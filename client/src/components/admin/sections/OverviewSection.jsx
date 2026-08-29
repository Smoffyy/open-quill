import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Block, Btn, Table, Stats, Badge, Empty, Note, KV, fmtInt, fmtMoney, fmtAgo } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function OverviewSection() {
  const { catalog, members, setSection } = useAdmin();
  const { models, providers, draft, publish, publishing } = catalog;
  const [usage, setUsage] = useState(null);
  const [events, setEvents] = useState(null);

  useEffect(() => {
    (async () => {
      try { setUsage(await api.get('/api/admin/usage?days=30')); } catch { setUsage(null); }
      try { const d = await api.get('/api/admin/audit?limit=8&offset=0'); setEvents(d.entries || []); } catch { setEvents([]); }
    })();
  }, []);

  const visible = models.filter(m => m.enabled && !m.unavailable).length;
  const hidden = models.filter(m => !m.enabled).length;
  const down = models.filter(m => !!m.unavailable).length;
  const admins = members.members.filter(u => u.isAdmin || u.isOwner).length;
  const fallback = models.find(m => m.is_default);

  return (
    <>
      <Block>
        <Stats items={[
          { k: t('Catalog'), v: fmtInt(models.length), n: t('{v} visible · {h} hidden{d}', { v: visible, h: hidden, d: down ? ' · ' + down + ' down' : '' }) },
          { k: t('Connections'), v: fmtInt(providers.length) },
          { k: t('Members'), v: fmtInt(members.members.length), n: t('{n} with admin', { n: admins }) },
          { k: t('30-day spend'), v: usage ? fmtMoney(usage.totals.cost) : '—', n: usage ? t('{n} tokens', { n: fmtInt(usage.totals.total) }) : t('loading') }
        ]} />
      </Block>

      <Block title={t('Catalog draft')}
        sub={t('Model edits are held back until published. Everything else in this panel is live the moment you change it.')}
        actions={<Btn kind="primary" disabled={publishing || (!draft.dirty && draft.published)} onClick={publish}>
          {publishing ? t('Publishing…') : t('Publish catalog')}
        </Btn>}>
        <Note tone={draft.dirty ? 'warn' : undefined}>
          {draft.dirty
            ? t('The draft has changes clients are not running yet.')
            : draft.published ? t('Clients are running the current draft.') : t('The catalog has never been published.')}
        </Note>
        <div style={{ marginTop: 14 }}>
          <KV items={[
            [t('last published'), draft.publishedAt ? new Date(draft.publishedAt).toLocaleString() : t('never'), true],
            [t('fallback model'), fallback ? (fallback.display_name || fallback.internal_name) : t('none set'), true]
          ]} />
        </div>
      </Block>

      <Block title={t('Recent admin events')}
        actions={<Btn size="sm" onClick={() => setSection('events')}>{t('Open event log')}</Btn>}>
        {!events && <Empty title={t('Loading')} />}
        {events && events.length === 0 && (
          <Empty title={t('Nothing recorded')}>{t('Sensitive admin actions appear here as they happen.')}</Empty>
        )}
        {events && events.length > 0 && (
          <Table head={[
            { label: t('Action'), fit: true, mono: true },
            { label: t('Actor'), mono: true },
            { label: t('When'), num: true, fit: true, mono: true }
          ]}>
            {events.map(e => (
              <tr key={e.id}>
                <td className="mono"><Badge>{e.action}</Badge></td>
                <td className="mono dim">{e.actorEmail}</td>
                <td className="num mono dim">{fmtAgo(e.ts)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
    </>
  );
}
