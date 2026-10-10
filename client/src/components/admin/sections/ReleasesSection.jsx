import '../../../styles/changes.css';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { useAdmin } from '../store.jsx';
import { Card, Btn, Empty, KV, Note, fmtAgo } from '../ui.jsx';
import { Upload } from '../../ui/icons.jsx';
import { t } from '../../../i18n.jsx';
import { toast } from '../../../lib/toast.js';
import { groupChanges } from '../../../lib/changeset.js';
import { sectionMeta } from '../nav.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { ChangeRow, fieldLabel } from '../changes/ChangeRow.jsx';
import { changeCount } from '../changes/count.js';
import { AREA_TITLES } from '../changes/labels.js';

const PAGE = 20;

function kindLine(r) {
  if (r.kind === 'initial') return t('First recorded version');
  if (r.kind === 'restore') return t('Restored version {v}', { v: r.from });
  return changeCount(r.count);
}

function groupTitle(g) {
  if (g.key === 'models:order') return t('Catalog');
  if (g.key === 'themes') return t('Themes');
  if (g.key.startsWith('section:')) return t(sectionMeta(g.section).title);
  return g.label || t('Untitled');
}

function Detail({ version }) {
  const [rel, setRel] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/api/admin/releases/' + version)
      .then(r => { if (alive) setRel(r); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [version]);
  if (failed) return <Note tone="bad">{t('This version could not be loaded.')}</Note>;
  if (!rel) return <Skel when><SkelTable cols={2} rows={3} /></Skel>;
  if (!rel.changes.length) return <p className="ch-quiet">{t('Nothing changed in this version.')}</p>;
  const changes = rel.changes.map(c => ({ ...c, authors: (c.authors || []).map(name => ({ id: name, name })) }));
  return (
    <div className="ch">
      {groupChanges(changes).map(area => (
        <section key={area.area} className="ch-area" aria-label={t(AREA_TITLES[area.area])}>
          <h4>{t(AREA_TITLES[area.area])}</h4>
          {area.groups.map(g => (
            <div key={g.key} className="ch-group">
              <div className="ch-group-head"><b>{groupTitle(g)}</b><span>{changeCount(g.items.length)}</span></div>
              <ul>{g.items.map(c => <ChangeRow key={c.key} change={c} label={fieldLabel(c)} />)}</ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function ReleasesSection() {
  const { changes, confirm, setReviewing, user } = useAdmin();
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async (offset = 0) => {
    try {
      const r = await api.get(`/api/admin/releases?limit=${PAGE}&offset=${offset}`);
      setList(cur => ({ ...r, releases: offset && cur ? [...cur.releases, ...r.releases] : r.releases }));
    } catch {
      setList(cur => cur || { version: 0, total: 0, releases: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => load();
    window.addEventListener('oq-config', again);
    return () => window.removeEventListener('oq-config', again);
  }, [load]);

  const restore = (r) => confirm({
    title: t('Restore version {v}?', { v: r.version }),
    message: t('Members switch to version {v} straight away. It ships as a new version, so this can be undone the same way. Changes still waiting in the draft are kept.', { v: r.version }),
    confirm: t('Restore this version'),
    onConfirm: async () => {
      try {
        const out = await api.post(`/api/admin/releases/${r.version}/restore`, {});
        toast(t('Version {v} is live again, published as version {n}.', { v: r.version, n: out.version }));
        await load();
        changes.reload();
      } catch (e) {
        toast(e?.message || t('That version could not be restored.'), { kind: 'error', icon: 'info' });
      }
    }
  });

  const pending = changes.changes.length;
  const head = list?.releases?.[0];

  return (
    <>
      <Card title={t('Live version')}
        sub={t('Every edit in this panel is staged. You see your own draft straight away; members keep running the published version until a release ships it.')}
        actions={<Btn kind={pending ? 'primary' : undefined} onClick={() => setReviewing(true)}>{t('Review changes')}</Btn>}>
        <KV items={[
          [t('Members are on'), changes.version ? t('Version {v}', { v: changes.version }) : t('loading')],
          [t('Published'), changes.publishedAt ? [changes.publishedBy, new Date(changes.publishedAt).toLocaleString()].filter(Boolean).join(' · ') : t('never')],
          [t('Waiting in the draft'), pending ? changeCount(pending) : t('nothing')]
        ]} />
      </Card>

      <Card title={t('History')} sub={t('The last 50 versions are kept.')} flush
        foot={list && list.releases.length < list.total && head ? (
          <Btn size="sm" disabled={more} onClick={async () => { setMore(true); await load(list.releases.length); setMore(false); }}>
            {t('Show older versions')}
          </Btn>
        ) : null}>
        <Skel when={!list}><SkelTable cols={3} rows={5} /></Skel>
        {list && !list.releases.length && <Empty icon={Upload} title={t('Nothing published yet')} />}
        {list && list.releases.length > 0 && (
          <div className="rl-list">
            {list.releases.map(r => {
              const live = r.version === list.version;
              const expanded = open === r.version;
              return (
                <div key={r.id} className="rl-item">
                  <button type="button" className="rl-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.version)}>
                    <span className="rl-v">v{r.version}</span>
                    <span className="rl-what">
                      <b>{r.note || kindLine(r)}</b>
                      <span>{[r.note ? kindLine(r) : '', r.author, live ? t('live now') : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="rl-when" data-tip={new Date(r.createdAt).toLocaleString()}>{fmtAgo(r.createdAt)}</span>
                  </button>
                  {expanded && (
                    <div className="rl-body">
                      <Detail version={r.version} />
                      {!live && user?.canPublish && (
                        <div>
                          <Btn size="sm" onClick={() => restore(r)}>{t('Restore this version')}</Btn>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}