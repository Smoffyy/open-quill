import { useState, useEffect, useRef, useMemo } from 'react';
import { AdminProvider, useAdmin } from './store.jsx';
import { NAV, SECTIONS, sectionMeta } from './nav.jsx';
import { Btn, Confirm, SaveState } from './ui.jsx';
import { Search, X } from '../icons.jsx';
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
import BrandingSection from './sections/BrandingSection.jsx';
import LauncherSection from './sections/LauncherSection.jsx';
import MembersSection from './sections/MembersSection.jsx';
import GuardrailsSection from './sections/GuardrailsSection.jsx';
import NetworkSection from './sections/NetworkSection.jsx';
import QuotasSection from './sections/QuotasSection.jsx';
import UsageSection from './sections/UsageSection.jsx';
import RatingsSection from './sections/RatingsSection.jsx';
import EventsSection from './sections/EventsSection.jsx';
import StorageSection from './sections/StorageSection.jsx';

// Sections whose edits are staged for publish. The rest are either read-only
// records or infrastructure that has to take effect the moment it is saved.
const STAGED = new Set(['search', 'voice', 'memory', 'files', 'branding', 'launcher', 'guardrails', 'network', 'quotas']);

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
  branding: BrandingSection,
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

function isMac() {
  const hint = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac/i.test(hint);
}

function Finder() {
  const A = useAdmin();
  const { catalog, setSection } = A;
  const { models, setSelected } = catalog;
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
        Icon: null,
        label: m.display_name || m.internal_name || t('Untitled'),
        hint: t('model'),
        go: () => { setSelected(m.id); setSection('models'); }
      }));
    return [...rows.slice(0, 12), ...ms];
  }, [needle, models, setSelected, setSection]);

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
      <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t('Find a section or model')} aria-label={t('Find a section or model')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % Math.max(1, hits.length)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + hits.length) % Math.max(1, hits.length)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(cursor); }
        }} />
      <kbd>{isMac() ? '⌘K' : 'Ctrl K'}</kbd>
      {!!needle && (
        <div className="cp-find-pop">
          {hits.length === 0 && <div className="cp-find-empty">{t('Nothing matches “{q}”', { q })}</div>}
          {hits.map((h, i) => (
            <button key={h.key} className={'cp-find-row' + (i === cursor ? ' on' : '')}
              onMouseEnter={() => setCursor(i)} onClick={() => run(i)}>
              {h.Icon ? <h.Icon /> : <span style={{ width: 14 }} />}
              <span>{h.label}</span>
              <em>{h.hint}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Every edit in the panel is staged, so this belongs to the whole panel rather
// than to the models page it started on.
function DraftState() {
  const { catalog } = useAdmin();
  const { draft, publishing, publish } = catalog;
  return (
    <div className="cp-draft">
      <span className="cp-draft-note">
        <span className={'cp-dot' + (draft.dirty ? ' pending' : draft.published ? ' live' : '')} />
        {draft.dirty
          ? <b>{t('Unpublished changes')}</b>
          : draft.published ? t('Live') : t('Not published')}
      </span>
      <Btn kind="primary" disabled={publishing || (!draft.dirty && draft.published)} onClick={publish}>
        {publishing ? t('Publishing…') : t('Publish')}
      </Btn>
    </div>
  );
}

function Shell() {
  const A = useAdmin();
  const { section, setSection, catalog, members, onClose, ask, setAsk, keepScroll, workspace } = A;
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
          <span>{t('admin')}</span>
        </div>
        <div className="cp-top-spacer" />
        <Finder />
        <DraftState />
        <button className="cp-exit" onClick={onClose} title={t('Close')} aria-label={t('Close')}>
          <X style={{ width: 14 }} />
        </button>
      </header>

      <div className="cp-body">
        <nav className="cp-rail" aria-label={t('Sections')}>
          {NAV.map(g => (
            <div key={g.group} style={{ display: 'contents' }}>
              <div className="cp-rail-group">{t(g.group)}</div>
              {g.items.map(({ id, label, Icon }) => (
                <button key={id} className={'cp-rail-item' + (section === id ? ' on' : '')}
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
              {STAGED.has(section) && <SaveState state={workspace.saveState} />}
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

export default function AdminApp({ user, onClose, modelId }) {
  return (
    <AdminProvider user={user} onClose={onClose} modelId={modelId}>
      <Shell />
    </AdminProvider>
  );
}
