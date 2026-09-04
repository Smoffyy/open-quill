import React, { useState, useMemo, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import { t } from '../i18n.jsx';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';
import Tip from './Tip.jsx';
import { Copy, Check, ArrowOut, Chevron, Info, Pencil, Trash, Plus, X } from './icons.jsx';
import {
  docsModels, docsConfig, fmtTokens, fmtPrice, priceRange, bulletLines, modalityLabel,
  publicModelId, docsModelPatch, parseTokens, parseMoney, DOCS_BADGE_OPTIONS
} from '../lib/modeldocs.js';

const INTEL_LABELS = ['', 'Low', 'Fair', 'Medium', 'High', 'Highest'];
const SPEED_LABELS = ['', 'Slow', 'Steady', 'Medium', 'Fast', 'Fastest'];
const BADGE_LABELS = { latest: 'Latest', legacy: 'Legacy', preview: 'Preview', new: 'New' };

const TIPS = {
  latency: 'Relative to the rest of this workspace. Real latency depends on prompt length, reply length, and how hard the model thinks.',
  pricing: 'The rate an admin set for this model, per million tokens in and out. Spend is estimated from it, never billed by it.',
  modelId: 'The identifier this model is sent to its backend under.',
  thinking: 'Whether the model reasons before it answers, and how that reasoning is steered.',
  effort: 'The reasoning effort used when a request does not ask for one.',
  context: 'How much prompt and reply fit in a single turn. Measured with the real tokenizer, never estimated.',
  maxOutput: 'The most tokens this model will produce in one reply.',
  cutoff: 'The point after which the model has no reliable knowledge of events.',
  trainCutoff: 'The end of the data this model was trained on.',
  cacheWrite: 'The rate for writing a prompt into the backend cache, per million tokens.',
  cacheRead: 'The rate for reading a cached prompt back, per million tokens.',
  batch: 'How queued work is priced against the live rate.',
  modalities: 'What this model accepts as input and what it can produce.',
  status: 'Whether the model is selectable today, and which generation it belongs to.',
  released: 'When this model was added to the workspace.',
  retirement: 'When the model is scheduled to stop accepting turns.',
  platforms: 'Where this model can be reached from.'
};

function InfoTip({ text }) {
  if (!text) return null;
  return (
    <Tip label={t(text)} tone="docs">
      <button className="mdoc-info" aria-label={t(text)} onClick={(e) => e.preventDefault()}>
        <Info />
      </button>
    </Tip>
  );
}

function RowLabel({ label, tip }) {
  return <span className="mdoc-rowlabel">{label}<InfoTip text={tip} /></span>;
}

const Edit = createContext({ on: false });
const useEdit = () => useContext(Edit);

function Show({ when, children }) {
  const { on } = useEdit();
  return (on || when) ? children : null;
}

function Text({ value, onChange, placeholder, className = '', mono, right, view }) {
  const { on } = useEdit();
  if (!on) {
    if (value === '' || value == null) return null;
    return view ? view(value) : <>{value}</>;
  }
  return (
    <input className={'mdoc-f-input ' + className + (mono ? ' mono' : '') + (right ? ' right' : '')}
      value={value ?? ''} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  );
}

function Area({ value, onChange, placeholder, rows = 6, view }) {
  const { on } = useEdit();
  if (!on) {
    if (!value) return null;
    return view ? view(value) : <>{value}</>;
  }
  return (
    <textarea className="mdoc-f-area" rows={rows} value={value ?? ''} placeholder={placeholder}
      aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

function Pick({ value, onChange, options, label }) {
  return (
    <select className="mdoc-f-input" value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
    </select>
  );
}

function Labelled({ label, children }) {
  return <label className="mdoc-f"><span className="mdoc-fieldlabel">{label}</span>{children}</label>;
}

function EditBox({ title, hint, children }) {
  const { on } = useEdit();
  if (!on) return null;
  return (
    <div className="mdoc-editbox">
      <div className="mdoc-editbox-head">{title}</div>
      {hint && <div className="mdoc-hint">{hint}</div>}
      {children}
    </div>
  );
}

function PairRows({ rows, onChange, cols, keys, mono, addLabel }) {
  const list = Array.isArray(rows) ? rows : [];
  const edit = (i, k, v) => onChange(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <>
      {list.map((row, i) => (
        <div className="mdoc-listrow" key={i}>
          <input className="mdoc-f-input" value={row[keys[0]] || ''} placeholder={cols[0]} aria-label={cols[0]}
            onChange={(e) => edit(i, keys[0], e.target.value)} />
          <input className={'mdoc-f-input' + (mono ? ' mono' : '')} value={row[keys[1]] || ''} placeholder={cols[1]}
            aria-label={cols[1]} onChange={(e) => edit(i, keys[1], e.target.value)} />
          <button className="mdoc-iconbtn" aria-label={t('Remove')}
            onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash /></button>
        </div>
      ))}
      <button className="mdoc-addbtn" onClick={() => onChange([...list, { [keys[0]]: '', [keys[1]]: '' }])}>
        <Plus /> {addLabel}
      </button>
    </>
  );
}

function TileRows({ rows, onChange }) {
  const list = Array.isArray(rows) ? rows : [];
  const edit = (i, k, v) => onChange(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <>
      {list.map((row, i) => (
        <div className="mdoc-listcard" key={i}>
          <div>
            <input className="mdoc-f-input" value={row.title || ''} placeholder={t('Title')} aria-label={t('Title')}
              onChange={(e) => edit(i, 'title', e.target.value)} />
            <input className="mdoc-f-input" value={row.desc || ''} placeholder={t('Description')} aria-label={t('Description')}
              onChange={(e) => edit(i, 'desc', e.target.value)} />
            <input className="mdoc-f-input mono" value={row.url || ''} placeholder={t('Address, optional')} aria-label={t('Address')}
              onChange={(e) => edit(i, 'url', e.target.value)} />
          </div>
          <button className="mdoc-iconbtn" aria-label={t('Remove')}
            onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash /></button>
        </div>
      ))}
      <button className="mdoc-addbtn" onClick={() => onChange([...list, { title: '', desc: '', url: '' }])}>
        <Plus /> {t('Add tile')}
      </button>
    </>
  );
}

function modIcon(m, cls) {
  const src = m.docsIcon || m.staticIcon;
  return src
    ? <img className={cls} src={src} alt="" />
    : <span className={cls + ' noicon'}>{(m.displayName || '?').trim().charAt(0).toUpperCase()}</span>;
}

function ModelIcon({ m, set }) {
  const { on } = useEdit();
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  if (!on) return modIcon(m, 'mdoc-mico');
  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url } = await api.upload(file);
      set('docsIcon', url);
    } catch { /* the button title reports the state */ }
    finally { setBusy(false); }
  };
  return (
    <span className="mdoc-iconedit">
      <button className="mdoc-iconedit-btn" disabled={busy}
        title={busy ? t('Uploading…') : t('Upload a reference logo. With none set the model logo is used.')}
        aria-label={t('Upload a reference logo')}
        onClick={() => input.current && input.current.click()}>
        {modIcon(m, 'mdoc-mico')}
        <span className="mdoc-iconedit-veil"><Plus /></span>
      </button>
      {m.docsIcon && (
        <button className="mdoc-iconedit-clear" aria-label={t('Use the model logo')}
          title={t('Use the model logo')} onClick={() => set('docsIcon', '')}><X /></button>
      )}
      <input ref={input} type="file" accept="image/*" hidden
        onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ''; }} />
    </span>
  );
}

function Badge({ kind }) {
  if (!kind || !BADGE_LABELS[kind]) return null;
  return <span className={'mdoc-badge is-' + kind}>{t(BADGE_LABELS[kind])}</span>;
}

function CopyPill({ value }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!value) return null;
  const copy = () => {
    try { navigator.clipboard.writeText(value); } catch { setDone(false); }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1400);
  };
  return (
    <button className="mdoc-idpill" onClick={copy} title={t('Copy model id')} aria-label={t('Copy model id')}>
      <code>{value}</code>
      {done ? <Check className="mdoc-idpill-ic" /> : <Copy className="mdoc-idpill-ic" />}
    </button>
  );
}

function Crumbs({ items }) {
  return (
    <nav className="mdoc-crumbs" aria-label={t('Breadcrumb')}>
      {items.filter(Boolean).map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Chevron className="mdoc-crumb-sep" aria-hidden="true" />}
          <span>{c}</span>
        </React.Fragment>
      ))}
    </nav>
  );
}

function Notice({ m, set, onOpen }) {
  const { on } = useEdit();
  const target = m.docsNotice ? (m.docsNoticeUrl || '') : '';
  const external = /^https?:\/\//i.test(target);
  return (
    <>
      {m.docsNotice && (
        <div className="mdoc-notice" role="note">
          <Info className="mdoc-notice-ic" aria-hidden="true" />
          <span className="mdoc-notice-text">{m.docsNotice}</span>
          {m.docsNoticeAction && target && (external
            ? <a className="mdoc-notice-btn" href={target} target="_blank" rel="noreferrer noopener">{m.docsNoticeAction}</a>
            : <button className="mdoc-notice-btn" onClick={() => onOpen(target)}>{m.docsNoticeAction}</button>)}
        </div>
      )}
      {on && (
        <EditBox title={t('Notice strip')} hint={t('A band above the page, for a model that is retiring or is no longer recommended. Leave the message blank to hide it.')}>
          <Labelled label={t('Message')}>
            <input className="mdoc-f-input" value={m.docsNotice || ''} placeholder={t('This model is being retired.')}
              onChange={(e) => set('docsNotice', e.target.value)} />
          </Labelled>
          <div className="mdoc-editgrid">
            <Labelled label={t('Button label')}>
              <input className="mdoc-f-input" value={m.docsNoticeAction || ''} placeholder={t('See the replacement')}
                onChange={(e) => set('docsNoticeAction', e.target.value)} />
            </Labelled>
            <Labelled label={t('Button target')}>
              <input className="mdoc-f-input mono" value={m.docsNoticeUrl || ''} placeholder={t('A model id, or an http address')}
                onChange={(e) => set('docsNoticeUrl', e.target.value)} />
            </Labelled>
          </div>
        </EditBox>
      )}
    </>
  );
}

function LinkRow({ links, set }) {
  const { on } = useEdit();
  const list = Array.isArray(links) ? links : [];
  return (
    <>
      {list.length > 0 && (
        <div className="mdoc-linkrow">
          {list.map((l, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="mdoc-linkdot">·</span>}
              <a className="mdoc-link" href={l.url || '#'} target={/^https?:\/\//i.test(l.url || '') ? '_blank' : undefined}
                rel={/^https?:\/\//i.test(l.url || '') ? 'noreferrer noopener' : undefined}>
                {l.label}
                {/^https?:\/\//i.test(l.url || '')
                  ? <ArrowOut className="mdoc-link-ic" aria-hidden="true" />
                  : <span className="mdoc-link-arrow" aria-hidden="true">→</span>}
              </a>
            </React.Fragment>
          ))}
        </div>
      )}
      {on && (
        <EditBox title={t('Header links')} hint={t('The small link row under the buttons. An address starting with http opens in a new tab.')}>
          <PairRows rows={list} onChange={(v) => set('docsLinks', v)} cols={[t('Label'), t('Address')]}
            keys={['label', 'url']} mono addLabel={t('Add link')} />
        </EditBox>
      )}
    </>
  );
}

function StatStrip({ m, set }) {
  const { on } = useEdit();
  const cells = [
    { label: t('Context window'), tip: TIPS.context, unit: t('tokens'), view: fmtTokens(m.numCtx), key: 'numCtx', parse: parseTokens, ph: '200K' },
    { label: t('Max output'), tip: TIPS.maxOutput, unit: t('tokens'), view: fmtTokens(m.docsMaxOutput), key: 'docsMaxOutput', parse: parseTokens, ph: '64K' },
    { label: t('Input pricing'), tip: TIPS.pricing, unit: t('/ MTok'), view: fmtPrice(m.priceIn), key: 'priceIn', parse: parseMoney, ph: '$2' },
    { label: t('Output pricing'), tip: TIPS.pricing, unit: t('/ MTok'), view: fmtPrice(m.priceOut), key: 'priceOut', parse: parseMoney, ph: '$10' }
  ];
  if (!on && !cells.some(c => c.view)) return null;
  return (
    <dl className="mdoc-stats">
      {cells.map(c => (
        <div className="mdoc-stat" key={c.label}>
          <dt><RowLabel label={c.label} tip={c.tip} /></dt>
          <dd>
            {on
              ? <input className="mdoc-f-input stat" value={c.view} placeholder={c.ph} aria-label={c.label}
                  onChange={(e) => set(c.key, c.parse(e.target.value))} />
              : <span className="mdoc-stat-val">{c.view || '—'}</span>}
            <span className="mdoc-stat-unit">{c.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Rows({ title, rows }) {
  const { on } = useEdit();
  const live = rows.filter(r => r && (on || (r.value !== '' && r.value != null)));
  if (!live.length) return null;
  return (
    <section className="mdoc-card">
      <h3 className="mdoc-card-head">{title}</h3>
      <dl className="mdoc-card-rows">
        {live.map(r => (
          <div className="mdoc-card-row" key={r.label}>
            <dt><RowLabel label={r.label} tip={r.tip} /></dt>
            <dd>
              {on && r.set
                ? <input className={'mdoc-f-input right' + (r.mono ? ' mono' : '')} value={r.raw ?? r.value ?? ''}
                    placeholder={r.ph || r.label} aria-label={r.label}
                    onChange={(e) => r.set(r.parse ? r.parse(e.target.value) : e.target.value)} />
                : (r.mono && r.value ? <code>{r.value}</code> : r.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CardGrid({ title, cards, set, hint }) {
  const { on } = useEdit();
  const list = Array.isArray(cards) ? cards : [];
  if (!on && !list.length) return null;
  return (
    <>
      <h2 className="mdoc-h2">{title}</h2>
      {list.length > 0 && (
        <div className="mdoc-cardgrid">
          {list.map((c, i) => {
            const external = /^https?:\/\//i.test(c.url || '');
            const Tag = c.url && !on ? 'a' : 'div';
            return (
              <Tag key={i} className="mdoc-tile" href={(c.url && !on) ? c.url : undefined}
                target={external && !on ? '_blank' : undefined} rel={external && !on ? 'noreferrer noopener' : undefined}>
                <span className="mdoc-tile-body">
                  <span className="mdoc-tile-title">
                    {c.title}
                    {external && <ArrowOut className="mdoc-link-ic" aria-hidden="true" />}
                  </span>
                  {c.desc && <span className="mdoc-tile-desc">{c.desc}</span>}
                </span>
              </Tag>
            );
          })}
        </div>
      )}
      <EditBox title={title} hint={hint}><TileRows rows={list} onChange={set} /></EditBox>
    </>
  );
}

const COMPARE_COLS = [
  { id: 'ctx', label: 'Context', tip: TIPS.context, get: (m) => fmtTokens(m.numCtx) },
  { id: 'out', label: 'Max output', tip: TIPS.maxOutput, get: (m) => fmtTokens(m.docsMaxOutput) },
  { id: 'price', label: 'Price / MTok', tip: TIPS.pricing, get: (m) => priceRange(m) },
  { id: 'latency', label: 'Latency', tip: TIPS.latency, get: (m) => m.docsLatency },
  { id: 'thinking', label: 'Thinking', tip: TIPS.thinking, get: (m) => m.docsThinking },
  { id: 'effort', label: 'Default effort', tip: TIPS.effort, get: (m) => m.docsEffort, mono: true },
  { id: 'cutoff', label: 'Knowledge cutoff', tip: TIPS.cutoff, get: (m) => m.docsCutoff }
];

function CompareTable({ models, selfId, onOpen }) {
  const cols = COMPARE_COLS.filter(c => models.some(m => c.get(m)));
  if (!models.length) return null;
  return (
    <div className="mdoc-tablewrap">
      <table className="mdoc-table">
        <thead>
          <tr>
            <th scope="col">{t('Model')}</th>
            {cols.map(c => <th scope="col" key={c.id}><RowLabel label={t(c.label)} tip={c.tip} /></th>)}
          </tr>
        </thead>
        <tbody>
          {models.map(m => (
            <tr key={m.id} className={m.id === selfId ? 'self' : ''}>
              <th scope="row">
                {m.id === selfId
                  ? <span className="mdoc-table-name">{m.displayName}</span>
                  : <button className="mdoc-table-link" onClick={() => onOpen(m.id)}>{m.displayName}</button>}
                {m.id === selfId && <span className="mdoc-thismodel">{t('This model')}</span>}
                <Badge kind={m.docsBadge} />
              </th>
              {cols.map(c => (
                <td key={c.id}>{c.mono && c.get(m) ? <code>{c.get(m)}</code> : (c.get(m) || '—')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Meters({ m, set }) {
  const { on } = useEdit();
  const intel = Math.max(0, Math.min(5, m.docsIntelligence || 0));
  const speed = Math.max(0, Math.min(5, m.docsSpeed || 0));
  if (!on && !intel && !speed) return null;
  const dots = (n, key) => [1, 2, 3, 4, 5].map(i => (on
    ? <button key={i} className={'mdoc-dot' + (i <= n ? ' on' : '')} aria-label={String(i)}
        onClick={() => set(key, i === n ? 0 : i)} />
    : <span key={i} className={'mdoc-dot' + (i <= n ? ' on' : '')} />));
  return (
    <div className="mdoc-meters">
      {(on || intel > 0) && (
        <div className="mdoc-meter">
          <span className="mdoc-meter-label">{m.capReasoning || m.hasReasoning ? t('Reasoning') : t('Intelligence')}</span>
          <span className="mdoc-dots">{dots(intel, 'docsIntelligence')}</span>
          <span className="mdoc-meter-val">{intel ? t(INTEL_LABELS[intel]) : t('Not rated')}</span>
        </div>
      )}
      {(on || speed > 0) && (
        <div className="mdoc-meter">
          <span className="mdoc-meter-label">{t('Speed')}</span>
          <span className="mdoc-dots">{dots(speed, 'docsSpeed')}</span>
          <span className="mdoc-meter-val">{speed ? t(SPEED_LABELS[speed]) : t('Not rated')}</span>
        </div>
      )}
    </div>
  );
}

function Modalities({ m, set }) {
  const { on } = useEdit();
  if (!on) return null;
  const row = (dir, key) => (
    <div className="mdoc-editgrid" key={dir}>
      {['text', 'image', 'audio', 'video'].map(k => (
        <label className="mdoc-fieldrow" key={k}>
          <input type="checkbox" checked={!!(m[key] || {})[k]}
            onChange={(e) => set(key, { ...(m[key] || {}), [k]: e.target.checked })} />
          <span className="mdoc-hint">{dir} · {k}</span>
        </label>
      ))}
    </div>
  );
  return (
    <EditBox title={t('Modalities')} hint={t('What the model accepts and produces. Shown on the capabilities card.')}>
      {row(t('Accepts'), 'docsIn')}
      {row(t('Produces'), 'docsOut')}
    </EditBox>
  );
}

function ModelPage({ m, models, cfg, set, onTry, onOpen, appName }) {
  const { on } = useEdit();
  const labels = { text: t('Text'), image: t('Images'), audio: t('Audio'), video: t('Video') };
  const inLabel = modalityLabel(m.docsIn, labels) || t('Text');
  const outLabel = modalityLabel(m.docsOut, labels) || t('Text');
  const notes = bulletLines(m.docsNotes);
  const idValue = publicModelId(m);
  const S = (key) => (v) => set(key, v);
  return (
    <>
      <Notice m={m} set={set} onOpen={onOpen} />
      <Crumbs items={[appName, m.docsGroup || cfg.navLabel]} />
      <header className="mdoc-header">
        <ModelIcon m={m} set={set} />
        <div className="mdoc-header-text">
          <h1 className="mdoc-h1">{m.displayName}<Badge kind={m.docsBadge} /></h1>
          <p className="mdoc-sub">
            <Text value={m.description} onChange={S('description')} className="sub"
              placeholder={t('One line describing this model')} />
          </p>
        </div>
      </header>

      <EditBox title={t('Listing')} hint={t('How this model is named and placed in the reference.')}>
        <div className="mdoc-editgrid">
          <Labelled label={t('Badge')}>
            <Pick value={m.docsBadge} onChange={S('docsBadge')} options={DOCS_BADGE_OPTIONS} label={t('Badge')} />
          </Labelled>
          <Labelled label={t('Sidebar group')}>
            <input className="mdoc-f-input" value={m.docsGroup || ''} placeholder={t('Blank lists it on its own')}
              onChange={(e) => set('docsGroup', e.target.value)} />
          </Labelled>
          <Labelled label={t('Comparison summary')}>
            <input className="mdoc-f-input" value={m.docsSummary || ''} placeholder={m.description || t('One line')}
              onChange={(e) => set('docsSummary', e.target.value)} />
          </Labelled>
          <Labelled label={t('Button label')}>
            <input className="mdoc-f-input" value={m.docsActionLabel || ''} placeholder={t('Try in chat')}
              onChange={(e) => set('docsActionLabel', e.target.value)} />
          </Labelled>
        </div>
        <div className="mdoc-editgrid">
          <label className="mdoc-fieldrow">
            <input type="checkbox" checked={!!m.docsFeatured} onChange={(e) => set('docsFeatured', e.target.checked)} />
            <span className="mdoc-hint">{t('Feature in the overview comparison')}</span>
          </label>
          <label className="mdoc-fieldrow">
            <input type="checkbox" checked={!!m.docsHidden} onChange={(e) => set('docsHidden', e.target.checked)} />
            <span className="mdoc-hint">{t('Hide from the reference')}</span>
          </label>
        </div>
      </EditBox>

      <div className="mdoc-actions">
        <CopyPill value={idValue} />
        <button className="mdoc-primary" disabled={m.unavailable || on} onClick={() => onTry(m.id)}>
          {m.docsActionLabel || t('Try in chat')}
          <span className="mdoc-link-arrow" aria-hidden="true">→</span>
        </button>
      </div>
      <LinkRow links={m.docsLinks} set={set} />
      <StatStrip m={m} set={set} />

      <Show when={!!(m.docsBody || m.description)}>
        <>
          <h2 className="mdoc-h2">{t('Overview')}</h2>
          <div className="mdoc-prose">
            <Area value={m.docsBody} onChange={S('docsBody')} rows={8}
              placeholder={t('A few paragraphs on what this model is best at. Markdown is supported.')}
              view={(v) => <Markdown>{v}</Markdown>} />
            {!on && !m.docsBody && m.description && <p>{m.description}</p>}
          </div>
        </>
      </Show>

      {models.length > 1 && (
        <>
          <h2 className="mdoc-h2">{t('How it compares')}</h2>
          <CompareTable models={models} selfId={m.id} onOpen={onOpen} />
        </>
      )}

      <h2 className="mdoc-h2">{cfg.specTitle}</h2>
      <div className="mdoc-specs">
        <div className="mdoc-speccol">
          {on ? (
            <EditBox title={t('Model IDs')} hint={t('One row per platform this model is reachable on. The first identifier fills the copy button under the name.')}>
              <PairRows rows={m.docsIds} onChange={S('docsIds')} cols={[t('Platform'), t('Identifier')]}
                keys={['label', 'value']} mono addLabel={t('Add identifier')} />
            </EditBox>
          ) : (
            <Rows title={t('Model IDs')} rows={(m.docsIds || []).map(p => ({ label: p.label, value: p.value, mono: true }))} />
          )}
          <Rows title={t('Pricing')} rows={[
            { tip: TIPS.pricing, label: t('Input'), value: fmtPrice(m.priceIn) && fmtPrice(m.priceIn) + ' ' + t('/ MTok'), raw: fmtPrice(m.priceIn), ph: '$2', set: S('priceIn'), parse: parseMoney },
            { tip: TIPS.pricing, label: t('Output'), value: fmtPrice(m.priceOut) && fmtPrice(m.priceOut) + ' ' + t('/ MTok'), raw: fmtPrice(m.priceOut), ph: '$10', set: S('priceOut'), parse: parseMoney },
            { tip: TIPS.cacheWrite, label: t('Cache write'), value: fmtPrice(m.docsPriceCacheWrite) && fmtPrice(m.docsPriceCacheWrite) + ' ' + t('/ MTok'), raw: fmtPrice(m.docsPriceCacheWrite), ph: '$2.50', set: S('docsPriceCacheWrite'), parse: parseMoney },
            { tip: TIPS.cacheRead, label: t('Cache read'), value: fmtPrice(m.docsPriceCacheRead) && fmtPrice(m.docsPriceCacheRead) + ' ' + t('/ MTok'), raw: fmtPrice(m.docsPriceCacheRead), ph: '$0.20', set: S('docsPriceCacheRead'), parse: parseMoney },
            { tip: TIPS.batch, label: t('Batch'), value: m.docsPriceBatch, ph: t('50% discount'), set: S('docsPriceBatch') }
          ]} />
        </div>
        <div className="mdoc-speccol">
          <Rows title={t('Capabilities')} rows={[
            { tip: TIPS.context, label: t('Context window'), value: fmtTokens(m.numCtx) && fmtTokens(m.numCtx) + ' ' + t('tokens'), raw: fmtTokens(m.numCtx), ph: '200K', set: S('numCtx'), parse: parseTokens },
            { tip: TIPS.maxOutput, label: t('Max output'), value: fmtTokens(m.docsMaxOutput) && fmtTokens(m.docsMaxOutput) + ' ' + t('tokens'), raw: fmtTokens(m.docsMaxOutput), ph: '64K', set: S('docsMaxOutput'), parse: parseTokens },
            { tip: TIPS.thinking, label: t('Thinking'), value: m.docsThinking || ((m.capReasoning || m.hasReasoning) ? t('Supported') : ''), raw: m.docsThinking, ph: t('Adaptive'), set: S('docsThinking') },
            { tip: TIPS.effort, label: t('Default effort'), value: m.docsEffort, mono: true, ph: 'high', set: S('docsEffort') },
            { tip: TIPS.latency, label: t('Comparative latency'), value: m.docsLatency, ph: t('Fast'), set: S('docsLatency') },
            { tip: TIPS.modalities, label: t('Input → output'), value: inLabel + ' → ' + outLabel },
            { tip: TIPS.cutoff, label: t('Knowledge cutoff'), value: m.docsCutoff, ph: 'Feb 2026', set: S('docsCutoff') },
            { tip: TIPS.trainCutoff, label: t('Training data cutoff'), value: m.docsTrainCutoff, ph: 'Feb 2026', set: S('docsTrainCutoff') }
          ].filter(r => r.value != null || on)} />
          <Rows title={t('Availability')} rows={[
            { tip: TIPS.status, label: t('Status'), value: m.docsStatus || (!on && m.unavailable ? t('Unavailable') : m.docsStatus), raw: m.docsStatus, ph: t('Active'), set: S('docsStatus') },
            { tip: TIPS.released, label: t('Released'), value: m.docsReleased, ph: 'June 30, 2026', set: S('docsReleased') },
            { tip: TIPS.retirement, label: t('Retirement'), value: m.docsRetired, ph: t('Not scheduled'), set: S('docsRetired') },
            { tip: TIPS.platforms, label: t('Platforms'), value: (m.docsPlatforms || []).join(', '), ph: t('Comma separated'), set: (v) => set('docsPlatforms', String(v).split(',').map(x => x.trim()).filter(Boolean)) }
          ]} />
          <Meters m={m} set={set} />
          <Modalities m={m} set={set} />
        </div>
      </div>

      <Show when={notes.length > 0}>
        <>
          <h2 className="mdoc-h2">{t('Good to know')}</h2>
          {on
            ? <Area value={m.docsNotes} onChange={S('docsNotes')} rows={4} placeholder={t('One bullet per line. Blank hides the section.')} />
            : <ul className="mdoc-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </>
      </Show>

      <CardGrid title={t('Resources')} cards={m.docsResources} set={S('docsResources')}
        hint={t('Tiles at the foot of the page.')} />
      <CardGrid title={t('Reference')} cards={m.docsReference} set={S('docsReference')}
        hint={t('A second row of tiles, for specifications and policy.')} />
    </>
  );
}

function OverviewPage({ models, cfg, setCfg, onOpen, appName }) {
  const { on } = useEdit();
  const [all, setAll] = useState(false);
  const featured = models.filter(m => m.docsFeatured);
  const lead = (featured.length ? featured : models.filter(m => !m.docsGroup)).slice(0, 6);
  const labels = { text: t('Text'), image: t('Images'), audio: t('Audio'), video: t('Video') };
  const baseRows = [
    [t('Comparative latency'), (m) => m.docsLatency, false, null, TIPS.latency],
    [t('Pricing'), (m) => (fmtPrice(m.priceIn) || fmtPrice(m.priceOut)
      ? <>
        {fmtPrice(m.priceIn) && <span className="mdoc-priceline">{fmtPrice(m.priceIn)} {t('/ input MTok')}</span>}
        {fmtPrice(m.priceOut) && <span className="mdoc-priceline">{fmtPrice(m.priceOut)} {t('/ output MTok')}</span>}
      </>
      : ''), false, (m) => fmtPrice(m.priceIn) || fmtPrice(m.priceOut), TIPS.pricing],
    [t('Model id'), (m) => publicModelId(m), true, null, TIPS.modelId]
  ];
  const capRows = [
    [t('Thinking'), (m) => m.docsThinking || ((m.capReasoning || m.hasReasoning) ? t('Supported') : ''), false, null, TIPS.thinking],
    [t('Default effort'), (m) => m.docsEffort, true, null, TIPS.effort],
    [t('Context window'), (m) => fmtTokens(m.numCtx) && fmtTokens(m.numCtx) + ' ' + t('tokens'), false, null, TIPS.context],
    [t('Max output'), (m) => fmtTokens(m.docsMaxOutput) && fmtTokens(m.docsMaxOutput) + ' ' + t('tokens'), false, null, TIPS.maxOutput],
    [t('Reliable knowledge cutoff'), (m) => m.docsCutoff, false, null, TIPS.cutoff]
  ];
  const moreRows = [
    [t('Training data cutoff'), (m) => m.docsTrainCutoff, false, null, TIPS.trainCutoff],
    [t('Cache write'), (m) => fmtPrice(m.docsPriceCacheWrite), false, null, TIPS.cacheWrite],
    [t('Cache read'), (m) => fmtPrice(m.docsPriceCacheRead), false, null, TIPS.cacheRead],
    [t('Batch'), (m) => m.docsPriceBatch, false, null, TIPS.batch],
    [t('Input'), (m) => modalityLabel(m.docsIn, labels) || t('Text'), false, null, TIPS.modalities],
    [t('Output'), (m) => modalityLabel(m.docsOut, labels) || t('Text'), false, null, TIPS.modalities],
    [t('Status'), (m) => m.docsStatus, false, null, TIPS.status],
    [t('Released'), (m) => m.docsReleased, false, null, TIPS.released]
  ];
  const has = (rows) => rows.some(([, get, , probe]) => lead.some(m => (probe || get)(m)));
  const band = (rows) => rows.filter(([, get, , probe]) => lead.some(m => (probe || get)(m)))
    .map(([label, get, mono, , tip]) => (
      <tr key={label}>
        <th scope="row"><RowLabel label={label} tip={tip} /></th>
        {lead.map(m => <td key={m.id}>{mono && get(m) ? <code>{get(m)}</code> : (get(m) || '—')}</td>)}
      </tr>
    ));
  const links = Array.isArray(cfg.links) ? cfg.links : [];
  return (
    <>
      <Crumbs items={[appName, cfg.navLabel]} />
      <h1 className="mdoc-h1">
        {on
          ? <input className="mdoc-f-input h1" value={cfg.title} placeholder={t('Models overview')}
              aria-label={t('Title')} onChange={(e) => setCfg('title', e.target.value)} />
          : cfg.title}
      </h1>
      <p className="mdoc-sub">
        <Area value={cfg.intro} onChange={(v) => setCfg('intro', v)} rows={2}
          placeholder={t('One or two lines introducing the catalogue')} />
      </p>

      <EditBox title={t('Reference shell')} hint={t('Headings used across every page of the reference.')}>
        <div className="mdoc-editgrid">
          <Labelled label={t('Sidebar entry')}>
            <input className="mdoc-f-input" value={cfg.overviewLabel} placeholder={t('Models overview')}
              onChange={(e) => setCfg('overviewLabel', e.target.value)} />
          </Labelled>
          <Labelled label={t('Models heading')}>
            <input className="mdoc-f-input" value={cfg.navLabel} placeholder={t('Models')}
              onChange={(e) => setCfg('navLabel', e.target.value)} />
          </Labelled>
          <Labelled label={t('Specifications heading')}>
            <input className="mdoc-f-input" value={cfg.specTitle} placeholder={t('Specifications')}
              onChange={(e) => setCfg('specTitle', e.target.value)} />
          </Labelled>
          <Labelled label={t('Comparison heading')}>
            <input className="mdoc-f-input" value={cfg.compareTitle} placeholder={t('Compare models')}
              onChange={(e) => setCfg('compareTitle', e.target.value)} />
          </Labelled>
        </div>
      </EditBox>

      {links.length > 0 && (
        <div className="mdoc-pills">
          {links.map((l, i) => {
            const ext = /^https?:\/\//i.test(l.url || '');
            return (
              <a key={i} className="mdoc-pill" href={l.url || '#'} target={ext ? '_blank' : undefined}
                rel={ext ? 'noreferrer noopener' : undefined}>
                {l.label}
                {ext && <ArrowOut className="mdoc-link-ic" aria-hidden="true" />}
              </a>
            );
          })}
        </div>
      )}
      <EditBox title={t('Quick links')} hint={t('Pills under the introduction. A path such as /docs/p/pricing opens one of your own pages.')}>
        <PairRows rows={links} onChange={(v) => setCfg('links', v)} cols={[t('Label'), t('Address')]}
          keys={['label', 'url']} mono addLabel={t('Add link')} />
      </EditBox>

      {lead.length > 0 && (
        <>
          <h2 className="mdoc-h2">{cfg.compareTitle}</h2>
          <p className="mdoc-lead">
            <Area value={cfg.compareIntro} onChange={(v) => setCfg('compareIntro', v)} rows={2}
              placeholder={t('A sentence above the comparison table')} />
          </p>
          <div className="mdoc-tablewrap mdoc-matrixwrap">
            <table className="mdoc-table mdoc-matrix">
              <thead>
                <tr>
                  <th scope="col"><span className="mdoc-sr">{cfg.featureLabel}</span></th>
                  {lead.map(m => (
                    <th scope="col" key={m.id}>
                      <button className="mdoc-matrix-head" onClick={() => onOpen(m.id)}>
                        {modIcon(m, 'mdoc-mico md')}
                        <span className="mdoc-matrix-name">{m.displayName}</span>
                      </button>
                      <span className="mdoc-matrix-desc">{m.docsSummary || m.description || ''}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {band(baseRows)}
                {has(capRows) && (
                  <tr className="mdoc-band">
                    <th scope="row">{t('Capabilities')}</th>
                    {lead.map(m => <td key={m.id} />)}
                  </tr>
                )}
                {band(capRows)}
                {all && band(moreRows)}
                {has(moreRows) && (
                  <tr className="mdoc-morerow">
                    <td colSpan={lead.length + 1}>
                      <button className="mdoc-more" aria-expanded={all} onClick={() => setAll(v => !v)}>
                        {all ? t('Hide extra details') : t('Show all details')}
                        <Chevron className={'mdoc-more-chev' + (all ? ' open' : '')} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Show when={!!cfg.outro}>
        <div className="mdoc-prose mdoc-outro">
          <Area value={cfg.outro} onChange={(v) => setCfg('outro', v)} rows={10}
            placeholder={t('Anything that belongs under the comparison. Markdown headings, lists, and tables all render.')}
            view={(v) => <Markdown>{v}</Markdown>} />
        </div>
      </Show>

      <Show when={(cfg.tiles || []).length > 0}>
        <>
          <h2 className="mdoc-h2">
            {on
              ? <input className="mdoc-f-input" value={cfg.tilesTitle} placeholder={t('Get started')}
                  aria-label={t('Heading')} onChange={(e) => setCfg('tilesTitle', e.target.value)} />
              : cfg.tilesTitle}
          </h2>
          {(cfg.tiles || []).length > 0 && (
            <div className="mdoc-cardgrid">
              {(cfg.tiles || []).map((c, i) => {
                const ext = /^https?:\/\//i.test(c.url || '');
                const Tag = c.url && !on ? 'a' : 'div';
                return (
                  <Tag key={i} className="mdoc-tile" href={(c.url && !on) ? c.url : undefined}
                    target={ext && !on ? '_blank' : undefined} rel={ext && !on ? 'noreferrer noopener' : undefined}>
                    <span className="mdoc-tile-body">
                      <span className="mdoc-tile-title">
                        {c.title}
                        {ext && <ArrowOut className="mdoc-link-ic" aria-hidden="true" />}
                      </span>
                      {c.desc && <span className="mdoc-tile-desc">{c.desc}</span>}
                    </span>
                  </Tag>
                );
              })}
            </div>
          )}
          <EditBox title={t('Tiles')} hint={t('The card grid at the foot of the overview.')}>
            <TileRows rows={cfg.tiles || []} onChange={(v) => setCfg('tiles', v)} />
          </EditBox>
        </>
      </Show>

      <Sections cfg={cfg} setCfg={setCfg} />
    </>
  );
}

function Sections({ cfg, setCfg }) {
  const { on } = useEdit();
  if (!on) return null;
  const list = cfg.sections;
  const setSections = (v) => setCfg('sections', v);
  const editSection = (i, patch) => setSections(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <EditBox title={t('Extra pages')} hint={t('Groups of written pages listed under the models in the reference sidebar.')}>
      {list.map((s, si) => (
        <div className="mdoc-editbox" key={si}>
          <div className="mdoc-listrow">
            <input className="mdoc-f-input" value={s.label} placeholder={t('Group heading')} aria-label={t('Group heading')}
              onChange={(e) => editSection(si, { label: e.target.value })} />
            <span className="mdoc-hint">{t('{n} page(s)', { n: s.pages.length })}</span>
            <button className="mdoc-iconbtn" aria-label={t('Remove')}
              onClick={() => setSections(list.filter((_, j) => j !== si))}><Trash /></button>
          </div>
          {s.pages.map((p, pi) => (
            <div className="mdoc-editbox" key={pi}>
              <div className="mdoc-listrow">
                <input className="mdoc-f-input" value={p.title} placeholder={t('Page title')} aria-label={t('Page title')}
                  onChange={(e) => editSection(si, { pages: s.pages.map((x, k) => (k === pi ? { ...x, title: e.target.value } : x)) })} />
                <input className="mdoc-f-input mono" value={p.id} placeholder={t('page-id')} aria-label={t('Page id')}
                  onChange={(e) => editSection(si, { pages: s.pages.map((x, k) => (k === pi ? { ...x, id: e.target.value } : x)) })} />
                <button className="mdoc-iconbtn" aria-label={t('Remove')}
                  onClick={() => editSection(si, { pages: s.pages.filter((_, k) => k !== pi) })}><Trash /></button>
              </div>
              <input className="mdoc-f-input" value={p.subtitle} placeholder={t('Subtitle')} aria-label={t('Subtitle')}
                onChange={(e) => editSection(si, { pages: s.pages.map((x, k) => (k === pi ? { ...x, subtitle: e.target.value } : x)) })} />
              <textarea className="mdoc-f-area" rows={6} value={p.body} placeholder={t('Markdown body')} aria-label={t('Body')}
                onChange={(e) => editSection(si, { pages: s.pages.map((x, k) => (k === pi ? { ...x, body: e.target.value } : x)) })} />
            </div>
          ))}
          <button className="mdoc-addbtn"
            onClick={() => editSection(si, { pages: [...s.pages, { id: '', title: '', subtitle: '', body: '' }] })}>
            <Plus /> {t('Add page')}
          </button>
        </div>
      ))}
      <button className="mdoc-addbtn" onClick={() => setSections([...list, { id: '', label: '', pages: [] }])}>
        <Plus /> {t('Add group')}
      </button>
    </EditBox>
  );
}

function CustomPage({ page, section, cfg, setCfg, appName }) {
  const { on } = useEdit();
  const si = cfg.sections.findIndex(s => s.id === section.id);
  const pi = si >= 0 ? cfg.sections[si].pages.findIndex(p => p.id === page.id) : -1;
  const setPage = (patch) => setCfg('sections', cfg.sections.map((s, j) => (j === si
    ? { ...s, pages: s.pages.map((p, k) => (k === pi ? { ...p, ...patch } : p)) }
    : s)));
  return (
    <>
      <Crumbs items={[appName, section.label]} />
      <h1 className="mdoc-h1">
        {on
          ? <input className="mdoc-f-input h1" value={page.title} aria-label={t('Page title')}
              placeholder={t('Page title')} onChange={(e) => setPage({ title: e.target.value })} />
          : page.title}
      </h1>
      <p className="mdoc-sub">
        <Text value={page.subtitle} onChange={(v) => setPage({ subtitle: v })} className="sub"
          placeholder={t('One line under the title')} />
      </p>
      <div className="mdoc-prose" style={{ marginTop: 24 }}>
        <Area value={page.body} onChange={(v) => setPage({ body: v })} rows={16}
          placeholder={t('Markdown body. Headings, tables, lists, and code blocks all render.')}
          view={(v) => <Markdown>{v}</Markdown>} />
      </div>
    </>
  );
}

function EditBar({ editing, dirty, saving, error, onStart, onCancel, onSave }) {
  return (
    <div className="mdoc-editbar">
      <span className="mdoc-editbar-label">
        {error ? error : editing ? t('Editing the reference. Changes are staged until you publish the workspace.') : ''}
      </span>
      {editing ? (
        <>
          <button className="mdoc-editbtn" onClick={onCancel} disabled={saving}><X /> {t('Cancel')}</button>
          <button className="mdoc-editbtn primary" onClick={onSave} disabled={saving || !dirty}>
            <Check /> {saving ? t('Saving…') : t('Save')}
          </button>
        </>
      ) : (
        <button className="mdoc-editbtn" onClick={onStart}><Pencil /> {t('Edit page')}</button>
      )}
    </div>
  );
}

export default function ModelDocs({ models, cfg, target, appName, isAdmin, onTry, onNavigate, onSaved }) {
  const scroller = useRef(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modelEdits, setModelEdits] = useState({});
  const [cfgEdit, setCfgEdit] = useState(null);

  const liveCfg = cfgEdit || cfg;
  const list = useMemo(() => {
    const base = docsModels(models);
    if (!editing) return base;
    return base.map(m => (modelEdits[m.id] ? { ...m, ...modelEdits[m.id] } : m));
  }, [models, modelEdits, editing]);

  const model = target.kind === 'model'
    ? (list.find(m => m.id === target.id)
      || (editing && modelEdits[target.id] ? { ...docsModels(models).find(m => m.id === target.id), ...modelEdits[target.id] } : null))
    : null;
  const found = target.kind === 'page'
    ? liveCfg.sections.flatMap(s => s.pages.map(p => [s, p])).find(([, p]) => p.id === target.id)
    : null;

  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [target.kind, target.id]);
  useEffect(() => { setEditing(false); setModelEdits({}); setCfgEdit(null); setError(''); }, [target.kind, target.id]);

  const setModel = useCallback((key, value) => {
    if (!model) return;
    setModelEdits(prev => ({ ...prev, [model.id]: { ...(prev[model.id] || {}), [key]: value } }));
  }, [model]);

  const setCfgKey = useCallback((key, value) => {
    setCfgEdit(prev => ({ ...docsConfig(prev || cfg), [key]: value }));
  }, [cfg]);

  const dirty = Object.keys(modelEdits).length > 0 || cfgEdit !== null;

  const cancel = () => { setEditing(false); setModelEdits({}); setCfgEdit(null); setError(''); };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      for (const [id, patch] of Object.entries(modelEdits)) {
        const base = docsModels(models).find(x => x.id === id);
        if (!base) continue;
        await api.patch('/api/admin/models/' + id, docsModelPatch({ ...base, ...patch }));
      }
      if (cfgEdit) await api.patch('/api/admin/app-config', { modelDocsConfig: cfgEdit });
      setModelEdits({});
      setCfgEdit(null);
      setEditing(false);
      if (onSaved) await onSaved();
    } catch (e) {
      setError(e?.message || t('Could not save these changes.'));
    } finally {
      setSaving(false);
    }
  };

  const openModel = (id) => onNavigate({ kind: 'model', id });

  return (
    <div className="mdoc-page" ref={scroller}>
      <div className={'mdoc-col' + (editing ? ' mdoc-editing' : '')}>
        <Edit.Provider value={{ on: editing }}>
          {isAdmin && (
            <EditBar editing={editing} dirty={dirty} saving={saving} error={error}
              onStart={() => setEditing(true)} onCancel={cancel} onSave={save} />
          )}
          {target.kind === 'overview' && (
            <OverviewPage models={list} cfg={liveCfg} setCfg={setCfgKey} onOpen={openModel} appName={appName} />
          )}
          {target.kind === 'model' && (model
            ? <ModelPage m={model} models={list} cfg={liveCfg} set={setModel} onTry={onTry} onOpen={openModel} appName={appName} />
            : <p className="mdoc-sub">{t('That model is no longer listed.')}</p>)}
          {target.kind === 'page' && (found
            ? <CustomPage page={found[1]} section={found[0]} cfg={liveCfg} setCfg={setCfgKey} appName={appName} />
            : <p className="mdoc-sub">{t('That page is no longer listed.')}</p>)}
        </Edit.Provider>
      </div>
    </div>
  );
}
