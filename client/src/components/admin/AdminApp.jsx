import React, { useState, useEffect, useRef } from 'react';
import { AdminProvider, useAdmin } from './store.jsx';
import { NAV_GROUPS, SECTIONS, sectionById } from './nav.jsx';
import { ConfirmDialog } from './widgets.jsx';
import { Chevron } from '../icons.jsx';
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
  feedback: FeedbackSection,
  limits: LimitsSection,
  audit: AuditSection,
  analytics: AnalyticsSection
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
            <h3>Discover models</h3>
            <div className="muted-note">Models your backend currently exposes. Add the ones you want, added models can be hidden or deleted like any other.</div>
          </div>
          <button className="modal-close" style={{ position: 'static' }} onClick={() => setDiscover(null)}>✕</button>
        </div>
        <div className="discover-list">
          {discover.loading && <div className="muted-note" style={{ padding: 14 }}>Reaching the backend…</div>}
          {discover.error && <div className="dz-err">{discover.error}</div>}
          {!discover.loading && !discover.error && discover.list.length === 0 && <div className="muted-note" style={{ padding: 14 }}>No models returned by the backend.</div>}
          {discover.list.map(x => (
            <div key={x.id} className="discover-row">
              <span className="discover-id">{x.id}</span>
              {x.added
                ? <span className="discover-added">Added ✓</span>
                : <button className="btn" disabled={x.busy} onClick={() => A.addDiscovered(x.id)}>{x.busy ? 'Adding…' : 'Add'}</button>}
            </div>
          ))}
        </div>
        <div className="sp-foot">
          <button className="btn ghost" onClick={() => A.openDiscover(discover.providerId)} disabled={discover.loading}>Refresh</button>
          <button className="btn primary" onClick={() => setDiscover(null)}>Done</button>
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
  const nq = navQ.trim().toLowerCase();
  const sectionMatches = nq ? SECTIONS.filter(t => (t.label + ' ' + (t.group || '') + ' ' + (t.keywords || '')).toLowerCase().includes(nq)) : null;
  const modelMatches = nq ? models.filter(m => (m.display_name || '').toLowerCase().includes(nq) || (m.internal_name || '').toLowerCase().includes(nq)).slice(0, 5) : [];

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

  return (
    <div className="oqa">
      <nav className="oqa-nav">
        <div className="oqa-brand">
          <img className="oqa-brand-icon" src={cfg.appIcon || '/starburst.svg'} alt="" />
          <div className="oqa-brand-text">
            <span className="oqa-brand-name">{cfg.appName || 'open-quill'}</span>
            <span className="oqa-brand-sub">Control Center</span>
          </div>
        </div>
        <div className="oqa-jump">
          <input ref={navRef} value={navQ} onChange={(e) => setNavQ(e.target.value)} placeholder="Jump to anything… (Ctrl K)"
            onKeyDown={(e) => { if (e.key === 'Enter') pickFirst(); if (e.key === 'Escape') { setNavQ(''); e.target.blur(); } }} />
        </div>
        <div className="oqa-scroll">
          {sectionMatches ? (
            <div className="oqa-group">
              <div className="oqa-group-label">{sectionMatches.length || modelMatches.length ? 'Matches' : 'No matches'}</div>
              {sectionMatches.map(({ id, label, Icon, group }) => (
                <button key={id} className={'oqa-tab' + (section === id ? ' active' : '')} onClick={() => pickSection(id)}>
                  <Icon /> <span>{label}</span>{group && <span className="oqa-tab-hint">{group}</span>}
                </button>
              ))}
              {modelMatches.map(m => (
                <button key={m.id} className="oqa-tab" onClick={() => pickModel(m)}>
                  {m.static_icon ? <img className="oqa-tab-mico" src={m.static_icon} alt="" /> : <span className="oqa-tab-mico noicon">{(m.display_name || '?').trim().charAt(0).toUpperCase()}</span>}
                  <span>{m.display_name || m.internal_name || 'Untitled'}</span><span className="oqa-tab-hint">Model</span>
                </button>
              ))}
            </div>
          ) : NAV_GROUPS.map((g) => (
            <div className="oqa-group" key={g.id}>
              {g.label && <div className="oqa-group-label">{g.label}</div>}
              {g.items.map(({ id, label, Icon }) => (
                <button key={id} className={'oqa-tab' + (section === id ? ' active' : '')} onClick={() => setSection(id)}>
                  <Icon /> <span>{label}</span>
                  {id === 'models' && models.length > 0 && <span className="oqa-tab-count">{models.length}</span>}
                  {id === 'members' && users.length > 0 && <span className="oqa-tab-count">{users.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <button className="oqa-back" onClick={onClose}><Chevron style={{ transform: 'rotate(90deg)', width: 16 }} /> Back to chat</button>
      </nav>
      <div className="oqa-main">
        <header className="oqa-topbar">
          <div className="oqa-title">
            {meta.group && <span className="oqa-crumb">{meta.group}</span>}
            <h1>{meta.label}</h1>
            <span className="oqa-desc">{meta.desc}</span>
          </div>
          {section !== 'dashboard' && (
            <div className="oqa-status">
              {pubFlash
                ? <span className="saved-flash">Pushed to all clients ✓</span>
                : pub.dirty
                  ? <span className="pub-note dirty">Unpublished draft changes</span>
                  : <span className="pub-note">{pub.published ? 'Clients are up to date' : 'Nothing published yet'}</span>}
            </div>
          )}
          {section !== 'dashboard' && (
            <button className={'btn primary push-btn' + (pub.dirty ? ' dirty' : '')} onClick={A.publish} disabled={publishing || (!pub.dirty && pub.published)}>
              {publishing ? 'Pushing…' : 'Push to all clients'}
            </button>
          )}
        </header>
        <div className={'oqa-body' + (section === 'models' && models.length ? ' fill' : '')}>
          <Section />
        </div>
      </div>
      <DiscoverModal />
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

export default function AdminApp({ user, onClose }) {
  return (
    <AdminProvider user={user} onClose={onClose}>
      <Shell />
    </AdminProvider>
  );
}
