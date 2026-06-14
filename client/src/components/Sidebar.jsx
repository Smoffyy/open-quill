import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Chat, Search, Panel, Gear, Shield, Logout, Dots, Trash, Heart, FileText, Star, Download, Folder, Pencil, Chevron } from './icons.jsx';

function ProfileMenu({ user, version, onSettings, onAdmin, onCredits, onChangelog, onLicense, onLogout, onClose }) {
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
      <button onClick={onLicense}><FileText /> Licensing</button>
      <hr />
      <button onClick={onLogout}><Logout /> Log out</button>
      {version && <div className="pm-version">open-quill v{version}</div>}
    </div>
  );
}

function ChatRow({ c, active, showTrash, folders, onOpen, onDelete, onToggleStar, onMoveChat, onDragChat }) {
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
    setMenu({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 190) });
  }
  const openInTab = () => window.open('/chat/' + c.id, '_blank', 'noopener');
  const close = () => { setMenu(null); setSubOpen(false); };
  return (
    <div className={'chat-row' + (active ? ' active' : '')}
      draggable
      onDragStart={(e) => { onDragChat?.(c.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.id); } catch {} }}
      onDragEnd={() => onDragChat?.(null)}
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
          <button onClick={(e) => { e.stopPropagation(); onToggleStar(c.id); close(); }}>
            <Star style={{ width: 15 }} /> {c.starred ? 'Unstar chat' : 'Star chat'}
          </button>
          <div className="cm-sub">
            <button onClick={(e) => { e.stopPropagation(); setSubOpen(s => !s); }}>
              <Folder style={{ width: 15 }} /> Move to folder
              <Chevron style={{ width: 13, marginLeft: 'auto', transform: subOpen ? 'rotate(90deg)' : 'none' }} />
            </button>
            {subOpen && (
              <div className="cm-sublist">
                {c.folderId && <button onClick={(e) => { e.stopPropagation(); onMoveChat(c.id, null); close(); }}>Remove from folder</button>}
                {folders.length === 0 && <div className="cm-empty">No folders yet</div>}
                {folders.map(f => (
                  <button key={f.id} className={f.id === c.folderId ? 'on' : ''} onClick={(e) => { e.stopPropagation(); onMoveChat(c.id, f.id); close(); }}>
                    <Folder style={{ width: 14 }} /> {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); window.open('/api/chats/' + c.id + '/export?format=md', '_blank'); close(); }}>
            <Download style={{ width: 15 }} /> Export as Markdown
          </button>
          <button onClick={(e) => { e.stopPropagation(); window.open('/api/chats/' + c.id + '/export?format=json', '_blank'); close(); }}>
            <Download style={{ width: 15 }} /> Export as JSON
          </button>
          <button className="danger" onClick={(e) => { e.stopPropagation(); onDelete(c.id); close(); }}>
            <Trash style={{ width: 15 }} /> Delete chat
          </button>
        </div>, document.body)}
    </div>
  );
}

function FolderSection({ f, chats, active, showTrash, folders, dragChatId, onToggle, onRename, onDelete, onDrop, rowProps }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.name);
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => setName(f.name), [f.name]);
  function commit() { setEditing(false); const v = name.trim(); if (v && v !== f.name) onRename(f.id, v); else setName(f.name); }
  return (
    <div className={'folder' + (dragOver ? ' drag-over' : '')}
      onDragOver={(e) => { if (dragChatId) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const id = e.dataTransfer.getData('text/plain') || dragChatId; if (id) onDrop(id, f.id); }}>
      <div className="folder-head" onClick={() => !editing && onToggle(f.id)}>
        <Chevron className="fl-chev" style={{ width: 13, transform: f.collapsed ? 'none' : 'rotate(90deg)' }} />
        <Folder style={{ width: 14 }} className="fl-icon" />
        {editing ? (
          <input className="folder-rename" autoFocus value={name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(f.name); setEditing(false); } }} />
        ) : (
          <span className="folder-name">{f.name}</span>
        )}
        <span className="folder-count">{chats.length}</span>
        <span className="folder-ctrls" onClick={(e) => e.stopPropagation()}>
          <button className="row-ctrl" title="Rename" onClick={() => setEditing(true)}><Pencil style={{ width: 13 }} /></button>
          <button className="row-ctrl" title="Delete folder" onClick={() => onDelete(f.id)}><Trash style={{ width: 13 }} /></button>
        </span>
      </div>
      {!f.collapsed && (
        <div className="folder-body">
          {chats.length === 0 && <div className="chats-empty sub">Drag chats here</div>}
          {chats.map(c => <ChatRow key={c.id} c={c} active={c.id === active} showTrash={showTrash} folders={folders} {...rowProps} />)}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  user, chats, chatsLoaded = true, activeId, appName, onNew, onOpen, onDelete, onToggleStar,
  folders = [], onCreateFolder, onRenameFolder, onToggleFolder, onDeleteFolder, onMoveChat,
  collapsed, onToggle, onSettings, onAdmin, onCredits, onChangelog, onLicense, onLogout, version, onChatsOverview
}) {
  const [menu, setMenu] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [hover, setHover] = useState(false);
  const [dragChatId, setDragChatId] = useState(null);
  const [rootDragOver, setRootDragOver] = useState(false);
  const [recentsCollapsed, setRecentsCollapsed] = useState(() => { try { return localStorage.getItem('oq-recents-collapsed') === '1'; } catch { return false; } });
  const toggleRecents = () => setRecentsCollapsed(v => { const n = !v; try { localStorage.setItem('oq-recents-collapsed', n ? '1' : '0'); } catch {} return n; });
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
  const folderIds = new Set(folders.map(f => f.id));
  const inFolder = (fid) => chats.filter(c => !c.starred && c.folderId === fid);
  const others = chats.filter(c => !c.starred && (!c.folderId || !folderIds.has(c.folderId)));
  const rowProps = { onOpen, onDelete, onToggleStar, onMoveChat, onDragChat: setDragChatId, folders };
  const row = (c) => <ChatRow key={c.id} c={c} active={c.id === activeId} showTrash={showTrash} folders={folders} {...rowProps} />;

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
            <div className="section-label">Recents</div>
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

            <div className="section-label folders-label">
              <span><Folder style={{ width: 12, verticalAlign: '-1px' }} /> Folders</span>
              <button className="folder-add" title="New folder" onClick={() => onCreateFolder && onCreateFolder()}><Plus style={{ width: 13 }} /></button>
            </div>
            {folders.length === 0 && <div className="chats-empty">No folders — click + to add one</div>}
            {folders.map(f => (
              <FolderSection key={f.id} f={f} chats={inFolder(f.id)} active={activeId} showTrash={showTrash}
                folders={folders} dragChatId={dragChatId}
                onToggle={onToggleFolder} onRename={onRenameFolder} onDelete={onDeleteFolder} onDrop={onMoveChat}
                rowProps={rowProps} />
            ))}

            <div className={'section-label recents-label' + (rootDragOver ? ' drag-over' : '') + (recentsCollapsed ? ' collapsed' : '')}
              onClick={toggleRecents}
              onDragOver={(e) => { if (dragChatId) { e.preventDefault(); setRootDragOver(true); } }}
              onDragLeave={() => setRootDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setRootDragOver(false); const id = e.dataTransfer.getData('text/plain') || dragChatId; if (id) onMoveChat(id, null); }}>
              <Chevron className="rl-chev" style={{ width: 13 }} /> Recents
            </div>
            {!recentsCollapsed && <>
              {others.length === 0 && <div className="chats-empty">No chats yet</div>}
              {others.map(row)}
            </>}
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
          onLicense={() => { setMenu(false); onLicense(); }}
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
