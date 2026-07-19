import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card } from '../widgets.jsx';
import { Box, Check, Clock, Trash } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
}

export default function DatabasesSection() {
  const { setAsk } = useAdmin();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.get('/api/admin/databases')); }
    catch (e) { setErr(e.message || 'Could not load databases.'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function run(key, fn) {
    setBusy(key);
    setErr('');
    try { setData(await fn()); }
    catch (e) { setErr(e.message || 'Something went wrong.'); }
    finally { setBusy(''); }
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    run('create', async () => {
      const d = await api.post('/api/admin/databases', { name });
      setNewName('');
      return d;
    });
  }

  function activate(name, isActive) {
    setAsk({
      message: isActive
        ? t('This database is already running. Setting it again just confirms it loads on the next restart.')
        : t(`Load "${name}" on the next restart? The running database will not change until the server restarts. Current chats, users and content stay untouched.`),
      danger: t('Set for next restart'),
      onConfirm: () => run('activate', () => api.post('/api/admin/databases/activate', { name }))
    });
  }

  function remove(name) {
    setAsk({
      message: t(`Permanently delete the "${name}" database and everything inside it (chats, users, uploads, artifacts, memory)? This cannot be undone.`),
      danger: t('Delete database'),
      onConfirm: () => run('del-' + name, () => api.del('/api/admin/databases/' + encodeURIComponent(name)))
    });
  }

  if (!data && !err) return <div className="muted-note">{t('Loading…')}</div>;

  const dbs = data?.databases || [];
  const pending = data?.pending;
  const active = data?.active;
  const willSwitch = data?.requiresRestart;

  return (
    <>
      <Card title={t('How database switching works')}
        sub={t('Each database is a fully isolated world with its own users, chats, preferences, interface, models, artifacts, uploaded content and memory. The active one is chosen from the .env file when the server starts. To keep data safe, it can never be switched while the app is running, only before it loads.')}>
        <div className="field">
          <div className="muted-note">
            {t('Running now')}: <code>{active}</code>
            {willSwitch
              ? <> · {t('loads on next restart')}: <code>{pending}</code> · <strong>{t('restart required')}</strong></>
              : <> · {t('this will also load on the next restart')}</>}
          </div>
          {data?.envFile && <div className="muted-note">{t('Configured in')} <code>{data.envFile}</code> ({t('key')} <code>OPEN_QUILL_DB</code>).</div>}
        </div>
      </Card>

      {err && <div className="dz-err" style={{ marginBottom: 12 }}>{err}</div>}

      <Card title={t('Databases')} sub={t('Switching sets which database loads next. Restart the server to apply.')}>
        {dbs.map((db, i) => (
          <div key={db.name} className="fn-card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: i === dbs.length - 1 ? 0 : 8, padding: '10px 12px' }}>
            <Box style={{ width: 18, flex: '0 0 auto', opacity: 0.8 }} />
            <div className="fn-card-main" style={{ flex: 1, minWidth: 0 }}>
              <div className="fn-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <code>{db.name}</code>
                {db.active && <span className="oqa-tab-count" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check style={{ width: 12 }} /> {t('running')}</span>}
                {db.pending && !db.active && <span className="oqa-tab-count" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock style={{ width: 12 }} /> {t('next restart')}</span>}
              </div>
              <div className="fn-card-desc muted-note">
                {db.initialized ? t('initialized') : t('empty, created on first load')} · {fmtSize(db.sizeBytes)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
              {!db.pending && <button className="btn ghost" disabled={busy === 'activate'} onClick={() => activate(db.name, db.active)}>{t('Load next restart')}</button>}
              {db.pending && !db.active && <span className="muted-note">{t('pending restart')}</span>}
              {!db.active && !db.pending && db.name !== 'default' && (
                <button className="btn ghost danger" disabled={busy === 'del-' + db.name} onClick={() => remove(db.name)} title={t('Delete')}><Trash style={{ width: 14 }} /></button>
              )}
            </div>
          </div>
        ))}
      </Card>

      <Card title={t('Add a database')} sub={t('Creates a new, empty database you can switch to. It initializes automatically the first time it loads. Use lowercase letters, numbers, dashes or underscores.')}>
        <div className="field" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input
            value={newName}
            placeholder={t('e.g. staging, client-acme, testing')}
            onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            maxLength={40}
            style={{ flex: 1 }}
          />
          <button className="btn primary" disabled={busy === 'create' || !newName.trim()} onClick={create}>{busy === 'create' ? t('Adding…') : t('Add database')}</button>
        </div>
      </Card>
    </>
  );
}
