import { useState, useEffect, useCallback, useRef } from 'react';
import '../../styles/setup.css';
import { api } from '../../api.js';
import { t } from '../../i18n.jsx';
import { useTheme } from '../../lib/theme/store.jsx';
import { logoFor, modelIconFor, useLogos } from '../../lib/logos.js';
import { Chat, Check, Cube, Gauge, Gear, Plug, Sliders, Terminal } from '../icons.jsx';

const KNOWN_SWATCH = new Set(['anthropic', 'openai', 'blank']);

function Mark({ name }) {
  const hit = logoFor(name, useLogos());
  if (!hit) return <span className="sg-mark blank" aria-hidden="true" />;
  if (hit.color) return <img className="sg-mark" src={hit.src} alt="" aria-hidden="true" />;
  const url = `url("${hit.src}")`;
  return <span className="sg-mark mask" aria-hidden="true" style={{ maskImage: url, WebkitMaskImage: url }} />;
}

function Welcome({ appName }) {
  const rows = [
    { Icon: Sliders, title: t('Pick how it looks'), body: t('A starting layout. You can restyle any part of it later, or design your own.') },
    { Icon: Plug, title: t('Point it at a model'), body: t('Somewhere the app can reach: a program running on this machine, or a paid service you have a key for.') },
    { Icon: Cube, title: t('Choose your models'), body: t('It asks that connection what it can run, and you decide which ones to keep.') },
    { Icon: Gauge, title: t('Set prices, if any'), body: t('Only for a paid service, so the usage screen can show what a conversation cost.') }
  ];
  return (
    <>
      <p className="sg-lede">
        {t('{app} runs on your own machine and talks only to the models you point it at. Nothing leaves this computer unless you set that up yourself.', { app: appName })}
      </p>
      <ul className="sg-list">
        {rows.map(({ Icon, title, body }) => (
          <li key={title}>
            <span className="sg-list-icon"><Icon /></span>
            <span>
              <strong>{title}</strong>
              <span className="sg-list-body">{body}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="sg-note">{t('It takes about a minute, and every answer can be changed later in Admin.')}</p>
    </>
  );
}

function BasicsStep({ name, setName, signups, setSignups, placeholder }) {
  return (
    <>
      <p className="sg-lede">{t('Two things that are awkward to change once people have started using it.')}</p>
      <div className="sg-fields one">
        <label className="sg-field">
          <span className="sg-label">{t('What is this workspace called?')}</span>
          <input className="sg-input" value={name} maxLength={120} placeholder={placeholder}
            onChange={(e) => setName(e.target.value)} />
          <span className="sg-hint">{t('Shown in the sidebar and the browser tab. Your own name, your team’s, or anything you like.')}</span>
        </label>
      </div>
      <div className="sg-group" style={{ marginTop: 18 }}>
        <div className="sg-group-head"><span>{t('Who can create an account?')}</span></div>
        <div className="sg-choices">
          <button type="button" className={'sg-choice' + (signups ? '' : ' on')} aria-pressed={!signups}
            onClick={() => setSignups(false)}>
            <strong>{t('Only me, for now')}</strong>
            <span>{t('Nobody else can sign up. You can invite people later by turning this back on.')}</span>
          </button>
          <button type="button" className={'sg-choice' + (signups ? ' on' : '')} aria-pressed={signups}
            onClick={() => setSignups(true)}>
            <strong>{t('Anyone who can reach this server')}</strong>
            <span>{t('Good on a machine only you can reach. Risky if this address is open to a network you do not control.')}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function LayoutStep({ chosen, onChoose }) {
  const [themes, setThemes] = useState([]);
  useEffect(() => {
    let live = true;
    api.get('/api/admin/themes')
      .then(r => { if (live) setThemes((r.themes || []).filter(x => x.builtin)); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!themes.length) return <p className="sg-note">{t('Loading layouts…')}</p>;
  return (
    <>
      <p className="sg-lede">{t('Every layout is a starting point, not a fixed skin. Nothing here is permanent.')}</p>
      <div className="sg-grid">
        {themes.map(th => (
          <button key={th.id} type="button" className={'sg-card' + (chosen === th.id ? ' on' : '')}
            aria-pressed={chosen === th.id} onClick={() => onChoose(th.id)}>
            <span className={'sg-swatch ' + (KNOWN_SWATCH.has(th.id) ? th.id : 'plain')}><span className="ps-dot" /></span>
            <span className="sg-card-name">{th.name}</span>
            <span className="sg-card-desc">{t(th.blurb || th.note || '')}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ConnectionStep({ types, draft, setDraft, probe, onTest, busy }) {
  const entries = Object.entries(types);
  const local = entries.filter(([, v]) => v.local);
  const hosted = entries.filter(([, v]) => !v.local);
  const spec = types[draft.type] || {};
  const pick = (type) => setDraft(d => ({
    ...d, type,
    base_url: types[type]?.defaultBaseUrl || '',
    api_key: types[type]?.keyOptional ? '' : d.api_key
  }));

  const group = (label, hint, list) => (
    <div className="sg-group">
      <div className="sg-group-head"><span>{label}</span><span className="sg-group-hint">{hint}</span></div>
      <div className="sg-chips">
        {list.map(([key, v]) => (
          <button key={key} type="button" className={'sg-chip' + (draft.type === key ? ' on' : '')}
            aria-pressed={draft.type === key} onClick={() => pick(key)}>
            <Mark name={[key, v.label]} />
            <span>{v.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <p className="sg-lede">{t('A connection is one address the app talks to. Pick the kind you are running, then say where it is.')}</p>
      {group(t('On this machine'), t('Free to run, nothing leaves your computer'), local)}
      {group(t('A paid service'), t('Needs an API key, and bills you per message'), hosted)}
      <div className="sg-fields">
        <label className="sg-field">
          <span className="sg-label">{t('Address')}</span>
          <input className="sg-input mono" value={draft.base_url}
            placeholder={spec.defaultBaseUrl || ''} spellCheck="false"
            onChange={(e) => setDraft(d => ({ ...d, base_url: e.target.value }))} />
          <span className="sg-hint">{t('No trailing slash. The suggested address is the one this kind of server normally uses.')}</span>
        </label>
        <label className="sg-field">
          <span className="sg-label">{spec.keyOptional ? t('API key, not needed here') : t('API key')}</span>
          <input className="sg-input mono" type="password" value={draft.api_key} autoComplete="off"
            placeholder={spec.keyOptional ? t('leave empty') : t('required')}
            onChange={(e) => setDraft(d => ({ ...d, api_key: e.target.value }))} />
          <span className="sg-hint">{t('Stored on the server and never sent to the browser.')}</span>
        </label>
      </div>
      <div className="sg-testrow">
        <button type="button" className="sg-btn" disabled={busy} onClick={onTest}>
          {busy ? t('Checking…') : t('Check the connection')}
        </button>
        {probe && !busy && (probe.ok
          ? <span className="sg-ok"><Check /> {t('Answered, and reported {n} models', { n: probe.count })}</span>
          : <span className="sg-bad">{probe.error}</span>)}
      </div>
      {probe && !probe.ok && !busy && (
        <p className="sg-note">{t('Check that the program is running and that the address matches the one it printed when it started.')}</p>
      )}
    </>
  );
}

function ModelsStep({ list, picked, toggle, all, none, error }) {
  if (error) return <p className="sg-bad">{error}</p>;
  if (!list.length) {
    return (
      <p className="sg-note">
        {t('That connection answered but listed no models. You can finish here and add them later under Admin, Models.')}
      </p>
    );
  }
  return (
    <>
      <p className="sg-lede">{t('These are the models the connection says it can run. Keep the ones you want; you can add or remove any of them later.')}</p>
      <div className="sg-actions">
        <button type="button" className="sg-btn sm" onClick={all}>{t('Select all')}</button>
        <button type="button" className="sg-btn sm" onClick={none}>{t('Select none')}</button>
        <span className="sg-count">{t('{n} of {total} selected', { n: picked.size, total: list.length })}</span>
      </div>
      <div className="sg-scroll">
        {list.map(m => (
          <label key={m.id} className={'sg-row' + (picked.has(m.id) ? ' on' : '')}>
            <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
            <Mark name={m.id} />
            <span className="sg-row-name mono">{m.id}</span>
          </label>
        ))}
      </div>
    </>
  );
}

function PricingStep({ isLocal, rows, setPrice }) {
  if (isLocal) {
    return (
      <>
        <p className="sg-lede">{t('Nothing to price. A model running on your own machine costs you nothing per message, so the usage screen will count tokens rather than money.')}</p>
        <p className="sg-note">{t('If you add a paid connection later, prices live under Admin, Models, on each model.')}</p>
      </>
    );
  }
  return (
    <>
      <p className="sg-lede">{t('What the provider charges, per million tokens. This is only used to show you what a conversation cost; leave a row at zero if you would rather not track it.')}</p>
      <div className="sg-scroll">
        <div className="sg-price-head">
          <span>{t('Model')}</span><span>{t('Input')}</span><span>{t('Output')}</span>
        </div>
        {rows.map(r => (
          <div key={r.id} className="sg-price-row">
            <span className="sg-row-name mono"><Mark name={r.name} />{r.name}</span>
            <input className="sg-input sm" type="number" min="0" step="0.01" value={r.cost_in ?? ''}
              aria-label={t('Input price for {name}', { name: r.name })}
              onChange={(e) => setPrice(r.id, 'cost_in', e.target.value)} />
            <input className="sg-input sm" type="number" min="0" step="0.01" value={r.cost_out ?? ''}
              aria-label={t('Output price for {name}', { name: r.name })}
              onChange={(e) => setPrice(r.id, 'cost_out', e.target.value)} />
          </div>
        ))}
      </div>
      <p className="sg-note">{t('A price we recognised has been filled in for you. Check it against your provider’s page, since prices change.')}</p>
    </>
  );
}

function DoneStep({ appName, titlesOn, added }) {
  const rows = [
    { Icon: Chat, title: t('Start a chat'), body: t('Pick a model from the name at the top of the screen, then type. Every chat is stored on this machine only.') },
    { Icon: Terminal, title: t('Give it files and a shell'), body: t('Turn on the workspace in the composer and the assistant gets its own folder for the chat, with a terminal it can run commands in.') },
    { Icon: Gear, title: t('Change anything'), body: t('Admin holds models, connections, prices, limits and the interface designer. Nothing you chose here is locked in.') }
  ];
  return (
    <>
      <p className="sg-lede">
        {added > 0
          ? t('{app} is ready, with {n} models set up.', { app: appName, n: added })
          : t('{app} is ready.', { app: appName })}
      </p>
      <ul className="sg-list">
        {rows.map(({ Icon, title, body }) => (
          <li key={title}>
            <span className="sg-list-icon"><Icon /></span>
            <span><strong>{title}</strong><span className="sg-list-body">{body}</span></span>
          </li>
        ))}
      </ul>
      {titlesOn && <p className="sg-note">{t('Chats will name themselves from their first exchange. That is on because your models run locally, and it is free to do. Admin, Limits turns it off.')}</p>}
    </>
  );
}

export default function SetupGuide({ appName, onDone }) {
  const { reload: reloadTheme } = useTheme();
  const logos = useLogos();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const [name, setName] = useState('');
  const [signups, setSignups] = useState(false);
  const [theme, setTheme] = useState('');
  const [types, setTypes] = useState({});
  const [providerId, setProviderId] = useState('');
  const [draft, setDraft] = useState({ type: 'llamacpp', base_url: '', api_key: '' });
  const [probe, setProbe] = useState(null);
  const [discovered, setDiscovered] = useState([]);
  const [discoverError, setDiscoverError] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [priced, setPriced] = useState([]);
  const [addedCount, setAddedCount] = useState(0);

  useEffect(() => {
    let live = true;
    api.get('/api/admin/providers').then(r => {
      if (!live) return;
      const first = (r.providers || [])[0];
      setTypes(r.types || {});
      if (first) {
        setProviderId(first.id);
        setDraft({ type: first.type, base_url: first.base_url || '', api_key: first.api_key || '' });
      }
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const isLocal = !!types[draft.type]?.local;

  const test = useCallback(async () => {
    setBusy(true);
    setProbe(null);
    try {
      await api.patch('/api/admin/providers/' + providerId, draft);
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(providerId));
      const list = r.models || [];
      if (!alive.current) return;
      setDiscovered(list);
      setDiscoverError('');
      setPicked(new Set(list.map(m => m.id)));
      setProbe({ ok: true, count: list.length });
    } catch (e) {
      if (!alive.current) return;
      setProbe({ ok: false, error: e?.message || t('The backend did not answer.') });
      setDiscoverError(e?.message || '');
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [draft, providerId]);

  async function addPicked() {
    const wanted = discovered.filter(m => picked.has(m.id));
    const made = [];
    for (const m of wanted) {
      const icon = modelIconFor(m.id, logos);
      try {
        const r = await api.post('/api/admin/models', {
          display_name: m.id, internal_name: m.id, provider_id: providerId,
          ...(icon ? { static_icon: icon, generating_icon: icon, thinking_icon: icon } : {})
        });
        if (r?.id) made.push({ id: r.id, name: m.id, cost_in: '', cost_out: '' });
      } catch { /* one bad row must not strand the rest */ }
    }
    let known = [];
    try { known = await api.get('/api/admin/models'); } catch {}
    const byId = new Map((known || []).map(m => [m.id, m]));
    if (made.length && !(known || []).some(m => m.is_default)) {
      try { await api.patch('/api/admin/models/' + made[0].id, { is_default: true }); } catch {}
    }
    for (const r of made) {
      const row = byId.get(r.id);
      if (!row) continue;
      r.cost_in = row.cost_in ?? '';
      r.cost_out = row.cost_out ?? '';
    }
    if (!alive.current) return;
    setPriced(made);
    setAddedCount(made.length);
  }

  async function savePrices() {
    for (const r of priced) {
      const patch = {
        cost_in: r.cost_in === '' ? null : Number(r.cost_in),
        cost_out: r.cost_out === '' ? null : Number(r.cost_out)
      };
      try { await api.patch('/api/admin/models/' + r.id, patch); } catch { /* keep going */ }
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await api.post('/api/admin/models/publish', {});
    } catch { /* publishing again is always available from Admin */ }
    try { await api.post('/api/admin/setup-complete', {}); } catch {}
    onDone();
  }

  const steps = [
    { id: 'welcome', label: t('Welcome'), title: t('Welcome to {app}', { app: appName }) },
    { id: 'basics', label: t('Basics'), title: t('Name it, and decide who gets in') },
    { id: 'layout', label: t('Look'), title: t('Choose a starting layout') },
    { id: 'connection', label: t('Connection'), title: t('Connect a model') },
    { id: 'models', label: t('Models'), title: t('Pick your models') },
    { id: 'pricing', label: t('Pricing'), title: isLocal ? t('Pricing') : t('What does it cost?') },
    { id: 'done', label: t('Done'), title: t('You are set up') }
  ];
  const current = steps[step];
  const last = step === steps.length - 1;

  const nextLabel = () => {
    if (last) return t('Start using {app}', { app: appName });
    if (current.id === 'models') return picked.size ? t('Add {n} models', { n: picked.size }) : t('Skip for now');
    return t('Continue');
  };

  const canAdvance = () => {
    if (busy) return false;
    if (current.id === 'layout') return !!theme;
    if (current.id === 'connection') return !!probe?.ok;
    return true;
  };

  async function advance() {
    if (!canAdvance()) return;
    setFailed('');
    setBusy(true);
    try {
      if (current.id === 'basics') {
        await api.patch('/api/admin/app-config', { appName: name.trim() || appName, allowSignups: signups });
      }
      if (current.id === 'layout' && theme) {
        await api.post(`/api/admin/themes/${theme}/activate`, {});
        await api.post('/api/admin/themes/publish', {});
        await reloadTheme();
      }
      if (current.id === 'models') await addPicked();
      if (current.id === 'pricing' && !isLocal) await savePrices();
    } catch (e) {
      if (alive.current) { setFailed(e?.message || t('That step did not finish. You can set it up later in Admin.')); setBusy(false); }
      return;
    }
    if (!alive.current) return;
    setBusy(false);
    if (last) { finish(); return; }
    setStep(s => s + 1);
  }

  async function skipAll() {
    setBusy(true);
    try { await api.post('/api/admin/setup-complete', {}); } catch {}
    onDone();
  }

  return (
    <div className="sg-scrim" role="dialog" aria-modal="true" aria-label={t('Setup')}>
      <div className="sg-modal">
        <ol className="sg-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={'sg-step' + (i === step ? ' on' : '') + (i < step ? ' done' : '')}>
              <span className="sg-step-dot">{i < step ? <Check /> : i + 1}</span>
              <span className="sg-step-label">{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="sg-body">
          <h2 className="sg-title">{current.title}</h2>
          {current.id === 'welcome' && <Welcome appName={appName} />}
          {current.id === 'basics' && (
            <BasicsStep name={name} setName={setName} signups={signups} setSignups={setSignups} placeholder={appName} />
          )}
          {current.id === 'layout' && <LayoutStep chosen={theme} onChoose={setTheme} />}
          {current.id === 'connection' && (
            <ConnectionStep types={types} draft={draft} setDraft={setDraft} probe={probe} onTest={test} busy={busy} />
          )}
          {current.id === 'models' && (
            <ModelsStep list={discovered} picked={picked} error={discoverError}
              toggle={(id) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
              all={() => setPicked(new Set(discovered.map(m => m.id)))}
              none={() => setPicked(new Set())} />
          )}
          {current.id === 'pricing' && (
            <PricingStep isLocal={isLocal} rows={priced}
              setPrice={(id, field, v) => setPriced(rs => rs.map(r => (r.id === id ? { ...r, [field]: v } : r)))} />
          )}
          {current.id === 'done' && <DoneStep appName={appName} titlesOn={isLocal} added={addedCount} />}
          {failed && <p className="sg-bad">{failed}</p>}
        </div>

        <div className="sg-foot">
          <button type="button" className="sg-link" onClick={skipAll} disabled={busy}>{t('Skip setup')}</button>
          <div className="sg-foot-end">
            {step > 0 && !last && (
              <button type="button" className="sg-btn" disabled={busy} onClick={() => setStep(s => s - 1)}>{t('Back')}</button>
            )}
            <button type="button" className="sg-btn primary" disabled={!canAdvance()} onClick={advance}>
              {busy ? t('Working…') : nextLabel()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
