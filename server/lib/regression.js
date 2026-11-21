import { db, uid, now } from '../db.js';
import { usageCost, recordUsage } from './budget.js';
import { getCollection, casesAt, LIMITS } from './evals.js';
import { resolveRun, prepareRun, runPrepared } from './playrun.js';
import { judge } from './judge.js';
import { transcript, compareScores } from './grader.js';
import { startJob, activeJob, listJobs } from './evaljobs.js';

const OVERRIDE_CAP = 24000;
const OUTPUT_CAP = 12000;
const RUN_TIMEOUT_MS = 300000;

export function cleanSide(raw) {
  const source = raw?.source === 'live' ? 'live' : 'draft';
  return {
    source,
    modelId: typeof raw?.modelId === 'string' ? raw.modelId.slice(0, 64) : '',
    systemOverride: typeof raw?.systemOverride === 'string' ? raw.systemOverride.slice(0, OVERRIDE_CAP) : ''
  };
}

function median(list) {
  const xs = list.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

function average(list) {
  const xs = list.filter(Number.isFinite);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

const sum = (list) => list.reduce((a, b) => a + (Number(b) || 0), 0);

function sideStats(results, key) {
  const sides = results.map(r => r[key]).filter(Boolean);
  return {
    score: average(sides.map(s => s.score)),
    medianMs: median(sides.filter(s => !s.error).map(s => s.ms)),
    cost: sum(sides.map(s => s.cost)) + sum(sides.map(s => s.judgeCost)),
    tokens: sum(sides.map(s => s.tokens)),
    passed: sides.filter(s => s.verdict === 'pass').length,
    errors: sides.filter(s => s.error).length
  };
}

export function summarize(results) {
  const counts = { improved: 0, regressed: 0, same: 0, unknown: 0 };
  for (const r of results) counts[r.outcome in counts ? r.outcome : 'unknown']++;
  return { cases: results.length, ...counts, baseline: sideStats(results, 'base'), candidate: sideStats(results, 'cand') };
}

async function runSide(side, kase, userId, signal) {
  const resolved = resolveRun(side.source, side.modelId, kase.messages);
  if (resolved.error) return { error: resolved.error, ms: 0, cost: 0, tokens: 0 };
  const run = prepareRun(resolved.model, { history: kase.messages, userId, systemOverride: side.systemOverride });
  const limit = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(RUN_TIMEOUT_MS)]);
  try {
    const r = await runPrepared(run, { userId, signal: limit });
    recordUsage(userId, run.model, r.usage && (r.usage.prompt || r.usage.completion) ? r.usage : null);
    return {
      text: r.text.slice(0, OUTPUT_CAP), ms: r.ms, firstTokenMs: r.firstTokenMs,
      tokens: r.usage.total || 0, cost: usageCost(run.model, r.usage), model: run.model.display_name || run.model.internal_name || ''
    };
  } catch (e) {
    if (signal?.aborted) throw e;
    const error = limit.aborted ? `The model did not answer within ${RUN_TIMEOUT_MS / 60000} minutes.` : String(e?.message || e).slice(0, 400);
    return { error, ms: 0, cost: 0, tokens: 0 };
  }
}

async function grade(kase, side, userId, signal) {
  if (side.error) return side;
  const verdict = await judge({ conversation: transcript(kase.messages), reply: side.text, reference: kase.reference }, { userId, signal });
  if (verdict.error) return { ...side, judgeError: verdict.error, judgeCost: verdict.cost || 0 };
  return { ...side, verdict: verdict.verdict, score: verdict.score, explanation: verdict.explanation, evidence: verdict.evidence, judgeCost: verdict.cost || 0 };
}

export function startRegression({ collectionId, version, baseline, candidate }, user) {
  const collection = getCollection(collectionId);
  if (!collection) return { status: 404, error: 'Collection not found.' };
  const cases = casesAt(collectionId, Number(version) || collection.version);
  if (!cases) return { status: 404, error: 'That version is no longer kept.' };
  if (!cases.length) return { status: 400, error: 'This collection has no test cases yet.' };
  const base = cleanSide(baseline);
  const cand = cleanSide(candidate);
  if (!base.modelId || !cand.modelId) return { status: 400, error: 'Pick a model for both sides.' };
  if (activeJob('regression', collectionId)) return { status: 409, error: 'This collection is already running.' };

  const run = db.evalRuns.insert({
    id: uid(), collection_id: collectionId, collection_name: collection.name, version: Number(version) || collection.version,
    baseline: base, candidate: cand, status: 'running', results: [], summary: null,
    started_by: user?.email || '', created_at: now(), finished_at: 0, job_id: ''
  });
  const results = [];
  const { job } = startJob({
    kind: 'regression', label: collection.name, ref: collectionId, items: cases,
    worker: async (kase, signal) => {
      const [b, c] = [await runSide(base, kase, user?.id || null, signal), await runSide(cand, kase, user?.id || null, signal)];
      const gb = await grade(kase, b, user?.id || null, signal);
      const gc = await grade(kase, c, user?.id || null, signal);
      results.push({ caseId: kase.id, title: kase.title, reference: kase.reference, base: gb, cand: gc, outcome: compareScores(gb.score, gc.score) });
      db.evalRuns.update(run.id, { results, summary: summarize(results) });
      return !b.error && !c.error;
    },
    onFinish: (status) => {
      db.evalRuns.update(run.id, { status, summary: summarize(results), finished_at: now() });
      db.evalRuns.keepLatest(collectionId, LIMITS.runsKept);
    }
  });
  db.evalRuns.update(run.id, { job_id: job.id });
  return { run: { ...run, job_id: job.id }, job };
}

export function settleInterrupted() {
  const live = new Set(listJobs().filter(j => j.status === 'running').map(j => j.id));
  for (const r of db.evalRuns.recent(500).filter(x => x.status === 'running' && !live.has(x.job_id))) {
    db.evalRuns.update(r.id, { status: 'stopped', finished_at: r.finished_at || now() });
  }
}