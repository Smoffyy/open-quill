import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash, Star, Chevron, Box, Stop, Download } from '../ui/icons.jsx';
import { t } from '../../i18n.jsx';
import { Skel, SkelMenu } from '../ui/Skeleton.jsx';
import { SubItem } from '../ui/Submenu.jsx';
import { useDismiss } from '../../lib/dismiss.js';
import { useSubmenus } from '../../lib/submenu.js';

export function ChatMenu({ chat, at, projects = [], projectsReady = true, busy = false, anchorRef, onStopChat, onToggleStar, onMoveToProject, onDelete, onClose }) {
  const [pos, setPos] = useState({ ...at, ready: false });
  const sub = useSubmenus();
  const menuRef = useRef(null);

  useEffect(() => { setPos({ ...at, ready: false }); }, [at]);

  useDismiss(true, onClose, anchorRef ? [menuRef, anchorRef] : menuRef, { inside: '.cm-flyout' });
  useEffect(() => {
    const onScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (anchorRef && anchorRef.current && e.target && typeof e.target.contains === 'function' && e.target.contains(anchorRef.current)) onClose();
    };
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
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
  }, [pos]);

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
      {onMoveToProject && chat.mode !== 'code' && (
        <SubItem id="project" sub={sub} wrapClass="cm-sub" flyoutClass="chat-menu cm-flyout"
          trigger={({ onClick }) => (
            <button onClick={onClick}>
              <Box style={{ width: 20 }} /> {t('Add to project')}
              <Chevron style={{ width: 13, marginLeft: 'auto' }} />
            </button>
          )}>
          {chat.projectId && <button onClick={stop(() => onMoveToProject(chat.id, null))}>{t('Remove from project')}</button>}
          {!projectsReady && <Skel when><SkelMenu count={3} /></Skel>}
          {projectsReady && projects.length === 0 && <div className="cm-empty">{t('No projects yet')}</div>}
          {projects.map(p => (
            <button key={p.id} className={p.id === chat.projectId ? 'on' : ''} onClick={stop(() => onMoveToProject(chat.id, p.id))}>
              <Box style={{ width: 15 }} /> {p.name}
            </button>
          ))}
        </SubItem>
      )}
      <SubItem id="export" sub={sub} wrapClass="cm-sub" flyoutClass="chat-menu cm-flyout"
        trigger={({ onClick }) => (
          <button onClick={onClick}>
            <Download style={{ width: 20 }} /> {t('Export as...')}
            <Chevron style={{ width: 13, marginLeft: 'auto' }} />
          </button>
        )}>
        <button onClick={stop(exportAs('json'))}>{t('JSON')}</button>
        <button onClick={stop(exportAs('md'))}>{t('Markdown')}</button>
      </SubItem>
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