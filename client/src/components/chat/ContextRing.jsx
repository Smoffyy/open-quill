import { useEffect, useRef, useState } from 'react';
import Tip from '../ui/Tip.jsx';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';

export default function ContextRing({ chatId, modelId, revision, streaming, live, className = '' }) {
  const [data, setData] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [shift, setShift] = useState(false);
  const modelRef = useRef(modelId);
  modelRef.current = modelId;
  const forced = useRef(false);

  useEffect(() => {
    if (!chatId) { setData(null); setBusy(false); return undefined; }
    if (streaming) return undefined;
    let on = true;
    const now = forced.current;
    forced.current = false;
    const timer = setTimeout(() => {
      const id = modelRef.current || '';
      api.get('/api/chats/' + chatId + '/context?modelId=' + encodeURIComponent(id))
        .then(d => { if (on) setData(d ? { ...d, modelId: id } : null); })
        .catch(() => { if (on) setData(null); })
        .finally(() => { if (on) setBusy(false); });
    }, now ? 0 : 350);
    return () => { on = false; clearTimeout(timer); };
  }, [chatId, revision, streaming, refresh]);

  useEffect(() => {
    if (!hover) return undefined;
    const onKey = (e) => setShift(e.shiftKey);
    const reset = () => setShift(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', reset);
    };
  }, [hover]);

  const canRefresh = !!chatId && !streaming && !busy;
  const onClick = (e) => {
    if (!e.shiftKey || !canRefresh) return;
    forced.current = true;
    setBusy(true);
    setRefresh(n => n + 1);
  };

  const liveUsed = streaming && live && live.used > 0 ? live.used : 0;
  const current = data && data.modelId === (modelId || '') ? data : null;
  const pending = !liveUsed && !!data && (!current || !!current.pending);
  const limit = (current && current.limit) || (live && live.limit) || 0;
  const capTokens = current && current.budget > 0 ? current.budget : limit;
  const used = liveUsed || (current ? current.used : 0);
  const pct = capTokens > 0 ? Math.min(100, Math.round((used / capTokens) * 100)) : 0;
  const summarized = current ? current.summarized || 0 : 0;
  const r = 5;
  const len = 2 * Math.PI * r;
  let label = t('Context: nothing used yet');
  if (busy) label = t('Refreshing context…');
  else if (shift && canRefresh) label = t('Shift+Click to refresh context');
  else if (pending) label = t('Send a message to load context');
  else if (capTokens > 0 && used > 0) label = t('Context: {used} of {limit} tokens ({pct}%)', { used: Number(used).toLocaleString(), limit: Number(limit).toLocaleString(), pct });
  else if (used > 0) label = t('Context: {used} tokens', { used: Number(used).toLocaleString() });
  if (summarized > 0 && !busy && !(shift && canRefresh)) label += ' · ' + t('{n} earlier messages summarized', { n: summarized });
  let cls = 'cx-ring';
  if (className) cls += ' ' + className;
  if (pct >= 90) cls += ' danger';
  else if (pct >= 75) cls += ' warn';
  if (shift && canRefresh) cls += ' armed';
  if (busy) cls += ' busy';

  return (
    <Tip label={label}>
      <span className={cls} role="img" aria-label={label} onClick={onClick}
        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
        onMouseEnter={(e) => { setHover(true); setShift(e.shiftKey); }}
        onMouseMove={(e) => setShift(e.shiftKey)}
        onMouseLeave={() => { setHover(false); setShift(false); }}>
        <svg viewBox="0 0 12 12">
          <circle cx="6" cy="6" r={r} className="cx-ring-track" />
          <circle cx="6" cy="6" r={r} className="cx-ring-fill" strokeDasharray={len} strokeDashoffset={len - (len * pct) / 100} />
        </svg>
      </span>
    </Tip>
  );
}