import { useState, useMemo, useRef } from 'react';
import { t } from '../../i18n.jsx';
import { useTheme } from '../../lib/theme/store.jsx';
import {
  elementTree, ORDER_INDEX, TOKEN_GROUPS,
  CONTENT_KEYS, SLOTS, NODE_TYPES, NODE_INDEX, CATEGORIES, ELEMENTS
} from '../../lib/theme/schema.js';
import {
  setPath, orderedItems, reorder, setHidden, elementEditCount,
  addNode, removeNode, nodeId
} from '../../lib/theme/ops.js';
import { Group, Field, Text, Color, Num, Select } from './controls.jsx';
import { PlaceholderChips } from './Inspector.jsx';
import { Eye, EyeOff, Search, Trash, Plus, ChevDown } from '../icons.jsx';

/* ---------------------------------------------------------------------------
   Layers
--------------------------------------------------------------------------- */

function Row({ depth, label, note, on, hidden, count, onClick, onToggleHide, onGripDown }) {
  return (
    <div className={'bx-row' + (on ? ' on' : '') + (hidden ? ' off' : '')} style={{ paddingLeft: 8 + depth * 12 }}>
      {onGripDown && (
        <span className="bx-grip" onPointerDown={onGripDown} role="presentation" title={t('Drag to reorder')}>⋮⋮</span>
      )}
      <button type="button" className="bx-row-main" onClick={onClick}>
        <span className="bx-row-label">{label}</span>
        {note && <em className="bx-row-note">{note}</em>}
        {count > 0 && <span className="bx-row-n">{count}</span>}
      </button>
      {onToggleHide && (
        <button type="button" className="bx-row-eye" title={hidden ? t('Show') : t('Hide')} aria-label={hidden ? t('Show') : t('Hide')}
          onClick={(e) => { e.stopPropagation(); onToggleHide(); }}>
          {hidden ? <EyeOff /> : <Eye />}
        </button>
      )}
    </div>
  );
}

// Reordering is a pointer drag between siblings with a line showing where the
// item will land. Pointer events rather than the HTML5 drag API, so the same
// code works with a mouse, a pen and a touch screen. The order it writes is a
// plain number the stylesheet turns into flex order, so nothing in the app has
// to know a drag happened.
function SortList({ group, depth, selection, onSelect }) {
  const { doc, apply } = useTheme();
  const [drag, setDrag] = useState(null);
  const box = useRef(null);
  const items = orderedItems(doc, group.items);

  // Where the pointer currently sits, measured against the rows as drawn. Doing
  // this from rectangles rather than from a dragover event is what keeps the
  // indicator correct when the list scrolls under the pointer.
  const indexAt = (clientY) => {
    const rows = [...(box.current?.querySelectorAll('[data-sort-row]') || [])];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length;
  };

  const start = (id) => (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, at: items.findIndex(i => i.id === id) });
  };

  const move = (e) => {
    if (!drag) return;
    const at = indexAt(e.clientY);
    setDrag(d => (d && d.at === at ? d : { ...d, at }));
  };

  const end = () => {
    if (!drag) return;
    const { id, at } = drag;
    setDrag(null);
    const from = items.findIndex(i => i.id === id);
    if (at !== from && at !== from + 1) apply(d => reorder(d, group.items, id, at > from ? at - 1 : at));
  };

  return (
    <div className="bx-sort" ref={box} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      {items.map((it, i) => {
        const cfg = doc.elements?.[it.id];
        return (
          <div key={it.id} data-sort-row className={'bx-sort-slot' + (drag?.at === i ? ' over' : '') + (drag?.id === it.id ? ' lifting' : '')}>
            <Row depth={depth} label={t(it.label)} on={selection?.kind === 'item' && selection.id === it.id}
              hidden={!!cfg?.hidden} count={elementEditCount(cfg)}
              onClick={() => onSelect({ kind: 'item', id: it.id })}
              onToggleHide={() => apply(d => setHidden(d, it.id, !cfg?.hidden))}
              onGripDown={start(it.id)} />
          </div>
        );
      })}
      <div className={'bx-sort-end' + (drag?.at === items.length ? ' over' : '')} />
    </div>
  );
}

function TreeNode({ node, depth, selection, onSelect, open, setOpen, filter }) {
  const { doc, apply } = useTheme();
  const cfg = doc.elements?.[node.id];
  const orderGroup = ORDER_INDEX.get(node.id);
  const expandable = node.children.length > 0 || !!orderGroup;
  const isOpen = open.has(node.id);
  const label = t(node.label);
  const hit = !filter || label.toLowerCase().includes(filter);

  const kids = filter
    ? node.children
    : (isOpen ? node.children : []);

  const show = hit || (filter && hasMatch(node, filter));
  if (!show) return null;

  return (
    <>
      <div className="bx-tree-row">
        {expandable && !filter && (
          <button type="button" className={'bx-twist' + (isOpen ? ' open' : '')} style={{ left: depth * 12 }}
            aria-label={isOpen ? t('Collapse') : t('Expand')}
            onClick={() => setOpen(s => { const n = new Set(s); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; })}>
            <ChevDown />
          </button>
        )}
        <Row depth={depth} label={label} on={selection?.kind === 'element' && selection.id === node.id}
          hidden={!!cfg?.hidden} count={elementEditCount(cfg)}
          onClick={() => onSelect({ kind: 'element', id: node.id })}
          onToggleHide={() => apply(d => setHidden(d, node.id, !cfg?.hidden))} />
      </div>
      {orderGroup && (isOpen || filter) && (
        <div className="bx-sort-wrap">
          <div className="bx-sort-title" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>{t('Order')}</div>
          <SortList group={orderGroup} depth={depth + 1} selection={selection} onSelect={onSelect} />
        </div>
      )}
      {kids.map(k => (
        <TreeNode key={k.id} node={k} depth={depth + 1} selection={selection} onSelect={onSelect}
          open={open} setOpen={setOpen} filter={filter} />
      ))}
    </>
  );
}

function hasMatch(node, filter) {
  if (t(node.label).toLowerCase().includes(filter)) return true;
  return node.children.some(c => hasMatch(c, filter));
}

export function LayersPanel({ selection, onSelect }) {
  const { doc, apply } = useTheme();
  const tree = useMemo(() => elementTree(), []);
  const [open, setOpen] = useState(() => new Set(['app', 'main', 'sidebar', 'sidebarNav', 'centerWrap', 'composerWrap']));
  const [q, setQ] = useState('');
  const filter = q.trim().toLowerCase();

  const added = Object.entries(doc.slots || {});

  return (
    <div className="bx-panel">
      <div className="bx-search">
        <Search />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find an element')} aria-label={t('Find an element')} />
      </div>
      <div className="bx-scroll">
        {tree.map(n => (
          <TreeNode key={n.id} node={n} depth={0} selection={selection} onSelect={onSelect}
            open={open} setOpen={setOpen} filter={filter} />
        ))}
        {!!added.length && (
          <>
            <div className="bx-panel-head">{t('Added elements')}</div>
            {added.map(([slot, nodes]) => (
              <div key={slot}>
                <div className="bx-sort-title">{t(SLOTS.find(s => s.id === slot)?.label || slot)}</div>
                {nodes.map(n => (
                  <div key={n.id} className="bx-tree-row">
                    <Row depth={1} label={t(NODE_INDEX.get(n.type)?.label || n.type)}
                      note={String(n.props?.text || '').slice(0, 18)}
                      on={selection?.kind === 'node' && selection.id === n.id}
                      onClick={() => onSelect({ kind: 'node', id: n.id })} />
                    <button type="button" className="bx-row-eye danger" title={t('Delete')} aria-label={t('Delete')}
                      onClick={() => { apply(d => removeNode(d, slot, n.id)); if (selection?.id === n.id) onSelect(null); }}>
                      <Trash />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Library
--------------------------------------------------------------------------- */

const NODE_CATS = [
  { id: 'layout', label: t('Layout') },
  { id: 'content', label: t('Content') },
  { id: 'controls', label: t('Controls') },
  { id: 'feedback', label: t('Feedback') }
];

export function LibraryPanel({ onSelect }) {
  const { doc, apply } = useTheme();
  const [slot, setSlot] = useState(SLOTS[0].id);
  const [q, setQ] = useState('');
  const filter = q.trim().toLowerCase();

  const add = (type) => {
    const spec = NODE_INDEX.get(type);
    const props = {};
    for (const p of spec?.props || []) if (p.def) props[p.key] = p.def;
    const node = { id: nodeId(), type, props, style: {} };
    apply(d => addNode(d, slot, node));
    onSelect({ kind: 'node', id: node.id });
  };

  return (
    <div className="bx-panel">
      <div className="bx-panel-head">{t('Add to')}</div>
      <div className="bx-pad">
        <select className="bx-select" value={slot} onChange={(e) => setSlot(e.target.value)} aria-label={t('Where to add')}>
          {SLOTS.map(s => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
        </select>
        <p className="bx-hint">{t('Pick a place, then choose what to put there. It appears immediately in the preview and you can style it like anything else.')}</p>
      </div>
      <div className="bx-search">
        <Search />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search elements')} aria-label={t('Search elements')} />
      </div>
      <div className="bx-scroll">
        {NODE_CATS.map(cat => {
          const items = NODE_TYPES.filter(n => n.cat === cat.id && (!filter || t(n.label).toLowerCase().includes(filter)));
          if (!items.length) return null;
          return (
            <div key={cat.id}>
              <div className="bx-panel-head">{cat.label}</div>
              <div className="bx-cards">
                {items.map(n => (
                  <button key={n.type} type="button" className="bx-card" onClick={() => add(n.type)}>
                    <span className="bx-card-ic" aria-hidden="true"><Plus /></span>
                    <span className="bx-card-name">{t(n.label)}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="bx-panel-head">{t('Interface parts')}</div>
        <p className="bx-hint pad">{t('These already exist in the app. Selecting one opens its settings.')}</p>
        {CATEGORIES.map(cat => {
          const items = ELEMENTS.filter(e => e.cat === cat.id && (!filter || t(e.label).toLowerCase().includes(filter)));
          if (!items.length) return null;
          return (
            <div key={cat.id}>
              <div className="bx-sort-title">{t(cat.label)}</div>
              {items.map(e => (
                <Row key={e.id} depth={0} label={t(e.label)} count={elementEditCount(doc.elements?.[e.id])}
                  onClick={() => onSelect({ kind: 'element', id: e.id })} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Design tokens
--------------------------------------------------------------------------- */

// What the preset is currently painting. Showing it beside an unset control is
// the difference between "no value" and "this value, inherited".
function useComputedTokens(doc) {
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const g of TOKEN_GROUPS) for (const tok of g.tokens) out[g.id + '.' + tok.id] = cs.getPropertyValue(tok.var).trim();
    return out;
  }, [doc]);
}

export function TokensPanel() {
  const { doc, apply } = useTheme();
  const computed = useComputedTokens(doc);
  const [open, setOpen] = useState(() => new Set(['color']));
  const toggle = (id) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="bx-panel">
      <div className="bx-pad">
        <p className="bx-hint">{t('These are the values the whole interface is built from. Change one here and every component that uses it follows.')}</p>
      </div>
      <div className="bx-scroll">
        {TOKEN_GROUPS.map(g => (
          <Group key={g.id} title={t(g.label)} open={open.has(g.id)} onToggle={() => toggle(g.id)}
            count={Object.keys(doc.tokens?.[g.id] || {}).length}>
            {g.tokens.map(tok => {
              const kind = tok.kind || g.kind;
              const value = doc.tokens?.[g.id]?.[tok.id] ?? '';
              const set = (v) => apply(d => setPath(d, ['tokens', g.id, tok.id], v), { coalesce: 'token.' + g.id + '.' + tok.id });
              return (
                <Field key={tok.id} label={t(tok.label)} wide={kind === 'color' || kind === 'shadow' || kind === 'fontFamily'}
                  set={!!value} onReset={() => set('')}>
                  {kind === 'color' && <Color value={value} onChange={set} allowTokens={false} inherited={computed[g.id + '.' + tok.id]} />}
                  {kind === 'fontFamily' && (
                    <Select value={value} onChange={set} placeholder={t('Preset default')}
                      options={[
                        { value: "'Newsreader Variable', serif", label: 'Newsreader' },
                        { value: "'Source Serif 4 Variable', serif", label: 'Source Serif' },
                        { value: "'Open Sans', sans-serif", label: 'Open Sans' },
                        { value: 'ui-monospace, monospace', label: 'Monospace' },
                        { value: 'system-ui, sans-serif', label: 'System' }
                      ]} />
                  )}
                  {kind === 'number' && <Num value={value} onChange={set} min={tok.min} max={tok.max} step={tok.step || 1} unit="none" units={['none']} />}
                  {kind === 'size' && <Num value={value || tok.def} onChange={set} min={tok.min ?? 0} max={tok.max ?? 100} units={['px', 'rem', '%']} />}
                  {kind === 'seconds' && <Num value={value || tok.def} onChange={set} min={tok.min} max={tok.max} step={tok.step} unit="s" units={['s', 'ms']} />}
                  {kind === 'easing' && (
                    <Select value={value} onChange={set} placeholder="ease"
                      options={[{ value: 'ease', label: 'Ease' }, { value: 'linear', label: 'Linear' }, { value: 'ease-out', label: 'Ease out' },
                        { value: 'cubic-bezier(.4,0,.2,1)', label: 'Standard' }, { value: 'cubic-bezier(.34,1.56,.64,1)', label: 'Overshoot' }]} />
                  )}
                  {kind === 'shadow' && <Text value={value || tok.def} onChange={set} mono />}
                </Field>
              );
            })}
          </Group>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Interface text
--------------------------------------------------------------------------- */

export function ContentPanel() {
  const { doc, apply } = useTheme();
  const [focus, setFocus] = useState('');
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of CONTENT_KEYS) {
      const g = t(c.group);
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(c);
    }
    return [...m.entries()];
  }, []);

  return (
    <div className="bx-panel">
      <div className="bx-pad">
        <p className="bx-hint">{t('Rename anything the interface says. Leave a field empty to keep the built-in wording, which stays translated.')}</p>
      </div>
      <div className="bx-scroll">
        {groups.map(([label, keys]) => (
          <Group key={label} title={label} open onToggle={() => {}}
            count={keys.filter(k => doc.content?.[k.key]).length}>
            {keys.map(k => (
              <Field key={k.key} label={t(k.label)} wide set={!!doc.content?.[k.key]}
                onReset={() => apply(d => setPath(d, ['content', k.key], ''))}>
                <Text value={doc.content?.[k.key] ?? ''} placeholder={k.def}
                  onChange={(v) => { setFocus(k.key); apply(d => setPath(d, ['content', k.key], v), { coalesce: 'content.' + k.key }); }} />
              </Field>
            ))}
          </Group>
        ))}
        <div className="bx-pad">
          <PlaceholderChips onPick={(tok) => {
            const key = focus || CONTENT_KEYS[0].key;
            apply(d => setPath(d, ['content', key], String(d.content?.[key] || '') + tok));
          }} />
        </div>
      </div>
    </div>
  );
}
