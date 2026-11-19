import { useState, useEffect } from 'react';
import { api } from '../../../lib/api.js';
import { useAdmin } from '../store.jsx';
import { Card, Btn, Acts, Table, Stats, Badge, Empty, KV, fmtInt, fmtMoney, fmtAgo } from '../ui.jsx';
import { changeCount } from '../changes/count.js';
import { Plus, Sliders, Users, Clock } from '../../ui/icons.jsx';
import { t } from '../../../i18n.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { can } from '../../../lib/permissions.js';

const RECENT_EVENTS = 8;
const USAGE_DAYS = 30;

export default function OverviewSection() {
  const { catalog, users, changes, setSection, openModel, user } = useAdmin();
  const { models, providers, createModel } = catalog;
  const pending = changes.changes.length;
  const [usage, setUsage] = useState(null);
  const [events, setEvents] = useState(null);
  const seeUsage = can(user, 'admin.usage');
  const seeAudit = can(user, 'admin.audit');
  const seeUsers = can(user, 'admin.users');

  async function replaySetup() {
    try { await api.post('/api/admin/setup-complete', { done: false }); } catch {}
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (seeUsage) {
        try { const u = await api.get('/api/admin/usage?days=' + USAGE_DAYS); if (alive) setUsage(u); }
        catch { if (alive) setUsage(null); }
      }
      if (seeAudit) {
        try { const d = await api.get('/api/admin/audit?limit=' + RECENT_EVENTS + '&offset=0'); if (alive) setEvents(d.entries || []); }
        catch { if (alive) setEvents([]); }
      }
    })();
    return () => { alive = false; };
  }, [seeUsage, seeAudit]);

  const visible = models.filter(m => m.enabled && !m.unavailable).length;
  const hidden = models.filter(m => !m.enabled).length;
  const down = models.filter(m => !!m.unavailable).length;
  const fallback = models.find(m => m.is_default);

  return (
    <>
      <Stats items={[
        { k: t('Catalog'), v: fmtInt(models.length), n: t('{v} visible · {h} hidden{d}', { v: visible, h: hidden, d: down ? ' · ' + down + ' ' + t('down') : '' }) },
        { k: t('Connections'), v: fmtInt(providers.length) },
        ...(seeUsers ? [{ k: t('Users'), v: fmtInt(users.counts.all), n: users.counts.pending ? t('{n} waiting for approval', { n: users.counts.pending }) : t('{n} disabled', { n: users.counts.disabled }) }] : []),
        ...(seeUsage ? [{ k: t('30-day spend'), v: usage ? fmtMoney(usage.totals.cost) : '…', n: usage ? t('{n} tokens', { n: fmtInt(usage.totals.total) }) : t('loading') }] : [])
      ]} />

      <Card title={t('Live version')}
        actions={<Btn size="sm" onClick={() => setSection('releases')}>{t('Open releases')}</Btn>}>
        <KV items={[
          [t('Members are on'), changes.version ? t('Version {v}', { v: changes.version }) : t('loading')],
          [t('Waiting in the draft'), pending ? changeCount(pending) : t('nothing')],
          [t('Fallback model'), fallback
            ? <button type="button" className="linklike" onClick={() => openModel(fallback.id)}>
              {fallback.display_name || fallback.internal_name}
            </button>
            : t('none set')]
        ]} />
      </Card>

      <Card title={t('Set up')} sub={t('The three things a workspace needs before members can chat.')}>
        <Acts>
          <Btn onClick={async () => openModel(await createModel())}><Plus /> {t('Add model')}</Btn>
          <Btn onClick={() => setSection('providers')}><Sliders /> {t('Connections')}</Btn>
          {seeUsers && <Btn onClick={() => setSection('users')}><Users /> {t('Users')}</Btn>}
          <Btn onClick={replaySetup}>{t('Run the setup guide')}</Btn>
        </Acts>
        <div className="cp-hint">{t('The guide walks through the layout, a connection, models and prices. Reopen this page after starting it.')}</div>
      </Card>

      {seeAudit && (
        <Card title={t('Recent admin events')} flush
          actions={<Btn size="sm" onClick={() => setSection('events')}>{t('Open event log')}</Btn>}>
          <Skel when={!events}><SkelTable cols={3} rows={5} /></Skel>
          {events && events.length === 0 && (
            <Empty icon={Clock} title={t('Nothing recorded')}>{t('Sensitive admin actions appear here as they happen.')}</Empty>
          )}
          {events && events.length > 0 && (
            <Table head={[
              { label: t('Action'), fit: true },
              { label: t('Actor'), mono: true },
              { label: t('When'), num: true, fit: true }
            ]}>
              {events.map(e => (
                <tr key={e.id}>
                  <td className="fit"><Badge>{e.action}</Badge></td>
                  <td className="mono dim">{e.actorEmail}</td>
                  <td className="num dim">{fmtAgo(e.ts)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}