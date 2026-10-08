import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Chevron, Bulb, Copy, Check, CheckCircle, Clock } from '../ui/icons.jsx';
import { copyText } from '../../lib/clipboard.js';
import { t } from '../../i18n.jsx';
import { parseSteps, lastSentence, thoughtSeconds, LINE_HOLD_MS } from '../../lib/reasoning.js';
import { useLayout } from '../../lib/uselayout.js';

const COLLAPSE_MS = 560;

function thoughtLabel(ms) {
  const secs = thoughtSeconds(ms);
  if (!secs) return t('Thought process');
  if (secs < 60) return secs === 1 ? t('Thought for 1 second') : t('Thought for {n} seconds', { n: secs });
  const mins = Math.round(secs / 60);
  return mins === 1 ? t('Thought for 1 minute') : t('Thought for {n} minutes', { n: mins });
}

const LINE_CAP_PX = 616;
let measureCanvas = null;

function measureText(text, el) {
  measureCanvas = measureCanvas || document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(el);
  measureCanvas.font = cs.font;
  measureCanvas.letterSpacing = cs.letterSpacing;
  return measureCanvas.measureText(text).width;
}

function fitLine(text, el) {
  if (measureText(text, el) <= LINE_CAP_PX) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid).trimEnd() + '…', el) <= LINE_CAP_PX) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

function elapsedLabel(secs) {
  if (secs < 60) return t('{n}s', { n: secs });
  return t('{m}m {s}s', { m: Math.floor(secs / 60), s: secs % 60 });
}

export default function ReasoningBlock({ text, live, durationMs = 0, collapsible = true }) {
  const layout = useLayout();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [line, setLine] = useState({ cur: '', prev: '' });
  const rootRef = useRef(null);
  const animTimer = useRef(null);
  const peekRef = useRef(null);
  const nextLine = useRef('');
  const lineAt = useRef(0);
  const lineTimer = useRef(null);
  const steps = useMemo(() => parseSteps(text), [text]);
  const rolling = layout.reasoning === 'rolling';
  const linesRef = useRef(null);
  const [shown, setShown] = useState('');
  const [lineW, setLineW] = useState(0);
  const [gliding, setGliding] = useState(false);

  useLayoutEffect(() => {
    const el = linesRef.current;
    if (!line.cur || !el) {
      setShown('');
      setLineW(0);
      return;
    }
    const text = fitLine(line.cur, el);
    setShown(text);
    setLineW(Math.min(measureText(text, el) + 4, LINE_CAP_PX + 4));
    setGliding(true);
    const done = setTimeout(() => setGliding(false), 360);
    return () => clearTimeout(done);
  }, [line.cur]);

  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!live) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [live]);

  useEffect(() => {
    if (!rolling) return;
    const s = lastSentence(text);
    if (!s) return;
    nextLine.current = s;
    const show = () => {
      lineTimer.current = null;
      lineAt.current = Date.now();
      setLine(l => (l.cur === nextLine.current ? l : { cur: nextLine.current, prev: l.cur }));
    };
    if (!live) {
      if (lineTimer.current) { clearTimeout(lineTimer.current); lineTimer.current = null; }
      show();
      return;
    }
    if (lineTimer.current) return;
    const wait = lineAt.current ? LINE_HOLD_MS - (Date.now() - lineAt.current) : 0;
    if (wait <= 0) show();
    else lineTimer.current = setTimeout(show, wait);
  }, [text, rolling, live]);

  useEffect(() => () => { if (lineTimer.current) clearTimeout(lineTimer.current); }, []);

  useEffect(() => () => {
    clearTimeout(animTimer.current);
    const host = rootRef.current && rootRef.current.closest('.msg');
    if (host) delete host.dataset.rbAnim;
  }, []);

  useEffect(() => {
    if (!line.prev) return;
    const timer = setTimeout(() => setLine(l => (l.prev ? { cur: l.cur, prev: '' } : l)), 420);
    return () => clearTimeout(timer);
  }, [line]);

  useEffect(() => {
    if (!live || open) return;
    const raf = requestAnimationFrame(() => {
      const el = peekRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [text, live, open]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!text) return null;

  const shim = live ? ' shimmer' : '';
  const headLine = rolling && (live || line.cur) ? (
    <span ref={linesRef} className={'rb-lines' + (gliding ? ' gliding' : '')} style={{ width: lineW }}>
      {line.prev && <span className={'rb-line out' + shim} key={'p' + line.prev}>{line.prev}</span>}
      {!shown && <span className={'rb-label rb-placeholder' + shim}>{t('Thinking…')}</span>}
      {shown && <span className={'rb-line' + shim} key={'c' + shown}>{shown}</span>}
    </span>
  ) : null;

  if (!collapsible) {
    if (!live) return null;
    return (
      <div className={'reasoning live' + (rolling ? ' rolling' : ' carded')}>
        <div className="reasoning-head static live">
          {!rolling && <Bulb className="rb-icon" />}
          {headLine || <span className="rb-label shimmer">{t("Thinking…")}</span>}
        </div>
      </div>
    );
  }

  const carded = live && !rolling;
  const peeking = carded && !open;
  const label = live ? t("Thinking…") : thoughtLabel(durationMs);

  const doCopy = async (e) => {
    e.stopPropagation();
    if (await copyText(text)) setCopied(true);
  };

  const toggle = () => {
    try { window.dispatchEvent(new CustomEvent('oq-release-scroll')); } catch {}
    const host = rootRef.current && rootRef.current.closest('.msg');
    if (host) {
      host.dataset.rbAnim = '1';
      clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => { delete host.dataset.rbAnim; }, COLLAPSE_MS);
    }
    setOpen(o => !o);
  };

  return (
    <div ref={rootRef} className={'reasoning' + (open ? ' open' : '') + (live ? ' live' : '') + (carded ? ' carded' : '') + (rolling ? ' rolling' : '')}>
      <button className={'reasoning-head' + (open ? ' open' : '') + (live ? ' live' : '')}
        onClick={toggle} aria-expanded={open}>
        {live && !rolling && <Bulb className="rb-icon" />}
        {headLine || (!(rolling && live) && <span className={'rb-label' + shim}>{label}</span>)}
        <span className={'rb-meta' + (line.cur || !live ? ' on' : '')}>
          {live && rolling && line.cur && <span className="rb-timer">{elapsedLabel(elapsed)}</span>}
          <Chevron className="chev" />
        </span>
      </button>
      {carded && (
        <div className={'rb-peek' + (peeking ? ' shown' : '')}>
          <div className="rb-peek-in" ref={peekRef}>{text}</div>
        </div>
      )}
      <div className={'reasoning-collapse' + (open ? ' open' : '')}>
        <div className="rb-inner">
          <div className="rb-steps" role="list">
            {steps.map((lines, i) => (
              <div className="rb-step" role="listitem" key={i}>
                {rolling && <Clock className="rb-node" />}
                {lines.map((l, j) => <div className="rb-p" key={j}>{l}</div>)}
              </div>
            ))}
            {rolling && !live && (
              <div className="rb-step rb-done" role="listitem">
                <CheckCircle className="rb-node" />
                <div className="rb-p">{t('Done')}</div>
              </div>
            )}
          </div>
          {!live && (
            <button className="rb-copy" onClick={doCopy} title={copied ? t('Copied') : t('Copy')} aria-label={t('Copy')}>
              {copied ? <Check /> : <Copy />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}