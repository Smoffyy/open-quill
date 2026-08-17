import { useState, useEffect, useRef } from 'react';
import { AdminProvider, useAdmin } from './store.jsx';
import { NAV_GROUPS, SECTIONS, sectionById } from './nav.jsx';
import { ConfirmDialog } from './widgets.jsx';
import { Chevron, Search } from '../icons.jsx';
import DashboardSection from './sections/DashboardSection.jsx';
import ModelsSection from './sections/ModelsSection.jsx';
import ProvidersSection from './sections/ProvidersSection.jsx';
import AppearanceSection from './sections/AppearanceSection.jsx';
import HomeScreenSection from './sections/HomeScreenSection.jsx';
import MembersSection from './sections/MembersSection.jsx';
import WebSearchSection from './sections/WebSearchSection.jsx';
import VoiceSection from './sections/VoiceSection.jsx';
import MemorySection from './sections/MemorySection.jsx';
import MembankSection from './sections/MembankSection.jsx';
import SkillsSection from './sections/SkillsSection.jsx';
import McpSection from './sections/McpSection.jsx';
import SafetySection from './sections/SafetySection.jsx';
import FeedbackSection from './sections/FeedbackSection.jsx';
import LimitsSection from './sections/LimitsSection.jsx';
import AuditSection from './sections/AuditSection.jsx';
import AnalyticsSection from './sections/AnalyticsSection.jsx';
import DatabasesSection from './sections/DatabasesSection.jsx';
import PrivacySection from './sections/PrivacySection.jsx';
import { t } from '../../i18n.jsx';
import { BRAND_ICON } from '../../lib/brand.js';

const SECTION_COMPONENTS = {
  dashboard: DashboardSection,
  models: ModelsSection,
  providers: ProvidersSection,
  appearance: AppearanceSection,
  homescreen: HomeScreenSection,
  members: MembersSection,
  websearch: WebSearchSection,
  voice: VoiceSection,
  memory: MemorySection,
  membank: MembankSection,
  skills: SkillsSection,
  mcp: McpSection,
  safety: SafetySection,
  privacy: PrivacySection,
  feedback: FeedbackSection,
  limits: LimitsSection,
  audit: AuditSection,
  analytics: AnalyticsSection,
  databases: DatabasesSection
};

function DiscoverModal() {
  const A = useAdmin();
  const { discover, setDiscover } = A;
  if (!discover) return null;
  return (
    <div className="overlay sp-overlay" onMouseDown={(e) => e.target.classList.contains('sp-overlay') && setDiscover(null)}>
      <div className="sp-modal" style={{ maxHeight: '80vh' }}>
        <div className="sp-head">
          <div>
            <h3>{t("Discover models")}</h3>
            <div className="muted-note">{t("Models your backend currently exposes. Add the ones you want, added models can be hidden or deleted like any other.")}</div>
          </div>
          <button className="modal-close" style={{ position: 'static' }} onClick={() => setDiscover(null)} aria-label={t('Close')}>✕</button>
        </div>
        <div className="discover-list">
          {discover.loading && <div className="muted-note" style={{ padding: 14 }}>{t('Reaching the backend…')}</div>}
          {discover.error && <div className="dz-err">{discover.error}</div>}
          {!discover.loading && !discover.error && discover.list.length === 0 && <div className="muted-note" style={{ padding: 14 }}>{t("No models returned by the backend.")}</div>}
          {discover.list.map(x => (
            <div key={x.id} className="discover-row">
              <span className="discover-id">{x.id}</span>
              {x.added
                ? <span className="discover-added">{t("Added")} ✓</span>
                : <button className="btn" disabled={x.busy} onClick={() => A.addDiscovered(x.id)}>{x.busy ? t('Adding…') : t('Add')}</button>}
            </div>
          ))}
        </div>
        <div className="sp-foot">
          <button className="btn ghost" onClick={() => A.openDiscover(discover.providerId)} disabled={discover.loading}>{t("Refresh")}</button>
          <button className="btn primary" onClick={() => setDiscover(null)}>{t("Done")}</button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const A = useAdmin();
  const { section, setSection, models, users, cfg, pub, publishing, pubFlash, ask, setAsk, onClose } = A;
  const [navQ, setNavQ] = useState('');
  const navRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navRef.current?.focus();
        navRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const meta = sectionById(section);
  const activeGroup = NAV_GROUPS.find(g => g.id === meta.groupId) || NAV_GROUPS[0];
  const nq = navQ.trim().toLowerCase();
  const sectionMatches = nq ? SECTIONS.filter(s => [s.label, s.group, s.keywords].filter(Boolean).map(v => v + ' ' + t(v)).join(' ').toLowerCase().includes(nq)) : null;
  const modelMatches = nq ? models.filter(m => (m.display_name || '').toLowerCase().includes(nq) || (m.internal_name || '').toLowerCase().includes(nq)).slice(0, 5) : [];
  const jumpOpen = nq.length > 0;

  function pickSection(id) {
    setSection(id);
    setNavQ('');
  }
  function pickModel(m) {
    A.setSelModel(m.id);
    setSection('models');
    setNavQ('');
  }
  function pickFirst() {
    if (sectionMatches?.length) pickSection(sectionMatches[0].id);
    else if (modelMatches.length) pickModel(modelMatches[0]);
  }

  const Section = SECTION_COMPONENTS[section] || DashboardSection;
  const showPublish = section !== 'dashboard' && section !== 'databases';

  return (
    <div className="oqa">
      <header className="oqa-header">
        <button className="oqa-back" onClick={onClose}><Chevron style={{ transform: 'rotate(90deg)', width: 16 }} /></button>
        <button className="oqa-brand" onClick={() => setSection('dashboard')}>
          <img className="oqa-brand-icon" src={cfg.appIcon || BRAND_ICON} alt="" />
          <div className="oqa-brand-text">
            <span className="oqa-brand-name">{cfg.appName || 'open-quill'}</span>
            <span className="oqa-brand-sub">{t("Control Center")}</span>
          </div>
        </button>
        <nav className="oqa-toptabs">
          <button className={'oqa-toptab' + (section === 'dashboard' ? ' active' : '')} onClick={() => setSection('dashboard')}>
            {t('Dashboard')}
          </button>
          {NAV_GROUPS.filter(g => g.label).map(g => (
            <button key={g.id} className={'oqa-toptab' + (activeGroup.id === g.id ? ' active' : '')} onClick={() => setSection(g.items[0].id)}>
              {t(g.label)}
            </button>
          ))}
        </nav>
        <div className="oqa-jump">
          <Search className="oqa-jump-icon" />
          <input ref={navRef} value={navQ} onChange={(e) => setNavQ(e.target.value)} placeholder={t("Jump to anything… (Ctrl K)")}
            onKeyDown={(e) => { if (e.key === 'Enter') pickFirst(); if (e.key === 'Escape') { setNavQ(''); e.target.blur(); } }} />
          {jumpOpen && (
            <div className="oqa-jump-pop">
              <div className="oqa-group-label">{sectionMatches.length || modelMatches.length ? t('Matches') : t('No matches')}</div>
              {sectionMatches.map(({ id, label, Icon, group }) => (
                <button key={id} className={'oqa-tab' + (section === id ? ' active' : '')} onClick={() => pickSection(id)}>
                  <Icon /> <span>{t(label)}</span>{group && <span className="oqa-tab-hint">{t(group)}</span>}
                </button>
              ))}
              {modelMatches.map(m => (
                <button key={m.id} className="oqa-tab" onClick={() => pickModel(m)}>
                  {m.static_icon ? <img className="oqa-tab-mico" src={m.static_icon} alt="" /> : <span className="oqa-tab-mico noicon">{(m.display_name || '?').trim().charAt(0).toUpperCase()}</span>}
                  <span>{m.display_name || m.internal_name || 'Untitled'}</span><span className="oqa-tab-hint">{t("Model")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {showPublish && (
          <div className="oqa-status">
            {pubFlash
              ? <span className="saved-flash">{t("Pushed to all clients")} ✓</span>
              : pub.dirty
                ? <span className="pub-note dirty">{t("Unpublished draft changes")}</span>
                : <span className="pub-note">{pub.published ? t('Clients are up to date') : t('Nothing published yet')}</span>}
          </div>
        )}
        {showPublish && (
          <button className={'btn primary push-btn' + (pub.dirty ? ' dirty' : '')} onClick={A.publish} disabled={publishing || (!pub.dirty && pub.published)}>
            {publishing ? t('Pushing…') : t('Push to all clients')}
          </button>
        )}
      </header>
      <div className="oqa-shell">
        {activeGroup.items.length > 1 && (
          <nav className="oqa-rail">
            <div className="oqa-group-label">{t(activeGroup.label)}</div>
            {activeGroup.items.map(({ id, label, Icon }) => (
              <button key={id} className={'oqa-tab' + (section === id ? ' active' : '')} onClick={() => setSection(id)}>
                <Icon /> <span>{t(label)}</span>
                {id === 'models' && models.length > 0 && <span className="oqa-tab-count">{models.length}</span>}
                {id === 'members' && users.length > 0 && <span className="oqa-tab-count">{users.length}</span>}
              </button>
            ))}
          </nav>
        )}
        <div className="oqa-main">
          <div className="oqa-pagehead">
            <h1>{t(meta.label)}</h1>
            <span className="oqa-desc">{t(meta.desc)}</span>
          </div>
          <div className={'oqa-body' + (section === 'models' && models.length ? ' fill' : '')}>
            <Section />
          </div>
        </div>
      </div>
      <DiscoverModal />
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

export default function AdminApp({ user, onClose, modelId }) {
  return (
    <AdminProvider user={user} onClose={onClose} modelId={modelId}>
      <Shell />
    </AdminProvider>
  );
}
