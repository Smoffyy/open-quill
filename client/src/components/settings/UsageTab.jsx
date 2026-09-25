import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';
import { SegSlide } from '../ui/controls.jsx';
import { Skel, SkelStats } from '../ui/Skeleton.jsx';

const fmtN = (n) => Number(n || 0).toLocaleString();
const fmtUsd = (n) => {
  const v = Number(n || 0);
  if (!v) return '$0.00';
  return '$' + (v < 0.01 ? v.toFixed(6) : v.toFixed(4));
};

export default function UsageTab() {
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setErr(''); setData(null);
    const q = range === 'all' ? '' : '?days=' + range;
    api.get('/api/me/usage' + q)
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(t('Could not load usage.')); });
    return () => { alive = false; };
  }, [range]);

  const totals = data?.totals;
  const tiles = totals ? [
    [t('Total tokens'), fmtN(totals.total)],
    [t('Input'), fmtN(totals.prompt)],
    [t('Output'), fmtN(totals.completion)],
    [t('Est. cost'), totals.cost ? fmtUsd(totals.cost) : (totals.costKnown ? '$0.00' : '-')]
  ] : [];

  return (
    <>
      <div className="hint">{t("Tokens and estimated cost for your account, across every chat.")}</div>
      <div className="usage-range">
        <SegSlide label={t("Usage window")} value={range} onPick={setRange}
          options={[{ v: '7', label: t('7 days') }, { v: '30', label: t('30 days') }, { v: '90', label: t('90 days') }, { v: 'all', label: t('All time') }]} />
      </div>
      <div className="dz-err" role="alert">{err}</div>
      {!data && !err && <Skel when><SkelStats count={3} /></Skel>}
      {data && (
        <>
          <div className="usage-tiles">
            {tiles.map(([label, value]) => (
              <div key={label} className="usage-tile">
                <div className="ut-val">{value}</div>
                <div className="ut-lbl">{label}</div>
              </div>
            ))}
          </div>
          <div className="usage-count">
            {totals.generations === 1
              ? t('{n} generation in this window.', { n: fmtN(totals.generations) })
              : t('{n} generations in this window.', { n: fmtN(totals.generations) })}
          </div>
          {data.models.length === 0 ? (
            <div className="muted-note">{t("No usage recorded yet. Token counts appear here after you chat with a model whose backend reports usage.")}</div>
          ) : (
            <>
              <div className="me-section-h">{t("By model")}</div>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Model')}</th>
                    <th scope="col" className="num">{t('Input')}</th>
                    <th scope="col" className="num">{t('Output')}</th>
                    <th scope="col" className="num">{t('Cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m, i) => (
                    <tr key={m.modelId || i}>
                      <td>{m.modelName}</td>
                      <td className="num">{fmtN(m.prompt)}</td>
                      <td className="num">{fmtN(m.completion)}</td>
                      <td className="num">{m.priced ? fmtUsd(m.cost) : <span className="muted-note">{t('no price')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="muted-note usage-foot">{t('Cost is estimated from per-model prices set by your admin. Models marked no price are local or free, so no cost is counted. Token counts come from your model backend and may be unavailable for some providers.')}</div>
        </>
      )}
    </>
  );
}
