import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import SectionHead from './SectionHead.jsx';
import { menuAtButton, menuAtPointer } from './ChatMenu.jsx';
import { Folder, FolderOpen, Plus, DotsV, Pencil, Trash, Chevron } from '../ui/icons.jsx';
import { t } from '../../i18n.jsx';
import { useDismiss } from '../../lib/dismiss.js';
import { CHAT_DRAG, FOLDER_DRAG, dragKind, dropPosition, moveId } from '../../lib/folders.js';

const OPEN_KEY = 'oq-open-folders';
const EXPAND_DELAY = 600;

function readOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); }
}

function FolderMenu({ at, anchorRef, index, last, onRename, onNewChat, onMove, onDelete, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ ...at, ready: false });
  useDismiss(true, onClose, anchorRef ? [ref, anchorRef] : ref);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const pad = 8;
    const r = ref.current.getBoundingClientRect();
    const top = Math.max(pad, Math.min(at.top, window.innerHeight - r.height - pad));
    const left = Math.max(pad, Math.min(at.left, window.innerWidth - r.width - pad));
    setPos({ top, left, ready: true });
  }, [at]);
  const run = (fn) => (e) => { e.stopPropagation(); fn(); onClose(); };
  return createPortal(
    <div className="chat-menu" ref={ref} role="menu" aria-label={t('Folder options')}
      style={{ top: pos.top, left: pos.left, visibility: pos.ready ? undefined : 'hidden' }}>
      <button onClick={run(onNewChat)}><Plus style={{ width: 20 }} /> {t('New chat here')}</button>
      <button onClick={run(onRename)}><Pencil style={{ width: 20 }} /> {t('Rename folder')}</button>
      {index > 0 && <button onClick={run(() => onMove(-1))}><Chevron style={{ width: 20, transform: 'rotate(-90deg)' }} /> {t('Move up')}</button>}
      {!last && <button onClick={run(() => onMove(1))}><Chevron style={{ width: 20, transform: 'rotate(90deg)' }} /> {t('Move down')}</button>}
      <button className="danger" onClick={run(onDelete)}><Trash style={{ width: 20 }} /> {t('Delete folder')}</button>
    </div>, document.body
  );
}

function FolderRow({
  folder, chats, index, last, open, active, renaming, over, ids, renderRow,
  onToggle, onStartRename, onStopRename, onRename, onDelete, onReorder, onMoveChat, onNewChat, onOver
}) {
  const [menu, setMenu] = useState(null);
  const btnRef = useRef(null);
  const expandTimer = useRef(null);
  const [draft, setDraft] = useState(folder.name);

  useEffect(() => { if (renaming) setDraft(folder.name); }, [renaming, folder.name]);
  useEffect(() => () => clearTimeout(expandTimer.current), []);

  const finish = (save) => {
    if (save) onRename(folder.id, draft);
    onStopRename();
  };

  const overChat = over && over.id === folder.id && over.kind === 'chat';
  const overFolder = over && over.id === folder.id && over.kind === 'folder';
  const move = (step) => {
    const target = ids[index + step];
    if (target) onReorder(moveId(ids, folder.id, target, step > 0));
  };

  const hoverChat = (e) => {
    if (dragKind(e.dataTransfer.types) !== 'chat') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onOver({ id: folder.id, kind: 'chat' });
    if (!open && !expandTimer.current) expandTimer.current = setTimeout(() => { expandTimer.current = null; onToggle(folder.id, true); }, EXPAND_DELAY);
  };
  const leave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    clearTimeout(expandTimer.current);
    expandTimer.current = null;
    onOver(null);
  };
  const dropChat = (e) => {
    if (dragKind(e.dataTransfer.types) !== 'chat') return;
    e.preventDefault();
    clearTimeout(expandTimer.current);
    expandTimer.current = null;
    onOver(null);
    const id = e.dataTransfer.getData(CHAT_DRAG);
    if (!id) return;
    onMoveChat(id, folder.id);
    onToggle(folder.id, true);
  };

  const hoverFolder = (e) => {
    if (dragKind(e.dataTransfer.types) !== 'folder') return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    onOver({ id: folder.id, kind: 'folder', pos: dropPosition(e.currentTarget.getBoundingClientRect(), e.clientY) });
  };
  const dropFolder = (e) => {
    if (dragKind(e.dataTransfer.types) !== 'folder') return;
    e.preventDefault();
    e.stopPropagation();
    const pos = dropPosition(e.currentTarget.getBoundingClientRect(), e.clientY);
    onOver(null);
    const dragged = e.dataTransfer.getData(FOLDER_DRAG);
    if (dragged) onReorder(moveId(ids, dragged, folder.id, pos === 'after'));
  };

  return (
    <div className={'folder-block' + (open ? ' open' : '') + (overChat ? ' drop-chat' : '')} onDragOver={hoverChat} onDragLeave={leave} onDrop={dropChat}>
      <div className={'chat-row project-row folder-row' + (active ? ' active' : '') + (overFolder ? ' drop-' + over.pos : '')}
        draggable={!renaming}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(FOLDER_DRAG, folder.id); e.dataTransfer.setData('text/plain', folder.name); }}
        onDragEnd={() => onOver(null)}
        onDragOver={hoverFolder} onDrop={dropFolder}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu(menuAtPointer(e)); }}>
        {renaming ? (
          <>
            <span className="row-ic"><Folder className="folder-ic" aria-hidden="true" /></span>
            <input className="folder-rename" autoFocus value={draft} maxLength={80} aria-label={t('Rename folder')}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => finish(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
              }} />
          </>
        ) : (
          <>
            <button className="row-link folder-link" aria-expanded={open} onClick={() => onToggle(folder.id)}>
              <span className="row-ic">{open ? <FolderOpen className="folder-ic" aria-hidden="true" /> : <Folder className="folder-ic" aria-hidden="true" />}</span>
              <span className="title">{folder.name}</span>
              {chats.length > 0 && <span className="folder-count">{chats.length}</span>}
            </button>
            <button className="row-ctrl folder-add" data-tip={t('New chat here')} aria-label={t('New chat here')}
              onClick={(e) => { e.stopPropagation(); onNewChat(folder.id); }}><Plus /></button>
            <button className="row-ctrl" ref={btnRef} data-tip={t('Options')} aria-label={t('Options')} aria-haspopup="menu" aria-expanded={!!menu}
              onClick={(e) => { e.stopPropagation(); const at = menuAtButton(e.currentTarget); setMenu(m => m ? null : at); }}><DotsV /></button>
          </>
        )}
        {menu && <FolderMenu at={menu} anchorRef={btnRef} index={index} last={last}
          onRename={() => onStartRename(folder.id)} onNewChat={() => onNewChat(folder.id)} onMove={move}
          onDelete={() => onDelete(folder.id)} onClose={() => setMenu(null)} />}
      </div>
      {open && (
        <div className="folder-chats">
          {chats.length === 0 && <div className="folder-empty">{t('Drop chats here')}</div>}
          {chats.map(renderRow)}
        </div>
      )}
    </div>
  );
}

export default function FolderSection({
  folders, byId, activeFolderId, folded, onToggleFold, renderRow,
  onCreate, onRename, onDelete, onReorder, onMoveChat, onNewChat
}) {
  const [open, setOpen] = useState(readOpen);
  const [renamingId, setRenamingId] = useState(null);
  const [over, setOver] = useState(null);
  const ids = folders.map(f => f.id);

  const persist = (next) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch {} return next; };
  const setFolderOpen = (id, on) => setOpen(prev => {
    if (prev.has(id) === on) return prev;
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return persist(next);
  });
  const toggle = (id, force) => setOpen(prev => {
    const next = new Set(prev);
    if (force === true || !next.has(id)) next.add(id); else next.delete(id);
    return persist(next);
  });

  useEffect(() => { if (activeFolderId) setFolderOpen(activeFolderId, true); }, [activeFolderId]);

  useEffect(() => {
    const clear = () => setOver(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); };
  }, []);

  const create = async () => {
    const f = await onCreate();
    if (!f) return;
    if (folded.has('folders')) onToggleFold('folders');
    setRenamingId(f.id);
  };

  return (
    <>
      <SectionHead id="folders" label={t('Folders')} folded={folded.has('folders')} onToggle={onToggleFold}>
        <button className="rl-group" data-tip={t('New folder')} aria-label={t('New folder')} onClick={create}><Plus /></button>
      </SectionHead>
      {!folded.has('folders') && folders.map((f, i) => (
        <FolderRow key={f.id} folder={f} chats={byId.get(f.id) || []} index={i} last={i === folders.length - 1} ids={ids}
          open={open.has(f.id)} active={f.id === activeFolderId} renaming={renamingId === f.id} over={over} renderRow={renderRow}
          onToggle={toggle} onStartRename={setRenamingId} onStopRename={() => setRenamingId(null)}
          onRename={onRename} onDelete={onDelete} onReorder={onReorder} onMoveChat={onMoveChat} onNewChat={onNewChat} onOver={setOver} />
      ))}
    </>
  );
}