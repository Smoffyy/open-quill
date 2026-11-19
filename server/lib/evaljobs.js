import { uid } from '../db.js';
import { broadcastAdmins } from './ws/broadcast.js';

const PROGRESS_MS = 400;
const KEEP_FINISHED = 20;
const jobs = new Map();

function view(job) {
  return {
    id: job.id, kind: job.kind, label: job.label, ref: job.ref, total: job.total, done: job.done, failed: job.failed,
    status: job.status, error: job.error, startedAt: job.startedAt, finishedAt: job.finishedAt
  };
}

function announce(job, force = false) {
  const at = Date.now();
  if (!force && at - job.sentAt < PROGRESS_MS) return;
  job.sentAt = at;
  broadcastAdmins({ type: 'eval_job', job: view(job) });
}

function trim() {
  const finished = [...jobs.values()].filter(j => j.status !== 'running').sort((a, b) => b.finishedAt - a.finishedAt);
  for (const j of finished.slice(KEEP_FINISHED)) jobs.delete(j.id);
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).map(view);
}

export function activeJob(kind, ref) {
  return [...jobs.values()].find(j => j.status === 'running' && j.kind === kind && (ref === undefined || j.ref === ref)) || null;
}

export function stopJob(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  job.ctl.abort();
  return true;
}

export function startJob({ kind, label, ref = '', items, worker, onFinish = () => {} }) {
  const job = {
    id: uid(), kind, label, ref, total: items.length, done: 0, failed: 0, status: 'running', error: '',
    startedAt: Date.now(), finishedAt: 0, sentAt: 0, ctl: new AbortController()
  };
  jobs.set(job.id, job);
  announce(job, true);
  const finished = (async () => {
    for (const item of items) {
      if (job.ctl.signal.aborted) break;
      try {
        const ok = await worker(item, job.ctl.signal);
        if (ok === false) job.failed++;
      } catch (e) {
        if (job.ctl.signal.aborted) break;
        job.failed++;
        job.error = String(e?.message || e).slice(0, 300);
      }
      job.done++;
      announce(job);
    }
    job.status = job.ctl.signal.aborted ? 'stopped' : 'done';
    job.finishedAt = Date.now();
    try { await onFinish(job.status); } catch (e) { job.error = String(e?.message || e).slice(0, 300); }
    announce(job, true);
    trim();
  })();
  return { job: view(job), finished };
}