import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Chat, Search, Panel, Gear, Shield, Logout, Dots, Trash, Heart, FileText, Star, Download } from './icons.jsx';

function ProfileMenu({ user, version, onSettings, onAdmin, onCredits, onChangelog, onLogout, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="popover" ref={ref}>
      {user.isAdmin && <button onClick={onAdmin}><Shield /> Admin Panel</button>}
      <button onClick={onSettings}><Gear /> Settings</button>
      <button onClick={onCredits}><Heart /> Credits</button>
      <button onClick={onChangelog}><FileText /> Changelog</button>
      <hr />
      <button onClick={onLogout}><Logout /> Log out</button>
      {version && <div className="pm-version">open-quill v{version}</div>}
    </div>
  );
}

function ChatRow({ c, active, showTrash, onOpen, onDelete, onToggleStar }) {
  const [menu, setMenu] = useState(null); // null or {top,left}
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenu(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);
  function openMenu(e) {
    e.stopPropagation();
    if (menu) { setMenu(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    setMenu({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 170) });
  }
  const openInTab = () => window.open('/chat/' + c.id, '_blank', 'noopener');
  return (
    <div className={'chat-row' + (active ? ' active' : '')}
      onClick={(e) => { if (e.ctrlKey || e.metaKey) { openInTab(); return; } onOpen(c.id); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openInTab(); } }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}>
      <span className="title">{c.title}</span>
      {showTrash ? (
        <button className="row-ctrl shift-del" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} title="Delete chat"><Trash style={{ width: 14 }} /></button>
      ) : (
        <button className="row-ctrl" ref={btnRef} onClick={openMenu} title="Options"><Dots style={{ width: 16 }} /></button>
      )}
      {menu && createPortal(
        <div className="chat-menu" ref={menuRef} style={{ top: menu.top, left: menu.left }}>
          <button onClick={(e) => { e.stopPropagation(); onToggleStar(c.id); setMenu(null); }}>
            <Star style={{ width: 15 }} /> {c.starred ? 'Unstar chat' : 'Star chat'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); window.open('/api/chats/' + c.id + '/export?format=md', '_blank'); setMenu(null); }}>
            <Download style={{ width: 15 }} /> Export as Markdown
          </button>
          <button onClick={(e) => { e.stopPropagation(); window.open('/api/chats/' + c.id + '/export?format=json', '_blank'); setMenu(null); }}>
            <Download style={{ width: 15 }} /> Export as JSON
          </button>
          <button className="danger" onClick={(e) => { e.stopPropagation(); onDelete(c.id); setMenu(null); }}>
            <Trash style={{ width: 15 }} /> Delete chat
          </button>
        </div>, document.body)}
    </div>
  );
}

export default function Sidebar({
  user, chats, chatsLoaded = true, activeId, appName, onNew, onOpen, onDelete, onToggleStar,
  collapsed, onToggle, onSettings, onAdmin, onCredits, onChangelog, onLogout, version, onChatsOverview
}) {
  const [menu, setMenu] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [hover, setHover] = useState(false);
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

  const starred = chats.filter(c => c.starred);
  const others = chats.filter(c => !c.starred);
  const row = (c) => <ChatRow key={c.id} c={c} active={c.id === activeId} showTrash={showTrash} onOpen={onOpen} onDelete={onDelete} onToggleStar={onToggleStar} />;

  return (
    <div className={'sidebar' + (collapsed ? ' collapsed' : '')}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="sidebar-head">
        <div className="brand">{appName || 'open-quill'}</div>
        <div className="sidebar-head-actions">
          <button className="icon-btn search-btn"><Search style={{ width: 17 }} /></button>
          <button className="icon-btn" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Panel style={{ width: 17 }} /></button>
        </div>
      </div>
      <div className="nav">
        <button className="nav-item" title="New chat"
          onClick={(e) => { if (e.ctrlKey || e.metaKey) { window.open('/', '_blank', 'noopener'); return; } onNew(); }}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); window.open('/', '_blank', 'noopener'); } }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}><Plus /> <span className="nav-label">New chat</span></button>
        <button className="nav-item" title="Chats" onClick={onChatsOverview}><Chat /> <span className="nav-label">Chats</span></button>
      </div>
      <div className="chats">
        {!chatsLoaded ? (
          <>
            <div className="section-label">Chats</div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="chat-skel"><span className="skeleton" style={{ width: (55 + ((i * 37) % 40)) + '%' }} /></div>
            ))}
          </>
        ) : (
          <>
            {starred.length > 0 && <>
              <div className="section-label"><Star style={{ width: 12, verticalAlign: '-1px' }} /> Starred</div>
              {starred.map(row)}
            </>}
            <div className="section-label">Chats</div>
            {others.length === 0 && <div className="chats-empty">No chats yet</div>}
            {others.map(row)}
          </>
        )}
      </div>
      <div className="rail-spacer" />
      <div className="profile">
        {menu && <ProfileMenu user={user} version={version}
          onSettings={() => { setMenu(false); onSettings(); }}
          onAdmin={() => { setMenu(false); onAdmin(); }}
          onCredits={() => { setMenu(false); onCredits(); }}
          onChangelog={() => { setMenu(false); onChangelog(); }}
          onLogout={onLogout} onClose={() => setMenu(false)} />}
        <button className="profile-btn" onClick={() => setMenu(m => !m)}>
          <div className="avatar">{(user.displayName || user.email)[0].toUpperCase()}</div>
          <div className="profile-info">
            <div className="name">{user.displayName}</div>
            <div className="plan">{user.isAdmin ? 'Admin' : 'Member'}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
