import { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';
import { t } from '../i18n.jsx';

const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(v);
};

export default function CtxGauge({ chatId, modelId, revision, streaming }) {
  const [data, setData] = useState(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!chatId || streaming) return;
    const mine = ++seq.current;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const d = await api.get('/api/chats/' + chatId + '/context?modelId=' + encodeURIComponent(modelId || ''));
        if (!cancelled && mine === seq.current) setData(d && d.limit > 0 ? d : null);
      } catch { if (!cancelled && mine === seq.current) setData(null); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [chatId, modelId, revision, streaming]);

  useEffect(() => { setData(null); }, [chatId]);
  if (!data || !(data.limit > 0)) return null;

  const cap = data.budget > 0 ? data.budget : data.limit;
  const pct = Math.min(100, Math.round((data.used / cap) * 100));
  const level = pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '';
  const title = [
    `${Number(data.used).toLocaleString()} ${t('of')} ${Number(data.limit).toLocaleString()} ${t('context tokens')}`,
    data.reserve > 0 ? `${Number(data.reserve).toLocaleString()} ${t('reserved for the reply')}` : '',
    data.exact ? t('Counted by the model tokenizer') : t('Estimated, this backend has no tokenizer'),
    data.rolling ? t('Older turns are dropped automatically past this point') : ''
  ].filter(Boolean).join('\n');

  return (
    <div className={'ctx-gauge' + level} title={title} role="img" aria-label={title}>
      <span className="cg-bar"><span className="cg-fill" style={{ width: pct + '%' }} /></span>
      <span className="cg-text">{compact(data.used)}<span className="cg-sep">/</span>{compact(data.limit)}</span>
      {!data.exact && <span className="cg-est">~</span>}
    </div>
  );
}
