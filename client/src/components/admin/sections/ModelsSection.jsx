import React, { useState, useEffect, useRef } from 'react';
import { useAdmin } from '../store.jsx';
import { Grip, EmptyState } from '../widgets.jsx';
import ModelEditor from '../ModelEditor.jsx';
import { Cube, Plus, Copy, Trash, Star, Pencil, Sliders, Chevron } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const GROUPS_KEY = 'oq-model-groups';
const COLLAPSED_KEY = 'oq-model-groups-collapsed';

const EyeIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" />
  </svg>
);
const EyeOffIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 3l18 18M10 5.9A9.9 9.9 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.4 6.9A16 16 0 0 0 2 12s3.5 6.5 10 6.5a10 10 0 0 0 3.4-.6" /><path d="M9.9 10.2a2.6 2.6 0 0 0 3.6 3.7" />
  </svg>
);
const FolderIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

function loadGroupReg() {
  try {
    const v = JSON.parse(localStorage.getItem(GROUPS_KEY));
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

export default function ModelsSection() {
  const A = useAdmin();
  const { models, providers, providerTypes, selModel, setSelModel, modelSave, setAsk } = A;
  const [filter, setFilter] = useState('');
  const [view, setView] = useState('all');
  const [multiSel, setMultiSel] = useState(() => new Set());
  const [meSection, setMeSection] = useState('essentials');
  const [dragIds, setDragIds] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [menu, setMenu] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [groupReg, setGroupReg] = useState(loadGroupReg);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY));
      return new Set(Array.isArray(v) ? v : []);
    } catch { return new Set(); }
  });
  const [renamingGroup, setRenamingGroup] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const selAnchor = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groupReg)); } catch {}
  }, [groupReg]);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch {}
  }, [collapsed]);

  useEffect(() => {
    const labels = [];
    for (const m of models) {
      if (!m.in_more_models) continue;
      const k = m.more_models_label || '';
      if (!labels.includes(k)) labels.push(k);
    }
    setGroupReg(reg => {
      const missing = labels.filter(l => !reg.includes(l));
      return missing.length ? [...reg, ...missing] : reg;
    });
  }, [models]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const visibleModels = models.filter(m => m.enabled && !m.unavailable).length;
  const hiddenModels = models.filter(m => !m.enabled).length;
  const unavailModels = models.filter(m => !!m.unavailable).length;

  if (!models.length) {
    return (
      <EmptyState icon={<Cube style={{ width: 30 }} />} title={t("Add your first model")}
        actions={<>
          <button className="btn primary" onClick={A.addModel}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> {t('Add model')}</button>
          <button className="btn ghost" onClick={() => A.openDiscover(providers[0]?.id)}><Cube style={{ width: 14, verticalAlign: '-2px' }} /> {t('Discover from a provider')}</button>
        </>}>
        <p>{t('Models are what users pick in the chat. Each one points at a provider (your LLM backend) and carries its own prompt, sampling, and capabilities.')}</p>
        <div className="aq-empty-hint">{t('No provider set up yet? Head to the')} <button className="linklike" onClick={() => A.setSection('providers')}>{t('Providers')}</button> {t('section first.')}</div>
      </EmptyState>
    );
  }

  const sel = models.find(x => x.id === selModel) || models[0] || null;
  const q = filter.trim().toLowerCase();
  const inView = (m) => view === 'visible' ? (!!m.enabled && !m.unavailable) : view === 'hidden' ? !m.enabled : view === 'unavailable' ? !!m.unavailable : true;
  const shown = models.filter(m => inView(m) && (!q || (m.display_name || '').toLowerCase().includes(q) || (m.internal_name || '').toLowerCase().includes(q)));
  const orderable = !q && view === 'all';

  const ungrouped = shown.filter(m => !m.in_more_models);
  const groupMap = new Map();
  for (const m of shown) {
    if (!m.in_more_models) continue;
    const k = m.more_models_label || '';
    if (!groupMap.has(k)) groupMap.set(k, []);
    groupMap.get(k).push(m);
  }
  const groupOrder = groupReg.filter(k => orderable || (groupMap.get(k) || []).length);
  const displaySeq = [...ungrouped, ...groupOrder.flatMap(k => groupMap.get(k) || [])];
  const groupTitle = (k) => k || t('More models');
  const membersOf = (k) => models.filter(m => m.in_more_models && (m.more_models_label || '') === k);

  function rowClick(e, m) {
    if (e.shiftKey && selAnchor.current) {
      const order = displaySeq.map(x => x.id);
      let a = order.indexOf(selAnchor.current), b = order.indexOf(m.id);
      if (a < 0) a = b;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setMultiSel(new Set(order.slice(lo, hi + 1)));
      setSelModel(m.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setMultiSel(prev => {
        const n = new Set(prev);
        if (!n.size && sel) n.add(sel.id);
        if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
        return n;
      });
      selAnchor.current = m.id;
      setSelModel(m.id);
      return;
    }
    setMultiSel(new Set());
    selAnchor.current = m.id;
    setSelModel(m.id);
  }

  function toggleCheck(e, m) {
    e.stopPropagation();
    setMultiSel(prev => {
      const n = new Set(prev);
      if (!n.size && sel && sel.id !== m.id) n.add(sel.id);
      if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
      return n;
    });
    selAnchor.current = m.id;
  }

  function startMarquee(e) {
    if (e.button !== 0) return;
    if (e.target !== listRef.current) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
    const move = (ev) => {
      const x = Math.min(start.x, ev.clientX), y = Math.min(start.y, ev.clientY);
      const w = Math.abs(ev.clientX - start.x), h = Math.abs(ev.clientY - start.y);
      setMarquee({ x, y, w, h });
      if (w < 4 && h < 4) return;
      const hits = new Set();
      listRef.current?.querySelectorAll('[data-mid]').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) hits.add(el.dataset.mid);
      });
      setMultiSel(hits);
    };
    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setMarquee(null);
      const moved = Math.abs(ev.clientX - start.x) > 4 || Math.abs(ev.clientY - start.y) > 4;
      if (!moved) setMultiSel(new Set());
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function openMenu(e, m) {
    e.preventDefault();
    e.stopPropagation();
    let ids;
    if (multiSel.size > 1 && multiSel.has(m.id)) {
      ids = [...multiSel].filter(id => models.some(x => x.id === id));
    } else {
      ids = [m.id];
      setMultiSel(new Set());
      setSelModel(m.id);
      selAnchor.current = m.id;
    }
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.min(e.clientY, window.innerHeight - 400);
    setMenu({ x, y, ids });
  }

  function newGroupLabel() {
    const labels = new Set(groupReg);
    let l = 'New group', n = 2;
    while (labels.has(l)) l = 'New group ' + n++;
    return l;
  }

  function createGroup(ids) {
    const l = newGroupLabel();
    setGroupReg(reg => reg.includes(l) ? reg : [...reg, l]);
    setCollapsed(c => { if (!c.has(l)) return c; const n = new Set(c); n.delete(l); return n; });
    if (ids && ids.length) A.setModelsGroup(ids, l);
    setRenamingGroup(l);
    setRenameVal(l);
  }

  function act(fn) {
    setMenu(null);
    fn();
  }

  function commitGroupRename(oldLabel) {
    const v = renameVal.trim();
    setRenamingGroup(null);
    if (!v || v === oldLabel) return;
    setGroupReg(reg => [...new Set(reg.map(l => l === oldLabel ? v : l))]);
    setCollapsed(c => { if (!c.has(oldLabel)) return c; const n = new Set(c); n.delete(oldLabel); n.add(v); return n; });
    if (membersOf(oldLabel).length) A.renameModelGroup(oldLabel, v);
  }

  function deleteGroup(k) {
    const members = membersOf(k);
    const drop = () => {
      setGroupReg(reg => reg.filter(l => l !== k));
      if (members.length) A.setModelsGroup(members.map(m => m.id), null);
    };
    if (!members.length) { drop(); return; }
    setAsk({
      message: t('Delete the group “{g}”? Its models will move back to the main list.', { g: groupTitle(k) }),
      danger: t('Delete group'),
      onConfirm: drop
    });
  }

  function handleDrop(target, targetGroup, after) {
    const ids = dragIds;
    setDragIds(null);
    setDragOver(null);
    if (!ids || !ids.length) return;
    const idSet = new Set(ids);
    if (target && idSet.has(target.id)) return;
    const orderedIds = displaySeq.filter(m => idSet.has(m.id)).map(m => m.id);
    if (!orderedIds.length) return;
    const seq = displaySeq.map(x => x.id).filter(id => !idSet.has(id));
    let at;
    if (target) {
      const i = seq.indexOf(target.id);
      at = i < 0 ? seq.length : i + (after ? 1 : 0);
    } else {
      at = seq.length;
    }
    seq.splice(at, 0, ...orderedIds);
    const nowGroup = target ? (target.in_more_models ? (target.more_models_label || '') : null) : targetGroup;
    const changed = [];
    const arr = seq.map(id => {
      const m = models.find(x => x.id === id);
      if (!idSet.has(id)) return m;
      const wasGroup = m.in_more_models ? (m.more_models_label || '') : null;
      if (nowGroup === wasGroup) return m;
      changed.push(id);
      return nowGroup === null ? { ...m, in_more_models: 0, more_models_label: '' } : { ...m, in_more_models: 1, more_models_label: nowGroup };
    });
    A.commitModelOrder(arr);
    if (changed.length) A.setModelsGroup(changed, nowGroup);
  }

  function renderRow(m) {
    const over = dragOver && dragOver.id === m.id;
    const isDragging = dragIds && dragIds.includes(m.id);
    return (
      <div key={m.id} data-mid={m.id}
        className={'mw-row' + (sel && sel.id === m.id ? ' active' : '') + (multiSel.has(m.id) ? ' checked' : '') + (isDragging ? ' dragging' : '') + (over && !dragOver.after ? ' drag-over' : '') + (over && dragOver.after ? ' drag-over-after' : '')}
        draggable={orderable}
        onDragStart={() => {
          if (!orderable) return;
          setDragIds(multiSel.size > 1 && multiSel.has(m.id) ? [...multiSel] : [m.id]);
        }}
        onDragEnd={() => { setDragIds(null); setDragOver(null); }}
        onDragOver={(e) => {
          if (!orderable || (dragIds && dragIds.includes(m.id))) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setDragOver({ id: m.id, after: e.clientY > r.top + r.height / 2 });
        }}
        onDrop={(e) => { if (!orderable) return; e.preventDefault(); handleDrop(m, undefined, !!(dragOver && dragOver.id === m.id && dragOver.after)); }}
        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
        onContextMenu={(e) => openMenu(e, m)}
        onClick={(e) => rowClick(e, m)}>
        {orderable && <span className="mw-grip"><Grip /></span>}
        {m.static_icon ? <img className="mw-row-icon" src={m.static_icon} alt="" /> : <span className="mw-row-icon noicon">{(m.display_name || '?').trim().charAt(0).toUpperCase()}</span>}
        <div className="mw-row-meta">
          <span className="mw-row-name">
            {m.display_name || t('Untitled model')}
            {!!m.is_default && <span className="mw-star" title={t("Default")}>★</span>}
          </span>
          <span className="mw-row-sub">{m.internal_name || 'no id'}</span>
        </div>
        <span className="mw-row-hover">
          <button type="button" className={'mw-hact' + (multiSel.has(m.id) ? ' on' : '')} title={t("Select for bulk actions")} onClick={(e) => toggleCheck(e, m)}>
            {multiSel.has(m.id)
              ? <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" /><path d="M8 12.4l2.8 2.8 5.6-6.4" fill="none" stroke="var(--card-bg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /></svg>}
          </button>
        </span>
        <span className="mw-dots">
          {!m.enabled && <span className="mw-dot dim" title={t("Hidden")} />}
          {!!m.unavailable && <span className="mw-dot warn" title={t("Unavailable")} />}
        </span>
      </div>
    );
  }

  function renderGroup(k) {
    const rows = groupMap.get(k) || [];
    const renaming = renamingGroup === k;
    const over = dragOver && dragOver.id === 'group:' + k;
    const isCollapsed = collapsed.has(k) && !renaming;
    const allMembers = membersOf(k);
    const anyVisible = allMembers.some(x => !!x.enabled);
    return (
      <React.Fragment key={'grp:' + k}>
        <div className={'mw-group-head' + (over ? ' drag-over' : '') + (isCollapsed ? ' collapsed' : '')}
          onDragOver={(e) => { if (!orderable) return; e.preventDefault(); setDragOver({ id: 'group:' + k }); }}
          onDrop={(e) => { if (!orderable) return; e.preventDefault(); handleDrop(null, k); }}>
          <button type="button" className="mw-group-chev" title={isCollapsed ? t('Expand group') : t('Collapse group')}
            onClick={() => setCollapsed(c => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
            <Chevron />
          </button>
          {renaming ? (
            <input className="mw-group-rename" autoFocus value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={() => commitGroupRename(k)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitGroupRename(k); if (e.key === 'Escape') setRenamingGroup(null); }} />
          ) : (
            <>
              <button type="button" className="mw-group-label" title={t("Click to rename this group")} onClick={() => { setRenamingGroup(k); setRenameVal(groupTitle(k)); }}>
                {groupTitle(k)}
              </button>
              {isCollapsed && allMembers.length > 0 && <span className="mw-group-count">{allMembers.length}</span>}
              {allMembers.length > 0 && (
                <button type="button" className="mw-group-edit" title={anyVisible ? t('Hide all models in this group') : t('Show all models in this group')}
                  onClick={() => A.setModelsEnabled(allMembers.map(x => x.id), !anyVisible)}>
                  {anyVisible
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10 5.9A9.9 9.9 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.4 6.9A16 16 0 0 0 2 12s3.5 6.5 10 6.5a10 10 0 0 0 3.4-.6" /><path d="M9.9 10.2a2.6 2.6 0 0 0 3.6 3.7" /></svg>}
                </button>
              )}
              <button type="button" className="mw-group-edit" title={t("Rename group")} onClick={() => { setRenamingGroup(k); setRenameVal(groupTitle(k)); }}><Pencil /></button>
              <button type="button" className="mw-group-edit del" title={t("Delete group")} onClick={() => deleteGroup(k)}><Trash /></button>
            </>
          )}
          <span className="mw-group-line" />
        </div>
        {!isCollapsed && rows.map(renderRow)}
        {!isCollapsed && orderable && rows.length === 0 && (
          <div className={'mw-group-empty' + (over ? ' drag-over' : '')}
            onDragOver={(e) => { e.preventDefault(); setDragOver({ id: 'group:' + k }); }}
            onDrop={(e) => { e.preventDefault(); handleDrop(null, k); }}>
            {t('Drag models here')}
          </div>
        )}
      </React.Fragment>
    );
  }

  const menuModels = menu ? menu.ids.map(id => models.find(x => x.id === id)).filter(Boolean) : [];
  const menuSingle = menuModels.length === 1 ? menuModels[0] : null;
  const menuAllHidden = menuModels.length > 0 && menuModels.every(m => !m.enabled);
  const menuAnyGrouped = menuModels.some(m => !!m.in_more_models);
  const menuCurrentGroup = menuSingle && menuSingle.in_more_models ? (menuSingle.more_models_label || '') : null;

  return (
    <div className="mw">
      <div className="mw-rail">
        <div className="mw-rail-head">
          <span className="mw-rail-title">{t('Models')} <span className="mw-count">{models.length}</span></span>
          <button className="mw-add" onClick={A.addModel} title={t("Add model")}><Plus style={{ width: 16 }} /></button>
        </div>
        <div className="mw-search">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Search models…")} />
        </div>
        <div className="mw-filters">
          {[['all', t('All'), models.length], ['visible', t('Visible'), visibleModels], ['hidden', t('Hidden'), hiddenModels], ['unavailable', t('Down'), unavailModels]].map(([v, l, n]) => (
            <button key={v} className={'mw-chip' + (view === v ? ' on' : '')} onClick={() => setView(v)}>{l}{n > 0 && <em>{n}</em>}</button>
          ))}
        </div>
        <div className="mw-list" ref={listRef} onMouseDown={startMarquee}
          onDragOver={(e) => { if (orderable && e.target === listRef.current) { e.preventDefault(); setDragOver(null); } }}
          onDrop={(e) => { if (orderable && e.target === listRef.current) { e.preventDefault(); handleDrop(null, null); } }}>
          {ungrouped.map(renderRow)}
          {groupOrder.map(renderGroup)}
          {orderable && (
            <button type="button" className="mw-new-group" onClick={() => createGroup([])}>
              <Plus style={{ width: 12 }} /> {t('New group')}
            </button>
          )}
          {shown.length === 0 && <div className="mw-none">{q ? t('No models match “{q}”.', { q: filter }) : t('Nothing here with this filter.')}</div>}
        </div>
        <div className="mw-rail-foot">
          <button className="btn add-model" onClick={A.addModel}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> {t('Add model')}</button>
          <button className="btn ghost" onClick={() => A.openDiscover(providers[0]?.id)}><Cube style={{ width: 14, verticalAlign: '-2px' }} /> {t('Discover')}</button>
        </div>
      </div>
      <div className="mw-detail">
        {sel
          ? <ModelEditor key={sel.id} m={sel} onChange={A.changeModel}
              onDelete={(id) => A.deleteModels([id])} onDuplicate={A.duplicateModel}
              autosaveState={modelSave} providers={providers} providerTypes={providerTypes} models={models}
              section={meSection} onSection={setMeSection} />
          : <div className="muted-note" style={{ padding: 20 }}>No models yet, add one to get started.</div>}
      </div>
      {marquee && <div className="mw-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      {menu && menuModels.length > 0 && (
        <div className="mw-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          {menuSingle ? (
            <>
              <button onClick={() => act(() => A.changeModel({ ...menuSingle, enabled: menuSingle.enabled ? 0 : 1 }))}>
                {menuSingle.enabled ? <EyeOffIcon /> : <EyeIcon />} {menuSingle.enabled ? t('Hide from users') : t('Show to users')}
              </button>
              <button disabled={!!menuSingle.is_default} onClick={() => act(() => A.changeModel({ ...menuSingle, is_default: 1 }))}>
                <Star /> {menuSingle.is_default ? t('Default model') : t('Make default')}
              </button>
              <button onClick={() => act(() => A.duplicateModel(menuSingle.id))}><Copy /> {t('Duplicate')}</button>
            </>
          ) : (
            <>
              <button onClick={() => act(() => A.setModelsEnabled(menu.ids, menuAllHidden))}>
                {menuAllHidden ? <EyeIcon /> : <EyeOffIcon />} {menuAllHidden ? t('Show {n} models', { n: menuModels.length }) : t('Hide {n} models', { n: menuModels.length })}
              </button>
              <button onClick={() => act(async () => { await A.duplicateModels(menu.ids); setMultiSel(new Set()); })}><Copy /> {t('Duplicate {n} models', { n: menuModels.length })}</button>
            </>
          )}
          <div className="mw-menu-sep" />
          <button onClick={() => act(() => createGroup(menu.ids))}>
            <FolderIcon /> {menuSingle ? t('New group') : t('Group models')}
          </button>
          {groupReg.filter(k => k !== menuCurrentGroup).map(k => (
            <button key={'mv:' + k} onClick={() => act(() => A.setModelsGroup(menu.ids, k))}>
              <FolderIcon /> {t('Move to')} “{groupTitle(k)}”
            </button>
          ))}
          {menuAnyGrouped && (
            <button onClick={() => act(() => A.setModelsGroup(menu.ids, null))}><FolderIcon /> {menuSingle ? t('Remove from group') : t('Ungroup')}</button>
          )}
          {!menuSingle && providers.length > 1 && (
            <>
              <div className="mw-menu-sep" />
              {providers.map(p => (
                <button key={'pv:' + p.id} onClick={() => act(() => A.setModelsProvider(menu.ids, p.id))}>
                  <Sliders /> {t('Set provider:')} {p.name || (providerTypes[p.type]?.label || p.type)}
                </button>
              ))}
            </>
          )}
          <div className="mw-menu-sep" />
          <button className="danger" onClick={() => act(() => A.deleteModels(menu.ids, () => setMultiSel(new Set())))}>
            <Trash /> {menuSingle ? t('Delete') : t('Delete {n} models', { n: menuModels.length })}
          </button>
        </div>
      )}
    </div>
  );
}
