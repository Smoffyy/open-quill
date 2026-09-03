import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash, Star, Chevron, Box, Stop, Download } from './icons.jsx';
import { t } from '../i18n.jsx';

export function ChatMenu({ chat, at, projects = [], busy = false, anchorRef, onStopChat, onToggleStar, onMoveToProject, onDelete, onClose }) {
  const [pos, setPos] = useState({ ...at, ready: false });
  const [subOpen, setSubOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => { setPos({ ...at, ready: false }); setSubOpen(false); }, [at]);

  useEffect(() => {
    const away = (e) => {
      if (anchorRef && anchorRef.current && anchorRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      onClose();
    };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (anchorRef && anchorRef.current && e.target && typeof e.target.contains === 'function' && e.target.contains(anchorRef.current)) onClose();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorRef, onClose]);

  useLayoutEffect(() => {
    if (pos.ready || !menuRef.current) return;
    const pad = 8;
    const mr = menuRef.current.getBoundingClientRect();
    let top = pos.top;
    let left = pos.left;
    if (top + mr.height > window.innerHeight - pad) top = Math.max(pad, pos.anchorTop - mr.height - 6);
    if (top + mr.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - mr.height - pad);
    left = Math.min(Math.max(pad, left), window.innerWidth - mr.width - pad);
    setPos(p => ({ ...p, top, left, ready: true }));
  }, [pos, subOpen]);

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); onClose(); };
  const exportAs = (format) => () => window.open('/api/chats/' + chat.id + '/export?format=' + format, '_blank');

  return createPortal(
    <div className="chat-menu" ref={menuRef} role="menu" aria-label={t('Chat options')}
      style={{ top: pos.top, left: pos.left, visibility: pos.ready ? undefined : 'hidden' }}>
      {busy && onStopChat && (
        <button onClick={stop(() => onStopChat(chat.id))}>
          <Stop style={{ width: 20 }} /> {t('Stop generating')}
        </button>
      )}
      <button onClick={stop(() => onToggleStar(chat.id))}>
        <Star style={{ width: 20 }} /> {chat.starred ? t('Unstar chat') : t('Star chat')}
      </button>
      {onMoveToProject && (
        <div className="cm-sub">
          <button onClick={(e) => { e.stopPropagation(); setSubOpen(s => !s); setPos(p => ({ ...p, ready: false })); }}>
            <Box style={{ width: 20 }} /> {t('Add to project')}
            <Chevron style={{ width: 13, marginLeft: 'auto', transform: subOpen ? 'rotate(90deg)' : 'none' }} />
          </button>
          {subOpen && (
            <div className="cm-sublist">
              {chat.projectId && <button onClick={stop(() => onMoveToProject(chat.id, null))}>{t('Remove from project')}</button>}
              {projects.length === 0 && <div className="cm-empty">{t('No projects yet')}</div>}
              {projects.map(p => (
                <button key={p.id} className={p.id === chat.projectId ? 'on' : ''} onClick={stop(() => onMoveToProject(chat.id, p.id))}>
                  <Box style={{ width: 15 }} /> {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button onClick={stop(exportAs('md'))}>
        <Download style={{ width: 20 }} /> {t('Export as Markdown')}
      </button>
      <button onClick={stop(exportAs('json'))}>
        <Download style={{ width: 20 }} /> {t('Export as JSON')}
      </button>
      <button className="danger" onClick={stop(() => onDelete(chat.id))}>
        <Trash style={{ width: 20 }} /> {t('Delete chat')}
      </button>
    </div>, document.body);
}

export function menuAtButton(el) {
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 6, left: r.left, anchorTop: r.top };
}

export function menuAtPointer(e) {
  return { top: e.clientY + 4, left: e.clientX, anchorTop: e.clientY };
}
