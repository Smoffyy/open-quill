import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n.jsx';

const TICK = 5;
const GAP_MAX = 6;
const GAP_MIN = 1;

export default function ThreadRail({ items, scrollRef, matches, onJump }) {
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

  useEffect(() => {
    const list = listRef.current;
    if (!list || firstVisible < 0) return;
    const el = list.children[firstVisible];
    if (el && list.scrollHeight > list.clientHeight + 2) el.scrollIntoView({ block: 'nearest' });
  }, [firstVisible]);

  if (count < 4) return null;

  const label = (it) => {
    const who = it.role === 'user' ? t('You') : t('Assistant');
    const parts = [who];
    if (it.branchCount > 1) parts.push(t('version {n} of {total}', { n: it.branchIndex + 1, total: it.branchCount }));
    if (it.tool) parts.push(t('used a tool'));
    if (it.pinned) parts.push(t('pinned'));
    return parts.join(', ') + (it.preview ? ': ' + it.preview : '');
  };

  return (
    <nav className="trail" ref={railRef} aria-label={t('Conversation map')}>
      <div className="trail-list" ref={listRef} style={{ gap: gap + 'px' }}>
        {items.map((it, i) => {
          const on = visible.has(it.id);
          const cls = ['trail-tick', 'r-' + it.role];
          if (on) cls.push('in-view');
          if (it.tool) cls.push('is-tool');
          if (it.branch) cls.push('is-branch');
          if (it.pinned) cls.push('is-pinned');
          if (it.excluded) cls.push('is-out');
          if (matches && matches.has(it.id)) cls.push('is-match');
          return (
            <button
              key={it.id}
              type="button"
              className={cls.join(' ')}
              style={{ height: TICK }}
              aria-label={label(it)}
              aria-current={on ? 'true' : undefined}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(h => (h === i ? null : h))}
              onClick={() => onJump(it.id)}
            />
          );
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
