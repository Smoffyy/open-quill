import React, { useState, useEffect, useCallback } from 'react';
import { subscribe } from '../toast.js';
import { Check, Pin, Fork, Star, Copy, Sliders } from './icons.jsx';

const ICONS = { check: Check, pin: Pin, fork: Fork, star: Star, copy: Copy, sliders: Sliders };

export default function Toaster() {
  const [items, setItems] = useState([]);
  const remove = useCallback((id) => {
    setItems(list => list.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), 280);
  }, []);
  useEffect(() => subscribe((t) => {
    setItems(list => [...list.slice(-3), t]);
    setTimeout(() => remove(t.id), t.duration);
  }), [remove]);
  if (!items.length) return null;
  return (
    <div className="toaster">
      {items.map(t => {
        const Ico = t.icon && ICONS[t.icon];
        return (
          <div key={t.id} className={'toast' + (t.leaving ? ' leaving' : '') + (t.kind ? ' ' + t.kind : '')} onClick={() => remove(t.id)}>
            {Ico && <span className="toast-ico"><Ico style={{ width: 15 }} /></span>}
            <span className="toast-msg">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
