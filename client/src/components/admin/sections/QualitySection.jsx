import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../../lib/api.js';
import { onFrame } from '../../../lib/wsbus.js';
import { useAdmin } from '../store.jsx';
import { Card, Rows, Row, ToggleRow, Fields, Field, Input, Area, Select, Seg, Btn, IconBtn, Acts, Table, Badge, Stats, Empty, Note, Switch, fmtAgo } from '../ui.jsx';
import { Plus, Trash, Gauge, Chat, Flask } from '../../ui/icons.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { t, tk, fmtNumber, fmtDate } from '../../../i18n.jsx';
import { ReviewDialog, AddToCollection, VERDICT_TONE, verdictLabel } from './EvalShared.jsx';
import { dailyRates, criterionRates } from '../../../lib/quality.js';

const KIND_LABEL = { __proto__: null, policy: tk('Internal policy'), grounding: tk('Uses supplied documents'), resolution: tk('Unresolved requests'), custom: tk('Custom') };
const PERIODS = [7, 30, 90];
const PAGE = 50;

function CriterionCard({ c, models, onChange, onRemove }) {
  const set = (patch) => onChange({ ...c, ...patch });
  return (
    <div className={'qa-criterion' + (c.enabled ? '' : ' off')}>
      <div className="qa-criterion-head">
        <Input value={c.name} aria-label={t('Check name')} onChange={(e) => set({ name: e.target.value })} />
        <Badge>{t(KIND_LABEL[c.kind] || KIND_LABEL.custom)}</Badge>
        <Switch on={c.enabled} label={t('Enabled')} onToggle={() => set({ enabled: !c.enabled })} />
        <IconBtn kind="danger" label={t('Remove check')} onClick={onRemove}><Trash /></IconBtn>
      </div>
      <Fields>
        <Field label={t('What the judge looks for')}>
          <Area rows={4} value={c.instruction} onChange={(e) => set({ instruction: e.target.value })} />
        </Field>
        {c.kind === 'policy' && (
          <Field label={t('Policy text')} hint={t('Paste the policy replies must follow. The judge quotes the part a reply breaks.')}>
            <Area rows={6} value={c.policy} onChange={(e) => set({ policy: e.target.value })} />
          </Field>
        )}
        <Field label={t('Models')} hint={t('Leave all off to check every model.')}>
          <div className="mc-chips" role="group" aria-label={t('Models')}>
            {models.map(m => (
              <button key={m.value} type="button" className="mc-chip" aria-pressed={c.models.includes(m.value)}
                onClick={() => set({ models: c.models.includes(m.value) ? c.models.filter(x => x !== m.value) : [...c.models, m.value] })}>
                {m.label}
              </button>
            ))}
          </div>
        </Field>
      </Fields>
    </div>
  );
}

function Trend({ report, days }) {
  const series = useMemo(() => dailyRates(report.daily, report.since, days), [report, days]);
  const peak = Math.max(1, ...series.map(d => d.pass + d.fail));
  if (!series.some(d => d.pass + d.fail)) return <Empty title={t('No checks in this period')} />;
  return (
    <>
      <div className="qa-trend" role="img" aria-label={t('Checks per day, failed and passed')}>
        {series.map(d => (
          <div key={d.day} className="qa-trend-day" style={{ height: Math.round(((d.pass + d.fail) / peak) * 100) + '%' }}
            data-tip={t('{date}: {fail} failed, {pass} passed', { date: fmtDate(d.day * 86400000), fail: d.fail, pass: d.pass })}>
            {d.fail > 0 && <span className="fail" style={{ flexGrow: d.fail }} />}
            {d.pass > 0 && <span className="pass" style={{ flexGrow: d.pass }} />}
          </div>
        ))}
      </div>
      <div className="qa-trend-axis"><span>{fmtDate(series[0].day * 86400000)}</span><span>{fmtDate(series.at(-1).day * 86400000)}</span></div>
      <div className="qa-legend"><span><i className="fail" />{t('Failed')}</span><span><i className="pass" />{t('Passed')}</span></div>
    </>
  );
}

export default function QualitySection() {
  const { catalog } = useAdmin();
  const models = useMemo(() => catalog.models.map(m => ({ value: m.id, label: m.display_name || m.internal_name || m.id })), [catalog.models]);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [days, setDays] = useState(30);
  const [results, setResults] = useState(null);
  const [filter, setFilter] = useState({ criterion: '', verdict: 'fail', offset: 0 });
  const [note, setNote] = useState('');
  const [backfill, setBackfill] = useState({ days: 7, limit: 100 });
  const [backfillError, setBackfillError] = useState('');
  const [review, setReview] = useState(null);
  const [adding, setAdding] = useState(null);

  const load = useCallback(() => api.get('/api/admin/quality?days=' + days).then(d => {
    setData(d);
    setDraft(cur => cur || d.settings);
  }).catch(() => {}), [days]);
  const loadResults = useCallback(() => {
    const q = new URLSearchParams({ days: String(days), criterion: filter.criterion, verdict: filter.verdict, offset: String(filter.offset) });
    api.get('/api/admin/quality/results?' + q).then(setResults).catch(() => setResults({ results: [], total: 0 }));
  }, [days, filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadResults(); }, [loadResults]);
  useEffect(() => onFrame('eval_job', (job) => {
    if (job.kind !== 'quality') return;
    setData(d => (d ? { ...d, jobs: [job, ...d.jobs.filter(j => j.id !== job.id)] } : d));
    if (job.status !== 'running') { load(); loadResults(); }
  }), [load, loadResults]);

  const dirty = data && draft && JSON.stringify(draft) !== JSON.stringify(data.settings);
  const rates = useMemo(() => (data ? criterionRates(data.report.tally, draft?.criteria || []) : []), [data, draft]);
  const job = data?.jobs.find(j => j.status === 'running');
  const totals = rates.reduce((s, r) => ({ checks: s.checks + r.pass + r.fail + r.na, fail: s.fail + r.fail }), { checks: 0, fail: 0 });

  async function save() {
    setNote('');
    try {
      const r = await api.put('/api/admin/quality/settings', draft);
      setData(d => ({ ...d, settings: r.settings }));
      setDraft(r.settings);
      setNote(t('Saved.'));
    } catch (e) { setNote(e.message || t('Could not save.')); }
  }
  function addCriterion(kind) {
    const tpl = data.templates.find(x => x.kind === kind) || { name: '', instruction: '' };
    setDraft(d => ({ ...d, criteria: [...d.criteria, { id: 'new-' + Date.now(), kind, name: tpl.name || t('New check'), instruction: tpl.instruction || '', policy: '', models: [], enabled: true }] }));
  }
  async function startBackfill() {
    setBackfillError('');
    try { await api.post('/api/admin/quality/backfill', backfill); load(); }
    catch (e) { setBackfillError(e.message || t('Could not start the review.')); }
  }

  if (!data || !draft) return <Skel when><SkelTable cols={4} rows={6} /></Skel>;

  return (
    <>
      <Stats items={[
        { k: t('Checks run'), v: fmtNumber(totals.checks), n: t('Last {n} days', { n: days }) },
        { k: t('Failed'), v: fmtNumber(totals.fail), n: totals.checks ? fmtNumber(totals.fail / totals.checks, { style: 'percent', maximumFractionDigits: 1 }) : undefined },
        { k: t('Sampling'), v: draft.enabled ? fmtNumber(draft.sampleRate / 100, { style: 'percent' }) : t('Off') }
      ]} />

      <Card title={t('Automatic review')}
        sub={t('A judge model reads a sample of new replies and checks each one against the criteria below. It runs in the background after a reply is saved, never slows a chat, and never reads incognito chats.')}
        foot={<Acts><Btn kind="primary" disabled={!dirty} onClick={save}>{t('Save checks')}</Btn><span className="cp-note-line" role="status">{note}</span></Acts>}>
        <Rows>
          <ToggleRow label={t('Review new replies')} on={draft.enabled} onToggle={() => setDraft(d => ({ ...d, enabled: !d.enabled }))}
            note={t('Members are told in Settings that replies may be reviewed, and that an admin can open a conversation only when one of its replies is flagged, rated or saved as a test case.')} />
          <Row label={t('Share of new replies to check')} note={t('Each check costs one judge call per criterion.')}>
            <span className="qa-rate-pick">
              <Input type="number" min={0} max={100} value={draft.sampleRate} aria-label={t('Share of new replies to check')}
                onChange={(e) => setDraft(d => ({ ...d, sampleRate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))} />
              <span className="dim">%</span>
            </span>
          </Row>
        </Rows>
        <div className="qa-criteria">
          {draft.criteria.length === 0 && <Note>{t('Add a check to start.')}</Note>}
          {draft.criteria.map((c, i) => (
            <CriterionCard key={c.id} c={c} models={models}
              onChange={(next) => setDraft(d => ({ ...d, criteria: d.criteria.map((x, j) => (j === i ? next : x)) }))}
              onRemove={() => setDraft(d => ({ ...d, criteria: d.criteria.filter((_, j) => j !== i) }))} />
          ))}
        </div>
        <Acts>
          {data.templates.map(tpl => <Btn key={tpl.kind} size="sm" onClick={() => addCriterion(tpl.kind)}><Plus /> {t(KIND_LABEL[tpl.kind])}</Btn>)}
          <Btn size="sm" onClick={() => addCriterion('custom')}><Plus /> {t('Custom check')}</Btn>
        </Acts>
      </Card>

      <Card title={t('Review past chats')} sub={t('Run the saved checks over replies already in the chat history.')}>
        <Rows>
          <Row label={t('Period')}>
            <Seg value={backfill.days} label={t('Period')} onChange={(v) => setBackfill(b => ({ ...b, days: v }))}
              options={PERIODS.map(n => ({ value: n, label: t('{n} days', { n }) }))} />
          </Row>
          <Row label={t('At most')} note={t('Newest replies first.')}>
            <span className="qa-rate-pick">
              <Input type="number" min={1} max={1000} value={backfill.limit} aria-label={t('At most')}
                onChange={(e) => setBackfill(b => ({ ...b, limit: Math.min(1000, Math.max(1, Number(e.target.value) || 1)) }))} />
              <span className="dim">{t('replies')}</span>
            </span>
          </Row>
        </Rows>
        {job ? (
          <div className="ev-job" role="status">
            <div className="ev-job-text"><b>{t('Checked {done} of {total}', { done: job.done, total: job.total })}</b></div>
            <div className="ev-bar" aria-hidden="true"><span style={{ width: (job.total ? Math.round((job.done / job.total) * 100) : 0) + '%' }} /></div>
            <Btn size="sm" onClick={() => api.post('/api/admin/evals/jobs/' + job.id + '/stop').catch(() => {})}>{t('Stop')}</Btn>
          </div>
        ) : (
          <Acts><Btn disabled={dirty || !data.settings.criteria.some(c => c.enabled)} onClick={startBackfill}>{t('Start review')}</Btn>{dirty && <span className="cp-note-line">{t('Save the checks first.')}</span>}</Acts>
        )}
        {backfillError && <Note tone="bad">{backfillError}</Note>}
      </Card>

      <Card title={t('Trends')} actions={<Seg value={days} label={t('Period')} onChange={setDays} options={PERIODS.map(n => ({ value: n, label: t('{n} days', { n }) }))} />}>
        <Trend report={data.report} days={days} />
        {rates.length > 0 && (
          <ul className="qa-rates" aria-label={t('Failure rate by check')}>
            {rates.map(r => {
              const total = r.pass + r.fail;
              return (
                <li key={r.id} className="qa-rate">
                  <span className="qa-rate-name">{r.name}</span>
                  <span className="qa-rate-bar" aria-hidden="true">
                    {r.fail > 0 && <span className="fail" style={{ flexGrow: r.fail }} />}
                    {r.pass > 0 && <span className="pass" style={{ flexGrow: r.pass }} />}
                  </span>
                  <span className="qa-rate-n">{total ? t('{fail} of {total} failed', { fail: r.fail, total }) : t('No checks')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t('Recurring problems')} flush sub={t('Failures grouped by check and model, most frequent first.')}>
        {data.report.recurring.length === 0
          ? <Empty icon={Gauge} title={t('No failures in this period')} />
          : (
            <Table head={[{ label: t('Check') }, { label: t('Model'), mono: true }, { label: t('Failures'), num: true, fit: true }]}>
              {data.report.recurring.map((r, i) => (
                <tr key={i}>
                  <td>{draft.criteria.find(c => c.id === r.criterion)?.name || t('Removed check')}</td>
                  <td className="mono dim">{r.model || '-'}</td>
                  <td className="num mono"><button type="button" className="ev-link" onClick={() => setFilter({ criterion: r.criterion, verdict: 'fail', offset: 0 })}>{fmtNumber(r.n)}</button></td>
                </tr>
              ))}
            </Table>
          )}
      </Card>

      <Card title={t('Results')} flush
        actions={<>
          <Select value={filter.criterion} label={t('Check')} onChange={(v) => setFilter(f => ({ ...f, criterion: v, offset: 0 }))}
            options={[{ value: '', label: t('All checks') }, ...draft.criteria.map(c => ({ value: c.id, label: c.name }))]} />
          <Seg value={filter.verdict} label={t('Verdict')} onChange={(v) => setFilter(f => ({ ...f, verdict: v, offset: 0 }))}
            options={[{ value: 'fail', label: t('Failed') }, { value: 'pass', label: t('Passed') }, { value: '', label: t('All') }]} />
        </>}
        foot={results && results.total > PAGE ? <>
          <Btn size="sm" disabled={filter.offset === 0} onClick={() => setFilter(f => ({ ...f, offset: Math.max(0, f.offset - PAGE) }))}>{t('Newer')}</Btn>
          <Btn size="sm" disabled={filter.offset + PAGE >= results.total} onClick={() => setFilter(f => ({ ...f, offset: f.offset + PAGE }))}>{t('Older')}</Btn>
        </> : null}>
        <Skel when={!results}><SkelTable cols={5} rows={5} /></Skel>
        {results && results.results.length === 0 && <Empty icon={Gauge} title={t('Nothing here yet')}>{t('Results appear as replies are checked.')}</Empty>}
        {results && results.results.length > 0 && (
          <Table head={[{ label: t('When'), fit: true }, { label: t('Verdict'), fit: true }, { label: t('Check') }, { label: t('Reply') }, { label: t('Why') }, { label: '', fit: true }]}>
            {results.results.map(r => (
              <tr key={r.id}>
                <td className="dim">{fmtAgo(r.ts)}</td>
                <td className="fit"><Badge tone={VERDICT_TONE[r.verdict]}>{verdictLabel(r.verdict)}</Badge></td>
                <td className="wrap">{r.criterion_name}<div className="dim mono">{r.model_name}</div></td>
                <td className="wrap qa-excerpt">
                  {r.question && <div><b>{t('Asked')}:</b> {r.question}</div>}
                  <div><b>{t('Replied')}:</b> {r.excerpt}</div>
                </td>
                <td className="wrap qa-excerpt">{r.explanation}{r.evidence && <div className="dim">“{r.evidence}”</div>}</td>
                <td className="acts">
                  <Acts end>
                    {r.verdict === 'fail' && <IconBtn label={t('Open conversation')} onClick={() => setReview({ chatId: r.chat_id, messageId: r.message_id })}><Chat /></IconBtn>}
                    {r.verdict === 'fail' && <IconBtn label={t('Add to a test collection')} onClick={() => setAdding(r.message_id)}><Flask /></IconBtn>}
                  </Acts>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {review && <ReviewDialog chatId={review.chatId} messageId={review.messageId} onClose={() => setReview(null)} />}
      {adding && <AddToCollection messageId={adding} kind="quality" onClose={() => setAdding(null)} />}
    </>
  );
}