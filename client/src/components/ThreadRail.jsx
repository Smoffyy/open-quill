import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n.jsx';

const TICK = 3;
const GAP_MAX = 6;
const GAP_MIN = 1;
const HUMP_SIGMA = 2.2;
const HUMP_MIN = 0.7;
const HUMP_MAX = 1.7;

const Tick = React.memo(function Tick({ index, cls, label, on, scale }) {
  const style = { height: TICK };
  if (scale != null) style.transform = `scaleX(${scale})`;
  return (
    <button
      type="button"
      data-i={index}
      className={cls}
      style={style}
      aria-label={label}
      aria-current={on ? 'true' : undefined}
    />
  );
});

function ThreadRail({ items, scrollRef, matches, onJump }) {
  const railRef = useRef(null);
  const listRef = useRef(null);
  const [visible, setVisible] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const [gap, setGap] = useState(GAP_MAX);

  const count = items.length;

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !count) { setVisible(new Set()); return; }
    const nodes = Array.from(root.querySelectorAll('[data-mid]'));
    if (!nodes.length) return;
    const live = new Set();
    const io = new IntersectionObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const id = e.target.getAttribute('data-mid');
        if (!id) continue;
        if (e.isIntersecting) { if (!live.has(id)) { live.add(id); changed = true; } }
        else if (live.delete(id)) changed = true;
      }
      if (changed) setVisible(new Set(live));
    }, { root, threshold: 0 });
    nodes.forEach(n => io.observe(n));
    return () => io.disconnect();
  }, [items, scrollRef, count]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !count) return;
    const recompute = () => {
      const h = rail.clientHeight;
      if (!h) return;
      const room = h - count * TICK;
      const next = count > 1 ? Math.floor(room / (count - 1)) : GAP_MAX;
      setGap(Math.max(GAP_MIN, Math.min(GAP_MAX, Number.isFinite(next) ? next : GAP_MAX)));
    };
    recompute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(recompute);
    ro.observe(rail);
    return () => ro.disconnect();
  }, [count]);

  const firstVisible = useMemo(() => {
    for (let i = 0; i < items.length; i++) if (visible.has(items[i].id)) return i;
    return -1;
  }, [items, visible]);

  const scales = useMemo(() => {
    if (firstVisible < 0) return null;
    return items.map((_, i) => {
      const d = i - firstVisible;
      const hump = Math.exp(-(d * d) / (2 * HUMP_SIGMA * HUMP_SIGMA));
      return HUMP_MIN + (HUMP_MAX - HUMP_MIN) * hump;
    });
  }, [items, firstVisible]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || firstVisible < 0) return;
    const el = list.children[firstVisible];
    if (el && list.scrollHeight > list.clientHeight + 2) el.scrollIntoView({ block: 'nearest' });
  }, [firstVisible]);

  const labels = useMemo(() => items.map(it => {
    const parts = [it.role === 'user' ? t('You') : t('Assistant')];
    if (it.branchCount > 1) parts.push(t('version {n} of {total}', { n: it.branchIndex + 1, total: it.branchCount }));
    if (it.tool) parts.push(t('used a tool'));
    if (it.pinned) parts.push(t('pinned'));
    return parts.join(', ') + (it.preview ? ': ' + it.preview : '');
  }), [items]);

  const idxOf = (e) => {
    const el = e.target.closest('[data-i]');
    return el ? Number(el.getAttribute('data-i')) : null;
  };
  const onOver = useCallback((e) => { const i = idxOf(e); if (i !== null) setHover(i); }, []);
  const onOut = useCallback((e) => { const i = idxOf(e); if (i !== null) setHover(h => (h === i ? null : h)); }, []);
  const onClick = useCallback((e) => { const i = idxOf(e); if (i !== null && items[i]) onJump(items[i].id); }, [items, onJump]);

  if (count < 4) return null;

  return (
    <nav className="trail" ref={railRef} aria-label={t('Conversation map')}>
      <div className="trail-list" ref={listRef} style={{ gap: gap + 'px' }}
        onMouseOver={onOver} onMouseOut={onOut} onFocus={onOver} onBlur={onOut} onClick={onClick}>
        {items.map((it, i) => {
          const on = visible.has(it.id);
          const cls = ['trail-tick', 'r-' + it.role];
          if (on) cls.push('in-view');
          if (it.tool) cls.push('is-tool');
          if (it.branch) cls.push('is-branch');
          if (it.pinned) cls.push('is-pinned');
          if (it.excluded) cls.push('is-out');
          if (matches && matches.has(it.id)) cls.push('is-match');
          return <Tick key={it.id} index={i} cls={cls.join(' ')} label={labels[i]} on={on} scale={scales ? scales[i] : null} />;
        })}
      </div>
      {hover !== null && items[hover] && (
        <div className="trail-tip" style={{ top: tipTop(listRef.current, hover) }}>
          <span className="trail-tip-who">{items[hover].role === 'user' ? t('You') : t('Assistant')}</span>
          {items[hover].preview && <span className="trail-tip-text">{items[hover].preview}</span>}
          {items[hover].branchCount > 1 && <span className="trail-tip-meta">{items[hover].branchIndex + 1}/{items[hover].branchCount}</span>}
        </div>
      )}
    </nav>
  );
}

function tipTop(list, index) {
  if (!list || !list.children[index]) return 0;
  const el = list.children[index];
  const mid = el.offsetTop - list.scrollTop + el.offsetHeight / 2;
  return Math.max(10, Math.min(mid, list.clientHeight - 10));
}

export default React.memo(ThreadRail);
