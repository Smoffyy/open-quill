import React, { useEffect, useState } from 'react';
import { Gauge } from './icons.jsx';
import { t } from '../i18n.jsx';

const num = (n) => Number(n || 0).toLocaleString();
const rate = (n) => {
  const v = Number(n || 0);
  if (!v) return '—';
  return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' tok/s';
};

export default function EngineStrip({ telemetry, streaming }) {
  const [show, setShow] = useState(false);
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
      <span className="es-stat es-tps">
        <strong>{rate(tps)}</strong>
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
