import { createContext, useContext, useMemo, useState, useRef, useLayoutEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useAdmin } from '../store.jsx';
import { Input, Area, Select, Switch, Btn, PointMenu, MenuItem, clampToViewport } from '../ui.jsx';
import { ChevDown, X } from '../../ui/icons.jsx';
import { t, tk } from '../../../i18n.jsx';
import {
  shared, variants, flagOn, folderOf, folderPatch, applyText, approxTokens, norm, revertPatch, FLAGS, TEXT_OPS
} from '../../../lib/modelcatalog.js';

const Ctx = createContext(null);

const MIXED = '\u0000mixed';
const MENU_W = 300;
const MENU_H = 320;
const VAR_MENU_H = 360;
const PREVIEW = 48;
const BULK_ROWS = 6;

const OP_LABEL = {
  __proto__: null,
  replace: tk('Replace all'),
  prepend: tk('Add to the start'),
  append: tk('Add to the end'),
  swap: tk('Find and replace')
};

export function EditorProvider({ models, edit, children }) {
  const value = useMemo(() => {
    const ids = models.map(m => m.id);
    return {
      models,
      ids,
      single: models.length === 1 ? models[0] : null,
      many: models.length > 1,
      edit: (change) => edit(ids, change),
      editEach: (fn) => edit(ids, fn),
      editOne: (id, change) => edit([id], change)
    };
  }, [models, edit]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useEditor = () => useContext(Ctx);

export function useField(k, { flag = false } = {}) {
  const { models } = useEditor();
  return shared(models, k, { flag });
}

function preview(m, k, flag) {
  if (flag) return flagOn(m, k) ? t('on') : t('off');
  if (k === 'folder') return folderOf(m) || t('top level');
  const v = m[k];
  if (v == null || v === '') return t('blank');
  if (Array.isArray(v)) return t('{n} entries', { n: v.length });
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > PREVIEW ? s.slice(0, PREVIEW) + '…' : s;
}

function copyFrom(m, k, flag) {
  if (flag) return { [k]: flagOn(m, k) ? 1 : 0 };
  if (k === 'folder') return folderPatch(folderOf(m));
  return { [k]: m[k] ?? null };
}

export function Mixed({ k, flag = false, apply }) {
  const { models, edit } = useEditor();
  const [menu, setMenu] = useState(null);
  const { mixed } = shared(models, k, { flag });
  if (!mixed) return null;
  const groups = variants(models, k, { flag });

  return (
    <>
      <button type="button" className="mc-mixed" aria-haspopup="menu" aria-expanded={!!menu}
        title={t('Models differ here. Pick one value for all of them.')}
        onClick={(e) => {
          if (menu) { setMenu(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ at: clampToViewport(r.left, r.bottom + 4, MENU_W, MENU_H), el: e.currentTarget });
        }}>
        {t('Mixed')}<ChevDown />
      </button>
      {menu && (
        <PointMenu at={menu.at} width={MENU_W} anchorEl={menu.el} onClose={() => setMenu(null)}>
          <div className="cp-menu-empty">{t('Use this value for all {n}', { n: models.length })}</div>
          {groups.map(g => (
            <MenuItem key={g[0].id} onClick={() => {
              setMenu(null);
              edit(apply ? apply(g[0]) : copyFrom(g[0], k, flag));
            }}>
              <span className={flag ? undefined : 'mono'}>{preview(g[0], k, flag)}</span>
              <em>{g.length === 1 ? (g[0].display_name || t('Untitled')) : t('{n} models', { n: g.length })}</em>
            </MenuItem>
          ))}
        </PointMenu>
      )}
    </>
  );
}

function keysOf(k) {
  return !k ? [] : Array.isArray(k) ? k : [k];
}

export function useChange(k) {
  const { catalog } = useAdmin();
  const { models, editEach } = useEditor();
  const live = catalog.draft.live || {};
  const keys = keysOf(k);
  const diff = models.filter(m => live[m.id] && keys.some(key => norm(live[m.id], key) !== norm(m, key)));
  return {
    changed: diff.length > 0,
    was: diff.length === 1 && keys.length === 1 ? preview(live[diff[0].id], k, FLAGS.has(k)) : null,
    count: diff.length,
    revert: () => {
      editEach(m => (live[m.id] ? Object.assign({}, ...keys.map(key => revertPatch(live[m.id], key))) : null));
      if (!keys.includes('is_default')) return;
      const holder = catalog.models.find(m => live[m.id]?.is_default && !m.is_default);
      if (holder && !diff.some(m => live[m.id].is_default)) catalog.edit([holder.id], { is_default: 1 });
    }
  };
}

export function Revert({ change, label }) {
  if (!change.changed) return null;
  const tip = change.was != null
    ? t('Revert {name} to the published value: {value}', { name: label, value: change.was })
    : change.count === 1
      ? t('Revert {name} to the published values', { name: label })
      : t('Revert {name} on {n} models to the published values', { name: label, n: change.count });
  return (
    <button type="button" className="mc-revert" title={tip} aria-label={tip}
      onClick={(e) => { e.stopPropagation(); change.revert(); }}>
      <X />
    </button>
  );
}

function Label({ text, k, flag, apply, change, plain }) {
  return (
    <span className="mc-label">
      {text}
      {k && !plain && <Mixed k={k} flag={flag} apply={apply} />}
      {change && <Revert change={change} label={typeof text === 'string' ? text : ''} />}
    </span>
  );
}

export function Slot({ label, k, flag, apply, hint, plain, children }) {
  const change = useChange(k);
  return (
    <div className={'cp-field' + (change.changed ? ' mc-changed' : '')}>
      <div className="mc-field-head"><Label text={label} k={k} flag={flag} apply={apply} change={change} plain={plain} /></div>
      {children}
      {hint && <div className="cp-hint">{hint}</div>}
    </div>
  );
}

export function Line({ label, note, k, flag, wide, children }) {
  const change = useChange(k);
  return (
    <div className={'cp-row' + (change.changed ? ' mc-changed' : '')}>
      <div className="cp-row-main">
        <span className="cp-row-label"><Label text={label} k={k} flag={flag} change={change} /></span>
        {note && <div className="cp-row-note">{note}</div>}
      </div>
      <div className={'cp-row-ctrl' + (wide ? ' wide' : '')}>{children}</div>
    </div>
  );
}

export function When({ k, test, keep, children }) {
  const { models } = useEditor();
  const pending = useChange(keep);
  const pass = models.some(m => (test ? test(m) : flagOn(m, k)));
  return pass || pending.changed ? children : null;
}

export function Levels({ label, note, level, options }) {
  const { models, edit } = useEditor();
  const values = new Set(models.map(level.read));
  const mixed = values.size > 1;
  const current = mixed ? MIXED : [...values][0];
  const change = useChange(level.keys);
  return (
    <div className={'cp-row' + (change.changed ? ' mc-changed' : '')}>
      <div className="cp-row-main">
        <span className="cp-row-label">
          <span className="mc-label">
            {label}
            {mixed && <span className="mc-mixed static">{t('Mixed')}</span>}
            <Revert change={change} label={label} />
          </span>
        </span>
        {note && <div className="cp-row-note">{note}</div>}
      </div>
      <div className="cp-row-ctrl wide">
        <Select value={current} label={label}
          onChange={(v) => { if (v !== MIXED) edit(level.patch[v]); }}
          options={[...(mixed ? [{ value: MIXED, label: t('Mixed') }] : []), ...options]} />
      </div>
    </div>
  );
}

export function Chips({ label, note, items }) {
  const { models, edit } = useEditor();
  const change = useChange(items.map(([k]) => k));
  const { catalog } = useAdmin();
  const live = catalog.draft.live || {};
  return (
    <div className={'cp-row mc-chip-row' + (change.changed ? ' mc-changed' : '')}>
      <div className="cp-row-main">
        <span className="cp-row-label"><span className="mc-label">{label}<Revert change={change} label={label} /></span></span>
        {note && <div className="cp-row-note">{note}</div>}
      </div>
      <div className="mc-chips" role="group" aria-label={label}>
        {items.map(([k, name, hint]) => {
          const on = models.filter(m => flagOn(m, k)).length;
          const all = on === models.length;
          const moved = models.some(m => live[m.id] && norm(live[m.id], k) !== norm(m, k));
          return (
            <button key={k} type="button" aria-pressed={all ? true : on ? 'mixed' : false} title={hint}
              className={'mc-chip' + (on && !all ? ' part' : '') + (moved ? ' moved' : '')}
              onClick={() => edit({ [k]: all ? 0 : 1 })}>
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ModelPicks({ k, label, note, candidates, empty }) {
  const { models, editEach } = useEditor();
  const change = useChange(k);
  const listOf = (m) => (Array.isArray(m[k]) ? m[k] : []);
  function toggle(id, all) {
    editEach(m => (m.id === id ? null : { [k]: all ? listOf(m).filter(x => x !== id) : [...new Set([...listOf(m), id])] }));
  }
  return (
    <div className={'cp-row mc-chip-row' + (change.changed ? ' mc-changed' : '')}>
      <div className="cp-row-main">
        <span className="cp-row-label"><span className="mc-label">{label}<Revert change={change} label={label} /></span></span>
        {note && <div className="cp-row-note">{note}</div>}
      </div>
      {candidates.length ? (
        <div className="mc-chips" role="group" aria-label={label}>
          {candidates.map(c => {
            const owners = models.filter(m => m.id !== c.id);
            const on = owners.filter(m => listOf(m).includes(c.id)).length;
            const all = owners.length > 0 && on === owners.length;
            return (
              <button key={c.id} type="button" aria-pressed={all ? true : on ? 'mixed' : false}
                className={'mc-chip' + (on && !all ? ' part' : '')} title={c.description || undefined}
                onClick={() => toggle(c.id, all)}>
                {c.display_name || c.internal_name}
              </button>
            );
          })}
        </div>
      ) : <div className="cp-row-note">{empty}</div>}
    </div>
  );
}

export function CardMark({ label, k }) {
  const change = useChange(k);
  return <Label text={label} k={k} change={change} />;
}

export function TextField({ k, label, hint, placeholder, mono, type, min, max, step, list, solo, commit, zeroBlank }) {
  const { many, edit, models } = useEditor();
  const { value, mixed } = useField(k);
  const locked = solo && many;
  const [local, setLocal] = useState(null);
  const shown = local ?? (mixed || (zeroBlank && Number(value) === 0) ? '' : (value ?? ''));
  const write = (v) => edit(commit ? commit(v) : { [k]: v });

  return (
    <Slot label={label} k={k} plain={locked} hint={locked ? t('Differs per model. Select one model to edit it.') : hint}>
      <Input mono={mono} type={type} min={min} max={max} step={step} list={list} disabled={locked} aria-label={label}
        value={locked ? '' : shown}
        placeholder={locked ? t('{n} values', { n: models.length }) : mixed ? t('Mixed. Typing sets all {n}.', { n: models.length }) : placeholder}
        onChange={(e) => { if (commit) setLocal(e.target.value); else write(e.target.value); }}
        onBlur={() => { if (local !== null) { write(local); setLocal(null); } }}
        onKeyDown={(e) => { if (commit && e.key === 'Enter') e.currentTarget.blur(); }} />
    </Slot>
  );
}

export function NumberField(props) {
  return <TextField mono type="number" step="any" {...props} />;
}

export function Flag({ k, label, note, disabled }) {
  const { edit } = useEditor();
  const { value, mixed } = useField(k, { flag: true });
  return (
    <Line label={label} k={k} flag note={note}>
      <Switch on={!mixed && !!value} label={label} disabled={disabled}
        onToggle={() => edit({ [k]: mixed || !value ? 1 : 0 })} />
    </Line>
  );
}

export function Choice({ k, label, hint, options, fallback, row, note, solo }) {
  const { many, edit } = useEditor();
  const { value, mixed } = useField(k);
  const locked = solo && many;
  const known = value == null || value === '' ? null : String(value);
  const current = mixed || locked ? MIXED : (known ?? fallback ?? options[0]?.value);
  const opts = [
    ...(mixed || locked ? [{ value: MIXED, label: t('Mixed') }] : []),
    ...options,
    ...(options.some(o => o.value === current) || current === MIXED ? [] : [{ value: current, label: current }])
  ];
  const control = (
    <Select value={current} label={label} disabled={locked}
      onChange={(v) => { if (v !== MIXED) edit({ [k]: v }); }}
      options={opts} />
  );
  if (row) return <Line label={label} k={k} note={note} wide>{control}</Line>;
  return <Slot label={label} k={k} hint={hint}>{control}</Slot>;
}

function syncMirror(ta, m) {
  if (!ta || !m) return;
  const cs = getComputedStyle(ta);
  Object.assign(m.style, {
    top: cs.borderTopWidth, left: cs.borderLeftWidth, width: ta.clientWidth + 'px', height: ta.clientHeight + 'px',
    padding: cs.padding, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, tabSize: cs.tabSize
  });
  m.scrollTop = ta.scrollTop;
}

const VAR_SPLIT = /(\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\})/;
const VAR_NAME = /^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/;
const POP_W = 320;
const POP_H = 150;

function withVariables(text) {
  return text.split(VAR_SPLIT).map((part, i) => {
    const m = VAR_NAME.exec(part);
    return m ? <span key={i} className="mc-var" data-var={m[1]}>{part}</span> : part;
  });
}

function VariablePop({ at, above, name, info }) {
  if (!info) return null;
  return createPortal(
    <div className="cp-menu mc-var-pop" role="tooltip" style={{ position: 'fixed', left: at.x, top: at.y, width: POP_W, transform: above ? 'translateY(-100%)' : undefined }}>
      <code className="mc-var-pop-name">{`{{${name}}}`}</code>
      <div className="mc-var-pop-desc">{info.desc}</div>
      {info.filled
        ? <div className="mc-var-pop-row"><span>{t('Filled in as')}</span><code>{info.filled}</code></div>
        : <div className="mc-var-pop-row"><span>{t('Empty for this model. Example')}</span><code>{info.example}</code></div>}
    </div>, document.body);
}

export function LongText({ k, label, hint, placeholder, rows = 6, mono, counter, variables, mirror, variableInfo }) {
  const { edit, models } = useEditor();
  const { value, mixed } = useField(k);
  const ref = useRef(null);
  const mirrorRef = useRef(null);
  const placed = useRef(null);
  const [caret, setCaret] = useState(null);
  const [varMenu, setVarMenu] = useState(null);
  const [hover, setHover] = useState(null);
  const mirrored = !!mirror && !mixed;
  useLayoutEffect(() => {
    const el = ref.current;
    const p = placed.current;
    if (!el || !p) return;
    placed.current = null;
    el.focus({ preventScroll: true });
    el.setSelectionRange(p.at, p.at);
    el.scrollTop = p.top;
  });
  useLayoutEffect(() => { if (mirrored) syncMirror(ref.current, mirrorRef.current); });
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!mirrored || !ta || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => syncMirror(ta, mirrorRef.current));
    ro.observe(ta);
    return () => ro.disconnect();
  }, [mirrored]);
  if (mixed) return <BulkText k={k} label={label} hint={hint} rows={rows} mono={mono} count={models.length} />;
  const text = value ?? '';

  function openVariables(e) {
    if (e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const pointer = e.clientX + e.clientY > 0;
    const r = el.getBoundingClientRect();
    const at = clampToViewport(pointer ? e.clientX : r.left + 16, pointer ? e.clientY : r.top + 16, MENU_W, VAR_MENU_H);
    setVarMenu({ at, start: el.selectionStart, end: el.selectionEnd, top: el.scrollTop });
  }

  function closeVariables() {
    const top = varMenu?.top;
    setVarMenu(null);
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (top != null) el.scrollTop = top;
  }

  function insert(name) {
    const token = `{{${name}}}`;
    const start = Math.min(varMenu.start, text.length);
    const end = Math.min(varMenu.end, text.length);
    placed.current = { at: start + token.length, top: varMenu.top };
    setVarMenu(null);
    edit({ [k]: text.slice(0, start) + token + text.slice(end) });
  }

  const onContextMenu = variables ? openVariables : undefined;

  function trackVariable(e) {
    const m = mirrorRef.current;
    if (!variableInfo || !m) return;
    let hit = null;
    for (const el of m.querySelectorAll('[data-var]')) {
      for (const r of el.getClientRects()) {
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { hit = { el, r }; break; }
      }
      if (hit) break;
    }
    const name = hit ? hit.el.dataset.var : null;
    if (!name) { if (hover) setHover(null); return; }
    if (hover && hover.name === name && hover.key === hit.r.left + ':' + hit.r.top) return;
    const above = hit.r.bottom + 6 + POP_H > window.innerHeight - 8;
    const pos = clampToViewport(hit.r.left, above ? hit.r.top - 6 : hit.r.bottom + 6, POP_W, 0);
    setHover({ name, above, key: hit.r.left + ':' + hit.r.top, at: pos });
  }

  return (
    <Slot label={label} k={k} hint={hint}>
      {mirrored ? (
        <div className="mc-mirror-wrap">
          <Area ref={ref} mono={mono} rows={rows} value={text} placeholder={placeholder} aria-label={label}
            className="mc-mirror-input"
            onChange={(e) => { setHover(null); edit({ [k]: e.target.value }); }} onContextMenu={onContextMenu}
            onMouseMove={variableInfo ? trackVariable : undefined} onMouseLeave={() => setHover(null)}
            onSelect={(e) => setCaret(e.target.selectionStart)}
            onBlur={() => setCaret(null)}
            onScroll={(e) => { setHover(null); if (mirrorRef.current) mirrorRef.current.scrollTop = e.target.scrollTop; }} />
          <div className="mc-mirror" ref={mirrorRef} aria-hidden="true">
            {mirror(text, caret).map((seg, i) => (seg.tone ? <span key={i} className={'mc-' + seg.tone}>{withVariables(seg.text)}</span> : <Fragment key={i}>{withVariables(seg.text)}</Fragment>))}
            {'\u200b'}
          </div>
        </div>
      ) : (
        <Area ref={ref} mono={mono} rows={rows} value={text} placeholder={placeholder} aria-label={label}
          onChange={(e) => edit({ [k]: e.target.value })} onContextMenu={onContextMenu} />
      )}
      {(counter || variables) && (
        <div className="mc-text-foot">
          {counter && (
            <span className="cp-note-line">
              {t('{n} characters', { n: text.length.toLocaleString() })}{' · '}{t('~{n} tokens', { n: approxTokens(text).toLocaleString() })}
            </span>
          )}
          {variables && <span className="cp-note-line">{t('Right-click to insert a variable. Shift and right-click for the browser’s own menu.')}</span>}
        </div>
      )}
      {hover && !varMenu && <VariablePop at={hover.at} above={hover.above} name={hover.name} info={variableInfo ? variableInfo(hover.name) : null} />}
      {varMenu && <VariableMenu at={varMenu.at} groups={variables} onPick={insert} onClose={closeVariables} />}
    </Slot>
  );
}

function VariableMenu({ at, groups, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const hit = (s) => t(s).toLowerCase().includes(q);
  const shown = groups
    .map(([group, list]) => [group, !q || hit(group) ? list : list.filter(([name, desc]) => name.toLowerCase().includes(q) || hit(desc))])
    .filter(([, list]) => list.length);
  const first = shown[0]?.[1][0]?.[0];

  function onKeyDown(e) {
    if (e.key === 'Enter' && first) {
      e.preventDefault();
      onPick(first);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.currentTarget.closest('.cp-menu')?.querySelector('.cp-menu-item')?.focus();
    }
  }

  return (
    <PointMenu at={at} width={MENU_W} onClose={onClose}>
      <div className="mc-var-find">
        <Input autoFocus value={query} placeholder={t('Find a variable')} aria-label={t('Find a variable')}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      </div>
      {shown.map(([group, list], i) => (
        <Fragment key={group}>
          {i > 0 && <div className="cp-menu-sep" />}
          <div className="cp-menu-empty">{t(group)}</div>
          {list.map(([name, desc]) => (
            <MenuItem key={name} onClick={() => onPick(name)}>
              <span className="mc-menu-two">
                <b><code>{`{{${name}}}`}</code></b>
                <small>{t(desc)}</small>
              </span>
            </MenuItem>
          ))}
        </Fragment>
      ))}
      {!shown.length && <div className="cp-menu-empty">{t('No matching variables')}</div>}
    </PointMenu>
  );
}

function BulkText({ k, label, hint, rows, mono, count }) {
  const { editEach } = useEditor();
  const [op, setOp] = useState('append');
  const [text, setText] = useState('');
  const [find, setFind] = useState('');
  const ready = op === 'swap' ? !!find : op === 'replace' || !!text;

  return (
    <Slot label={label} k={k} hint={hint}>
      <div className="mc-bulk">
        <p className="cp-note-line">
          {t('The {n} selected models each have their own text here. Choose how to change all of them at once.', { n: count })}
        </p>
        <Select value={op} label={t('Change')} onChange={setOp}
          options={TEXT_OPS.map(v => ({ value: v, label: t(OP_LABEL[v]) }))} />
        {op === 'swap' && (
          <Input mono={mono} value={find} placeholder={t('Text to find')} aria-label={t('Text to find')}
            onChange={(e) => setFind(e.target.value)} />
        )}
        <Area mono={mono} rows={op === 'swap' ? 2 : Math.min(rows, BULK_ROWS)} value={text} aria-label={label}
          placeholder={op === 'swap' ? t('Replace with') : op === 'replace' ? t('New text for every model') : t('Text to add')}
          onChange={(e) => setText(e.target.value)} />
        <div className="cp-acts end">
          <Btn kind="primary" size="sm" disabled={!ready}
            onClick={() => {
              editEach(m => ({ [k]: applyText(m[k], op, text, find) }));
              setText('');
              setFind('');
            }}>
            {t('Apply to {n} models', { n: count })}
          </Btn>
        </div>
      </div>
    </Slot>
  );
}