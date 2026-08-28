import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Tip from './Tip.jsx';
import { Plus, Search, Panel, Gear, Shield, Flask, Logout, DotsV, Trash, Heart, Star, Download, Chevron, ChevDown, Box, Compact, Stop, Sliders, Check, Artifact, Briefcase, ModelDocs, Info, Clock, ArrowOut, QuickTask, Sparkles, Paper } from './icons.jsx';
import { t } from '../i18n.jsx';
import { resolveKeybinds, comboKeys } from '../lib/keybinds.js';
import { parseVersion } from '../lib/appversion.js';
import { nextFitSize, FIT_PASSES } from '../lib/fittext.js';

function useFitText(ref, text, min) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !text) return;
    const fit = () => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      if (!(base > 0)) return;
      const floor = base * min;
      let size = base;
      for (let i = 0; i < FIT_PASSES; i++) {
        const next = nextFitSize(size, el.clientWidth, el.scrollWidth, floor);
        if (!next) break;
        size = next;
        el.style.fontSize = size + 'px';
      }
    };
    fit();
    const box = el.parentElement;
    if (!box || typeof ResizeObserver !== 'function') return;
    let last = box.clientWidth;
    const ro = new ResizeObserver(() => {
      if (box.clientWidth === last) return;
      last = box.clientWidth;
      fit();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref, text, min]);
}

const SIDE_MIN = 232;
const SIDE_MAX = 440;
const SIDE_KEY = 'oq-sidebar-w';

export function storedSidebarWidth() {
  try {
    const n = parseInt(localStorage.getItem(SIDE_KEY), 10);
    if (Number.isFinite(n)) return Math.min(SIDE_MAX, Math.max(SIDE_MIN, n));
  } catch { }
  return null;
}

function SideResize({ targetRef, onCommit }) {
  const drag = useRef(null);

  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      const el = targetRef.current;
      if (!d || !el) return;
      el.style.width = Math.min(SIDE_MAX, Math.max(SIDE_MIN, d.w + (e.clientX - d.x))) + 'px';
    };
    const up = () => {
      const el = targetRef.current;
      if (!drag.current || !el) return;
      drag.current = null;
      el.style.transition = '';
      document.body.classList.remove('resizing-x');
      const w = Math.round(el.getBoundingClientRect().width);
      try { localStorage.setItem(SIDE_KEY, String(w)); } catch { }
      if (onCommit) onCommit(w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [targetRef, onCommit]);

  const start = (e) => {
    const el = targetRef.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    drag.current = { x: e.clientX, w: el.getBoundingClientRect().width };
    el.style.transition = 'none';
    document.body.classList.add('resizing-x');
  };

  const setWidth = (w) => {
    const el = targetRef.current;
    if (!el) return;
    if (w == null) {
      el.style.width = '';
      try { localStorage.removeItem(SIDE_KEY); } catch { }
    } else {
      el.style.width = w + 'px';
      try { localStorage.setItem(SIDE_KEY, String(w)); } catch { }
    }
    if (onCommit) onCommit(w);
  };

  const nudge = (e) => {
    const el = targetRef.current;
    if (!el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const step = e.shiftKey ? 32 : 8;
    setWidth(Math.min(SIDE_MAX, Math.max(SIDE_MIN,
      Math.round(el.getBoundingClientRect().width) + (e.key === 'ArrowRight' ? step : -step))));
  };

  return (
    <div className="side-resize" role="separator" aria-orientation="vertical" aria-label={t('Resize sidebar')}
      tabIndex={0} onPointerDown={start} onKeyDown={nudge} onDoubleClick={() => setWidth(null)}>
      <span className="side-resize-grip" aria-hidden="true" />
    </div>
  );
}

const FOLD_KEY = 'oq-folded-sections';

function readFolded() {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); }
}

function SectionHead({ id, label, folded, onToggle, children }) {
  return (
    <div className="section-label recents-label has-head">
      <button className="sec-head" aria-expanded={!folded} onClick={() => onToggle(id)}>
        <span className="sec-head-label">{label}</span>
        <ChevDown className="sec-head-chev" aria-hidden="true" />
      </button>
      <span className="sec-head-actions">{children}</span>
    </div>
  );
}

function ProfileMenu({ user, anchorRef, onSettings, onAdmin, onPlayground, onCredits, onChangelog, onLicense, onLogout, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const btn = anchorRef.current;
    const r = btn?.getBoundingClientRect();
    if (!r) return;
    const rail = btn.closest('.sidebar')?.getBoundingClientRect();
    const left = rail ? rail.left + 8 : r.left;
    const width = rail ? Math.max(210, rail.width - 8) : Math.max(210, r.width);
    setPos({ left, width, bottom: window.innerHeight - r.top + 5.8 });
  }, [anchorRef]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);
  return createPortal(
    <div className="popover" ref={ref} role="menu" aria-label={t('Profile menu')}
      style={pos ? { position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, right: 'auto' } : { visibility: 'hidden' }}>
      <div className="pm-account">{user.email}</div>
      {user.isAdmin && <button onClick={onAdmin}><Shield /> {t('Admin Panel')}</button>}
      {user.isAdmin && <button onClick={onPlayground}><Flask /> {t('Playground')}</button>}
      <button onClick={onSettings}><Gear /> {t('Settings')}</button>
      <button onClick={onCredits}><Heart /> {t('Credits')}</button>
      <button onClick={onChangelog}><Sparkles /> {t('Changelog')}</button>
      <button onClick={onLicense}><Paper /> {t('Licensing')}</button>
      <hr />
      <button onClick={onLogout}><Logout /> {t('Log out')}</button>
    </div>, document.body
  );
}

function ChatRow({ c, active, showTrash, projects = [], onMoveToProject, onOpen, onDelete, onToggleStar, busyIds, onStopChat }) {
  const busy = !!(busyIds && busyIds.has(c.id));
  const [menu, setMenu] = useState(null); // null or {top,left}
  const [subOpen, setSubOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenu(null); setSubOpen(false);
    };
    const dismiss = () => { setMenu(null); setSubOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);
  function openMenu(e) {
    e.stopPropagation();
    if (menu) { setMenu(null); setSubOpen(false); return; }
    const r = btnRef.current.getBoundingClientRect();
    setMenu({ top: r.bottom + 6, left: r.left, anchorTop: r.top, ready: false });
  }
  function openContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    setSubOpen(false);
    setMenu({ top: e.clientY + 4, left: e.clientX, anchorTop: e.clientY, ready: false });
  }
  useLayoutEffect(() => {
    if (!menu || menu.ready || !menuRef.current) return;
    const pad = 8;
    const mr = menuRef.current.getBoundingClientRect();
    let top = menu.top;
    let left = menu.left;
    if (top + mr.height > window.innerHeight - pad) top = Math.max(pad, menu.anchorTop - mr.height - 6);
    if (top + mr.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - mr.height - pad);
    left = Math.min(Math.max(pad, left), window.innerWidth - mr.width - pad);
    setMenu(m => m ? { ...m, top, left, ready: true } : m);
  }, [menu, subOpen]);
  const openInTab = () => window.open('/chat/' + c.id, '_blank', 'noopener');
  const close = () => { setMenu(null); setSubOpen(false); };
  return (
    <div className={'chat-row' + (active ? ' active' : '') + (busy ? ' busy' : '')}
      onClick={(e) => { if (e.ctrlKey || e.metaKey) { openInTab(); return; } onOpen(c.id); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openInTab(); } }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onContextMenu={openContextMenu}>
      <span className="row-ic">
        {busy ? <span className="row-busy" role="img" aria-label={t('Still generating')} title={t('Still generating')} />
          : c.projectId ? <Box className="row-project" style={{ width: 15 }} aria-label={t('In a project')} />
          : <span className="row-dot" aria-hidden="true" />}
      </span>
      <span className="title">{c.title}</span>
      {showTrash ? (
        <button className="row-ctrl shift-del" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} title={t("Delete chat")} aria-label={t("Delete chat")}><Trash /></button>
      ) : (
        <button className="row-ctrl" ref={btnRef} onClick={openMenu} title={t("Options")} aria-label={t("Options")} aria-expanded={!!menu} aria-haspopup="menu"><DotsV /></button>
      )}
      {menu && createPortal(
        <div className="chat-menu" ref={menuRef} role="menu" aria-label={t("Chat options")} style={{ top: menu.top, left: menu.left, visibility: menu.ready ? undefined : 'hidden' }}>
          {busy && onStopChat && (
            <button onClick={(e) => { e.stopPropagation(); onStopChat(c.id); close(); }}>
              <Stop style={{ width: 20 }} /> {t('Stop generating')}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onToggleStar(c.id); close(); }}>
            <Star style={{ width: 20 }} /> {c.starred ? t('Unstar chat') : t('Star chat')}
          </button>
          {onMoveToProject && (
            <div className="cm-sub">
              <button onClick={(e) => { e.stopPropagation(); setSubOpen(s => !s); setMenu(m => m ? { ...m, ready: false } : m); }}>
                <Box style={{ width: 20 }} /> {t('Add to project')}
                <Chevron style={{ width: 13, marginLeft: 'auto', transform: subOpen ? 'rotate(90deg)' : 'none' }} />
              </button>
              {subOpen && (
                <div className="cm-sublist">
                  {c.projectId && <button onClick={(e) => { e.stopPropagation(); onMoveToProject(c.id, null); close(); }}>{t('Remove from project')}</button>}
                  {projects.length === 0 && <div className="cm-empty">{t('No projects yet')}</div>}
                  {projects.map(p => (
                    <button key={p.id} className={p.id === c.projectId ? 'on' : ''} onClick={(e) => { e.stopPropagation(); onMoveToProject(c.id, p.id); close(); }}>
                      <Box style={{ width: 15 }} /> {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={(e) => { e.stopPropagation(); window.open('/api/chats/' + c.id + '/export?format=md', '_blank'); close(); }}>
            <Download style={{ width: 20 }} /> Export as Markdown
          </button>
          <button onClick={(e) => { e.stopPropagation(); window.open('/api/chats/' + c.id + '/export?format=json', '_blank'); close(); }}>
            <Download style={{ width: 20 }} /> Export as JSON
          </button>
          <button className="danger" onClick={(e) => { e.stopPropagation(); onDelete(c.id); close(); }}>
            <Trash style={{ width: 20 }} /> Delete chat
          </button>
        </div>, document.body)}
    </div>
  );
}

function Sidebar({
  user, chats, onSearch, chatsLoaded = true, activeId, appName, onNew, onOpen, onDelete, onToggleStar,
  collapsed, onToggle, onSettings, onAdmin, onPlayground, onCredits, onChangelog, onLicense, onLogout, version, onChatsOverview,
  onSpaces, spacesPending = 0, projects = [], onProjects, onOpenProject, onNewProject, onMoveToProject, mobileOpen = false, onMobileClose,
  onArtifacts, onScheduled, onCustomize, onModelDocs, showModelDocs = true, onVersion, dest = null,
  busyChats = [], onStopChat
}) {
  const brandRef = useRef(null);
  const verRef = useRef(null);
  const verText = version ? parseVersion(version)?.full || '' : '';
  useFitText(brandRef, appName || 'open-quill', 0.6);
  useFitText(verRef, verText, 0.8);
  const busyIds = React.useMemo(() => new Set(busyChats), [busyChats]);
  const combos = React.useMemo(() => {
    const k = resolveKeybinds(user?.prefs);
    const show = (id) => (k[id] ? comboKeys(k[id]).join('+') : '');
    return { newChat: show('newChat'), sidebar: show('toggleSidebar'), search: show('searchChats') };
  }, [user?.prefs]);
  const newChatCombo = combos.newChat;
  const sidebarCombo = combos.sidebar;
  const searchCombo = combos.search;
  const [menu, setMenu] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [hover, setHover] = useState(false);
  const chatsRef = useRef(null);
  const sideRef = useRef(null);
  const [width, setWidth] = useState(() => storedSidebarWidth());
  const [scrolled, setScrolled] = useState(false);
  const profileBtnRef = useRef(null);
  const [groupBy, setGroupBy] = useState(() => { try { return localStorage.getItem('oq-group-by') || 'date'; } catch { return 'date'; } });
  const [groupMenu, setGroupMenu] = useState(false);
  const [folded, setFolded] = useState(readFolded);
  const toggleFold = (id) => setFolded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { }
    return next;
  });
  const groupRef = useRef(null);
  const pickGroup = (v) => { setGroupBy(v); setGroupMenu(false); try { localStorage.setItem('oq-group-by', v); } catch {} };
  useEffect(() => {
    if (!groupMenu) return;
    const h = (e) => { if (groupRef.current && !groupRef.current.contains(e.target)) setGroupMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setGroupMenu(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [groupMenu]);
  useEffect(() => {
    const down = (e) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e) => { if (e.key === 'Shift') setShiftHeld(false); };
    const blur = () => setShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  const showTrash = shiftHeld && hover;

  chats = chats.filter(c => !c.archived);
  const starred = chats.filter(c => c.starred);
  const starredProjects = (projects || []).filter(p => p.starred);
  const others = chats.filter(c => !c.starred);
  const nowMs = Date.now();
  const DAY = 86400000;
  const SIDEBAR_CHAT_LIMIT = 40;
  const SIDEBAR_PROJECT_LIMIT = 5;
  const capped = others.slice(0, SIDEBAR_CHAT_LIMIT);
  const overflow = others.length > SIDEBAR_CHAT_LIMIT;
  const recentGroups = (() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', items: capped }];
    if (groupBy === 'project') {
      const byId = new Map(projects.map(p => [p.id, p.name]));
      const buckets = new Map();
      for (const c of capped) {
        const k = c.projectId && byId.has(c.projectId) ? c.projectId : '_none';
        if (!buckets.has(k)) buckets.set(k, { key: k, label: k === '_none' ? t('No project') : byId.get(k), items: [] });
        buckets.get(k).items.push(c);
      }
      const list = [...buckets.values()];
      list.sort((a, b) => a.key === '_none' ? 1 : b.key === '_none' ? -1 : a.label.localeCompare(b.label));
      return [{ key: 'lead', label: '', items: [] }, ...list];
    }
    const g = [
      { key: 'recent', label: '', items: [] },
      { key: 'd3', label: '3+ days ago', items: [] },
      { key: 'd7', label: '7+ days ago', items: [] },
    ];
    for (const c of capped) {
      const age = nowMs - (c.updated_at || nowMs);
      if (age < 3 * DAY) g[0].items.push(c);
      else if (age < 7 * DAY) g[1].items.push(c);
      else g[2].items.push(c);
    }
    return g;
  })();
  const rowProps = { onOpen, onDelete, onToggleStar, busyIds, onStopChat, projects, onMoveToProject };
  const row = (c) => <ChatRow key={c.id} c={c} active={c.id === activeId} showTrash={showTrash} {...rowProps} />;

  return (
    <div className={'sidebar' + (collapsed ? ' collapsed' : '') + (mobileOpen ? ' mobile-open' : '')}
      ref={sideRef} style={width && !collapsed ? { width } : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {!collapsed && <SideResize targetRef={sideRef} onCommit={setWidth} />}
      <div className="sidebar-head">
        <div className="brand-wrap">
          <div className="brand" ref={brandRef}>{appName || 'open-quill'}</div>
          {verText && <div className="brand-version" ref={verRef}>{verText}</div>}
        </div>
        <div className="sidebar-head-actions">
          <Tip label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')} keys={sidebarCombo}>
            <button className="icon-btn collapse-btn" onClick={onToggle}
              aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}><Panel style={{ width: 16 }} /></button>
          </Tip>
          <Tip label={t('Search')} keys={searchCombo}>
            <button className="icon-btn search-btn" onClick={onSearch} aria-label={t('Search')}><Search style={{ width: 16 }} /></button>
          </Tip>
          <button className="icon-btn mobile-close-btn" onClick={onMobileClose} title={t("Close menu")}><span style={{ fontSize: 20, lineHeight: 1 }}>✕</span></button>
        </div>
      </div>
      <div className="nav">
        <div className="new-row">
        <button className={'nav-item new-chat' + (!activeId && !dest ? ' on' : '')} title={t("New")}
          aria-current={!activeId && !dest ? 'page' : undefined}
          onClick={(e) => { if (e.ctrlKey || e.metaKey) { window.open('/', '_blank', 'noopener'); return; } onNew(); }}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); window.open('/', '_blank', 'noopener'); } }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}><span className="nav-ic new-chat-plus"><Plus /></span> <span className="nav-label">{t("New")}</span>
          {newChatCombo && <span className="nav-shortcut">{newChatCombo}</span>}</button>
        <button className="new-quick" title={t('Quick task')} aria-label={t('Quick task')}
          onClick={(e) => { e.stopPropagation(); (onScheduled || onNew)(); }}><QuickTask /></button>
        </div>
        <button className={'nav-item' + (dest === 'projects' ? ' on' : '')} title={t("Projects")} aria-current={dest === 'projects' ? 'page' : undefined} onClick={onProjects}><span className="nav-ic"><Box /></span> <span className="nav-label">{t("Projects")}</span></button>
        <button className={'nav-item' + (dest === 'artifacts' ? ' on' : '')} title={t("Artifacts")} aria-current={dest === 'artifacts' ? 'page' : undefined} onClick={() => onArtifacts && onArtifacts()}><span className="nav-ic"><Artifact /></span> <span className="nav-label">{t("Artifacts")}</span></button>
        <button className={'nav-item' + (dest === 'scheduled' ? ' on' : '')} title={t("Scheduled")} aria-current={dest === 'scheduled' ? 'page' : undefined} onClick={() => onScheduled && onScheduled()}><span className="nav-ic"><Clock /></span> <span className="nav-label">{t("Scheduled")}</span></button>
        <button className="nav-item" title={t("Customize")} onClick={() => onCustomize && onCustomize()}><span className="nav-ic"><Briefcase /></span> <span className="nav-label">{t("Customize")}</span></button>
      </div>
      <div className="chats-wrap">
      <div className={'chats' + (scrolled ? ' scrolled' : '')} ref={chatsRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        {!chatsLoaded ? (
          <>
            <div className="section-label">{t("Recents")}</div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="chat-skel"><span className="skeleton" style={{ width: (55 + ((i * 37) % 40)) + '%' }} /></div>
            ))}
          </>
        ) : (
          <>
            {projects.length > 0 && <>
              <SectionHead id="projects" label={t('Projects')} folded={folded.has('projects')} onToggle={toggleFold}>
                <button className="rl-group" title={t('All projects')} aria-label={t('All projects')}
                  onClick={onProjects}><ArrowOut /></button>
                {onNewProject && <button className="rl-group" title={t('New project')} aria-label={t('New project')}
                  onClick={onNewProject}><Plus /></button>}
              </SectionHead>
              {!folded.has('projects') && projects.slice(0, SIDEBAR_PROJECT_LIMIT).map(p => (
                <div key={p.id} className="chat-row project-row" onClick={() => onOpenProject && onOpenProject(p.id)}>
                  <span className="row-ic"><Box style={{ width: 20, flexShrink: 0, opacity: .85 }} /></span>
                  <span className="title">{p.name}</span>
                </div>
              ))}
            </>}

            {(starred.length > 0 || starredProjects.length > 0) && <>
              <SectionHead id="starred" label={t("Starred")} folded={folded.has('starred')} onToggle={toggleFold} />
              {!folded.has('starred') && starredProjects.map(p => (
                <div key={p.id} className="chat-row project-row" onClick={() => onOpenProject && onOpenProject(p.id)}>
                  <span className="row-ic"><Box style={{ width: 20, flexShrink: 0, opacity: .85 }} /></span>
                  <span className="title">{p.name}</span>
                </div>
              ))}
              {!folded.has('starred') && starred.map(row)}
            </>}

            <div className="section-label recents-label has-head" ref={groupRef}>
              <button className="sec-head" aria-expanded={!folded.has('recents')} onClick={() => toggleFold('recents')}>
                <span className="sec-head-label">{t('Recents')}</span>
                <ChevDown className="sec-head-chev" aria-hidden="true" />
              </button>
              <span className="sec-head-actions">
              <button className="rl-group" title={t('All chats')} aria-label={t('All chats')} onClick={onChatsOverview}><ArrowOut /></button>
              <button className="rl-group" title={t('Group by')} aria-label={t('Group by')} aria-haspopup="menu" aria-expanded={groupMenu}
                onClick={() => setGroupMenu(o => !o)}><Sliders /></button>
              {groupMenu && (
                <div className="rl-menu" role="menu">
                  <div className="rl-menu-head">{t('Group by')}</div>
                  {[['none', t('None')], ['date', t('Date')], ['project', t('Project')]].map(([v, label]) => (
                    <button key={v} role="menuitemradio" aria-checked={groupBy === v} onClick={() => pickGroup(v)}>
                      <span>{label}</span>
                      {groupBy === v && <Check style={{ width: 16, marginLeft: 'auto' }} />}
                    </button>
                  ))}
                </div>
              )}
              </span>
            </div>
            {others.length === 0 && <div className="chats-empty">{t("No chats yet")}</div>}
            {!folded.has('recents') && recentGroups[0].items.map(row)}
            {!folded.has('recents') && recentGroups.slice(1).map(g => g.items.length > 0 && (
              <React.Fragment key={g.key}>
                <div className="section-label recents-sub">{g.label}</div>
                {g.items.map(row)}
              </React.Fragment>
            ))}
            {overflow && (
              <button className="all-chats-btn" onClick={onChatsOverview}><Compact style={{ width: 15, flexShrink: 0 }} /> <span>{t("All chats")}</span></button>
            )}
          </>
        )}
      </div>
      </div>
      <div className="rail-spacer" />
      {showModelDocs && (
        <div className="nav side-foot-nav">
          <button className="nav-item" title={t("Model docs")} onClick={() => onModelDocs && onModelDocs()}>
            <span className="nav-ic"><ModelDocs /></span> <span className="nav-label">{t("Model docs")}</span>
            <Chevron className="nav-go" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="profile">
        {menu && <ProfileMenu user={user} anchorRef={profileBtnRef}
          onSettings={() => { setMenu(false); onSettings(); }}
          onPlayground={() => { setMenu(false); onPlayground && onPlayground(); }}
          onAdmin={() => { setMenu(false); onAdmin(); }}
          onCredits={() => { setMenu(false); onCredits(); }}
          onChangelog={() => { setMenu(false); onChangelog(); }}
          onLicense={() => { setMenu(false); onLicense(); }}
          onLogout={onLogout} onClose={() => setMenu(false)} />}
        <button className="profile-btn" ref={profileBtnRef} onClick={() => setMenu(m => !m)}
          aria-haspopup="menu" aria-expanded={menu}>
          <div className="avatar">{(user.displayName || user.email)[0].toUpperCase()}</div>
          <div className="profile-info">
            <div className="name">{user.displayName}</div>
            <div className="plan">{user.isAdmin ? t('Admin') : t('Member')}</div>
          </div>
          <ChevDown className="profile-caret" aria-hidden="true" />
        </button>
        <Tip label={t('Version')}>
          <button className="profile-apps" onClick={() => onVersion && onVersion()} aria-label={t('Version')}>
            <Info />
          </button>
        </Tip>
      </div>
    </div>
  );
}

export default React.memo(Sidebar);
