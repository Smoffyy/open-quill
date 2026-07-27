import React, { useState, useEffect, useCallback } from 'react';
import { subscribeLightbox } from '../lightbox.js';

export default function Lightbox() {
  const [img, setImg] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => { setImg(null); setLeaving(false); }, 220);
  }, []);
  useEffect(() => subscribeLightbox((d) => { setLeaving(false); setImg(d); }), []);
  useEffect(() => {
    if (!img) return;
    const h = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [img, close]);
  if (!img) return null;
  return (
    <div className={'lightbox' + (leaving ? ' leaving' : '')} onClick={close}>
      <img src={img.src} alt={img.alt} onClick={(e) => e.stopPropagation()} />
      <a className="lightbox-open" href={img.src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open original ↗</a>
      <button className="lightbox-x" onClick={close}>✕</button>
    </div>
  );
}
