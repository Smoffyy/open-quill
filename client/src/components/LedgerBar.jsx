import React, { useEffect, useRef, useState } from 'react';
import { Gauge } from './icons.jsx';
import { t } from '../i18n.jsx';

export default function LedgerBar({ ledger, liveUsed = 0, live = false }) {
  const sentinelRef = useRef(null);
  const barRef = useRef(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const s = sentinelRef.current;
    if (!s || typeof IntersectionObserver === 'undefined') return;
    const root = s.closest('.scroll-area') || null;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { root, threshold: 0 });
    io.observe(s);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const apply = () => document.documentElement.style.setProperty('--ledger-h', Math.round(bar.getBoundingClientRect().height) + 'px');
    apply();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(apply); ro.observe(bar); }
    window.addEventListener('resize', apply);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty('--ledger-h');
    };
  }, []);

  const limit = ledger?.limit || 0;
  const used = liveUsed > 0 ? liveUsed : (ledger?.used || 0);
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const list = ledger?.messages || [];
  const dropped = list.filter(m => m.excluded).length;
  const folded = list.filter(m => m.summarized).length;
  const level = pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '';

  return (
    <>
      <div className="ledger-sentinel" ref={sentinelRef} aria-hidden="true" />
      <div ref={barRef} className={'ledger-head' + level + (stuck ? ' stuck' : '')}>
        <div className="lh-top">
          <span className="lh-title"><Gauge style={{ width: 14 }} /> {t('Context ledger')}</span>
          <span className="lh-total">
            {used.toLocaleString()}{limit ? ' / ' + limit.toLocaleString() : ''} {t('tokens')}
            {limit ? <span className="lh-pct">{pct}%</span> : null}
          </span>
        </div>
        {limit > 0 && <div className="lh-bar"><span className="lh-fill" style={{ width: pct + '%' }} /></div>}
        <div className="lh-notes">
          {ledger?.overhead ? <span>{t('system + instructions')} {ledger.overhead.toLocaleString()}</span> : null}
          {folded ? <span>{folded} {t('folded into summary')}</span> : null}
          {dropped ? <span className="lh-dropped">{dropped} {t('dropped by you')}</span> : null}
          {live && liveUsed > 0 ? <span className="lh-live">{t('live, counted by the model tokenizer')}</span>
            : ledger?.measured ? <span>{t('measured against the model tokenizer')}</span> : <span>{t('estimated')}</span>}
        </div>
      </div>
    </>
  );
}
