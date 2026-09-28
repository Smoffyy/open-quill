import { createContext, useContext, useMemo, useState, useRef } from 'react';
import { useAdmin } from '../store.jsx';
import { Input, Area, Select, Switch, Btn, PointMenu, MenuItem, clampToViewport } from '../ui.jsx';
import { ChevDown, Plus, X } from '../../ui/icons.jsx';
import { t, tk } from '../../../i18n.jsx';
import {
  shared, variants, flagOn, folderOf, folderPatch, applyText, approxTokens, norm, revertPatch, FLAGS, TEXT_OPS
} from '../../../lib/modelcatalog.js';

const Ctx = createContext(null);

const MIXED = '\u0000mixed';
const MENU_W = 300;
const MENU_H = 320;
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

export function LongText({ k, label, hint, placeholder, rows = 6, mono, counter, inserts }) {
  const { edit, models } = useEditor();
  const { value, mixed } = useField(k);
  const ref = useRef(null);
  if (mixed) return <BulkText k={k} label={label} hint={hint} rows={rows} mono={mono} count={models.length} />;
  const text = value ?? '';

  function insert(token) {
    const el = ref.current;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    edit({ [k]: text.slice(0, at) + token + text.slice(end) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  }

  return (
    <Slot label={label} k={k} hint={hint}>
      <Area ref={ref} mono={mono} rows={rows} value={text} placeholder={placeholder} aria-label={label}
        onChange={(e) => edit({ [k]: e.target.value })} />
      {(counter || inserts) && (
        <div className="mc-text-foot">
          {counter && (
            <span className="cp-note-line">
              {t('{n} characters', { n: text.length.toLocaleString() })}{' · '}{t('~{n} tokens', { n: approxTokens(text).toLocaleString() })}
            </span>
          )}
          {inserts && (
            <span className="cp-acts">
              {inserts.map(([name, token]) => (
                <Btn key={token} size="sm" kind="quiet" title={token} onClick={() => insert(token)}>
                  <Plus /> {name}
                </Btn>
              ))}
            </span>
          )}
        </div>
      )}
    </Slot>
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
