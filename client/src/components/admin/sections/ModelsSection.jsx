import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useAdmin } from '../store.jsx';
import ModelEditor from '../ModelEditor.jsx';
import {
  Btn, IconBtn, Acts, Input, Select, Seg, Badge, Switch, Empty, Table, Dialog,
  PointMenu, MenuItem, clampToViewport, useAutoFocus
} from '../ui.jsx';
import { Cube, Plus, Copy, Trash, Star, Eye, EyeOff, Chevron, Folder, Pencil, DotsV } from '../../icons.jsx';
import { folderOf, groupRows, planMove } from '../../../lib/modelfolders.js';
import { t, tk } from '../../../i18n.jsx';

const SORT_KEY = 'oq-model-sort';
const FOLD_KEY = 'oq-model-folded';
const FOLDERS_KEY = 'oq-model-folders';

const SORTS = [['manual', tk('Picker order')], ['name', tk('Name')], ['provider', tk('Connection')]];
const VIEWS = [['all', tk('All')], ['visible', tk('Visible')], ['hidden', tk('Hidden')], ['down', tk('Down')]];

const MENU_W = 250;
const MENU_H = 340;
const COLS = 7;
// Rows are draggable, so a press that starts on a control has to be excluded or
// selecting text in a cell would drag the row instead.
const NO_DRAG = 'input, textarea, select, button, [role="switch"]';

function readSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
function writeSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}
function toggleIn(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export default function ModelsSection() {
  const { catalog, setSection, confirm } = useAdmin();
  const {
    models, providers, providerTypes, selected, setSelected, saveState,
    patchModel, bulkPatch, createModel, copyModels, removeModels, reorderModels
  } = catalog;

  const [q, setQ] = useState('');
  const [view, setView] = useState('all');
  const [sort, setSort] = useState(() => {
    try { const v = localStorage.getItem(SORT_KEY); return SORTS.some(([id]) => id === v) ? v : 'manual'; } catch { return 'manual'; }
  });
  const [picked, setPicked] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [drop, setDrop] = useState(null);
  const [menu, setMenu] = useState(null);
  const [folderList, setFolderList] = useState(false);
  const [shut, setShut] = useState(() => readSet(FOLD_KEY));
  const [empties, setEmpties] = useState(() => readSet(FOLDERS_KEY));
  const [prompt, setPrompt] = useState(null);
  const anchor = useRef(null);
  const dragOk = useRef(true);

  useEffect(() => { writeSet(FOLD_KEY, shut); }, [shut]);
  useEffect(() => { writeSet(FOLDERS_KEY, empties); }, [empties]);
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch {} }, [sort]);
  useEffect(() => { setFolderList(false); }, [menu]);

  const connName = (id) => {
    const p = providers.find(x => x.id === id) || providers[0];
    return p ? (p.name || providerTypes[p.type]?.label || p.type || '') : '';
  };

  const counts = {
    all: models.length,
    visible: models.filter(m => m.enabled && !m.unavailable).length,
    hidden: models.filter(m => !m.enabled).length,
    down: models.filter(m => !!m.unavailable).length
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inView = (m) => (view === 'visible' ? (!!m.enabled && !m.unavailable)
      : view === 'hidden' ? !m.enabled
        : view === 'down' ? !!m.unavailable : true);
    const name = (id) => {
      const p = providers.find(x => x.id === id) || providers[0];
      return p ? (p.name || providerTypes[p.type]?.label || p.type || '') : '';
    };
    const list = models.filter(m => inView(m) && (!needle
      || (m.display_name || '').toLowerCase().includes(needle)
      || (m.internal_name || '').toLowerCase().includes(needle)));
    if (sort === 'name') return [...list].sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
    if (sort === 'provider') return [...list].sort((a, b) =>
      name(a.provider_id).localeCompare(name(b.provider_id)) || (a.display_name || '').localeCompare(b.display_name || ''));
    return list;
  }, [models, q, view, sort, providers, providerTypes]);

  const filtered = !!q.trim() || view !== 'all';
  const canReorder = sort === 'manual' && !filtered;
  const model = models.find(m => m.id === selected) || null;

  // Named folders that hold nothing yet are remembered locally so one can be
  // created before there is anything to put in it.
  const layout = useMemo(
    () => groupRows(rows, filtered ? [] : [...empties].sort((a, b) => a.localeCompare(b))),
    [rows, empties, filtered]
  );
  const folderNames = useMemo(
    () => layout.filter(e => e.kind === 'folder').map(e => e.name),
    [layout]
  );

  /* ---------- moving models between folders and positions ---------- */

  // One call does the whole move: the label that puts a model in (or out of) a
  // folder, and the order that keeps that folder's members together.
  function moveModels(ids, opts) {
    const { order, patch, needsPatch } = planMove(models, ids, opts);
    reorderModels(order);
    if (needsPatch) bulkPatch(ids, patch);
    if (opts.folder) setEmpties(prev => { const n = new Set(prev); n.delete(opts.folder); return n; });
  }

  function dragIds() {
    if (!drag || drag.kind !== 'model') return [];
    return picked.size > 1 && picked.has(drag.id) ? [...picked] : [drag.id];
  }

  function dropOnModel(target, after) {
    const from = drag;
    setDrag(null);
    setDrop(null);
    if (!from) return;
    if (from.kind === 'folder') {
      if (from.name === folderOf(target)) return;
      const ids = models.filter(m => folderOf(m) === from.name).map(m => m.id);
      if (ids.length) moveModels(ids, { folder: from.name, targetId: target.id, after });
      return;
    }
    const ids = dragIds();
    if (ids.includes(target.id)) return;
    moveModels(ids, { folder: folderOf(target), targetId: target.id, after });
  }

  function dropOnFolder(name) {
    const from = drag;
    setDrag(null);
    setDrop(null);
    if (!from || from.kind === 'folder') return;
    moveModels(dragIds(), { folder: name });
  }

  function dropOnLoose() {
    const from = drag;
    setDrag(null);
    setDrop(null);
    if (!from || from.kind === 'folder') return;
    const ids = dragIds().filter(id => folderOf(models.find(m => m.id === id) || {}));
    if (ids.length) moveModels(ids, { folder: null });
  }

  /* ---------- folder commands ---------- */

  function createFolder(ids = []) {
    setPrompt({
      mode: 'create',
      title: ids.length ? t('Group into a new folder') : t('New folder'),
      value: '',
      onSubmit: (name) => {
        if (ids.length) { moveModels(ids, { folder: name }); setPicked(new Set()); }
        else setEmpties(prev => new Set(prev).add(name));
      }
    });
  }

  function renameFolder(from) {
    setPrompt({
      mode: 'rename',
      title: t('Rename folder'),
      value: from,
      onSubmit: (to) => {
        if (to === from) return;
        const ids = models.filter(m => folderOf(m) === from).map(m => m.id);
        if (ids.length) bulkPatch(ids, { in_more_models: 1, more_models_label: to });
        setEmpties(prev => {
          const n = new Set(prev);
          n.delete(from);
          if (!ids.length) n.add(to);
          return n;
        });
        setShut(prev => (prev.has(from) ? toggleIn(toggleIn(prev, from), to) : prev));
      }
    });
  }

  function dissolveFolder(name) {
    const ids = models.filter(m => folderOf(m) === name).map(m => m.id);
    const forget = () => setEmpties(prev => { const n = new Set(prev); n.delete(name); return n; });
    if (!ids.length) { forget(); return; }
    confirm({
      title: t('Remove folder'),
      message: ids.length === 1
        ? t('“{name}” is removed and its model moves back to the top level. Nothing is deleted.', { name })
        : t('“{name}” is removed and its {n} models move back to the top level. Nothing is deleted.', { name, n: ids.length }),
      confirm: t('Remove folder'),
      onConfirm: () => { moveModels(ids, { folder: null }); forget(); }
    });
  }

  /* ---------- selection and menus ---------- */

  function selectRow(e, m) {
    if (e.shiftKey && anchor.current) {
      const order = rows.map(x => x.id);
      let a = order.indexOf(anchor.current);
      const b = order.indexOf(m.id);
      if (a < 0) a = b;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setPicked(new Set(order.slice(lo, hi + 1)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setPicked(prev => toggleIn(prev, m.id));
      anchor.current = m.id;
      return;
    }
    anchor.current = m.id;
    setSelected(m.id);
  }

  // A right-click opens at the pointer. A button opens under the button, so
  // reaching it from the keyboard does not throw the menu into the top-left
  // corner, where a synthetic click reports 0,0.
  function menuAnchor(e) {
    if (e.type === 'contextmenu') return clampToViewport(e.clientX, e.clientY, MENU_W, MENU_H);
    const r = e.currentTarget.getBoundingClientRect();
    return clampToViewport(r.right - MENU_W, r.bottom + 4, MENU_W, MENU_H);
  }

  function openMenu(e, ids, extra) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ at: menuAnchor(e), ids, ...extra });
  }

  function rowMenu(e, m) {
    const ids = picked.size > 1 && picked.has(m.id) ? [...picked] : [m.id];
    if (ids.length === 1) setPicked(new Set());
    openMenu(e, ids);
  }

  const act = (fn) => { setMenu(null); fn(); };
  const stopIfControl = (e) => { if (e.target.closest('input, button, [role="switch"]')) e.stopPropagation(); };

  if (model) {
    return (
      <ModelEditor key={model.id} model={model} models={models}
        providers={providers} providerTypes={providerTypes}
        saveState={saveState} onChange={patchModel}
        onBack={() => setSelected(null)}
        onDuplicate={() => copyModels([model.id])}
        onDelete={() => removeModels([model.id], () => setSelected(null))} />
    );
  }

  if (!models.length) {
    return (
      <Empty icon={Cube} title={t('The catalog is empty')}
        actions={<>
          <Btn kind="primary" onClick={createModel}><Plus /> {t('Add model')}</Btn>
          <Btn onClick={() => setSection('providers')}>{t('Set up a connection')}</Btn>
        </>}>
        {t('A model binds one provider model id to a system prompt, a set of abilities, and a price. Members pick from these in the chat.')}
      </Empty>
    );
  }

  const menuModels = menu ? menu.ids.map(id => models.find(x => x.id === id)).filter(Boolean) : [];
  const one = menuModels.length === 1 ? menuModels[0] : null;
  const allHidden = menuModels.length > 0 && menuModels.every(m => !m.enabled);
  const anyFoldered = menuModels.some(m => folderOf(m));

  function renderModel(m, { inFolder, last }) {
    const over = drop && drop.kind === 'model' && drop.id === m.id;
    const cls = [
      inFolder && 'cp-grouped',
      inFolder && last && 'cp-grouped-last',
      picked.has(m.id) && 'on',
      canReorder && 'cp-row-drag',
      drag && drag.kind === 'model' && drag.id === m.id && 'dragging',
      over && (drop.after ? 'cp-drop-after' : 'cp-drop-before')
    ].filter(Boolean).join(' ') || undefined;

    return (
      <tr key={m.id} className={cls}
        draggable={canReorder}
        onMouseDown={(e) => { dragOk.current = !e.target.closest(NO_DRAG); }}
        onDragStart={(e) => {
          if (!canReorder || !dragOk.current) { e.preventDefault(); return; }
          setDrag({ kind: 'model', id: m.id });
        }}
        onDragEnd={() => { setDrag(null); setDrop(null); }}
        onDragOver={(e) => {
          if (!canReorder || !drag || (drag.kind === 'model' && drag.id === m.id)) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setDrop({ kind: 'model', id: m.id, after: e.clientY > r.top + r.height / 2 });
        }}
        onDrop={(e) => { if (!canReorder) return; e.preventDefault(); dropOnModel(m, !!(over && drop.after)); }}
        onContextMenu={(e) => rowMenu(e, m)}
        onClick={(e) => selectRow(e, m)}>
        <td className="fit" onClick={(e) => { e.stopPropagation(); setPicked(p => toggleIn(p, m.id)); }}>
          <input type="checkbox" readOnly checked={picked.has(m.id)}
            aria-label={t('Select {name}', { name: m.display_name || m.internal_name || t('Untitled') })} />
        </td>
        <td onClick={stopIfControl}>
          <div className="cp-inline">
            <Input value={m.display_name || ''} placeholder={t('Untitled')} aria-label={t('Display name')}
              onChange={(e) => patchModel({ ...m, display_name: e.target.value })} />
            {!!m.is_default && <Badge tone="on">{t('default')}</Badge>}
          </div>
        </td>
        <td onClick={stopIfControl}>
          <Input mono value={m.internal_name || ''} placeholder={t('not set')} aria-label={t('Model id')}
            onChange={(e) => patchModel({ ...m, internal_name: e.target.value })} />
        </td>
        <td onClick={stopIfControl}>
          {providers.length > 1
            ? <Select value={m.provider_id || providers[0]?.id || ''} label={t('Connection')}
              onChange={(v) => patchModel({ ...m, provider_id: v })}
              options={providers.map(p => ({ value: p.id, label: p.name || providerTypes[p.type]?.label || p.type }))} />
            : <span className="dim">{connName(m.provider_id)}</span>}
        </td>
        <td>
          <span className="cp-badges">
            {!!(m.effort_enabled || m.has_reasoning) && <Badge>{t('reasoning')}</Badge>}
            {!!m.has_vision && <Badge>{t('vision')}</Badge>}
            {m.sandbox_allowed !== 0 && !!m.sandbox_auto && <Badge>{t('sandbox')}</Badge>}
            {!!m.unavailable && <Badge tone="bad">{t('down')}</Badge>}
          </span>
        </td>
        <td className="fit" onClick={stopIfControl}>
          <Switch on={!!m.enabled} label={t('Visible')}
            onToggle={() => patchModel({ ...m, enabled: m.enabled ? 0 : 1 })} />
        </td>
        <td className="acts" onClick={stopIfControl}>
          <Acts end>
            <Btn size="sm" onClick={() => setSelected(m.id)}>{t('Configure')}</Btn>
            <IconBtn kind="quiet" label={t('More actions')} onClick={(e) => rowMenu(e, m)}><DotsV /></IconBtn>
          </Acts>
        </td>
      </tr>
    );
  }

  return (
    <>
      <div className="cp-toolbar">
        <div className="cp-toolbar-find">
          <Input value={q} type="search" placeholder={t('Filter by name or id')} aria-label={t('Filter by name or id')}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <Seg value={view} label={t('View')} onChange={setView}
          options={VIEWS.map(([value, label]) => ({ value, label: t(label), badge: counts[value] }))} />
        <div className="cp-toolbar-sort">
          <Select value={sort} onChange={setSort} label={t('Sort')}
            options={SORTS.map(([value, label]) => ({ value, label: t(label) }))} />
        </div>
        <div className="cp-toolbar-end">
        {picked.size > 0 ? (
          <>
            <span className="cp-state">{t('{n} selected', { n: picked.size })}</span>
            <Btn onClick={() => bulkPatch([...picked], { enabled: 1 })}><Eye /> {t('Show')}</Btn>
            <Btn onClick={() => bulkPatch([...picked], { enabled: 0 })}><EyeOff /> {t('Hide')}</Btn>
            <Btn onClick={() => createFolder([...picked])}><Folder /> {t('Group')}</Btn>
            <Btn onClick={async () => { await copyModels([...picked]); setPicked(new Set()); }}><Copy /> {t('Duplicate')}</Btn>
            <Btn kind="danger" onClick={() => removeModels([...picked], () => setPicked(new Set()))}><Trash /> {t('Delete')}</Btn>
            <Btn kind="quiet" onClick={() => setPicked(new Set())}>{t('Clear')}</Btn>
          </>
        ) : (
          <>
            <Btn onClick={() => createFolder()}><Folder /> {t('New folder')}</Btn>
            <Btn kind="primary" onClick={createModel}><Plus /> {t('Add model')}</Btn>
          </>
        )}
        </div>
      </div>

      <p className="cp-note-line">
        {canReorder
          ? t('Rows are in the order members see them in the picker. Drag a row to reorder it, or onto a folder to move it in.')
          : t('Switch to picker order with no filters to reorder rows and move them between folders.')}
      </p>

      {rows.length === 0
        ? (
          <Empty icon={Cube} title={t('Nothing matches')}
            actions={<Btn onClick={() => { setQ(''); setView('all'); }}>{t('Reset filters')}</Btn>}>
            {t('No model in the catalog matches the current filter.')}
          </Empty>
        )
        : (
          /* Fixed layout keeps columns from jumping while a name is typed, so
             every width is declared and they add up to exactly 100%. */
          <Table fixed head={[
            { label: '', width: '5%' },
            { label: t('Name'), width: '24%' },
            { label: t('Model id'), mono: true, width: '19%' },
            { label: t('Connection'), width: '14%' },
            { label: t('Abilities'), width: '13%' },
            { label: t('Visible'), width: '8%' },
            { label: '', width: '17%' }
          ]}>
            {layout.map(entry => {
              if (entry.kind === 'model') return renderModel(entry.model, { inFolder: false, last: false });

              const isShut = shut.has(entry.name);
              const isTarget = drop && drop.kind === 'folder' && drop.name === entry.name;
              return (
                <Fragment key={entry.key}>
                  <tr className={'cp-group-row'
                    + (drag && drag.kind === 'folder' && drag.name === entry.name ? ' dragging' : '')
                    + (isTarget ? ' cp-drop-into' : '')}
                    draggable={canReorder && entry.models.length > 0}
                    onDragStart={() => canReorder && setDrag({ kind: 'folder', name: entry.name })}
                    onDragEnd={() => { setDrag(null); setDrop(null); }}
                    onDragOver={(e) => {
                      if (!canReorder || !drag || drag.kind === 'folder') return;
                      e.preventDefault();
                      setDrop({ kind: 'folder', name: entry.name });
                    }}
                    onDragLeave={() => setDrop(d => (d && d.kind === 'folder' && d.name === entry.name ? null : d))}
                    onDrop={(e) => { if (!canReorder) return; e.preventDefault(); dropOnFolder(entry.name); }}
                    onContextMenu={(e) => openMenu(e, [], { folder: entry.name })}>
                    <td colSpan={COLS}>
                      <div className="cp-group-bar">
                        <button type="button" className={'cp-group-toggle' + (isShut ? '' : ' open')}
                          aria-expanded={!isShut}
                          onClick={() => setShut(v => toggleIn(v, entry.name))}>
                          <Chevron />
                          <Folder />
                          <span className="cp-group-name">{entry.name}</span>
                          <span className="cp-group-count">{entry.models.length}</span>
                        </button>
                        <span className="cp-group-note">
                          {entry.models.length
                            ? t('folded behind “More models” in the picker')
                            : t('empty — drag a model here')}
                        </span>
                        <span className="cp-toolbar-spacer" />
                        <Acts end>
                          <IconBtn kind="quiet" label={t('Rename folder')} onClick={() => renameFolder(entry.name)}><Pencil /></IconBtn>
                          <IconBtn kind="quiet" label={t('Remove folder')} onClick={() => dissolveFolder(entry.name)}><Trash /></IconBtn>
                        </Acts>
                      </div>
                    </td>
                  </tr>
                  {!isShut && entry.models.map((m, i) =>
                    renderModel(m, { inFolder: true, last: i === entry.models.length - 1 }))}
                </Fragment>
              );
            })}
          </Table>
        )}

      {/* Dropping below the list, or right-clicking it, is how a model leaves a
          folder without needing the menu. */}
      <div className="cp-loose-zone"
        onDragOver={(e) => { if (canReorder && drag && drag.kind === 'model') e.preventDefault(); }}
        onDrop={(e) => { if (!canReorder) return; e.preventDefault(); dropOnLoose(); }}
        onContextMenu={(e) => { setPicked(new Set()); openMenu(e, []); }}>
        {canReorder && drag && drag.kind === 'model' && (
          <span className="cp-note-line">{t('Drop here to take it out of its folder')}</span>
        )}
      </div>

      {menu && (menu.ids.length === 0 || menuModels.length > 0) && (
        <PointMenu at={menu.at} width={MENU_W} onClose={() => setMenu(null)}>
          {menu.ids.length === 0 ? (
            menu.folder ? (
              <>
                <MenuItem onClick={() => act(() => renameFolder(menu.folder))}>
                  <Pencil /><span>{t('Rename folder')}</span>
                </MenuItem>
                <MenuItem tone="danger" onClick={() => act(() => dissolveFolder(menu.folder))}>
                  <Trash /><span>{t('Remove folder')}</span>
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem onClick={() => act(createModel)}><Plus /><span>{t('Add model')}</span></MenuItem>
                <MenuItem onClick={() => act(() => createFolder())}>
                  <Folder /><span>{t('New folder')}</span>
                </MenuItem>
              </>
            )
          ) : (
            <>
              {one && (
                <MenuItem onClick={() => act(() => setSelected(one.id))}>
                  <Chevron /><span>{t('Configure')}</span>
                </MenuItem>
              )}
              <MenuItem onClick={() => act(() => bulkPatch(menu.ids, { enabled: allHidden ? 1 : 0 }))}>
                {allHidden ? <Eye /> : <EyeOff />}
                <span>{allHidden ? t('Show to members') : t('Hide from members')}</span>
              </MenuItem>
              {one && (
                <MenuItem disabled={!!one.is_default} onClick={() => act(() => patchModel({ ...one, is_default: 1 }))}>
                  <Star /><span>{one.is_default ? t('Already the default') : t('Make default')}</span>
                </MenuItem>
              )}
              <MenuItem onClick={() => act(async () => { await copyModels(menu.ids); setPicked(new Set()); })}>
                <Copy /><span>{t('Duplicate')}</span>
              </MenuItem>

              <div className="cp-menu-sep" />
              <MenuItem onClick={() => act(() => createFolder(menu.ids))}>
                <Folder /><span>{t('Move to a new folder')}</span>
              </MenuItem>
              {folderNames.length > 0 && (
                <MenuItem aria-expanded={folderList} onClick={(e) => { e.stopPropagation(); setFolderList(o => !o); }}>
                  <Folder /><span>{t('Move to folder')}</span>
                  <Chevron style={{ marginLeft: 'auto', transform: folderList ? 'rotate(90deg)' : 'none' }} />
                </MenuItem>
              )}
              {folderList && folderNames.map(name => (
                <MenuItem key={name} sub
                  onClick={() => act(() => { moveModels(menu.ids, { folder: name }); setPicked(new Set()); })}>
                  <span>{name}</span>
                </MenuItem>
              ))}
              {anyFoldered && (
                <MenuItem onClick={() => act(() => { moveModels(menu.ids, { folder: null }); setPicked(new Set()); })}>
                  <Cube /><span>{t('Take out of folder')}</span>
                </MenuItem>
              )}

              {providers.length > 1 && (
                <>
                  <div className="cp-menu-sep" />
                  {providers.map(p => (
                    <MenuItem key={p.id} onClick={() => act(() => bulkPatch(menu.ids, { provider_id: p.id }))}>
                      <Cube /><span>{t('Move to {name}', { name: p.name || providerTypes[p.type]?.label || p.type })}</span>
                    </MenuItem>
                  ))}
                </>
              )}

              <div className="cp-menu-sep" />
              <MenuItem tone="danger" onClick={() => act(() => removeModels(menu.ids, () => setPicked(new Set())))}>
                <Trash /><span>{one ? t('Delete') : t('Delete {n}', { n: menuModels.length })}</span>
              </MenuItem>
            </>
          )}
        </PointMenu>
      )}

      {prompt && (
        <NamePrompt title={prompt.title} initial={prompt.value}
          taken={folderNames.filter(n => n !== prompt.value)}
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => { prompt.onSubmit(name); setPrompt(null); }} />
      )}
    </>
  );
}

function NamePrompt({ title, initial, taken, onCancel, onSubmit }) {
  const [name, setName] = useState(initial || '');
  const ref = useAutoFocus();
  const trimmed = name.trim();
  const clash = taken.includes(trimmed);
  const ok = !!trimmed && !clash;

  return (
    <Dialog title={title} size="narrow" onClose={onCancel}
      foot={<>
        <Btn onClick={onCancel}>{t('Cancel')}</Btn>
        <Btn kind="primary" disabled={!ok} onClick={() => onSubmit(trimmed)}>{t('Save')}</Btn>
      </>}>
      <Input ref={ref} value={name} placeholder={t('Folder name')} aria-label={t('Folder name')} maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && ok) onSubmit(trimmed); }} />
      {clash && <div className="cp-err">{t('A folder with that name already exists.')}</div>}
    </Dialog>
  );
}
