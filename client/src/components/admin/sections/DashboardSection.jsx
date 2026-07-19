import React, { useEffect } from 'react';
import { useAdmin } from '../store.jsx';
import { Card, fmtWhen } from '../widgets.jsx';
import { Cube, Sliders, Users, Wave, Plus, Sparkles, Clock, Gear } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

export default function DashboardSection() {
  const A = useAdmin();
  const { models, providers, providerTypes, users, usage, recentAudit, pub, publishing } = A;

  useEffect(() => {
    if (!usage) A.loadUsage('30');
    if (!recentAudit) A.loadRecentAudit();
  }, []);

  const visibleModels = models.filter(m => m.enabled && !m.unavailable).length;
  const hiddenModels = models.filter(m => !m.enabled).length;
  const unavailModels = models.filter(m => !!m.unavailable).length;
  const adminCount = users.filter(u => u.isAdmin || u.isOwner).length;
  const defaultModel = models.find(m => m.is_default);

  const stats = [
    ['Models', String(models.length), `${visibleModels} visible · ${hiddenModels} hidden${unavailModels ? ` · ${unavailModels} down` : ''}`, Cube, 'models'],
    ['Providers', String(providers.length), Object.keys(providerTypes).length ? 'LLM backends connected' : 'LLM backends', Sliders, 'providers'],
    ['Members', String(users.length), `${adminCount} admin${adminCount === 1 ? '' : 's'}`, Users, 'members'],
    ['30-day spend', usage ? '$' + (usage.totals?.cost || 0).toFixed(2) : ', ', usage ? `${(usage.totals?.total || 0).toLocaleString()} tokens · ${(usage.totals?.generations || 0).toLocaleString()} generations` : 'Loading…', Wave, 'analytics']
  ];

  return (
    <div className="dash">
      <div className="dash-stats">
        {stats.map(([l, v, s, Icon, dest]) => (
          <button key={l} className="dash-stat" onClick={() => A.setSection(dest)}>
            <span className="dash-stat-icon"><Icon /></span>
            <span className="dash-stat-main">
              <span className="dash-stat-v">{v}</span>
              <span className="dash-stat-l">{t(l)}</span>
              <span className="dash-stat-s">{s}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="dash-cols">
        <Card title={t("Publishing")} sub={t("Drafts stay private to admins until pushed.")}>
          <div className={'dash-pub' + (pub.dirty ? ' dirty' : '')}>
            <span className="dash-pub-dot" />
            <div className="dash-pub-text">
              <div className="dash-pub-title">{pub.dirty ? 'You have unpublished draft changes' : pub.published ? 'All clients are up to date' : 'Nothing published yet'}</div>
              <div className="muted-note">{pub.publishedAt ? 'Last pushed ' + new Date(pub.publishedAt).toLocaleString() : 'Model, appearance, and home screen edits collect in a draft until you push them.'}</div>
            </div>
            <button className="btn primary" onClick={A.publish} disabled={publishing || (!pub.dirty && pub.published)}>{publishing ? 'Pushing…' : 'Push now'}</button>
          </div>
          {defaultModel && (
            <div className="dash-default">
              <span className="muted-note" style={{ display: 'inline' }}>Default model:</span>
              <button className="linklike" onClick={() => { A.setSelModel(defaultModel.id); A.setSection('models'); }}>{defaultModel.display_name || defaultModel.internal_name}</button>
            </div>
          )}
        </Card>
        <Card title={t("Quick actions")} sub={t("Common tasks, one click away.")}>
          <div className="dash-actions">
            <button className="dash-action" onClick={() => { A.setSection('models'); A.addModel(); }}><Plus /> <span>New model</span></button>
            <button className="dash-action" onClick={() => { A.setSection('models'); A.openDiscover(providers[0]?.id); }}><Cube /> <span>Discover models</span></button>
            <button className="dash-action" onClick={() => A.setSection('providers')}><Sliders /> <span>Manage providers</span></button>
            <button className="dash-action" onClick={() => A.setSection('appearance')}><Sparkles /> <span>Edit appearance</span></button>
            <button className="dash-action" onClick={() => A.setSection('limits')}><Gear /> <span>Review limits</span></button>
            <button className="dash-action" onClick={() => A.setSection('audit')}><Clock /> <span>Open audit log</span></button>
          </div>
        </Card>
      </div>
      <Card title={t("Recent activity")} sub={t("The latest sensitive admin actions.")}
        right={<button className="linklike" onClick={() => A.setSection('audit')}>View full log</button>}>
        {!recentAudit && <div className="muted-note">{t("Loading…")}</div>}
        {recentAudit && recentAudit.length === 0 && <div className="muted-note">{t("No admin activity recorded yet.")}</div>}
        {recentAudit && recentAudit.length > 0 && (
          <div className="dash-activity">
            {recentAudit.map(e => (
              <div key={e.id} className="dash-act-row">
                <span className="au-action">{e.action}</span>
                <span className="dash-act-meta">{e.actorEmail}</span>
                <span className="dash-act-when">{fmtWhen(e.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
