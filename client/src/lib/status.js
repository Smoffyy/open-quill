import { useState, useEffect } from 'react';
import { t } from '../i18n.jsx';

export const STATUS_DELAY_SECS = 5;

export function statusDelayEnabled(v) {
  return v !== false;
}

const compact = (n) => (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Number(n).toLocaleString());

export function useStatusLabel(status, enabled = true) {
  const wait = STATUS_DELAY_SECS * 1000;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!enabled) { setShow(false); return; }
    setShow(false);
    const timer = setTimeout(() => setShow(true), wait);
    return () => clearTimeout(timer);
  }, [wait, enabled]);
  if (!enabled || !status || !show) return { show: false, label: '', detail: '' };

  if (status.phase === 'waiting') {
    const secs = Math.round((status.ms || 0) / 1000);
    return {
      show: true,
      label: t('Waiting for the backend'),
      detail: t('Nothing back yet after {n}s. A local server loading a model can take a while.', { n: secs })
    };
  }

  const total = status.total ? status.total : 0;
  const hasProgress = total > 0;
  const pct = Number.isFinite(status.pct) ? status.pct : null;
  const cached = status.cache ? status.cache : 0;
  const processed = status.total ? Math.max(cached, status.processed || 0) : 0;
  const ms = status.ms ? status.ms : 0;
  const generating = status.phase === 'generating';
  const reusingCache = !generating && cached > 0;
  const label = generating
    ? t('Working')
    : reusingCache
      ? t('Reusing cache') + (pct !== null && hasProgress ? ` ${pct}%` : '')
      : t('Reading your prompt');
  const fresh = processed - cached;
  const eta = (!generating && ms > 400 && fresh > 0 && total > processed)
    ? Math.round((total - processed) / (fresh / (ms / 1000)))
    : 0;

  const parts = [];
  if (hasProgress) parts.push(`${compact(processed)} / ${compact(total)} ${t('tokens')}`);
  if (pct !== null && hasProgress && !reusingCache) parts.push(`${pct}%`);
  if (cached > 0) parts.push(`${Math.round((cached / total) * 100)}% ${t('reused')}`);
  if (eta >= 2) parts.push(`~${eta}s ${t('left')}`);

  return { show: true, label, detail: parts.join(' · ') };
}
