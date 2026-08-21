import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card } from '../widgets.jsx';
import { t } from '../../../i18n.jsx';

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t('{n}s ago', { n: s });
  if (s < 3600) return t('{n}m ago', { n: Math.round(s / 60) });
  return t('{n}h ago', { n: Math.round(s / 3600) });
}

export default function PrivacySection() {
  const A = useAdmin();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try { setData(await api.get('/api/admin/egress-log')); setErr(''); }
    catch (e) { setErr(String(e.message || e)); }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const blocking = A.cfg.egressLocalOnly !== false;

  return (
    <>
      <Card title={t("Outbound connections")} sub={t("Every attempt this server made to reach another machine since it started. Kept in memory only, so it clears on restart.")}>
        <div className="eg-summary">
          <div className={'eg-stat ' + (blocking ? 'ok' : '')}>
            <b>{blocking ? t('On') : t('Off')}</b>
            <span>{t('Internet block')}</span>
          </div>
          <div className="eg-stat ok"><b>{(data?.allowed ?? 0).toLocaleString()}</b><span>{t('Allowed')}</span></div>
          <div className="eg-stat blocked"><b>{(data?.blocked ?? 0).toLocaleString()}</b><span>{t('Blocked')}</span></div>
        </div>
        {!blocking && <div className="muted-note">{t('The block is off, so outbound connections are not being restricted. Attempts are still recorded here.')}</div>}
        {err && <div className="err">{err}</div>}
        {data && !data.entries.length && <div className="muted-note">{t('Nothing has tried to leave this machine yet.')}</div>}
        {data && data.entries.map((e, i) => (
          <div className="eg-row" key={i}>
            <span className={'eg-tag ' + (e.allowed ? 'ok' : 'blocked')}>{e.allowed ? t('allowed') : t('blocked')}</span>
            <span className="eg-host" title={e.host}>{e.host}</span>
            <span className="eg-reason">{e.reason}</span>
            <span className="eg-reason">{ago(e.last)}</span>
            <span className="eg-count">{e.count > 1 ? '×' + e.count : ''}</span>
          </div>
        ))}
        {data && !!data.entries.length && (
          <div className="btn-row">
            <button className="btn ghost" onClick={async () => { try { await api.del('/api/admin/egress-log'); load(); } catch {} }}>{t('Clear log')}</button>
          </div>
        )}
      </Card>
    </>
  );
}
