import { useState, useEffect, useRef, useMemo } from 'react';
import { Chevron, Bulb, Copy, Check, CheckCircle, Clock } from './icons.jsx';
import { copyText } from '../clipboard.js';
import { t } from '../i18n.jsx';
import { parseSteps, lastSentence, thoughtSeconds, LINE_HOLD_MS } from '../lib/reasoning.js';

function thoughtLabel(ms) {
  const secs = thoughtSeconds(ms);
  if (!secs) return t('Thought process');
  if (secs < 60) return secs === 1 ? t('Thought for 1 second') : t('Thought for {n} seconds', { n: secs });
  const mins = Math.round(secs / 60);
  return mins === 1 ? t('Thought for 1 minute') : t('Thought for {n} minutes', { n: mins });
}

export default function ReasoningBlock({ text, live, durationMs = 0, preset = 'anthropic', collapsible = true }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [line, setLine] = useState({ cur: '', prev: '' });
  const peekRef = useRef(null);
  const nextLine = useRef('');
  const lineAt = useRef(0);
  const lineTimer = useRef(null);
  const steps = useMemo(() => parseSteps(text), [text]);
  const rolling = preset !== 'openai';

  useEffect(() => {
    if (!rolling) return;
    const s = lastSentence(text);
    if (!s) return;
    if (!lineAt.current) lineAt.current = Date.now();
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
    const wait = LINE_HOLD_MS - (Date.now() - lineAt.current);
    if (wait <= 0) show();
    else lineTimer.current = setTimeout(show, wait);
  }, [text, rolling, live]);

  useEffect(() => () => { if (lineTimer.current) clearTimeout(lineTimer.current); }, []);

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

  const headLine = rolling && line.cur ? (
    <span className="rb-lines">
      {line.prev && <span className="rb-line out" key={'p' + line.prev}>{line.prev}</span>}
      <span className="rb-line" key={'c' + line.cur}>{line.cur}</span>
    </span>
  ) : null;

  if (!collapsible) {
    if (!live) return null;
    return (
      <div className={'reasoning live' + (rolling ? ' rolling' : ' carded')}>
        <div className="reasoning-head static live">
          {!rolling && <Bulb className="rb-icon" />}
          {headLine || <span className="rb-label">{t("Thinking…")}</span>}
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
    setOpen(o => !o);
  };

  return (
    <div className={'reasoning' + (open ? ' open' : '') + (live ? ' live' : '') + (carded ? ' carded' : '') + (rolling ? ' rolling' : '')}>
      <button className={'reasoning-head' + (open ? ' open' : '') + (live ? ' live' : '')}
        onClick={toggle} aria-expanded={open}>
        {live && !rolling && <Bulb className="rb-icon" />}
        {headLine || <span className="rb-label">{label}</span>}
        <Chevron className="chev" />
      </button>
      {carded && (
        <div className={'rb-peek' + (peeking ? ' shown' : '')}>
          <div className="rb-peek-in" ref={peekRef}>{text}</div>
        </div>
      )}
      <div className={'reasoning-collapse' + (open ? ' open' : '')}>
        <div className="rb-inner">
          <ol className="rb-steps">
            {steps.map((lines, i) => (
              <li className="rb-step" key={i}>
                {rolling && <Clock className="rb-node" />}
                {lines.map((l, j) => <p key={j}>{l}</p>)}
              </li>
            ))}
            {rolling && !live && (
              <li className="rb-step rb-done">
                <CheckCircle className="rb-node" />
                <p>{t('Done')}</p>
              </li>
            )}
          </ol>
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
