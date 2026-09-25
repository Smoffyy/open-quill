import { useState, useRef, useEffect } from 'react';
import { t } from '../../i18n.jsx';
import { ChatMenu, menuAtButton } from '../sidebar/ChatMenu.jsx';
import { ChevDown, Menu } from '../ui/icons.jsx';

export default function ChatTopbar({
  lead, actions, chat, chatId, project, booting = false, projects, busy = false,
  onOpenMenu, onOpenProject, onRename, onStopChat, onToggleStar, onMoveToProject, onDelete
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(null);
  const caretRef = useRef(null);
  const editing = useRef(false);

  useEffect(() => { setMenu(null); setRenaming(false); editing.current = false; }, [chatId]);

  function startRename() {
    setDraft(chat?.title || '');
    editing.current = true;
    setRenaming(true);
  }
  function finish(save) {
    if (!editing.current) return;
    editing.current = false;
    setRenaming(false);
    if (save) onRename(draft.trim());
  }

  return (
    <div className="topbar">
      {lead}
      <button className="mobile-menu-btn" onClick={onOpenMenu} title={t('Menu')} aria-label={t('Menu')}><Menu style={{ width: 20 }} /></button>
      {renaming ? (
        <input className="chat-rename" autoFocus value={draft} aria-label={t('Rename chat')}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(true);
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          }} />
      ) : (
        <div className="chat-name-wrap">
          {project && (
            <>
              <button className="ct-crumb" onClick={() => onOpenProject(project.id)}>{project.name}</button>
              <span className="ct-sep" aria-hidden="true">/</span>
            </>
          )}
          <button className="chat-name ct-name" disabled={!chatId} title={t('Rename chat')} onClick={startRename}>
            <span className="ct-title">{chat?.title || (booting ? '' : t('New chat'))}</span>
          </button>
          <button className="chat-name ct-caret" ref={caretRef} disabled={!chatId}
            title={t('Chat options')} aria-label={t('Chat options')} aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => { const at = menuAtButton(e.currentTarget); setMenu(m => (m ? null : at)); }}>
            <ChevDown />
          </button>
          {menu && chatId && (
            <ChatMenu
              chat={{ id: chatId, title: chat?.title || t('New chat'), starred: !!chat?.starred, projectId: chat?.projectId || null }}
              at={menu} projects={projects} busy={busy} anchorRef={caretRef}
              onStopChat={onStopChat} onToggleStar={onToggleStar} onMoveToProject={onMoveToProject} onDelete={onDelete}
              onClose={() => setMenu(null)} />
          )}
        </div>
      )}
      {actions}
    </div>
  );
}
