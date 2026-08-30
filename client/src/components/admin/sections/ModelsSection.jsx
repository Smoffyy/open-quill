import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { useAdmin } from '../store.jsx';
import ModelEditor from '../ModelEditor.jsx';
import { Btn, Input, Select, Seg, Badge, Switch, Empty, Table, Dialog, useAutoFocus } from '../ui.jsx';
import { Cube, Plus, Copy, Trash, Star, Eye, EyeOff, Chevron, Folder } from '../../icons.jsx';
import { t, tk } from '../../../i18n.jsx';

const SORT_KEY = 'oq-model-sort';
const FOLD_KEY = 'oq-model-folded';
const FOLDERS_KEY = 'oq-model-folders';
const SORTS = [['manual', tk('Picker order')], ['name', tk('Name')], ['provider', tk('Connection')]];
const VIEWS = [['all', tk('All')], ['visible', tk('Visible')], ['hidden', tk('Hidden')], ['down', tk('Down')]];

export default function ModelsSection() {
  const { catalog, setSection } = useAdmin();
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
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const [menu, setMenu] = useState(null);
  const [shut, setShut] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); }
  });
  const [folders, setFolders] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]')); } catch { return new Set(); }
  });
  const [namePrompt, setNamePrompt] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const anchor = useRef(null);

  useEffect(() => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...shut])); } catch {} }, [shut]);

  useEffect(() => { try { localStorage.setItem(FOLDERS_KEY, JSON.stringify([...folders])); } catch {} }, [folders]);

  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch {} }, [sort]);

  useEffect(() => { setAddOpen(false); }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const esc = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);

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

  const groupOf = (m) => (m.in_more_models ? (m.more_models_label || t('More models')) : null);
  const groupSize = (g) => models.filter(x => groupOf(x) === g).length;
  const canReorder = sort === 'manual' && !q.trim() && view === 'all';
  const model = models.find(m => m.id === selected) || null;

  const folderNames = useMemo(() => {
    const s = new Set(folders);
    models.forEach(m => { if (m.in_more_models) s.add(m.more_models_label || t('More models')); });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [folders, models]);

  const emptyFolders = folderNames.filter(name => groupSize(name) === 0);

  function click(e, m) {
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
      setPicked(prev => {
        const n = new Set(prev);
        if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
        return n;
      });
      anchor.current = m.id;
      return;
    }
    anchor.current = m.id;
    setSelected(m.id);
  }

  function drop(target, after) {
    const id = dragId;
    setDragId(null);
    setDropAt(null);
    if (!id || !target) return;
    if (typeof id === 'string' && id.startsWith('folder:')) {
      const label = id.slice(7);
      if (label === groupOf(target)) return;
      const set = new Set(models.filter(m => groupOf(m) === label).map(m => m.id));
      const moving = models.filter(m => set.has(m.id));
      const rest = models.filter(m => !set.has(m.id));
      let at = rest.findIndex(m => m.id === target.id);
      if (at < 0) return;
      if (after) at += 1;
      reorderModels([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
      return;
    }
    if (id === target.id) return;
    const ids = picked.size > 1 && picked.has(id) ? [...picked] : [id];
    const set = new Set(ids);
    const moving = models.filter(m => set.has(m.id));
    const rest = models.filter(m => !set.has(m.id));
    let at = rest.findIndex(m => m.id === target.id);
    if (at < 0) return;
    if (after) at += 1;
    reorderModels([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
  }

  function openMenu(e, m) {
    e.preventDefault();
    e.stopPropagation();
    const ids = picked.size > 1 && picked.has(m.id) ? [...picked] : [m.id];
    if (ids.length === 1) setPicked(new Set());
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 320), ids });
  }

  function openEmptyMenu(e) {
    e.preventDefault();
    setPicked(new Set());
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 320), ids: [] });
  }

  const act = (fn) => { setMenu(null); fn(); };

  const stopIfControl = (e) => { if (e.target.closest('input, button, [role="switch"]')) e.stopPropagation(); };

  function submitFolderName(name) {
    const label = name.trim();
    if (!label) return;
    setFolders(prev => new Set(prev).add(label));
    if (namePrompt.ids.length) {
      bulkPatch(namePrompt.ids, { in_more_models: 1, more_models_label: label });
      setPicked(new Set());
    }
    setNamePrompt(null);
  }

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
      <Empty title={t('The catalog is empty')}
        actions={<>
          <Btn kind="primary" onClick={createModel}><Plus /> {t('Add model')}</Btn>
          <Btn onClick={() => setSection('providers')}><Cube /> {t('Set up a connection')}</Btn>
        </>}>
        {t('A model binds one provider model id to a system prompt, a set of abilities, and a price. Members pick from these in the chat.')}
      </Empty>
    );
  }

  const menuModels = menu ? menu.ids.map(id => models.find(x => x.id === id)).filter(Boolean) : [];
  const one = menuModels.length === 1 ? menuModels[0] : null;
  const allHidden = menuModels.length > 0 && menuModels.every(m => !m.enabled);

  return (
    <>
      <div className="cp-toolbar">
        <div style={{ width: 220 }}>
          <Input value={q} placeholder={t('Filter by name or id')} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Seg value={view} label={t('View')} onChange={setView}
          options={VIEWS.map(([value, label]) => ({ value, label: t(label), badge: counts[value] }))} />
        <div style={{ width: 150 }}>
          <Select value={sort} onChange={setSort} options={SORTS.map(([value, label]) => ({ value, label: t(label) }))} />
        </div>
        <div style={{ flex: 1 }} />
        {picked.size > 0 ? (
          <>
            <span className="cp-save">{t('{n} selected', { n: picked.size })}</span>
            <Btn size="sm" onClick={() => bulkPatch([...picked], { enabled: 1 })}><Eye /> {t('Show')}</Btn>
            <Btn size="sm" onClick={() => bulkPatch([...picked], { enabled: 0 })}><EyeOff /> {t('Hide')}</Btn>
            <Btn size="sm" onClick={async () => { await copyModels([...picked]); setPicked(new Set()); }}><Copy /> {t('Duplicate')}</Btn>
            <Btn size="sm" kind="danger" onClick={() => removeModels([...picked], () => setPicked(new Set()))}><Trash /> {t('Delete')}</Btn>
            <Btn size="sm" kind="quiet" onClick={() => setPicked(new Set())}>{t('Clear')}</Btn>
          </>
        ) : (
          <Btn kind="primary" size="sm" onClick={createModel}><Plus /> {t('Add model')}</Btn>
        )}
      </div>

      {canReorder && (
        <p className="cp-toolbar-note">{t('Rows are in the order members see them in the picker. Drag to change it.')}</p>
      )}

      {rows.length === 0
        ? <Empty title={t('Nothing matches')} actions={<Btn size="sm" onClick={() => { setQ(''); setView('all'); }}>{t('Reset filters')}</Btn>} />
        : (
          <Table fixed head={[
            { label: '', fit: true, width: '5%' },
            { label: t('Name'), width: '28%' },
            { label: t('Model id'), mono: true, width: '22%' },
            { label: t('Connection'), width: '16%' },
            { label: t('Abilities'), width: '18%' },
            { label: t('Visible'), fit: true, width: '6%' },
            { label: '', fit: true, width: '10%' }
          ]}>
            {rows.map((m, i) => {
              const over = dropAt && dropAt.id === m.id;
              const group = m.in_more_models ? (m.more_models_label || t('More models')) : null;
              const prev = rows[i - 1];
              const prevGroup = prev ? (prev.in_more_models ? (prev.more_models_label || t('More models')) : null) : undefined;
              const opensGroup = group && group !== prevGroup;
              const next = rows[i + 1];
              const nextGroup = next ? (next.in_more_models ? (next.more_models_label || t('More models')) : null) : undefined;
              const closesGroup = group && group !== nextGroup;
              return (
                <Fragment key={m.id}>
                {opensGroup && (
                  <tr className="cp-group-row"
                    draggable={canReorder}
                    onDragStart={() => canReorder && setDragId('folder:' + group)}
                    onDragEnd={() => { setDragId(null); setDropAt(null); }}
                    onDragOver={(e) => {
                      if (!canReorder || dragId === 'folder:' + group) return;
                      e.preventDefault();
                      setDropAt({ id: m.id, after: false });
                    }}
                    onDrop={(e) => { if (!canReorder) return; e.preventDefault(); drop(m, false); }}
                    style={{ opacity: dragId === 'folder:' + group ? 0.4 : 1, cursor: canReorder ? 'grab' : undefined }}>
                    <td colSpan={7}>
                      <button type="button" className="cp-group-toggle"
                        aria-expanded={!shut.has(group)}
                        onClick={() => setShut(v => { const n = new Set(v); if (n.has(group)) n.delete(group); else n.add(group); return n; })}>
                        <Chevron style={{ transform: shut.has(group) ? 'none' : 'rotate(90deg)' }} />
                        <Folder />
                        <span className="cp-group-name">{group}</span>
                        <span className="cp-group-count">{groupSize(group)}</span>
                      </button>
                      <span className="cp-group-note">{t('folded behind “More models” in the picker')}</span>
                    </td>
                  </tr>
                )}
                {group && shut.has(group) ? null : (
                <tr className={group ? ('cp-grouped' + (closesGroup ? ' cp-grouped-last' : '')) : undefined}
                  draggable={canReorder}
                  onMouseDown={(e) => {
                    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) e.currentTarget.draggable = false;
                  }}
                  onMouseUp={(e) => { e.currentTarget.draggable = canReorder; }}
                  onDragStart={(e) => {
                    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); return; }
                    if (canReorder) setDragId(m.id);
                  }}
                  onDragEnd={(e) => { e.currentTarget.draggable = canReorder; setDragId(null); setDropAt(null); }}
                  onDragOver={(e) => {
                    if (!canReorder || dragId === m.id) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropAt({ id: m.id, after: e.clientY > r.top + r.height / 2 });
                  }}
                  onDrop={(e) => { if (!canReorder) return; e.preventDefault(); drop(m, !!(over && dropAt.after)); }}
                  onContextMenu={(e) => openMenu(e, m)}
                  onClick={(e) => click(e, m)}
                  style={{
                    cursor: 'pointer',
                    opacity: dragId === m.id ? 0.4 : 1,
                    boxShadow: over ? (dropAt.after ? 'inset 0 -2px 0 var(--text)' : 'inset 0 2px 0 var(--text)') : undefined,
                    background: picked.has(m.id) ? 'var(--hover-mid)' : undefined
                  }}>
                  <td className="fit" onClick={(e) => {
                    e.stopPropagation();
                    setPicked(p => { const n = new Set(p); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; });
                  }}>
                    <input type="checkbox" readOnly checked={picked.has(m.id)} aria-label={t('Select')}
                      style={{ accentColor: 'var(--text)', cursor: 'pointer' }} />
                  </td>
                  <td onClick={stopIfControl}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {m.static_icon && <img src={m.static_icon} alt=""
                        style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0 }} />}
                      <Input value={m.display_name || ''} placeholder={t('Untitled')}
                        onChange={(e) => patchModel({ ...m, display_name: e.target.value })} />
                      {!!m.is_default && <Badge tone="on">{t('default')}</Badge>}
                    </div>
                  </td>
                  <td onClick={stopIfControl}>
                    <Input mono value={m.internal_name || ''} placeholder={t('not set')}
                      onChange={(e) => patchModel({ ...m, internal_name: e.target.value })} />
                  </td>
                  <td onClick={stopIfControl}>
                    {providers.length > 1
                      ? <Select value={m.provider_id || providers[0]?.id || ''}
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
                  <td className="acts">
                    <Btn size="sm" onClick={(e) => { e.stopPropagation(); setSelected(m.id); }}>
                      {t('Configure')} <Chevron />
                    </Btn>
                  </td>
                </tr>
                )}
                </Fragment>
              );
            })}
            {emptyFolders.map(name => (
              <tr key={'empty-' + name} className="cp-group-row"
                onDragOver={(e) => { if (!canReorder || !dragId) return; e.preventDefault(); }}
                onDrop={(e) => {
                  if (!canReorder) return;
                  e.preventDefault();
                  const id = dragId;
                  setDragId(null);
                  setDropAt(null);
                  if (!id || (typeof id === 'string' && id.startsWith('folder:'))) return;
                  const ids = picked.size > 1 && picked.has(id) ? [...picked] : [id];
                  bulkPatch(ids, { in_more_models: 1, more_models_label: name });
                  setPicked(new Set());
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 160), ids: [], emptyFolder: name });
                }}>
                <td colSpan={7}>
                  <span className="cp-group-toggle" style={{ cursor: 'default' }}>
                    <Folder />
                    <span className="cp-group-name">{name}</span>
                    <span className="cp-group-count">0</span>
                  </span>
                  <span className="cp-group-note">{t('empty — drag a model here')}</span>
                </td>
              </tr>
            ))}
          </Table>
        )}

      <div style={{ minHeight: 240 }} onContextMenu={openEmptyMenu} />

      {menu && (menu.ids.length === 0 || menuModels.length > 0) && (
        <div className="cp-find-pop" style={{ position: 'fixed', left: menu.x, top: menu.y, right: 'auto', width: 240 }}
          onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          {menu.ids.length === 0 ? (
            menu.emptyFolder ? (
              <button className="cp-find-row" style={{ color: 'var(--danger)' }}
                onClick={() => act(() => setFolders(prev => { const n = new Set(prev); n.delete(menu.emptyFolder); return n; }))}>
                <Trash /><span>{t('Delete folder')}</span>
              </button>
            ) : (
              <>
                <button className="cp-find-row" onClick={() => act(createModel)}>
                  <Plus /><span>{t('Add model')}</span>
                </button>
                <button className="cp-find-row" onClick={() => act(() => setNamePrompt({ ids: [] }))}>
                  <Folder /><span>{t('Create folder')}</span>
                </button>
              </>
            )
          ) : one ? (
            <>
              <button className="cp-find-row" onClick={() => act(() => patchModel({ ...one, enabled: one.enabled ? 0 : 1 }))}>
                {one.enabled ? <EyeOff /> : <Eye />}<span>{one.enabled ? t('Hide from members') : t('Show to members')}</span>
              </button>
              <button className="cp-find-row" disabled={!!one.is_default} onClick={() => act(() => patchModel({ ...one, is_default: 1 }))}>
                <Star /><span>{one.is_default ? t('Already the default') : t('Make default')}</span>
              </button>
              <button className="cp-find-row" onClick={() => act(() => copyModels([one.id]))}>
                <Copy /><span>{t('Duplicate')}</span>
              </button>
            </>
          ) : (
            <>
              <button className="cp-find-row" onClick={() => act(() => bulkPatch(menu.ids, { enabled: allHidden ? 1 : 0 }))}>
                {allHidden ? <Eye /> : <EyeOff />}<span>{allHidden ? t('Show {n}', { n: menuModels.length }) : t('Hide {n}', { n: menuModels.length })}</span>
              </button>
              <button className="cp-find-row" onClick={() => act(async () => { await copyModels(menu.ids); setPicked(new Set()); })}>
                <Copy /><span>{t('Duplicate {n}', { n: menuModels.length })}</span>
              </button>
              <button className="cp-find-row" onClick={() => act(() => setNamePrompt({ ids: menu.ids }))}>
                <Folder /><span>{t('Group into folder')}</span>
              </button>
              {folderNames.length > 0 && (
                <button className="cp-find-row" onClick={(e) => { e.stopPropagation(); setAddOpen(o => !o); }}>
                  <Folder /><span>{t('Add to folder')}</span>
                  <Chevron style={{ marginLeft: 'auto', transform: addOpen ? 'rotate(90deg)' : 'none' }} />
                </button>
              )}
              {addOpen && folderNames.map(name => (
                <button key={name} className="cp-find-row" style={{ paddingLeft: 28 }}
                  onClick={() => act(() => { bulkPatch(menu.ids, { in_more_models: 1, more_models_label: name }); setPicked(new Set()); })}>
                  <span>{name}</span>
                </button>
              ))}
              <button className="cp-find-row" onClick={() => act(() => setNamePrompt({ ids: [] }))}>
                <Folder /><span>{t('Create folder')}</span>
              </button>
            </>
          )}
          {menu.ids.length > 0 && providers.length > 1 && providers.map(p => (
            <button key={p.id} className="cp-find-row" onClick={() => act(() => bulkPatch(menu.ids, { provider_id: p.id }))}>
              <Cube /><span>{t('Move to {name}', { name: p.name || providerTypes[p.type]?.label || p.type })}</span>
            </button>
          ))}
          {menu.ids.length > 0 && (
            <button className="cp-find-row" style={{ color: 'var(--danger)' }}
              onClick={() => act(() => removeModels(menu.ids, () => setPicked(new Set())))}>
              <Trash /><span>{one ? t('Delete') : t('Delete {n}', { n: menuModels.length })}</span>
            </button>
          )}
        </div>
      )}

      {namePrompt && <FolderPrompt onCancel={() => setNamePrompt(null)} onSubmit={submitFolderName}
        title={namePrompt.ids.length ? t('Group into folder') : t('Create folder')} />}
    </>
  );
}

function FolderPrompt({ title, onCancel, onSubmit }) {
  const [name, setName] = useState('');
  const ref = useAutoFocus();
  return (
    <Dialog title={title} size="narrow" onClose={onCancel}
      foot={<>
        <Btn onClick={onCancel}>{t('Cancel')}</Btn>
        <Btn kind="primary" onClick={() => onSubmit(name)}>{t('Create')}</Btn>
      </>}>
      <input ref={ref} className="cp-input" value={name} placeholder={t('Folder name')} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(name); }} />
    </Dialog>
  );
}
