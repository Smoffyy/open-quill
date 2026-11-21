import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../../lib/api.js';
import { onFrame } from '../../../lib/wsbus.js';
import { useAdmin } from '../store.jsx';
import { Card, Rows, Row, Fields, Field, Input, Area, Select, Seg, Btn, IconBtn, Acts, Table, Badge, Stats, Empty, Dialog, Note, Tabs, fmtMoney, fmtAgo } from '../ui.jsx';
import { Plus, Trash, Pencil, Flask, Chevron, Retry, X } from '../../ui/icons.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { t, tk, fmtDateTime, fmtNumber } from '../../../i18n.jsx';
import { VERDICT_TONE, verdictLabel } from './EvalShared.jsx';

const OUTCOME = {
  __proto__: null,
  improved: { label: tk('Improved'), tone: 'good' },
  regressed: { label: tk('Worse'), tone: 'bad' },
  same: { label: tk('Unchanged'), tone: undefined },
  unknown: { label: tk('No score'), tone: 'warn' }
};
const SOURCE = { __proto__: null, manual: tk('Written'), chat: tk('From a chat'), rating: tk('From a rating'), quality: tk('From a check'), playground: tk('Playground') };

const fmtMs = (ms) => (Number.isFinite(ms) ? (ms >= 1000 ? t('{n} s', { n: fmtNumber(ms / 1000, { maximumFractionDigits: 1 }) }) : t('{n} ms', { n: fmtNumber(ms) })) : '-');
const fmtScore = (s) => (Number.isFinite(s) ? fmtNumber(s) : '-');

function useModels() {
  const { catalog } = useAdmin();
  return useMemo(() => catalog.models.map(m => ({ value: m.id, label: m.display_name || m.internal_name || m.id })), [catalog.models]);
}

function JobBar({ job, onStop }) {
  if (!job) return null;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <div className="ev-job" role="status">
      <div className="ev-job-text">
        <b>{t('Running {done} of {total}', { done: job.done, total: job.total })}</b>
        {job.failed > 0 && <span className="dim"> · {t('{n} failed', { n: job.failed })}</span>}
      </div>
      <div className="ev-bar" aria-hidden="true"><span style={{ width: pct + '%' }} /></div>
      {onStop && <Btn size="sm" onClick={onStop}>{t('Stop')}</Btn>}
    </div>
  );
}

function sideLabel(side, models) {
  const name = models.find(m => m.value === side.modelId)?.label || t('Removed model');
  const where = side.source === 'live' ? t('published') : t('draft');
  return `${name} (${where})${side.systemOverride ? ' · ' + t('custom prompt') : ''}`;
}

function OutcomeBadges({ summary, status }) {
  if (!summary && status !== 'stopped') return <span className="dim">-</span>;
  return (
    <span className="ev-badges">
      {status === 'stopped' && <Badge tone="warn">{t('Stopped')}</Badge>}
      {summary?.improved > 0 && <Badge tone="good">{t('{n} better', { n: summary.improved })}</Badge>}
      {summary?.regressed > 0 && <Badge tone="bad">{t('{n} worse', { n: summary.regressed })}</Badge>}
      {summary?.same > 0 && <Badge>{t('{n} same', { n: summary.same })}</Badge>}
      {summary?.unknown > 0 && <Badge tone="warn">{t('{n} unscored', { n: summary.unknown })}</Badge>}
    </span>
  );
}

function SideForm({ label, side, onChange, models }) {
  const [prompt, setPrompt] = useState(!!side.systemOverride);
  return (
    <div className="ev-side">
      <div className="ev-side-title">{label}</div>
      <Fields>
        <Field label={t('Configuration')}>
          <Seg value={side.source} label={t('Configuration')} onChange={(v) => onChange({ ...side, source: v })}
            options={[{ value: 'live', label: t('Published') }, { value: 'draft', label: t('Draft') }]} />
        </Field>
        <Field label={t('Model')}>
          <Select value={side.modelId} label={t('Model')} onChange={(v) => onChange({ ...side, modelId: v })} options={models} />
        </Field>
        {prompt ? (
          <Field label={t('System prompt to try')} hint={t('Replaces the model’s own prompt for this run only.')}>
            <Area mono rows={5} value={side.systemOverride} onChange={(e) => onChange({ ...side, systemOverride: e.target.value })} />
            <Acts><Btn size="sm" kind="quiet" onClick={() => { setPrompt(false); onChange({ ...side, systemOverride: '' }); }}>{t('Use the model’s prompt')}</Btn></Acts>
          </Field>
        ) : (
          <Acts><Btn size="sm" kind="quiet" onClick={() => setPrompt(true)}>{t('Try a different system prompt')}</Btn></Acts>
        )}
      </Fields>
    </div>
  );
}

function CaseEditor({ initial, onSave, onClose }) {
  const [draft, setDraft] = useState(() => ({
    title: initial?.title || '', reference: initial?.reference || '', notes: initial?.notes || '',
    messages: initial?.messages?.length ? initial.messages : [{ role: 'user', content: '' }]
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setTurn = (i, patch) => setDraft(d => ({ ...d, messages: d.messages.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const valid = draft.messages.length && draft.messages[draft.messages.length - 1].role === 'user' && draft.messages.every(m => m.content.trim());

  async function save() {
    setBusy(true);
    setError('');
    try { await onSave(draft); onClose(); }
    catch (e) { setError(e.message || t('Could not save the test case.')); }
    setBusy(false);
  }

  return (
    <Dialog title={initial ? t('Edit test case') : t('New test case')} size="wide" onClose={onClose}
      foot={<>
        <Btn onClick={onClose}>{t('Cancel')}</Btn>
        <Btn kind="primary" disabled={!valid || busy} onClick={save}>{t('Save test case')}</Btn>
      </>}>
      <Fields>
        <Field label={t('Title')} optional hint={t('Leave empty to use the last message.')}>
          <Input value={draft.title} onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))} />
        </Field>
      </Fields>
      <div className="ev-turns">
        <div className="ev-turns-head">{t('Conversation')}<span className="dim"> · {t('It must end with a member message: that is what each model answers.')}</span></div>
        {draft.messages.map((m, i) => (
          <div key={i} className="ev-turn">
            <Seg value={m.role} label={t('Speaker')} onChange={(v) => setTurn(i, { role: v })}
              options={[{ value: 'user', label: t('Member') }, { value: 'assistant', label: t('Assistant') }]} />
            <Area rows={3} value={m.content} aria-label={t('Message {n}', { n: i + 1 })} onChange={(e) => setTurn(i, { content: e.target.value })} />
            <IconBtn kind="quiet" label={t('Remove message')} disabled={draft.messages.length === 1}
              onClick={() => setDraft(d => ({ ...d, messages: d.messages.filter((_, j) => j !== i) }))}><X /></IconBtn>
          </div>
        ))}
        <Acts>
          <Btn size="sm" onClick={() => setDraft(d => ({ ...d, messages: [...d.messages, { role: d.messages.at(-1)?.role === 'user' ? 'assistant' : 'user', content: '' }] }))}>
            <Plus /> {t('Add message')}
          </Btn>
        </Acts>
      </div>
      {initial?.observed && (
        <Field label={t('What the model said at the time')}>
          <div className="ev-observed">{initial.observed}</div>
        </Field>
      )}
      <Fields>
        <Field label={t('Expert correction')} optional hint={t('What a correct answer says. Every reply in a run is judged against it.')}>
          <Area rows={5} value={draft.reference} onChange={(e) => setDraft(d => ({ ...d, reference: e.target.value }))} />
        </Field>
        <Field label={t('Notes')} optional>
          <Area rows={2} value={draft.notes} onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))} />
        </Field>
      </Fields>
      {error && <Note tone="bad">{error}</Note>}
    </Dialog>
  );
}

function SideResult({ label, side }) {
  return (
    <div className="ev-res-side">
      <div className="ev-res-head">
        <b>{label}</b>
        {side.verdict && <Badge tone={VERDICT_TONE[side.verdict]}>{verdictLabel(side.verdict)}</Badge>}
        <span className="dim">{t('Score {n}', { n: fmtScore(side.score) })} · {fmtMs(side.ms)} · {fmtMoney(side.cost)}</span>
      </div>
      {side.error
        ? <Note tone="bad">{side.error}</Note>
        : <div className="ev-res-text">{side.text || <span className="dim">{t('(empty)')}</span>}</div>}
      {side.explanation && <div className="ev-res-why"><b>{t('Judge')}:</b> {side.explanation}</div>}
      {side.judgeError && <div className="ev-res-why bad">{side.judgeError}</div>}
    </div>
  );
}

function RunDialog({ runId, models, onClose }) {
  const [run, setRun] = useState(null);
  const [open, setOpen] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(() => api.get('/api/admin/evals/runs/' + runId).then(d => setRun(d.run)).catch(() => {}), [runId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onFrame('eval_job', (job) => { if (run && job.id === run.job_id) load(); }), [run, load]);

  const s = run?.summary;
  const shown = (run?.results || []).filter(r => filter === 'all' || r.outcome === filter);
  const delta = (a, b, fmt) => (Number.isFinite(a) && Number.isFinite(b) ? `${fmt(a)} → ${fmt(b)}` : '-');

  return (
    <Dialog title={run ? t('Run on {name}', { name: run.collection_name }) : t('Run')} size="wide" onClose={onClose} foot={<Btn onClick={onClose}>{t('Close')}</Btn>}>
      <Skel when={!run}><SkelTable cols={3} rows={4} /></Skel>
      {run && (
        <>
          <div className="ev-run-sides">
            <div><span className="dim">{t('Baseline')}</span> {sideLabel(run.baseline, models)}</div>
            <div><span className="dim">{t('Candidate')}</span> {sideLabel(run.candidate, models)}</div>
            <div className="dim">{t('Version {n}', { n: run.version })} · {fmtDateTime(run.created_at)}{run.status === 'running' ? ' · ' + t('running') : run.status === 'stopped' ? ' · ' + t('stopped') : ''}</div>
          </div>
          {s && (
            <Stats items={[
              { k: t('Better'), v: fmtNumber(s.improved), n: t('{n} worse', { n: s.regressed }) },
              { k: t('Average score'), v: delta(s.baseline.score, s.candidate.score, fmtScore) },
              { k: t('Median response time'), v: delta(s.baseline.medianMs, s.candidate.medianMs, fmtMs) },
              { k: t('Cost'), v: `${fmtMoney(s.baseline.cost)} → ${fmtMoney(s.candidate.cost)}`, n: t('Includes the judge') }
            ]} />
          )}
          <Acts>
            <Seg value={filter} label={t('Show')} onChange={setFilter} options={[
              { value: 'all', label: t('All'), badge: run.results.length },
              { value: 'regressed', label: t('Worse'), badge: s?.regressed || 0 },
              { value: 'improved', label: t('Better'), badge: s?.improved || 0 },
              { value: 'same', label: t('Unchanged'), badge: s?.same || 0 }
            ]} />
          </Acts>
          <ul className="ev-results">
            {shown.map(r => (
              <li key={r.caseId} className={'ev-result' + (open === r.caseId ? ' open' : '')}>
                <button type="button" className="ev-result-head" aria-expanded={open === r.caseId} onClick={() => setOpen(o => (o === r.caseId ? '' : r.caseId))}>
                  <Chevron className="ev-chev" aria-hidden="true" />
                  <Badge tone={OUTCOME[r.outcome]?.tone}>{t(OUTCOME[r.outcome]?.label || OUTCOME.unknown.label)}</Badge>
                  <span className="ev-result-title">{r.title}</span>
                  <span className="dim mono">{fmtScore(r.base.score)} → {fmtScore(r.cand.score)}</span>
                </button>
                {open === r.caseId && (
                  <div className="ev-result-body">
                    {r.reference && <div className="ev-ref"><b>{t('Expert correction')}:</b> {r.reference}</div>}
                    <div className="ev-res-grid">
                      <SideResult label={t('Baseline')} side={r.base} />
                      <SideResult label={t('Candidate')} side={r.cand} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

function CollectionView({ id, models, jobs, onBack, onChanged }) {
  const { confirm, catalog } = useAdmin();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('cases');
  const [editing, setEditing] = useState(null);
  const [runId, setRunId] = useState('');
  const [error, setError] = useState('');
  const defaultModel = catalog.models.find(m => m.is_default)?.id || models[0]?.value || '';
  const [baseline, setBaseline] = useState({ source: 'live', modelId: defaultModel, systemOverride: '' });
  const [candidate, setCandidate] = useState({ source: 'draft', modelId: defaultModel, systemOverride: '' });
  const [version, setVersion] = useState(0);

  const load = useCallback(() => api.get('/api/admin/evals/' + id).then(setData).catch(() => setData({ missing: true })), [id]);
  const job = jobs.find(j => j.kind === 'regression' && j.ref === id && j.status === 'running');
  useEffect(() => { if (!job) load(); }, [job?.id, load]);

  if (!data) return <Card><Skel when><SkelTable cols={4} rows={5} /></Skel></Card>;
  if (data.missing) return <Card><Empty title={t('This collection was deleted.')} actions={<Btn onClick={onBack}>{t('Back')}</Btn>} /></Card>;
  const c = data.collection;

  async function saveCase(draft) {
    if (editing?.id) await api.patch(`/api/admin/evals/${id}/cases/${editing.id}`, draft);
    else await api.post(`/api/admin/evals/${id}/cases`, draft);
    await load();
    onChanged();
  }
  function removeCase(k) {
    confirm({
      title: t('Remove test case'), message: t('“{name}” leaves the collection. Earlier versions still have it.', { name: k.title }), confirm: t('Remove'),
      onConfirm: async () => { await api.del(`/api/admin/evals/${id}/cases/${k.id}`); await load(); onChanged(); }
    });
  }
  async function start() {
    setError('');
    try {
      const r = await api.post(`/api/admin/evals/${id}/runs`, { baseline, candidate, version: version || c.version });
      setRunId(r.run.id);
      setTab('runs');
      onChanged();
    } catch (e) { setError(e.message || t('Could not start the run.')); }
  }
  async function restore(v) {
    confirm({
      title: t('Restore version {n}', { n: v }), message: t('The cases from version {n} become a new version. Nothing is lost.', { n: v }), confirm: t('Restore'),
      onConfirm: async () => { await api.post(`/api/admin/evals/${id}/restore`, { version: v }); await load(); onChanged(); }
    });
  }
  function removeCollection() {
    confirm({
      title: t('Delete collection'), message: t('“{name}”, its versions and its runs are deleted.', { name: c.name }), confirm: t('Delete'),
      onConfirm: async () => { await api.del('/api/admin/evals/' + id); onChanged(); onBack(); }
    });
  }

  return (
    <>
      <div className="ev-crumb">
        <Btn size="sm" kind="quiet" onClick={onBack}><Chevron className="ev-back" aria-hidden="true" /> {t('All collections')}</Btn>
      </div>
      <Card title={c.name} sub={c.description || t('Version {n} · {count} cases', { n: c.version, count: c.cases.length })}
        actions={<IconBtn kind="danger" label={t('Delete collection')} onClick={removeCollection}><Trash /></IconBtn>}>
        <Tabs label={t('Collection')} value={tab} onChange={setTab} items={[
          { id: 'cases', label: t('Cases'), count: c.cases.length },
          { id: 'runs', label: t('Runs'), count: data.runs.length },
          { id: 'versions', label: t('Versions'), count: data.versions.length }
        ]} />
      </Card>

      {tab === 'cases' && (
        <Card title={t('Test cases')} flush sub={t('Each case is a conversation that ends with a member message, plus an optional expert correction.')}
          actions={<Btn kind="primary" size="sm" onClick={() => setEditing({})}><Plus /> {t('Add case')}</Btn>}>
          {c.cases.length === 0
            ? <Empty icon={Flask} title={t('No test cases yet')}>{t('Write one here, or add replies from Ratings or Quality to turn real conversations into tests.')}</Empty>
            : (
              <Table head={[{ label: t('Case') }, { label: t('Messages'), num: true, fit: true }, { label: t('Source'), fit: true }, { label: t('Correction'), fit: true }, { label: '', fit: true }]}>
                {c.cases.map(k => (
                  <tr key={k.id}>
                    <td className="wrap">{k.title}</td>
                    <td className="num mono">{k.messages.length}</td>
                    <td className="fit"><Badge>{t(SOURCE[k.source?.kind] || SOURCE.manual)}</Badge></td>
                    <td className="fit">{k.reference ? <Badge tone="good">{t('Yes')}</Badge> : <span className="dim">{t('No')}</span>}</td>
                    <td className="acts">
                      <Acts end>
                        <IconBtn label={t('Edit')} onClick={() => setEditing(k)}><Pencil /></IconBtn>
                        <IconBtn kind="danger" label={t('Remove')} onClick={() => removeCase(k)}><Trash /></IconBtn>
                      </Acts>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
        </Card>
      )}

      {tab === 'runs' && (
        <>
          <Card title={t('Compare two configurations')}
            sub={t('Every case runs on both sides, then the judge model scores each reply against the expert correction. Use the published configuration as the baseline and your draft as the candidate to see what a change would do before you publish it.')}>
            <div className="ev-sides">
              <SideForm label={t('Baseline')} side={baseline} onChange={setBaseline} models={models} />
              <SideForm label={t('Candidate')} side={candidate} onChange={setCandidate} models={models} />
            </div>
            <Rows>
              <Row label={t('Cases from')}>
                <Select value={version || c.version} label={t('Cases from')} onChange={(v) => setVersion(Number(v))}
                  options={[{ value: c.version, label: t('Current version ({n})', { n: c.version }) }, ...data.versions.filter(v => v.version !== c.version).map(v => ({ value: v.version, label: t('Version {n}', { n: v.version }) }))]} />
              </Row>
            </Rows>
            {job ? <JobBar job={job} onStop={() => api.post('/api/admin/evals/jobs/' + job.id + '/stop').catch(() => {})} /> : (
              <Acts>
                <Btn kind="primary" disabled={!c.cases.length || !baseline.modelId || !candidate.modelId} onClick={start}>{t('Run {n} cases', { n: c.cases.length })}</Btn>
              </Acts>
            )}
            {error && <Note tone="bad">{error}</Note>}
          </Card>
          <Card title={t('Runs')} flush>
            {data.runs.length === 0
              ? <Empty title={t('No runs yet')}>{t('Start one above.')}</Empty>
              : (
                <Table head={[{ label: t('When'), fit: true }, { label: t('Compared') }, { label: t('Outcome') }, { label: t('Score'), fit: true }, { label: t('Time'), fit: true }, { label: t('Cost'), fit: true }, { label: '', fit: true }]}>
                  {data.runs.map(r => (
                    <tr key={r.id}>
                      <td className="dim">{fmtAgo(r.created_at)}</td>
                      <td className="wrap">{sideLabel(r.baseline, models)} <span className="dim">{t('vs')}</span> {sideLabel(r.candidate, models)}</td>
                      <td>{r.status === 'running' ? <Badge tone="warn">{t('Running')}</Badge> : <OutcomeBadges summary={r.summary} status={r.status} />}</td>
                      <td className="mono fit">{r.summary ? `${fmtScore(r.summary.baseline.score)} → ${fmtScore(r.summary.candidate.score)}` : '-'}</td>
                      <td className="mono fit">{r.summary ? `${fmtMs(r.summary.baseline.medianMs)} → ${fmtMs(r.summary.candidate.medianMs)}` : '-'}</td>
                      <td className="mono fit">{r.summary ? `${fmtMoney(r.summary.baseline.cost)} → ${fmtMoney(r.summary.candidate.cost)}` : '-'}</td>
                      <td className="acts"><Btn size="sm" onClick={() => setRunId(r.id)}>{t('Open')}</Btn></td>
                    </tr>
                  ))}
                </Table>
              )}
          </Card>
        </>
      )}

      {tab === 'versions' && (
        <Card title={t('Versions')} flush sub={t('Every change to the cases is kept as a version, so a run can always be repeated on the exact same tests.')}>
          {data.versions.length === 0
            ? <Empty title={t('No versions yet')}>{t('Adding the first case creates version 1.')}</Empty>
            : (
              <Table head={[{ label: t('Version'), num: true, fit: true }, { label: t('Change') }, { label: t('By'), mono: true }, { label: t('When'), fit: true }, { label: t('Cases'), num: true, fit: true }, { label: '', fit: true }]}>
                {data.versions.map(v => (
                  <tr key={v.version}>
                    <td className="num mono">{v.version}</td>
                    <td className="wrap">{v.note || '-'}</td>
                    <td className="mono dim">{v.by || '-'}</td>
                    <td className="dim">{fmtAgo(v.created_at)}</td>
                    <td className="num mono">{v.caseCount ?? '-'}</td>
                    <td className="acts">
                      {v.version === c.version ? <Badge>{t('Current')}</Badge> : <Btn size="sm" onClick={() => restore(v.version)}><Retry /> {t('Restore')}</Btn>}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
        </Card>
      )}

      {editing && <CaseEditor initial={editing.id ? editing : null} onSave={saveCase} onClose={() => setEditing(null)} />}
      {runId && <RunDialog runId={runId} models={models} onClose={() => { setRunId(''); load(); }} />}
    </>
  );
}

export default function EvalsSection() {
  const models = useModels();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('/api/admin/evals').then(setData).catch(() => setData({ collections: [], runs: [], jobs: [], judge: { modelId: '' } })), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onFrame('eval_job', (job) => {
    setData(d => (d ? { ...d, jobs: [job, ...d.jobs.filter(j => j.id !== job.id)] } : d));
    if (job.status !== 'running') load();
  }), [load]);

  async function create() {
    setError('');
    try {
      const r = await api.post('/api/admin/evals', { name });
      setCreating(false);
      setName('');
      await load();
      setOpen(r.collection.id);
    } catch (e) { setError(e.message || t('Could not create the collection.')); }
  }
  async function setJudge(modelId) {
    try { const r = await api.put('/api/admin/evals/judge', { modelId }); setData(d => ({ ...d, judge: r.judge })); } catch {}
  }

  if (open) return <CollectionView id={open} models={models} jobs={data?.jobs || []} onBack={() => { setOpen(''); load(); }} onChanged={load} />;

  const lastRun = (cid) => data.runs.find(r => r.collection_id === cid);
  const cases = (data?.collections || []).reduce((n, c) => n + c.caseCount, 0);

  return (
    <>
      <Skel when={!data}><SkelTable cols={4} rows={4} /></Skel>
      {data && (
        <>
          <Stats items={[
            { k: t('Collections'), v: fmtNumber(data.collections.length) },
            { k: t('Test cases'), v: fmtNumber(cases) },
            { k: t('Runs kept'), v: fmtNumber(data.runs.length) }
          ]} />
          <Card title={t('Judge')} sub={t('The model that scores every reply. Pick your strongest model: it reads each conversation, the reply and the expert correction, and explains its score.')}>
            <Rows>
              <Row label={t('Judge model')}>
                <Select value={data.judge.modelId} label={t('Judge model')} onChange={setJudge}
                  options={[{ value: '', label: t('The default model') }, ...models]} />
              </Row>
            </Rows>
          </Card>
          <Card title={t('Test collections')} flush
            sub={t('Versioned sets of conversations drawn from real chats and expert corrections. Rerun them before you change a model or a system prompt.')}
            actions={<Btn kind="primary" size="sm" onClick={() => setCreating(true)}><Plus /> {t('New collection')}</Btn>}>
            {data.collections.length === 0
              ? <Empty icon={Flask} title={t('No test collections yet')}>{t('Create one, then add cases by hand or from rated and flagged replies.')}</Empty>
              : (
                <Table head={[{ label: t('Name') }, { label: t('Cases'), num: true, fit: true }, { label: t('Version'), num: true, fit: true }, { label: t('Last run') }, { label: t('Updated'), fit: true }]}>
                  {data.collections.map(c => {
                    const job = data.jobs.find(j => j.kind === 'regression' && j.ref === c.id && j.status === 'running');
                    return (
                      <tr key={c.id}>
                        <td><button type="button" className="ev-link" onClick={() => setOpen(c.id)}>{c.name}</button></td>
                        <td className="num mono">{c.caseCount}</td>
                        <td className="num mono">{c.version}</td>
                        <td>{job ? <JobBar job={job} /> : <OutcomeBadges summary={lastRun(c.id)?.summary} status={lastRun(c.id)?.status} />}</td>
                        <td className="dim">{fmtAgo(c.updated_at)}</td>
                      </tr>
                    );
                  })}
                </Table>
              )}
          </Card>
        </>
      )}
      {creating && (
        <Dialog title={t('New collection')} size="narrow" onClose={() => setCreating(false)}
          foot={<>
            <Btn onClick={() => setCreating(false)}>{t('Cancel')}</Btn>
            <Btn kind="primary" disabled={!name.trim()} onClick={create}>{t('Create')}</Btn>
          </>}>
          <Fields>
            <Field label={t('Name')}>
              <Input value={name} autoFocus placeholder={t('Billing questions')} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create(); }} />
            </Field>
          </Fields>
          {error && <Note tone="bad">{error}</Note>}
        </Dialog>
      )}
    </>
  );
}