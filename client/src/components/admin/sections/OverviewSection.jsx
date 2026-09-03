import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, Btn, Acts, Table, Stats, Badge, Empty, Note, KV, fmtInt, fmtMoney, fmtAgo } from '../ui.jsx';
import { PublishState } from '../publish.jsx';
import { Plus, Sliders, Users, Clock } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const RECENT_EVENTS = 8;
const USAGE_DAYS = 30;

export default function OverviewSection() {
  const { catalog, members, setSection, openModel } = useAdmin();
  const { models, providers, draft, publishError, createModel } = catalog;
  const [usage, setUsage] = useState(null);
  const [events, setEvents] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const u = await api.get('/api/admin/usage?days=' + USAGE_DAYS); if (alive) setUsage(u); }
      catch { if (alive) setUsage(null); }
      try { const d = await api.get('/api/admin/audit?limit=' + RECENT_EVENTS + '&offset=0'); if (alive) setEvents(d.entries || []); }
      catch { if (alive) setEvents([]); }
    })();
    return () => { alive = false; };
  }, []);

  const visible = models.filter(m => m.enabled && !m.unavailable).length;
  const hidden = models.filter(m => !m.enabled).length;
  const down = models.filter(m => !!m.unavailable).length;
  const admins = members.members.filter(u => u.isAdmin || u.isOwner).length;
  const fallback = models.find(m => m.is_default);

  return (
    <>
      <Stats items={[
        { k: t('Catalog'), v: fmtInt(models.length), n: t('{v} visible · {h} hidden{d}', { v: visible, h: hidden, d: down ? ' · ' + down + ' ' + t('down') : '' }) },
        { k: t('Connections'), v: fmtInt(providers.length) },
        { k: t('Members'), v: fmtInt(members.members.length), n: t('{n} with admin', { n: admins }) },
        { k: t('30-day spend'), v: usage ? fmtMoney(usage.totals.cost) : '—', n: usage ? t('{n} tokens', { n: fmtInt(usage.totals.total) }) : t('loading') }
      ]} />

      <Card title={t('Draft')}
        sub={t('Every edit in this panel is staged. You see your own draft straight away; members keep running the published version until you publish.')}
        actions={<PublishState />}>
        <Note tone={draft.dirty ? 'warn' : undefined}>
          {draft.dirty
            ? t('The draft has changes members are not running yet.')
            : draft.published ? t('Members are running the current draft.') : t('Nothing has been published yet.')}
        </Note>
        {!!publishError && <Note tone="bad">{publishError}</Note>}
        <KV items={[
          [t('Last published'), draft.publishedAt ? new Date(draft.publishedAt).toLocaleString() : t('never')],
          [t('Fallback model'), fallback
            ? <button type="button" className="linklike" onClick={() => openModel(fallback.id)}>
              {fallback.display_name || fallback.internal_name}
            </button>
            : t('none set')]
        ]} />
      </Card>

      <Card title={t('Set up')} sub={t('The three things a workspace needs before members can chat.')}>
        <Acts>
          <Btn onClick={createModel}><Plus /> {t('Add model')}</Btn>
          <Btn onClick={() => setSection('providers')}><Sliders /> {t('Connections')}</Btn>
          <Btn onClick={() => setSection('members')}><Users /> {t('Members')}</Btn>
        </Acts>
      </Card>

      <Card title={t('Recent admin events')} flush
        actions={<Btn size="sm" onClick={() => setSection('events')}>{t('Open event log')}</Btn>}>
        {!events && <Empty icon={Clock} title={t('Loading')} />}
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
    </>
  );
}
