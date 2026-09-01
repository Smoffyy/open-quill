import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { t } from '../../i18n.jsx';
import { useTheme } from '../../lib/theme/store.jsx';
import { ELEMENTS, ELEMENT_INDEX, ORDER_GROUPS, NODE_INDEX } from '../../lib/theme/schema.js';
import { orderedItems, reorder, findNode, getPath, setPath, stylePath } from '../../lib/theme/ops.js';

/* Selection works against the running DOM rather than the React tree: build mode
   walks up from whatever is under the pointer and stops at the first node the
   registry knows a name for. That is what lets an admin click a real button in a
   real conversation and get its inspector, without every component having to
   carry a builder prop. */

/* Build mode swallows pointer events over the canvas so a click selects instead
   of pressing a real button. Dialogs and popovers portal to document.body, which
   put them outside #oq-builder and got their own clicks eaten. Anything the
   builder draws carries one of these markers. */
const BUILDER_ROOT = '#oq-builder, [data-oq-builder]';

// Deepest match wins, so clicking a nav label selects the label rather than the
// sidebar that contains it.
const TARGETS = (() => {
  const rows = [];
  for (const el of ELEMENTS) rows.push({ id: el.id, kind: 'element', sel: el.sel, label: el.label });
  for (const g of ORDER_GROUPS) for (const it of g.items) rows.push({ id: it.id, kind: 'item', sel: it.sel, label: it.label, group: g.id });
  return rows;
})();

const ITEM_TARGETS = TARGETS.filter(x => x.kind === 'item');

function matches(node, target) {
  for (const one of target.sel.split(',')) {
    const sel = one.trim();
    if (!sel) continue;
    try { if (node.matches(sel)) return true; } catch { /* a selector the browser rejects is simply not a target */ }
  }
  return false;
}

// Clicking selects the registry element, because styling "every navigation item"
// is the common intent. Dragging moves the one item under the pointer, which is
// a different question asked of the same node.
export function itemAt(node) {
  let el = node;
  while (el && el !== document.body) {
    const hit = ITEM_TARGETS.find(target => matches(el, target));
    if (hit) return hit;
    el = el.parentElement;
  }
  return null;
}

function matchAt(node) {
  for (const target of TARGETS) {
    for (const one of target.sel.split(',')) {
      const sel = one.trim();
      if (!sel) continue;
      try { if (node.matches(sel)) return target; } catch { /* a selector the browser rejects is simply not a target */ }
    }
  }
  return null;
}

export function hitTest(x, y) {
  const start = document.elementFromPoint(x, y);
  if (!start || start.closest(BUILDER_ROOT)) return null;
  let node = start;
  while (node && node !== document.body) {
    const hit = matchAt(node);
    if (hit) return { ...hit, el: node };
    node = node.parentElement;
  }
  return null;
}

export function findElementNode(target) {
  if (!target) return null;
  const meta = target.kind === 'element' ? ELEMENT_INDEX.get(target.id) : null;
  const sel = meta ? meta.sel : target.sel;
  if (!sel) return null;
  for (const one of sel.split(',')) {
    try {
      const found = document.querySelector(one.trim());
      if (found && !found.closest(BUILDER_ROOT)) return found;
    } catch { /* ignore */ }
  }
  return null;
}

function rectOf(node) {
  if (!node || !node.isConnected) return null;
  const r = node.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function Box({ rect, label, kind, onResize }) {
  if (!rect) return null;
  const flip = rect.top < 24;
  return (
    <div className={'bx-outline ' + kind} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}>
      <span className={'bx-outline-tag' + (flip ? ' below' : '')}>{label}</span>
      {onResize && ['e', 's', 'se'].map(dir => (
        <span key={dir} className={'bx-handle ' + dir} onPointerDown={onResize(dir)} role="presentation" />
      ))}
    </div>
  );
}

export default function Overlay({ selection, onSelect, interact, tool = 'all' }) {
  const { doc, apply, endStroke } = useTheme();
  const [hover, setHover] = useState(null);
  const [drag, setDrag] = useState(null);
  const [tick, setTick] = useState(0);
  const press = useRef(null);
  const dragRef = useRef(null);
  const docRef = useRef(doc);
  const applyRef = useRef(apply);
  const endStrokeRef = useRef(endStroke);
  useEffect(() => { docRef.current = doc; applyRef.current = apply; endStrokeRef.current = endStroke; }, [doc, apply, endStroke]);

  // Rectangles follow the app: a sidebar that collapses or a menu that opens
  // moves the outline with it instead of leaving it stranded.
  useEffect(() => {
    const bump = () => setTick(n => n + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(document.body);
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    const id = setInterval(bump, 500);
    return () => { ro.disconnect(); window.removeEventListener('scroll', bump, true); window.removeEventListener('resize', bump); clearInterval(id); };
  }, []);

  const onMove = useCallback((e) => {
    if (interact) { setHover(null); return; }
    if (drag) return;
    const hit = hitTest(e.clientX, e.clientY);
    setHover(prev => (prev?.id === hit?.id && prev?.el === hit?.el ? prev : hit));
  }, [interact, drag]);

  /* One gesture, read differently depending on the active tool.

     A press that travels far enough becomes a drag; anything shorter stays a
     click, so selecting never costs an accidental layout change. Which drag it
     is depends on the tool: Move always nudges an element to where the pointer
     puts it, while the combined tool reorders items that live in a known flow
     and nudges everything else, because reordering a nav item is almost always
     what someone means when they drag one.

     The gesture is tracked in refs because the listeners are bound once: reading
     drag state out of a closure would hand mouseup a stale value. */
  useEffect(() => {
    if (interact || tool === 'resize') return undefined;

    const down = (e) => {
      if (e.oqPass || e.target.closest?.(BUILDER_ROOT)) return;
      const hit = hitTest(e.clientX, e.clientY);
      press.current = hit
        ? { hit, item: itemAt(hit.el), x: e.clientX, y: e.clientY, moved: false }
        : null;
      e.preventDefault();
      e.stopPropagation();
    };

    const move = (e) => {
      const p = press.current;
      if (!p) { onMove(e); return; }
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
      if (tool === 'select') return;
      p.moved = true;

      const group = p.item ? ORDER_GROUPS.find(g => g.id === p.item.group) : null;
      if (group && tool === 'all') {
        const rows = dragRef.current?.rows || siblingRects(docRef.current, group);
        const next = { kind: 'order', group, id: p.item.id, at: dropIndex(rows, e.clientX, e.clientY), rows };
        dragRef.current = next;
        setDrag(next);
        return;
      }

      // Free move. Shift locks to the axis the pointer has travelled furthest
      // along, which is how straightening something up usually goes.
      const id = p.hit.kind === 'element' ? p.hit.id : p.item?.id || p.hit.id;
      let dx = e.clientX - p.x;
      let dy = e.clientY - p.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const path = stylePath(id);
      const origin = dragRef.current?.origin || readOffset(docRef.current, path);
      const left = Math.round(origin.left + dx);
      const top = Math.round(origin.top + dy);
      dragRef.current = { kind: 'move', id, origin, left, top };
      setDrag(dragRef.current);
      applyRef.current(d => {
        // Relative keeps the element in the flow, so nudging one thing does not
        // collapse the layout around it. Absolute is a deliberate choice made in
        // the inspector, and is left alone if it is already set.
        const pos = getPath(d, [...path, 'position']);
        if (pos !== 'absolute' && pos !== 'fixed') setPath(d, [...path, 'position'], 'relative');
        setPath(d, [...path, 'left'], left + 'px');
        setPath(d, [...path, 'top'], top + 'px');
        return d;
      }, { coalesce: 'move.' + id });
    };

    const up = (e) => {
      if (e.oqPass) return;
      const p = press.current;
      const d = dragRef.current;
      press.current = null;
      dragRef.current = null;
      setDrag(null);
      endStrokeRef.current();
      if (e.target.closest?.(BUILDER_ROOT)) return;
      e.preventDefault();
      e.stopPropagation();
      if (p && p.moved && d) {
        if (d.kind === 'order') {
          const from = orderedItems(docRef.current, d.group.items).findIndex(i => i.id === d.id);
          if (d.at !== from && d.at !== from + 1) {
            applyRef.current(doc => reorder(doc, d.group.items, d.id, d.at > from ? d.at - 1 : d.at));
          }
          onSelect({ kind: 'item', id: d.id });
        } else {
          onSelect({ kind: 'element', id: d.id });
        }
        return;
      }
      const hit = hitTest(e.clientX, e.clientY);
      onSelect(hit ? { kind: hit.kind, id: hit.id } : null);
    };

    const swallow = (e) => { if (!e.oqPass && !e.target.closest?.(BUILDER_ROOT)) { e.preventDefault(); e.stopPropagation(); } };

    document.addEventListener('mousemove', move, true);
    document.addEventListener('mousedown', down, true);
    document.addEventListener('mouseup', up, true);
    document.addEventListener('click', swallow, true);
    return () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('mouseup', up, true);
      document.removeEventListener('click', swallow, true);
    };
  }, [onMove, onSelect, interact, tool]);

  // Arrow keys nudge whatever is selected, which is finer than any drag and the
  // only way to move something by exactly one pixel.
  useEffect(() => {
    if (interact || !selection || selection.kind === 'node') return undefined;
    const STEPS = { __proto__: null, ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const onKey = (e) => {
      const bump = STEPS[e.key];
      if (!bump) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      const size = e.shiftKey ? 10 : 1;
      const path = stylePath(selection.id);
      applyRef.current(d => {
        const at = readOffset(d, path);
        const pos = getPath(d, [...path, 'position']);
        if (pos !== 'absolute' && pos !== 'fixed') setPath(d, [...path, 'position'], 'relative');
        setPath(d, [...path, 'left'], Math.round(at.left + bump[0] * size) + 'px');
        setPath(d, [...path, 'top'], Math.round(at.top + bump[1] * size) + 'px');
        return d;
      }, { coalesce: 'nudge.' + selection.id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, interact]);

  const selRect = useMemo(() => {
    void tick;
    if (!selection) return null;
    if (selection.kind === 'node') {
      const node = document.querySelector(`[data-oq-node="${CSS.escape(selection.id)}"]`);
      return rectOf(node);
    }
    return rectOf(findElementNode(selection));
  }, [selection, tick]);

  const hoverRect = useMemo(() => { void tick; return hover ? rectOf(hover.el) : null; }, [hover, tick]);

  const selLabel = selection ? t(labelFor(selection, doc)) : '';

  // Dragging a handle writes width and height straight into the document, so the
  // number in the inspector and the box on screen are always the same fact.
  const startResize = (dir) => (e) => {
    if (!selRect) return;
    e.preventDefault();
    e.stopPropagation();
    const from = { x: e.clientX, y: e.clientY, w: selRect.width, h: selRect.height };
    const path = stylePath(selection.id);
    const onMove = (ev) => {
      const w = Math.max(8, Math.round(from.w + (ev.clientX - from.x)));
      const h = Math.max(8, Math.round(from.h + (ev.clientY - from.y)));
      applyRef.current(d => {
        if (dir !== 's') setPath(d, [...path, 'width'], w + 'px');
        if (dir !== 'e') setPath(d, [...path, 'height'], h + 'px');
        return d;
      }, { coalesce: 'resize.' + selection.id });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className={'bx-overlay' + (drag ? ' dragging' : '')} aria-hidden="true">
      {!interact && !drag && hover && (!selection || hover.id !== selection.id) && (
        <Box rect={hoverRect} label={t(hover.label)} kind="hover" />
      )}
      {selection && !drag && (
        <Box rect={selRect} label={selLabel} kind="sel"
          onResize={selection.kind === 'element' && (tool === 'all' || tool === 'resize') ? startResize : null} />
      )}
      {drag?.kind === 'order' && <DropLine rows={drag.rows} at={drag.at} />}
      {drag?.kind === 'move' && selRect && (
        <div className="bx-moved" style={{ top: selRect.top - 22, left: selRect.left }}>
          {drag.left}, {drag.top}
        </div>
      )}
    </div>
  );
}

function labelFor(sel, doc) {
  if (sel.kind === 'element') return ELEMENT_INDEX.get(sel.id)?.label || sel.id;
  if (sel.kind === 'node') {
    const hit = findNode(doc, sel.id);
    return NODE_INDEX.get(hit?.node?.type)?.label || sel.id;
  }
  if (sel.kind === 'item') {
    for (const g of ORDER_GROUPS) {
      const hit = g.items.find(i => i.id === sel.id);
      if (hit) return hit.label;
    }
  }
  return sel.id;
}

function readOffset(doc, path) {
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  return { left: num(getPath(doc, [...path, 'left'])), top: num(getPath(doc, [...path, 'top'])) };
}

// The rectangles of one order group's siblings, in the order they are painted.
function siblingRects(doc, group) {
  return orderedItems(doc, group.items)
    .map(it => {
      const node = document.querySelector(it.sel);
      const rect = node && !node.closest(BUILDER_ROOT) ? rectOf(node) : null;
      return rect ? { id: it.id, rect } : null;
    })
    .filter(Boolean);
}

// Which gap the pointer is nearest. Rows stacked vertically split on the middle
// of each row; a horizontal toolbar splits on the middle of each column.
function dropIndex(rows, x, y) {
  if (!rows.length) return 0;
  const horizontal = rows.length > 1 && Math.abs(rows[1].rect.left - rows[0].rect.left) > Math.abs(rows[1].rect.top - rows[0].rect.top);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].rect;
    const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
    if ((horizontal ? x : y) < mid) return i;
  }
  return rows.length;
}

function DropLine({ rows, at }) {
  if (!rows.length) return null;
  const horizontal = rows.length > 1 && Math.abs(rows[1].rect.left - rows[0].rect.left) > Math.abs(rows[1].rect.top - rows[0].rect.top);
  const ref = rows[Math.min(at, rows.length - 1)].rect;
  const after = at >= rows.length;
  const style = horizontal
    ? { top: ref.top, height: ref.height, left: (after ? ref.left + ref.width : ref.left) - 1, width: 2 }
    : { left: ref.left, width: ref.width, top: (after ? ref.top + ref.height : ref.top) - 1, height: 2 };
  return <div className="bx-dropline" style={style} />;
}
