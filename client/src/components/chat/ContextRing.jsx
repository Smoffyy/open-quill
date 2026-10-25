import { useEffect, useId, useRef, useState } from 'react';
import { simpleMotion } from '../../lib/motion.js';
import Tip from '../ui/Tip.jsx';
import { api } from '../../lib/api.js';
import { springStep } from '../../lib/liquid.js';
import { t } from '../../i18n.jsx';

const TOP = 1.4;
const SPAN = 9.2;

function fluidPath(level, amp, phase) {
  const surface = TOP + SPAN * (1 - level);
  let d = 'M0 12 L0 ' + surface.toFixed(2);
  for (let x = 0; x <= 12; x += 0.75) d += ' L' + x + ' ' + (surface + Math.sin(phase + x * 1.1) * amp).toFixed(2);
  return d + ' L12 12 Z';
}

function useVessel(target) {
  const path = useRef(null);
  const state = useRef({ level: 0, v: 0, amp: 0, phase: 0 });
  const frame = useRef(0);
  useEffect(() => {
    const s = state.current;
    if (simpleMotion()) {
      s.level = target;
      s.amp = 0;
      if (path.current) path.current.setAttribute('d', fluidPath(s.level, 0, 0));
      return undefined;
    }
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const before = s.level;
      [s.level, s.v] = springStep(s.level, s.v, target, 60, 9, dt);
      s.amp = Math.min(0.9, s.amp * Math.exp(-2.6 * dt) + Math.abs(s.level - before) * 5);
      s.phase += dt * 9;
      if (path.current) path.current.setAttribute('d', fluidPath(s.level, s.amp, s.phase));
      const still = Math.abs(s.level - target) < 0.001 && Math.abs(s.v) < 0.002 && s.amp < 0.02;
      frame.current = still ? 0 : requestAnimationFrame(tick);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target]);
  return path;
}

export default function ContextRing({ chatId, modelId, revision, streaming, live, className = '' }) {
  const [data, setData] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [shift, setShift] = useState(false);
  const modelRef = useRef(modelId);
  modelRef.current = modelId;
  const forced = useRef(false);
  const clip = useId();

  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const replied = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!chatId) { setData(null); setBusy(false); return undefined; }
    if (streaming) return undefined;
    let on = true;
    const now = forced.current;
    forced.current = false;
    const exact = now || replied;
    const timer = setTimeout(() => {
      const id = modelRef.current || '';
      api.get('/api/chats/' + chatId + '/context?modelId=' + encodeURIComponent(id) + (exact ? '&exact=1' : ''))
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
  const fluid = useVessel(pct / 100);
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
          <defs><clipPath id={clip}><circle cx="6" cy="6" r="4.4" /></clipPath></defs>
          <path ref={fluid} className="cx-ring-fluid" clipPath={'url(#' + clip + ')'} d={fluidPath(0, 0, 0)} />
          <circle cx="6" cy="6" r="5" className="cx-ring-glass" />
        </svg>
      </span>
    </Tip>
  );
}