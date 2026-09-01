import { useState, useEffect, useRef, useMemo } from 'react';
import { AdminProvider, useAdmin } from './store.jsx';
import { NAV, SECTIONS, sectionMeta } from './nav.jsx';
import { Confirm, SaveState } from './ui.jsx';
import { PublishState } from './publish.jsx';
import { Search, X, Cube } from '../icons.jsx';
import { t } from '../../i18n.jsx';
import { BRAND_ICON } from '../../lib/brand.js';

import OverviewSection from './sections/OverviewSection.jsx';
import ModelsSection from './sections/ModelsSection.jsx';
import ProvidersSection from './sections/ProvidersSection.jsx';
import SearchSection from './sections/SearchSection.jsx';
import VoiceSection from './sections/VoiceSection.jsx';
import MemorySection from './sections/MemorySection.jsx';
import FilesSection from './sections/FilesSection.jsx';
import SkillsSection from './sections/SkillsSection.jsx';
import McpSection from './sections/McpSection.jsx';
import InterfaceSection from './sections/InterfaceSection.jsx';
import LauncherSection from './sections/LauncherSection.jsx';
import MembersSection from './sections/MembersSection.jsx';
import GuardrailsSection from './sections/GuardrailsSection.jsx';
import NetworkSection from './sections/NetworkSection.jsx';
import QuotasSection from './sections/QuotasSection.jsx';
import UsageSection from './sections/UsageSection.jsx';
import RatingsSection from './sections/RatingsSection.jsx';
import EventsSection from './sections/EventsSection.jsx';
import StorageSection from './sections/StorageSection.jsx';

const VIEWS = {
  __proto__: null,
  overview: OverviewSection,
  models: ModelsSection,
  providers: ProvidersSection,
  search: SearchSection,
  voice: VoiceSection,
  memory: MemorySection,
  files: FilesSection,
  skills: SkillsSection,
  mcp: McpSection,
  interface: InterfaceSection,
  launcher: LauncherSection,
  members: MembersSection,
  guardrails: GuardrailsSection,
  network: NetworkSection,
  quotas: QuotasSection,
  usage: UsageSection,
  ratings: RatingsSection,
  events: EventsSection,
  storage: StorageSection
};

const MAX_HITS = 12;

function isMac() {
  const hint = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac/i.test(hint);
}

function Finder() {
  const { catalog, setSection, openModel } = useAdmin();
  const { models } = catalog;
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!q) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setQ(''); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [q]);

  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!needle) return [];
    const rows = [];
    for (const sec of SECTIONS) {
      if ([t(sec.title), t(sec.group), t(sec.find)].join(' ').toLowerCase().includes(needle)) {
        rows.push({ key: 's:' + sec.id, Icon: sec.Icon, label: t(sec.title), hint: t(sec.group), go: () => setSection(sec.id) });
      }
      // A setting is findable by its own name, landing on the section that holds it.
      for (const entry of (sec.index || [])) {
        const label = t(entry);
        if (!label.toLowerCase().includes(needle)) continue;
        rows.push({ key: 's:' + sec.id + ':' + entry, Icon: sec.Icon, label, hint: t(sec.title), go: () => setSection(sec.id) });
      }
    }
    const ms = models
      .filter(m => (m.display_name || '').toLowerCase().includes(needle) || (m.internal_name || '').toLowerCase().includes(needle))
      .slice(0, 5)
      .map(m => ({
        key: 'm:' + m.id,
        Icon: Cube,
        label: m.display_name || m.internal_name || t('Untitled'),
        hint: t('model'),
        go: () => openModel(m.id)
      }));
    return [...rows.slice(0, MAX_HITS), ...ms];
  }, [needle, models, openModel, setSection]);

  useEffect(() => { setCursor(0); }, [needle]);

  function run(i) {
    const hit = hits[i];
    if (!hit) return;
    hit.go();
    setQ('');
    inputRef.current?.blur();
  }

  return (
    <div className="cp-find" ref={boxRef}>
      <Search />
      <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} type="search"
        placeholder={t('Find a section or model')} aria-label={t('Find a section or model')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % Math.max(1, hits.length)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + hits.length) % Math.max(1, hits.length)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(cursor); }
        }} />
      <kbd>{isMac() ? '⌘K' : 'Ctrl K'}</kbd>
      {!!needle && (
        <div className="cp-menu">
          {hits.length === 0 && <div className="cp-menu-empty">{t('Nothing matches “{q}”', { q })}</div>}
          {hits.map((h, i) => (
            <button key={h.key} type="button" className={'cp-menu-item' + (i === cursor ? ' on' : '')}
              onMouseEnter={() => setCursor(i)} onClick={() => run(i)}>
              <h.Icon />
              <span>{h.label}</span>
              <em>{h.hint}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { section, setSection, catalog, members, onClose, ask, setAsk, keepScroll, workspace } = useAdmin();
  const scrollRef = useRef(null);
  const meta = sectionMeta(section);
  const View = VIEWS[section] || OverviewSection;

  useEffect(() => keepScroll('cp:' + section, scrollRef.current), [section, keepScroll]);

  useEffect(() => {
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.cp-overlay')) return;
      if (e.target.closest('input, textarea, select')) return;
      onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const counts = { models: catalog.models.length, members: members.members.length, providers: catalog.providers.length };

  return (
    <div className="cp-scrim" role="dialog" aria-modal="true" aria-label={t('Control panel')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp">
        <header className="cp-top">
          <div className="cp-mark">
            <img src={workspace.config.appIcon || BRAND_ICON} alt="" />
            <b>{workspace.config.appName || 'open-quill'}</b>
            <span>{t('Admin')}</span>
          </div>
          <div className="cp-top-spacer" />
          <Finder />
          <div className="cp-top-acts">
            <PublishState />
            <button type="button" className="cp-exit" onClick={onClose} title={t('Close')} aria-label={t('Close')}>
              <X />
            </button>
          </div>
        </header>

        <div className="cp-body">
          <nav className="cp-rail" aria-label={t('Sections')}>
            {NAV.map(g => (
              <div key={g.group} style={{ display: 'contents' }}>
                <div className="cp-rail-group">{t(g.group)}</div>
                {g.items.map(({ id, label, Icon }) => (
                  <button key={id} type="button" className={'cp-rail-item' + (section === id ? ' on' : '')}
                    aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
                    <Icon />
                    <span>{t(label)}</span>
                    {counts[id] > 0 && <span className="cp-rail-count">{counts[id]}</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <main className="cp-view">
            <div className="cp-head">
              <div className="cp-head-main">
                <h1>{t(meta.title)}</h1>
                <p>{t(meta.blurb)}</p>
              </div>
              <div className="cp-head-acts">
                {meta.saves === 'workspace' && <SaveState state={workspace.saveState} />}
              </div>
            </div>
            <div ref={scrollRef} className="cp-scroll">
              <div className="cp-page"><View /></div>
            </div>
          </main>
        </div>

        <Confirm ask={ask} onClose={() => setAsk(null)} />
      </div>
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
