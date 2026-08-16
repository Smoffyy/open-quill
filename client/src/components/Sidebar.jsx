import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Chat, Search, Panel, Gear, Shield, Flask, Logout, DotsV, Trash, Heart, FileText, Star, Download, Chevron, Users, Box, Compact, Stop, Sliders, Check } from './icons.jsx';
import { t } from '../i18n.jsx';
import { resolveKeybinds, comboKeys } from '../lib/keybinds.js';

function ProfileMenu({ user, version, anchorRef, onSettings, onAdmin, onPlayground, onCredits, onChangelog, onLicense, onLogout, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: r.left, width: Math.max(210, r.width), bottom: window.innerHeight - r.top + 6 });
  }, [anchorRef]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return createPortal(
    <div className="popover" ref={ref} role="menu" aria-label={t('Profile menu')}
      style={pos ? { position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, right: 'auto' } : { visibility: 'hidden' }}>
      {user.isAdmin && <button onClick={onAdmin}><Shield /> {t('Admin Panel')}</button>}
      {user.isAdmin && <button onClick={onPlayground}><Flask /> {t('Playground')}</button>}
      <button onClick={onSettings}><Gear /> {t('Settings')}</button>
      <button onClick={onCredits}><Heart /> {t('Credits')}</button>
      <button onClick={onChangelog}><FileText /> {t('Changelog')}</button>
      <button onClick={onLicense}><FileText /> {t('Licensing')}</button>
      <hr />
      <button onClick={onLogout}><Logout /> {t('Log out')}</button>
      {version && <div className="pm-version">open-quill v{version}</div>}
    </div>, document.body
  );
}

function ChatRow({ c, active, showTrash, projects = [], onMoveToProject, onOpen, onDelete, onToggleStar, onDragChat, busyIds, onStopChat }) {
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
    document.addEventListener('mousedown', h);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', h);
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
      draggable
      onDragStart={(e) => { onDragChat?.(c.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.id); } catch {} }}
      onDragEnd={() => onDragChat?.(null)}
      onClick={(e) => { if (e.ctrlKey || e.metaKey) { openInTab(); return; } onOpen(c.id); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openInTab(); } }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}>
      {busy && <span className="row-busy" role="img" aria-label={t('Still generating')} title={t('Still generating')} />}
      {c.projectId && <Box className="row-project" style={{ width: 15 }} aria-label={t('In a project')} />}
      <span className="title">{c.title}</span>
      {showTrash ? (
        <button className="row-ctrl shift-del" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} title={t("Delete chat")} aria-label={t("Delete chat")}><Trash style={{ width: 14 }} /></button>
      ) : (
        <button className="row-ctrl" ref={btnRef} onClick={openMenu} title={t("Options")} aria-label={t("Options")} aria-expanded={!!menu} aria-haspopup="menu"><DotsV style={{ width: 20 }} /></button>
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
  onSpaces, spacesPending = 0, projects = [], onProjects, onOpenProject, onMoveToProject, mobileOpen = false, onMobileClose,
  busyChats = [], onStopChat
}) {
  const busyIds = React.useMemo(() => new Set(busyChats), [busyChats]);
  const newChatCombo = React.useMemo(() => {
    const combo = resolveKeybinds(user?.prefs).newChat;
    return combo ? comboKeys(combo).join('+') : '';
  }, [user?.prefs]);
  const [menu, setMenu] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [hover, setHover] = useState(false);
  const chatsRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const profileBtnRef = useRef(null);
  const [groupBy, setGroupBy] = useState(() => { try { return localStorage.getItem('oq-group-by') || 'date'; } catch { return 'date'; } });
  const [groupMenu, setGroupMenu] = useState(false);
  const groupRef = useRef(null);
  const pickGroup = (v) => { setGroupBy(v); setGroupMenu(false); try { localStorage.setItem('oq-group-by', v); } catch {} };
  useEffect(() => {
    if (!groupMenu) return;
    const h = (e) => { if (groupRef.current && !groupRef.current.contains(e.target)) setGroupMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
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
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="sidebar-head">
        <div className="brand">{appName || 'open-quill'}</div>
        <div className="sidebar-head-actions">
          <button className="icon-btn search-btn" onClick={onSearch} title={t("Search chats (Ctrl+Shift+F)")}><Search style={{ width: 16 }} /></button>
          <button className="icon-btn collapse-btn" onClick={onToggle} title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}><Panel style={{ width: 16 }} /></button>
          <button className="icon-btn mobile-close-btn" onClick={onMobileClose} title={t("Close menu")}><span style={{ fontSize: 20, lineHeight: 1 }}>✕</span></button>
        </div>
      </div>
      <div className="nav">
        <button className="nav-item new-chat" title={t("New chat")}
          onClick={(e) => { if (e.ctrlKey || e.metaKey) { window.open('/', '_blank', 'noopener'); return; } onNew(); }}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); window.open('/', '_blank', 'noopener'); } }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}><span className="new-chat-plus"><Plus /></span> <span className="nav-label">{t("New chat")}</span>
          {newChatCombo && <span className="nav-shortcut">{newChatCombo}</span>}</button>
      </div>
      <div className="chats-wrap">
      <div className={'chats' + (scrolled ? ' scrolled' : '')} ref={chatsRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        <div className="nav nav-scrolled">
          <button className="nav-item" title={t("Chats")} onClick={onChatsOverview}><Chat /> <span className="nav-label">{t("Chats")}</span></button>
          <button className="nav-item" title={t("Projects")} onClick={onProjects}><Box /> <span className="nav-label">{t("Projects")}</span></button>
          <button className="nav-item" title={t("Spaces")} onClick={onSpaces}>
            <Users /> <span className="nav-label">{t("Spaces")}</span>
            {spacesPending > 0 && <span className="nav-badge">{spacesPending}</span>}
          </button>
        </div>
        {!chatsLoaded ? (
          <>
            <div className="section-label">{t("Recents")}</div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="chat-skel"><span className="skeleton" style={{ width: (55 + ((i * 37) % 40)) + '%' }} /></div>
            ))}
          </>
        ) : (
          <>
            {(starred.length > 0 || starredProjects.length > 0) && <>
              <div className="section-label">{t("Starred")}</div>
              {starredProjects.map(p => (
                <div key={p.id} className="chat-row project-row" onClick={() => onOpenProject && onOpenProject(p.id)}>
                  <Box style={{ width: 20, flexShrink: 0, opacity: .85 }} />
                  <span className="title">{p.name}</span>
                </div>
              ))}
              {starred.map(row)}
            </>}

            <div className="section-label recents-label" ref={groupRef}>
              {t('Recents')}
              <button className="rl-group" title={t('Group by')} aria-label={t('Group by')} aria-haspopup="menu" aria-expanded={groupMenu}
                onClick={() => setGroupMenu(o => !o)}><Sliders style={{ width: 13, height: 13 }} /></button>
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
            </div>
            {others.length === 0 && <div className="chats-empty">{t("No chats yet")}</div>}
            {recentGroups[0].items.map(row)}
            {recentGroups.slice(1).map(g => g.items.length > 0 && (
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
      <div className="profile">
        {menu && <ProfileMenu user={user} version={version} anchorRef={profileBtnRef}
          onSettings={() => { setMenu(false); onSettings(); }}
          onPlayground={() => { setMenu(false); onPlayground && onPlayground(); }}
          onAdmin={() => { setMenu(false); onAdmin(); }}
          onCredits={() => { setMenu(false); onCredits(); }}
          onChangelog={() => { setMenu(false); onChangelog(); }}
          onLicense={() => { setMenu(false); onLicense(); }}
          onLogout={onLogout} onClose={() => setMenu(false)} />}
        <button className="profile-btn" ref={profileBtnRef} onClick={() => setMenu(m => !m)}>
          <div className="avatar">{(user.displayName || user.email)[0].toUpperCase()}</div>
          <div className="profile-info">
            <div className="name">{user.displayName}</div>
            <div className="plan">{user.isAdmin ? t('Admin') : t('Member')}</div>
          </div>
        </button>
      </div>
    </div>
  );
}

export default React.memo(Sidebar);
