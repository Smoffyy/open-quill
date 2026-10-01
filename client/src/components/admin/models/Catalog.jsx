import { useState, useMemo, useRef, useEffect } from 'react';
import { useAdmin } from '../store.jsx';
import { Btn, IconBtn, Input, Select, PointMenu, MenuItem, clampToViewport } from '../ui.jsx';
import { Plus, Folder, Chevron, Star, EyeOff, Cube, Pencil, Copy, Trash, DotsV, Retry } from '../../ui/icons.jsx';
import { ModelMark } from '../../ui/Weave.jsx';
import { Faces } from '../changes/Review.jsx';
import { t, tk } from '../../../i18n.jsx';
import {
  layout, displayOrder, folderOf, folderPatch, folderNames, planMove, nudge, rangeIds, matches, STATUS,
  revertPatch, publishedOrder, folderChanged, orderChanged
} from '../../../lib/modelcatalog.js';
import { caretsAtEnd, insert, erase, move as moveCarets, selectAll, place, parts, MOVE_KEYS } from '../../../lib/multicaret.js';

const FOLD_KEY = 'oq-models-folded';
const LEGACY_FOLDER_KEYS = ['oq-model-folders', 'oq-models-empty-folders'];
const MENU_W = 248;
const MENU_H = 360;

const FILTERS = [
  ['all', tk('All models')],
  ['listed', tk('Listed')],
  ['hidden', tk('Hidden')],
  ['down', tk('Marked down')],
  ['unpublished', tk('Edited')]
];

function readSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}

function writeSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}

function flip(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

function Tick({ state }) {
  return <span className={'mc-tick' + (state ? ' ' + state : '')} aria-hidden="true" />;
}

function offsetAt(el, x, y) {
  const doc = el.ownerDocument;
  let node = null;
  let off = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    node = p?.offsetNode;
    off = p?.offset || 0;
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    node = r?.startContainer;
    off = r?.startOffset || 0;
  }
  const host = node && (node.nodeType === 3 ? node.parentElement : node);
  const seg = host?.closest?.('[data-at]');
  if (!seg || !el.contains(seg)) return null;
  return Number(seg.dataset.at) + (node.nodeType === 3 ? off : 0);
}

function NameEdit({ c }) {
  const { before, sel, after, caretAtStart } = parts(c);
  const caret = <span className="mc-caret" aria-hidden="true" />;
  return (
    <span className="mc-row-name mc-editing">
      <span data-at={0}>{before}</span>
      {caretAtStart && caret}
      {sel && <span data-at={before.length} className="mc-sel">{sel}</span>}
      {!caretAtStart && caret}
      <span data-at={before.length + sel.length}>{after}</span>
    </span>
  );
}

function FolderName({ initial, taken, onDone }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const clash = value.trim() !== initial && taken.includes(value.trim());
  const finish = (keep) => {
    if (done.current) return;
    done.current = true;
    onDone(keep && !clash ? value.trim() : null);
  };
  return (
    <Input autoFocus value={value} maxLength={60} placeholder={t('Folder name')} aria-label={t('Folder name')}
      aria-invalid={clash || undefined} title={clash ? t('A folder with that name already exists.') : undefined}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      }}
      onBlur={() => finish(true)} />
  );
}

export default function Catalog() {
  const { catalog, present } = useAdmin();
  const {
    models, selection, setSelection, edit, reorderModels, createModel, duplicateModels, removeModels, draft,
    folders, saveFolders, keepFolders
  } = catalog;

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [folded, setFolded] = useState(() => readSet(FOLD_KEY));
  const [drag, setDrag] = useState(null);
  const [drop, setDrop] = useState(null);
  const [active, setActive] = useState(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(null);
  const [folderEdit, setFolderEdit] = useState(null);
  const [carets, setCarets] = useState(null);
  const caretsRef = useRef(null);
  const composing = useRef(false);
  const anchor = useRef(null);
  const listRef = useRef(null);
  const sinkRef = useRef(null);

  useEffect(() => { writeSet(FOLD_KEY, folded); }, [folded]);
  useEffect(() => { caretsRef.current = carets; }, [carets]);

  const changed = useMemo(() => new Set(draft.changed || []), [draft.changed]);
  const picked = useMemo(() => new Set(selection), [selection]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([id]) => [id, models.filter(m => STATUS[id](m, changed)).length])), [models, changed]);
  const rows = useMemo(() => models.filter(m => STATUS[filter](m, changed) && matches(m, q)), [models, filter, changed, q]);
  const canReorder = filter === 'all' && !q.trim() && !carets;
  const used = useMemo(() => new Set(folderNames(models)), [models]);
  const spare = useMemo(() => folders.filter(n => !used.has(n)), [folders, used]);
  const unsaved = JSON.stringify([...used].filter(n => !folders.includes(n)));
  useEffect(() => {
    if (!catalog.ready) return;
    const legacy = LEGACY_FOLDER_KEYS.flatMap(key => [...readSet(key)]);
    if (legacy.length) keepFolders(legacy);
    for (const key of LEGACY_FOLDER_KEYS) { try { localStorage.removeItem(key); } catch {} }
  }, [catalog.ready, keepFolders]);
  useEffect(() => {
    const names = JSON.parse(unsaved);
    if (catalog.ready && names.length) keepFolders(names);
  }, [unsaved, catalog.ready, keepFolders]);
  const entries = useMemo(() => [
    ...layout(rows),
    ...(filter === 'all' && !q.trim() ? spare.map(name => ({ kind: 'folder', key: 'f:' + name, name, models: [] })) : [])
  ], [rows, spare, filter, q]);
  const allFolders = useMemo(() => [...used, ...spare].sort((a, b) => a.localeCompare(b)), [used, spare]);
  const order = useMemo(() => displayOrder(rows).filter(m => !folded.has(folderOf(m))).map(m => m.id), [rows, folded]);
  const allState = rows.length && rows.every(m => picked.has(m.id)) ? 'on' : rows.some(m => picked.has(m.id)) ? 'some' : '';

  const renaming = carets !== null;
  useEffect(() => { if (renaming) sinkRef.current?.focus(); }, [renaming]);

  function focusRow(id) {
    setActive(id);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus());
  }

  function toggle(ids, on) {
    setSelection(sel => (on ? [...new Set([...sel, ...ids])] : sel.filter(id => !ids.includes(id))));
  }

  function pick(e, id) {
    setActive(id);
    if (e.shiftKey && anchor.current) {
      const span = rangeIds(order, anchor.current, id);
      setSelection(e.ctrlKey || e.metaKey ? [...new Set([...selection, ...span])] : span);
      return;
    }
    anchor.current = id;
    if (e.ctrlKey || e.metaKey) { toggle([id], !picked.has(id)); return; }
    setSelection([id]);
  }

  function inOrder(ids) {
    const want = new Set(ids);
    return displayOrder(models).map(m => m.id).filter(id => want.has(id));
  }

  function move(ids, opts) {
    const plan = planMove(models, ids, opts);
    reorderModels(plan.order);
    if (plan.moved.length) edit(plan.moved, plan.patch);
  }

  const membersOf = (name) => models.filter(m => folderOf(m) === name).map(m => m.id);

  function startRename(ids) {
    const list = inOrder(ids);
    if (!list.length) return;
    setMenu(null);
    setCarets(caretsAtEnd(Object.fromEntries(list.map(id => [id, models.find(m => m.id === id)?.display_name || '']))));
  }

  function finishRename(keep) {
    const current = caretsRef.current;
    if (!current) return;
    caretsRef.current = null;
    setCarets(null);
    if (keep) {
      edit(Object.keys(current), m => {
        const text = current[m.id]?.text;
        return text && text.trim() && text !== m.display_name ? { display_name: text } : null;
      });
    }
    if (active) focusRow(active);
  }

  function onSinkKey(e) {
    const word = e.ctrlKey || e.metaKey || e.altKey;
    if (e.key === 'Enter') { e.preventDefault(); finishRename(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      setCarets(c => erase(c, e.key === 'Backspace' ? -1 : 1, word));
      return;
    }
    if (MOVE_KEYS.has(e.key)) {
      e.preventDefault();
      setCarets(c => moveCarets(c, e.key, { shift: e.shiftKey, word }));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setCarets(c => selectAll(c)); }
  }

  function onSinkInput(e) {
    if (composing.current) return;
    const text = e.target.value.replace(/\s*[\r\n]+\s*/g, ' ');
    e.target.value = '';
    if (text) setCarets(c => insert(c, text));
  }

  function renameFolder(from, to) {
    if (!to || to === from) return;
    const ids = membersOf(from);
    if (ids.length) edit(ids, folderPatch(to));
    saveFolders([...folders.filter(n => n !== from), to]);
    setFolded(f => (f.has(from) ? flip(flip(f, from), to) : f));
  }

  function removeFolder(name) {
    const ids = membersOf(name);
    if (ids.length) edit(ids, folderPatch(null));
    saveFolders(folders.filter(n => n !== name));
  }

  function finishFolder(name) {
    const job = folderEdit;
    setFolderEdit(null);
    if (!job || !name) return;
    if (job.mode === 'rename') { renameFolder(job.from, name); return; }
    if (job.ids.length) move(inOrder(job.ids), { folder: name });
    else saveFolders([...folders, name]);
  }

  function openMenu(e, spec) {
    e.preventDefault();
    e.stopPropagation();
    if (carets) finishRename(true);
    const pointer = e.type === 'contextmenu' && e.clientX + e.clientY > 0;
    const r = pointer ? null : e.currentTarget.getBoundingClientRect();
    const at = pointer ? clampToViewport(e.clientX, e.clientY, MENU_W, MENU_H) : clampToViewport(r.left, r.bottom + 4, MENU_W, MENU_H);
    setMenu({ ...spec, at, el: pointer ? null : e.currentTarget });
  }

  function rowMenu(e, id) {
    const ids = picked.has(id) ? inOrder(selection) : [id];
    if (!picked.has(id)) { anchor.current = id; setSelection([id]); }
    setActive(id);
    openMenu(e, { kind: 'rows', ids });
  }

  function onDropRow(target, after) {
    const from = drag;
    setDrag(null);
    setDrop(null);
    if (!from) return;
    if (from.folder) {
      if (folderOf(target)) return;
      move(membersOf(from.folder), { folder: from.folder, targetId: target.id, after });
      return;
    }
    if (from.ids.includes(target.id)) return;
    move(from.ids, { folder: folderOf(target), targetId: target.id, after });
  }

  function onDropFolder(name) {
    const from = drag;
    setDrag(null);
    setDrop(null);
    if (!from || from.folder === name) return;
    if (from.folder) {
      const first = models.find(m => folderOf(m) === name);
      move(membersOf(from.folder), { folder: from.folder, targetId: first?.id });
      return;
    }
    move(from.ids, { folder: name });
  }

  function onDropEnd() {
    const from = drag;
    setDrag(null);
    setDrop(null);
    if (!from) return;
    move(from.folder ? membersOf(from.folder) : from.ids, { folder: from.folder || null });
  }

  function onKeyDown(e) {
    if (carets || e.target.tagName === 'INPUT') return;
    const id = active && order.includes(active) ? active : order[0];
    if (!id) return;
    const i = order.indexOf(id);
    const row = () => listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const el = row();
      if (el) rowMenu({ type: 'key', preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation(), currentTarget: el }, id);
      return;
    }
    if (e.key === 'F2') { e.preventDefault(); startRename(picked.has(id) ? selection : [id]); return; }
    if (e.key === 'Delete' && selection.length) { e.preventDefault(); removeModels(inOrder(selection)); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (!canReorder) return;
      const plan = nudge(models, id, e.key === 'ArrowUp' ? -1 : 1);
      if (!plan) return;
      reorderModels(plan.order);
      if (plan.moved.length) edit(plan.moved, plan.patch);
      focusRow(id);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)));
      const next = order[j];
      if (e.shiftKey) setSelection(rangeIds(order, anchor.current || id, next));
      else if (!(e.ctrlKey || e.metaKey)) { anchor.current = next; setSelection([next]); }
      focusRow(next);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      anchor.current = id;
      toggle([id], !picked.has(id));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection(rows.map(m => m.id));
    }
  }

  function renderRow(m) {
    const on = picked.has(m.id);
    const editing = carets && carets[m.id];
    const over = drop && drop.id === m.id;
    const cls = ['mc-row', on && 'on', editing && 'renaming', drag && !drag.folder && drag.ids.includes(m.id) && 'dragging',
      over && (drop.after ? 'drop-after' : 'drop-before'), folderOf(m) && 'nested'].filter(Boolean).join(' ');
    return (
      <li key={m.id} data-id={m.id} role="option" aria-selected={on} className={cls}
        tabIndex={(active || order[0]) === m.id ? 0 : -1}
        draggable={canReorder}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ ids: picked.has(m.id) && selection.length > 1 ? inOrder(selection) : [m.id] }); }}
        onDragEnd={() => { setDrag(null); setDrop(null); }}
        onDragOver={(e) => {
          if (!drag || (!drag.folder && drag.ids.includes(m.id))) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setDrop({ id: m.id, after: e.clientY > r.top + r.height / 2 });
        }}
        onDrop={(e) => { e.preventDefault(); onDropRow(m, !!(over && drop.after)); }}
        onFocus={() => setActive(m.id)}
        onMouseDown={(e) => {
          if (!editing || e.button !== 0) return;
          e.preventDefault();
          const text = e.currentTarget.querySelector('.mc-editing');
          const at = text ? offsetAt(text, e.clientX, e.clientY) : null;
          setCarets(c => place(c, m.id, at ?? c[m.id].text.length, e.shiftKey));
        }}
        onClick={(e) => { if (!editing) pick(e, m.id); }}
        onDoubleClick={(e) => { if (!editing && !e.target.closest('.mc-hit')) startRename(picked.has(m.id) ? selection : [m.id]); }}
        onContextMenu={(e) => rowMenu(e, m.id)}>
        <span className="mc-hit" onClick={(e) => { e.stopPropagation(); anchor.current = m.id; setActive(m.id); toggle([m.id], !on); }}>
          <Tick state={on ? 'on' : ''} />
        </span>
        {m.static_icon
          ? <ModelMark src={m.static_icon} className="mc-row-icon" />
          : <span className="mc-row-icon blank" aria-hidden="true"><Cube /></span>}
        <span className="mc-row-text">
          {editing ? <NameEdit c={editing} /> : <span className="mc-row-name">{m.display_name || t('Untitled')}</span>}
          <span className="mc-row-id">{m.internal_name || t('no model id')}</span>
        </span>
        <span className="mc-row-marks">
          {!!m.is_default && <span title={t('Default for new accounts')}><Star /><span className="sr-only">{t('Default for new accounts')}</span></span>}
          {!m.enabled && <span title={t('Hidden from members')}><EyeOff /><span className="sr-only">{t('Hidden from members')}</span></span>}
          {!!m.unavailable && <span className="mc-flag bad">{t('down')}</span>}
          {m.kind === 'router' && <span className="mc-flag">{t('router')}</span>}
          {changed.has(m.id) && <span className="mc-flag" title={t('Changed since the last release')}>{t('edited')}</span>}
          <Faces people={present.filter(p => p.section === 'models' && p.target === m.id)} small />
        </span>
      </li>
    );
  }

  function renderFolder(entry) {
    const shut = folded.has(entry.name);
    const ids = entry.models.map(m => m.id);
    const state = ids.length && ids.every(id => picked.has(id)) ? 'on' : ids.some(id => picked.has(id)) ? 'some' : '';
    const into = drop && drop.folder === entry.name;
    const naming = folderEdit?.mode === 'rename' && folderEdit.from === entry.name;
    return (
      <li key={entry.key} role="group" aria-label={entry.name} className="mc-group">
        <div className={'mc-folder' + (into ? ' drop-into' : '') + (drag?.folder === entry.name ? ' dragging' : '')}
          draggable={canReorder && ids.length > 0 && !naming}
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ folder: entry.name }); }}
          onDragEnd={() => { setDrag(null); setDrop(null); }}
          onDragOver={(e) => { if (!drag || drag.folder === entry.name) return; e.preventDefault(); setDrop({ folder: entry.name }); }}
          onDragLeave={() => setDrop(d => (d && d.folder === entry.name ? null : d))}
          onDrop={(e) => { e.preventDefault(); onDropFolder(entry.name); }}
          onContextMenu={(e) => openMenu(e, { kind: 'folder', name: entry.name, ids })}>
          <button type="button" className="mc-hit" disabled={!ids.length}
            aria-label={t('Select every model in {name}', { name: entry.name })}
            onClick={() => toggle(ids, state !== 'on')}>
            <Tick state={state} />
          </button>
          {naming ? (
            <span className="mc-folder-edit">
              <Folder />
              <FolderName initial={entry.name} taken={allFolders} onDone={finishFolder} />
            </span>
          ) : (
            <button type="button" className={'mc-folder-toggle' + (shut ? '' : ' open')} aria-expanded={!shut}
              onClick={() => setFolded(f => flip(f, entry.name))}
              onDoubleClick={() => setFolderEdit({ mode: 'rename', from: entry.name })}>
              <Chevron />
              <Folder />
              <span>{entry.name}</span>
              <em>{ids.length || t('empty')}</em>
            </button>
          )}
        </div>
        {!shut && ids.length > 0 && <ul role="presentation">{entry.models.map(renderRow)}</ul>}
      </li>
    );
  }

  const menuModels = menu?.kind === 'rows' ? menu.ids.map(id => models.find(m => m.id === id)).filter(Boolean) : [];
  const n = menuModels.length;
  const act = (fn) => () => { setMenu(null); fn(); };

  return (
    <aside className="mc-list" aria-label={t('Models')}
      onContextMenu={(e) => { if (!e.target.closest('input, textarea, .cp-menu')) openMenu(e, { kind: 'blank' }); }}>
      <div className="mc-list-head">
        <Input type="search" value={q} placeholder={t('Search name, id or folder')} aria-label={t('Search name, id or folder')}
          onChange={(e) => setQ(e.target.value)} />
        <div className="mc-list-tools">
          <Select value={filter} label={t('Show')} onChange={setFilter}
            options={FILTERS.map(([value, label]) => ({ value, label: t(label) + ' · ' + counts[value] }))} />
          <Btn kind="primary" disabled={adding}
            onClick={async () => { setAdding(true); try { await createModel(); } finally { setAdding(false); } }}>
            <Plus /> {t('Add')}
          </Btn>
        </div>
      </div>

      <div className="mc-list-bar">
        <button type="button" className="mc-hit" aria-label={allState === 'on' ? t('Clear selection') : t('Select all shown')}
          disabled={!rows.length}
          onClick={() => setSelection(allState === 'on' ? [] : rows.map(m => m.id))}>
          <Tick state={allState} />
        </button>
        <span>{selection.length
          ? t('{n} of {total} selected', { n: selection.length, total: models.length })
          : t('{n} models', { n: rows.length })}</span>
        {selection.length > 0 && (
          <IconBtn kind="quiet" label={t('Actions for the selection')} aria-haspopup="menu"
            onClick={(e) => openMenu(e, { kind: 'rows', ids: inOrder(selection) })}>
            <DotsV />
          </IconBtn>
        )}
      </div>

      <ul ref={listRef} className="mc-items" role="listbox" aria-multiselectable="true" aria-label={t('Models')}
        onKeyDown={onKeyDown}>
        {folderEdit?.mode === 'new' && (
          <li className="mc-group" role="presentation">
            <div className="mc-folder">
              <span className="mc-folder-edit">
                <Folder />
                <FolderName initial="" taken={folderEdit.ids.length ? [] : allFolders} onDone={finishFolder} />
              </span>
            </div>
          </li>
        )}
        {entries.map(entry => (entry.kind === 'model' ? renderRow(entry.model) : renderFolder(entry)))}
        {!rows.length && !spare.length && <li className="mc-none" role="presentation">{t('Nothing matches.')}</li>}
        <li role="presentation" className={'mc-tail' + (drop?.end ? ' on' : '')}
          onDragOver={(e) => { if (!drag || !canReorder) return; e.preventDefault(); setDrop({ end: true }); }}
          onDragLeave={() => setDrop(d => (d?.end ? null : d))}
          onDrop={(e) => { e.preventDefault(); onDropEnd(); }}
          onClick={() => { if (!carets) setSelection([]); }} />
      </ul>

      <p className="mc-end">
        {canReorder
          ? t('Drag rows to reorder, or below the last row to move one out of its folder. Right-click for more.')
          : carets
            ? t('Type to edit every name at once. Enter saves, Escape cancels.')
            : t('Clear the search and show all models to reorder.')}
      </p>

      {carets && (
        <input ref={sinkRef} className="mc-sink" aria-label={t('Edit names')} autoComplete="off" spellCheck={false}
          onKeyDown={onSinkKey} onChange={onSinkInput}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(e) => { composing.current = false; onSinkInput(e); }}
          onBlur={() => finishRename(true)} />
      )}

      {menu && (
        <PointMenu at={menu.at} width={MENU_W} anchorEl={menu.el} onClose={() => setMenu(null)}>
          {menu.kind === 'rows' && n > 0 && (
            <>
              <MenuItem onClick={() => startRename(menu.ids)}>
                <Pencil /><span>{n === 1 ? t('Edit name') : t('Edit {n} names', { n })}</span><em>F2</em>
              </MenuItem>
              <MenuItem onClick={act(() => duplicateModels(menu.ids))}>
                <Copy /><span>{n === 1 ? t('Duplicate') : t('Duplicate {n}', { n })}</span>
              </MenuItem>
              <div className="cp-menu-sep" />
              <div className="cp-menu-empty">{t('Move to')}</div>
              {allFolders.filter(name => !menuModels.every(m => folderOf(m) === name)).map(name => (
                <MenuItem key={name} sub onClick={act(() => move(menu.ids, { folder: name }))}>
                  <Folder /><span>{name}</span>
                </MenuItem>
              ))}
              <MenuItem sub onClick={act(() => setFolderEdit({ mode: 'new', ids: menu.ids }))}>
                <Plus /><span>{t('New folder…')}</span>
              </MenuItem>
              {menuModels.some(m => folderOf(m)) && (
                <MenuItem sub onClick={act(() => edit(menu.ids, folderPatch(null)))}>
                  <Cube /><span>{t('Top level')}</span>
                </MenuItem>
              )}
              {folderChanged(menuModels, draft.live) && (
                <MenuItem sub onClick={act(() => edit(menu.ids, m => (draft.live?.[m.id] ? revertPatch(draft.live[m.id], 'folder') : null)))}>
                  <Retry /><span>{t('Published folder')}</span>
                </MenuItem>
              )}
              <div className="cp-menu-sep" />
              <MenuItem tone="danger" onClick={act(() => removeModels(menu.ids))}>
                <Trash /><span>{n === 1 ? t('Delete') : t('Delete {n}', { n })}</span><em>Del</em>
              </MenuItem>
            </>
          )}
          {menu.kind === 'folder' && (
            <>
              <MenuItem onClick={act(() => setFolderEdit({ mode: 'rename', from: menu.name }))}>
                <Pencil /><span>{t('Rename folder')}</span>
              </MenuItem>
              {menu.ids.length > 0 && (
                <MenuItem onClick={act(() => setSelection(menu.ids))}>
                  <Cube /><span>{t('Select its models')}</span>
                </MenuItem>
              )}
              <div className="cp-menu-sep" />
              <MenuItem tone="danger" onClick={act(() => removeFolder(menu.name))}>
                <Trash /><span>{menu.ids.length ? t('Remove folder, keep models') : t('Remove folder')}</span>
              </MenuItem>
            </>
          )}
          {menu.kind === 'blank' && (
            <>
              <MenuItem onClick={act(() => setFolderEdit({ mode: 'new', ids: [] }))}>
                <Folder /><span>{t('New folder')}</span>
              </MenuItem>
              {rows.length > 0 && (
                <MenuItem onClick={act(() => setSelection(rows.map(m => m.id)))}>
                  <Cube /><span>{t('Select all shown')}</span><em>Ctrl A</em>
                </MenuItem>
              )}
              {orderChanged(models, draft.order) && (
                <MenuItem onClick={act(() => reorderModels(publishedOrder(models, draft.order)))}>
                  <Retry /><span>{t('Restore the published order')}</span>
                </MenuItem>
              )}
            </>
          )}
        </PointMenu>
      )}
    </aside>
  );
}