import '../../styles/admin.css';
import '../../styles/models.css';
import '../../styles/playground.css';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AdminProvider, useAdmin, useUndoKeys } from '../admin/store.jsx';
import { Confirm, IconBtn, Tabs, Empty, CopyBtn, SectionSkeleton } from '../admin/ui.jsx';
import { ReviewButton, ReviewDialog, Faces } from '../admin/changes/Review.jsx';
import ChangesPanel from '../admin/changes/ChangesPanel.jsx';
import Inspector from '../admin/models/Inspector.jsx';
import BrandMark from '../ui/BrandMark.jsx';
import { X, Panel, Trash, Cube } from '../ui/icons.jsx';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { useFocusTrap } from '../../lib/focus.js';
import { t, tk } from '../../i18n.jsx';
import {
  STORE_KEY, STORE_MAX, newId, laneKey, makeLane, addLane, moveSubject, laneRow, historyFor, tally, suiteWins,
  restoreSession, blankSuite, patchCase, transcriptJson
} from '../../lib/playground.js';
import { streamReply, streamJobs } from '../playground/stream.js';
import { SubjectPicker, LaneBar } from '../playground/Lanes.jsx';
import { RequestDialog } from '../playground/Reply.jsx';
import Conversation from '../playground/Conversation.jsx';
import Suites from '../playground/Suites.jsx';

const PROBES = [
  { label: tk('Baseline'), text: tk('In one short paragraph, explain what a context window is.') },
  { label: tk('Instruction following'), text: tk('Reply with exactly five words, no punctuation.') },
  { label: tk('Structured output'), text: tk('Return only JSON: {"city":string,"country":string} for Kyoto. No prose, no code fence.') },
  { label: tk('Reasoning'), text: tk('A bat and a ball cost 1.10 together. The bat costs 1.00 more than the ball. What does the ball cost? Show your working.') }
];

const SAVE_DELAY = 500;
const STORE_DELAY = 400;

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
}

function writeStore(state) {
  try {
    const raw = JSON.stringify(state);
    if (raw.length <= STORE_MAX) localStorage.setItem(STORE_KEY, raw);
  } catch {}
}

function laneFromKey(key) {
  const at = key.lastIndexOf(':');
  return makeLane(key.slice(0, at), key.slice(at + 1));
}

function Workbench() {
  const { user, onClose, catalog, changes, workspace, present, ask, setAsk, confirm } = useAdmin();
  const { models, ready, setSelection, flush } = catalog;
  const { live: liveChanged, order: liveOrder } = catalog.draft;
  const live = useMemo(() => {
    const out = {};
    for (const id of liveOrder || []) out[id] = liveChanged && id in liveChanged ? liveChanged[id] : models.find(m => m.id === id) || null;
    return out;
  }, [liveChanged, liveOrder, models]);
  const changed = useMemo(() => new Set(catalog.draft.changed || []), [catalog.draft.changed]);
  const [session, setSession] = useState(null);
  const [suites, setSuites] = useState([]);
  const [suitesLoaded, setSuitesLoaded] = useState(false);
  const [busy, setBusy] = useState(() => new Set());
  const [review, setReview] = useState(false);
  const [request, setRequest] = useState(null);
  const sessionRef = useRef(null);
  const suitesRef = useRef([]);
  const saveTimer = useRef(null);
  const controllers = useRef(new Map());
  const scrimRef = useRef(null);
  sessionRef.current = session;

  const running = busy.size > 0;

  useUndoKeys(scrimRef);
  useFocusTrap(scrimRef, (e) => {
    if (e?.target?.closest?.('input, textarea, select') || controllers.current.size) return;
    onClose();
  }, { initial: scrimRef });

  useEffect(() => {
    if (!ready || session) return;
    const s = restoreSession(readStore(), models.map(m => m.id));
    const subjectId = s.subjectId || (models.find(m => m.is_default) || models[0])?.id || '';
    const lanes = s.lanes[0]?.modelId === subjectId && s.lanes[0]?.source === 'draft'
      ? s.lanes
      : moveSubject(s.lanes.length ? s.lanes : [makeLane(subjectId)], s.lanes[0]?.modelId, subjectId);
    setSession({ ...s, subjectId, lanes });
  }, [ready, models, session]);

  useEffect(() => {
    if (!session) return undefined;
    const id = setTimeout(() => writeStore(session), STORE_DELAY);
    return () => clearTimeout(id);
  }, [session]);

  const subjectId = session?.subjectId || '';
  useEffect(() => { if (subjectId) setSelection([subjectId]); }, [subjectId, setSelection]);

  useEffect(() => {
    if (!session || !ready || !models.length || models.some(m => m.id === subjectId)) return;
    const next = (models.find(m => m.is_default) || models[0]).id;
    setSession(s => ({ ...s, subjectId: next, lanes: moveSubject(s.lanes, s.subjectId, next) }));
  }, [session, ready, models, subjectId]);

  useEffect(() => {
    let alive = true;
    api.get('/api/admin/playground/suites')
      .then(r => { if (alive) { suitesRef.current = r.suites || []; setSuites(suitesRef.current); } })
      .catch(() => {})
      .finally(() => { if (alive) setSuitesLoaded(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => {
    for (const c of controllers.current.values()) c.abort();
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      api.put('/api/admin/playground/suites', { suites: suitesRef.current }).catch(() => {});
    }
  }, []);

  const editSuites = useCallback((fn) => {
    const next = fn(suitesRef.current);
    suitesRef.current = next;
    setSuites(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      try { await api.put('/api/admin/playground/suites', { suites: suitesRef.current }); }
      catch (e) { toast(e?.message || t('The test sets could not be saved.'), { kind: 'error', icon: 'info' }); }
    }, SAVE_DELAY);
  }, []);

  const patch = useCallback((p) => setSession(s => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })), []);

  const begin = (id) => {
    const c = new AbortController();
    controllers.current.set(id, c);
    setBusy(b => new Set(b).add(id));
    return c;
  };
  const end = (id) => {
    controllers.current.delete(id);
    setBusy(b => { const n = new Set(b); n.delete(id); return n; });
  };
  const stopAll = () => {
    for (const c of controllers.current.values()) c.abort();
  };

  const fallbackError = (status) => t('Upstream error {status}', { status });
  const groupOf = (lane) => laneRow(lane, models, live)?.provider_id || '';

  const shell = (lane) => {
    const row = laneRow(lane, models, live);
    return {
      key: laneKey(lane), name: row?.display_name || '', icon: row?.static_icon || '', source: lane.source,
      status: 'queue', content: '', reasoning: '', error: '', startedAt: Date.now()
    };
  };

  const patchReply = (turnId, i, r) => setSession(s => ({
    ...s,
    thread: s.thread.map(turn => (turn.id !== turnId ? turn : { ...turn, replies: turn.replies.map((x, j) => (j === i ? { ...x, ...r } : x)) }))
  }));

  async function runTurn(base) {
    const lanes = sessionRef.current.lanes;
    const id = newId();
    patch({ thread: [...base, { id, role: 'assistant', pick: 0, chosen: false, replies: lanes.map(shell) }] });
    const ctl = begin(id);
    await flush();
    const history = historyFor(base);
    await streamJobs({
      jobs: lanes.map((lane, i) => ({ lane, history, onPatch: (r) => patchReply(id, i, r) })),
      groupOf, signal: ctl.signal, fallbackError
    });
    end(id);
  }

  async function rerunReply(turnId, i) {
    const s = sessionRef.current;
    const at = s.thread.findIndex(x => x.id === turnId);
    const turn = s.thread[at];
    if (!turn) return;
    const lane = s.lanes.find(l => laneKey(l) === turn.replies[i].key) || laneFromKey(turn.replies[i].key);
    patchReply(turnId, i, { ...shell(lane), usage: null, request: null, finish: '', firstAt: 0, endedAt: 0 });
    const ctl = begin(turnId);
    await flush();
    await streamReply({
      lane, history: historyFor(s.thread.slice(0, at)), signal: ctl.signal, fallbackError, onPatch: (r) => patchReply(turnId, i, r)
    });
    end(turnId);
  }

  function rerunTurn(turnId) {
    const s = sessionRef.current;
    const at = s.thread.findIndex(x => x.id === turnId);
    if (at >= 0) runTurn(s.thread.slice(0, at));
  }

  function submit() {
    const s = sessionRef.current;
    const text = s.input.trim();
    if (s.role !== 'user') {
      if (text) patch({ thread: [...s.thread, { id: newId(), role: s.role, content: text }], input: '' });
      return;
    }
    const base = text ? [...s.thread, { id: newId(), role: 'user', content: text }] : s.thread;
    if (!historyFor(base).length) return;
    patch({ input: '' });
    runTurn(base);
  }

  const setTurn = (id, fn) => patch(s => ({ thread: s.thread.map(x => (x.id === id ? fn(x) : x)) }));

  const suite = useMemo(() => {
    if (!session) return null;
    return suites.find(x => x.id === session.suiteId) || suites[0] || null;
  }, [suites, session]);
  const rows = (session && suite && session.results[suite.id]) || null;

  const patchRow = (sid, cid, fn) => setSession(s => {
    const sr = s.results[sid] || {};
    return { ...s, results: { ...s.results, [sid]: { ...sr, [cid]: fn(sr[cid] || { pick: '', cells: {} }) } } };
  });
  const dropRow = (sid, cid) => setSession(s => {
    const sr = { ...(s.results[sid] || {}) };
    delete sr[cid];
    return { ...s, results: { ...s.results, [sid]: sr } };
  });

  async function runCases(sid, cases, id) {
    const lanes = sessionRef.current.lanes;
    const shells = Object.fromEntries(lanes.map(l => [laneKey(l), shell(l)]));
    for (const c of cases) patchRow(sid, c.id, row => ({ pick: '', cells: { ...row.cells, ...shells } }));
    const ctl = begin(id);
    await flush();
    await streamJobs({
      jobs: lanes.flatMap(lane => cases.map(c => ({
        lane,
        history: [{ role: 'user', content: c.prompt }],
        onPatch: (r) => patchRow(sid, c.id, row => ({ ...row, cells: { ...row.cells, [laneKey(lane)]: { ...row.cells[laneKey(lane)], ...r } } }))
      }))),
      groupOf, signal: ctl.signal, fallbackError
    });
    end(id);
  }

  function createSuite(starter) {
    const su = blankSuite(starter ? t('Starter checks') : t('New set'), starter ? PROBES.map(p => ({ prompt: t(p.text) })) : []);
    editSuites(list => [...list, su]);
    patch({ suiteId: su.id, mode: 'suite' });
  }

  function deleteSuite() {
    if (!suite) return;
    confirm({
      title: t('Delete test set'),
      message: t('This removes “{name}” and its prompts for every admin. This cannot be undone.', { name: suite.name }),
      confirm: t('Delete set'),
      onConfirm: () => {
        editSuites(list => list.filter(x => x.id !== suite.id));
        patch(s => {
          const results = { ...s.results };
          delete results[suite.id];
          return { results, suiteId: '' };
        });
      }
    });
  }

  const reviewScope = useCallback((c) => c.scope === 'model' && c.target === subjectId, [subjectId]);
  const subjectChanges = useMemo(() => changes.changes.filter(reviewScope).length, [changes.changes, reviewScope]);
  const subjectRow = useMemo(() => models.find(m => m.id === subjectId) || null, [models, subjectId]);
  const inspected = useMemo(() => (subjectRow ? [subjectRow] : []), [subjectRow]);

  if (!ready || !session) {
    return <Frame scrimRef={scrimRef} workspace={workspace} onClose={onClose}><div className="pg-loading"><SectionSkeleton /></div></Frame>;
  }

  if (!models.length) {
    return (
      <Frame scrimRef={scrimRef} workspace={workspace} onClose={onClose}>
        <Empty icon={Cube} title={t('The catalog is empty')}>
          {t('Add a model in the admin panel first. The playground tests models from the catalog.')}
        </Empty>
      </Frame>
    );
  }

  const mode = session.mode;
  const wins = mode === 'chat' ? tally(session.thread) : suiteWins(rows, session.lanes);
  const panel = session.panel !== false;

  return (
    <Frame scrimRef={scrimRef} workspace={workspace} onClose={() => { stopAll(); onClose(); }}
      center={<SubjectPicker models={models} subject={subjectRow} changed={changed}
        onPick={(id) => patch(s => ({ subjectId: id, lanes: moveSubject(s.lanes, s.subjectId, id) }))} />}
      acts={<>
        <Faces people={present} where />
        <ReviewButton />
        <IconBtn kind={panel ? undefined : 'quiet'} size="" aria-pressed={panel}
          label={panel ? t('Hide model settings') : t('Show model settings')}
          onClick={() => patch({ panel: !panel })}><Panel /></IconBtn>
      </>}>
      <div className={'pg-body' + (panel && subjectRow ? ' with-panel' : '')}>
        <main className="pg-bench" aria-label={t('Test bench')}>
          <div className="pg-bench-head">
            <Tabs label={t('Mode')} value={mode} onChange={(m) => patch({ mode: m })}
              items={[{ id: 'chat', label: t('Conversation') }, { id: 'suite', label: t('Test sets'), count: suites.length }]} />
            {mode === 'chat' && (
              <div className="cp-acts">
                {session.thread.length > 0 && (
                  <CopyBtn title={t('Copy transcript as JSON')}
                    text={transcriptJson(session.thread, { model: subjectRow?.display_name || '' })} />
                )}
                <IconBtn kind="quiet" label={t('Clear conversation')} disabled={!session.thread.length || running}
                  onClick={() => patch({ thread: [] })}><Trash /></IconBtn>
              </div>
            )}
          </div>
          <LaneBar lanes={session.lanes} models={models} live={live} wins={wins} changes={subjectChanges}
            onLanes={(lanes) => patch({ lanes })}
            onAdd={(id, source) => patch(s => ({ lanes: addLane(s.lanes, id, source) }))}
            onReview={() => setReview(true)} />
          {mode === 'chat' ? (
            <Conversation thread={session.thread} busy={busy} probes={PROBES}
              input={session.input} setInput={(input) => patch({ input })}
              role={session.role} setRole={(role) => patch({ role })}
              canRun={!!subjectRow && (!!session.input.trim() || session.thread.length > 0)}
              onSubmit={submit} onStop={stopAll}
              onEditTurn={(id, content) => setTurn(id, x => ({ ...x, content }))}
              onRoleTurn={(id, role) => setTurn(id, x => ({ ...x, role }))}
              onDropTurn={(id) => patch(s => ({ thread: s.thread.filter(x => x.id !== id) }))}
              onRerunTurn={rerunTurn}
              onRerunReply={rerunReply}
              onPrefer={(id, i) => setTurn(id, x => ({ ...x, pick: i, chosen: true }))}
              onEditReply={(id, i, text) => setTurn(id, x => ({ ...x, replies: x.replies.map((r, j) => (j === i ? { ...r, content: text } : r)) }))}
              onRequest={(replies, at) => setRequest({ replies, at })} />
          ) : (
            <Suites suites={suites} suite={suite} rows={rows} lanes={session.lanes} busy={busy}
              loaded={suitesLoaded} starter={PROBES}
              onPick={(id) => patch({ suiteId: id })}
              onCreate={createSuite}
              onRename={(name) => editSuites(list => list.map(x => (x.id === suite.id ? { ...x, name } : x)))}
              onDelete={deleteSuite}
              onAddCase={(prompt) => editSuites(list => list.map(x => (x.id === suite.id ? { ...x, cases: [...x.cases, { id: newId(), prompt, expect: '' }] } : x)))}
              onPatchCase={(cid, p) => {
                const before = suite.cases.find(c => c.id === cid);
                editSuites(list => patchCase(list, suite.id, cid, p));
                if (before && before.prompt !== p.prompt) dropRow(suite.id, cid);
              }}
              onDropCase={(cid) => { editSuites(list => list.map(x => (x.id === suite.id ? { ...x, cases: x.cases.filter(c => c.id !== cid) } : x))); dropRow(suite.id, cid); }}
              onRunCase={(cid) => { const c = suite.cases.find(x => x.id === cid); if (c) runCases(suite.id, [c], 'case:' + c.id); }}
              onRunAll={() => runCases(suite.id, suite.cases, 'suite:' + suite.id)}
              onStop={stopAll}
              onPrefer={(cid, key) => patchRow(suite.id, cid, row => ({ ...row, pick: row.pick === key ? '' : key }))}
              onRequest={(replies, at) => setRequest({ replies, at })} />
          )}
        </main>
        {panel && subjectRow && (
          <aside className="pg-panel" aria-label={t('Model settings')}>
            <Inspector models={inspected} onDismiss={() => patch({ panel: false })} />
          </aside>
        )}
      </div>
      <Confirm ask={ask} onClose={() => setAsk(null)} />
      <ReviewDialog />
      {review && <ChangesPanel changes={changes} user={user} scope={reviewScope} onClose={() => setReview(false)} />}
      {request && <RequestDialog replies={request.replies} at={request.at} onClose={() => setRequest(null)} />}
    </Frame>
  );
}

function Frame({ scrimRef, workspace, center, acts, onClose, children }) {
  return (
    <div className="cp-scrim" ref={scrimRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('Playground')}>
      <div className="cp pg">
        <header className="cp-top">
          <div className="cp-mark">
            <BrandMark src={workspace.config.appIcon} />
            <b>{workspace.config.appName || 'open-quill'}</b>
            <span>{t('Playground')}</span>
          </div>
          {center}
          <div className="cp-top-spacer" />
          <div className="cp-top-acts">
            {acts}
            <button type="button" className="cp-exit" onClick={onClose} title={t('Close')} aria-label={t('Close')}><X /></button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function Playground({ user, onClose }) {
  return (
    <AdminProvider user={user} onClose={onClose} fixedSection="models">
      <Workbench />
    </AdminProvider>
  );
}