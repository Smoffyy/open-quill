import React, { useEffect, useState } from 'react';
import { Gauge } from './icons.jsx';
import { t } from '../i18n.jsx';

const num = (n) => Number(n || 0).toLocaleString();
const rate = (n) => {
  const v = Number(n || 0);
  if (!v) return '—';
  return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' tok/s';
};

function Sparkline({ points }) {
  if (points.length < 3) return null;
  const max = Math.max(...points, 1);
  const w = 54, h = 14;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - (p / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return (
    <svg className="es-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function EngineStrip({ telemetry, streaming, route }) {
  const [show, setShow] = useState(false);
  const [history, setHistory] = useState([]);
  useEffect(() => {
    if (!streaming) return;
    const v = Number(telemetry?.tps || 0);
    if (!v) return;
    setHistory(h => (h.length > 47 ? [...h.slice(-47), v] : [...h, v]));
  }, [telemetry?.tps, streaming]);
  useEffect(() => { if (streaming && history.length && !telemetry) setHistory([]); }, [streaming]);
  useEffect(() => {
    if (streaming && telemetry) { setShow(true); return; }
    if (!telemetry) { setShow(false); return; }
    const timer = setTimeout(() => setShow(false), 5000);
    return () => clearTimeout(timer);
  }, [streaming, telemetry]);
  if (!show || !telemetry) return null;
  const { tps, promptTps, promptTokens, genTokens, ctx, exact } = telemetry;
  const used = (promptTokens || 0) + (genTokens || 0);
  const pct = ctx > 0 ? Math.min(100, Math.round((used / ctx) * 1000) / 10) : 0;
  const level = pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '';
  return (
    <div className={'engine-strip' + (streaming ? '' : ' final')} role="status" aria-live="off">
      <span className="es-icon"><Gauge style={{ width: 13 }} /></span>
      {route && (
        <span className="es-stat es-route" title={t('Chosen by {hub} because of: {via}', { hub: route.hubName, via: route.via })}>
          <span className="es-label">{t('via')}</span> {route.modelName}
        </span>
      )}
      <span className="es-stat es-tps">
        <strong>{rate(tps)}</strong>
        <Sparkline points={history} />
        {!exact && <span className="es-est" title={t('Estimated from streamed text, this provider does not report timings.')}>est</span>}
      </span>
      {promptTps > 0 && (
        <span className="es-stat" title={t('Prompt evaluation speed')}>
          <span className="es-label">{t('prompt')}</span> {rate(promptTps)}
        </span>
      )}
      <span className="es-stat" title={t('Tokens generated in this response')}>
        <span className="es-label">{t('out')}</span> {num(genTokens)}
      </span>
      {ctx > 0 && (
        <span className={'es-stat es-ctx' + level} title={t('Context used of the loaded window')}>
          <span className="es-label">{t('ctx')}</span>
          <span className="es-bar"><span className="es-fill" style={{ width: pct + '%' }} /></span>
          {pct}%
        </span>
      )}
    </div>
  );
}
