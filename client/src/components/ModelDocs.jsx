import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.jsx';
import { Chevron } from './icons.jsx';

const INTEL_LABELS = ['', 'Low', 'Fair', 'Medium', 'High', 'Highest'];
const SPEED_LABELS = ['', 'Slow', 'Steady', 'Medium', 'Fast', 'Fastest'];

const TextGlyph = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8.5 9h7M12 9v6.5" />
  </svg>
);
const ImageGlyph = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" /><circle cx="9" cy="9.2" r="1.6" /><path d="M4.5 17.5l4.6-4.6 3.2 3.2 3-3 4.2 4.3" />
  </svg>
);
const AudioGlyph = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8 10.5v3M11 8.5v7M14 10v4.5M17 9.5v5" />
  </svg>
);
const VideoGlyph = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M7.5 9.5h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM14.5 12l3-1.8v4.6l-3-1.8z" />
  </svg>
);
const GLYPHS = { text: TextGlyph, image: ImageGlyph, audio: AudioGlyph, video: VideoGlyph };
const MODALITY_LABELS = { text: 'Text', image: 'Image', audio: 'Audio', video: 'Video' };

function fmtPrice(v) {
  if (v == null || isNaN(Number(v))) return null;
  const n = Number(v);
  return '$' + (Number.isInteger(n) ? n : n.toFixed(n < 1 ? 2 : 2).replace(/\.?0+$/, '') || n);
}
function fmtTok(n) {
  return Number(n).toLocaleString();
}
function modIcon(m) {
  const src = m.docsIcon || m.staticIcon;
  return src
    ? <img className="mdoc-mico" src={src} alt="" />
    : <span className="mdoc-mico noicon">{(m.displayName || '?').trim().charAt(0).toUpperCase()}</span>;
}

function Modalities({ dirLabel, mods }) {
  const supported = Object.keys(GLYPHS).filter(k => mods[k]);
  const label = supported.map(k => t(MODALITY_LABELS[k])).join(', ') || t('None');
  return (
    <div className="mdoc-meter">
      <div className="mdoc-meter-label">{dirLabel}</div>
      <div className="mdoc-mod-row">
        {Object.entries(GLYPHS).map(([k, G]) => (
          <span key={k} className={'mdoc-mod' + (mods[k] ? ' on' : '')}
            title={mods[k] ? t('{m} supported', { m: t(MODALITY_LABELS[k]) }) : t('{m} not supported', { m: t(MODALITY_LABELS[k]) })}>
            <G />
            {!mods[k] && <span className="mdoc-mod-slash" />}
          </span>
        ))}
      </div>
      <div className="mdoc-meter-val">{label}</div>
    </div>
  );
}

function MeterStrip({ m }) {
  const intel = Math.max(0, Math.min(5, m.docsIntelligence || 0));
  const speed = Math.max(0, Math.min(5, m.docsSpeed || 0));
  const pIn = fmtPrice(m.priceIn), pOut = fmtPrice(m.priceOut);
  return (
    <div className="mdoc-strip">
      {intel > 0 && (
        <div className="mdoc-meter">
          <div className="mdoc-meter-label">{m.capReasoning || m.hasReasoning ? t('Reasoning') : t('Intelligence')}</div>
          <div className="mdoc-dots">{[1, 2, 3, 4, 5].map(i => <span key={i} className={'mdoc-dot' + (i <= intel ? ' on' : '')} />)}</div>
          <div className="mdoc-meter-val">{t(INTEL_LABELS[intel])}</div>
        </div>
      )}
      {speed > 0 && (
        <div className="mdoc-meter">
          <div className="mdoc-meter-label">{t('Speed')}</div>
          <div className="mdoc-bolts">{[1, 2, 3, 4, 5].map(i => i <= speed ? (
            <svg key={i} viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 2.5L5.5 13.4h5l-1.7 8.1 7.7-10.9h-5z" /></svg>
          ) : null)}</div>
          <div className="mdoc-meter-val">{t(SPEED_LABELS[speed])}</div>
        </div>
      )}
      {(pIn || pOut) && (
        <div className="mdoc-meter">
          <div className="mdoc-meter-label">{t('Price')}</div>
          <div className="mdoc-price">{pIn || '—'} <em>·</em> {pOut || '—'}</div>
          <div className="mdoc-meter-val">{t('Input')} · {t('Output')}</div>
        </div>
      )}
      <Modalities dirLabel={t('Input')} mods={m.docsIn || { text: true }} />
      <Modalities dirLabel={t('Output')} mods={m.docsOut || { text: true }} />
    </div>
  );
}

function Compare({ models, self }) {
  const [dir, setDir] = useState('in');
  const key = dir === 'in' ? 'priceIn' : 'priceOut';
  const priced = models.filter(x => x[key] != null && !isNaN(Number(x[key])));
  if (!priced.length || self[key] == null) return null;
  const rows = [self, ...priced.filter(x => x.id !== self.id).slice(0, 7)];
  const max = Math.max(...rows.map(x => Number(x[key]))) || 1;
  return (
    <div className="mdoc-section">
      <div className="mdoc-sec-side">{t('Quick comparison')}</div>
      <div className="mdoc-sec-main">
        <div className="mdoc-cmp-head">
          <button className={dir === 'in' ? 'on' : ''} onClick={() => setDir('in')}>{t('Input')}</button>
          <button className={dir === 'out' ? 'on' : ''} onClick={() => setDir('out')}>{t('Output')}</button>
        </div>
        <div className="mdoc-cmp">
          {rows.map(x => (
            <div key={x.id} className={'mdoc-cmp-row' + (x.id === self.id ? ' self' : '')}>
              <span className="mdoc-cmp-name">{x.displayName}</span>
              <span className="mdoc-cmp-bar"><span style={{ width: Math.max(2, (Number(x[key]) / max) * 100) + '%' }} /></span>
              <span className="mdoc-cmp-val">{fmtPrice(x[key])}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Detail({ m, models, onBack, onTry }) {
  const facts = [];
  if (m.numCtx > 0) facts.push([fmtTok(m.numCtx), t('context window')]);
  if (m.docsMaxOutput > 0) facts.push([fmtTok(m.docsMaxOutput), t('max output tokens')]);
  if (m.docsCutoff) facts.push([m.docsCutoff, t('knowledge cutoff')]);
  const pIn = fmtPrice(m.priceIn), pOut = fmtPrice(m.priceOut);
  return (
    <div className="mdoc-detail">
      <button className="mdoc-back" onClick={onBack}><Chevron style={{ transform: 'rotate(90deg)', width: 15 }} /> {t('Models')}</button>
      <div className="mdoc-head">
        {modIcon(m)}
        <div className="mdoc-head-id">
          <h2>{m.displayName}</h2>
          <div className="mdoc-head-desc">{m.description || ''}</div>
        </div>
        <button className="btn primary mdoc-try" disabled={m.unavailable} onClick={() => onTry(m.id)}>{t('Try now')}</button>
      </div>
      <MeterStrip m={m} />
      <div className="mdoc-about">
        <div className="mdoc-body">
          {(m.docsBody || '').split(/\n\n+/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
          {!m.docsBody && <p className="mdoc-empty-body">{m.description || t('No description yet.')}</p>}
        </div>
        {(facts.length > 0 || m.capReasoning || m.hasReasoning) && (
          <div className="mdoc-facts">
            {facts.map(([v, l]) => <div key={l} className="mdoc-fact"><strong>{v}</strong> {l}</div>)}
            {(m.capReasoning || m.hasReasoning) && <div className="mdoc-fact"><strong>{t('Reasoning token support')}</strong></div>}
          </div>
        )}
      </div>
      {(pIn || pOut) && (
        <div className="mdoc-section">
          <div className="mdoc-sec-side">{t('Pricing')}</div>
          <div className="mdoc-sec-main">
            <div className="mdoc-price-note">{t('Prices are per 1,000,000 tokens, estimated from the rates set by your admin.')}</div>
            <div className="mdoc-price-cards">
              {pIn && <div className="mdoc-price-card"><span>{t('Input')}</span><strong>{pIn}</strong></div>}
              {pOut && <div className="mdoc-price-card"><span>{t('Output')}</span><strong>{pOut}</strong></div>}
            </div>
          </div>
        </div>
      )}
      <Compare models={models} self={m} />
    </div>
  );
}

export default function ModelDocs({ models, currentId, onTry, onClose }) {
  const [sel, setSel] = useState(null);
  const pub = useMemo(() => models.filter(m => !m.removed), [models]);
  const featured = pub.filter(m => m.docsFeatured);
  const selModel = pub.find(m => m.id === sel);
  return createPortal(
    <div className="mdoc-overlay" onMouseDown={(e) => e.target.classList.contains('mdoc-overlay') && onClose()}>
      <div className="mdoc">
        <button className="modal-close" onClick={onClose}>✕</button>
        {selModel ? (
          <Detail m={selModel} models={pub} onBack={() => setSel(null)} onTry={onTry} />
        ) : (
          <div className="mdoc-list">
            <div className="mdoc-list-head">
              <div>
                <h2>{t('All models')}</h2>
                <div className="mdoc-head-desc">{t('Browse all available models and compare their capabilities.')}</div>
              </div>
            </div>
            {featured.length > 0 && (
              <>
                <div className="mdoc-group-head"><strong>{t('Frontier models')}</strong> <span>{t('The most advanced models here, recommended for most tasks.')}</span></div>
                <div className="mdoc-featured">
                  {featured.map(m => (
                    <button key={m.id} className="mdoc-feat-card" onClick={() => setSel(m.id)}>
                      <span className="mdoc-feat-banner" style={m.docsImage ? (/^(https?:|data:|blob:|\/)/i.test(m.docsImage.trim()) ? { backgroundImage: `url("${m.docsImage.trim()}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: m.docsImage }) : undefined}>
                        {!m.docsImage && modIcon(m)}
                      </span>
                      <span className="mdoc-feat-name">{m.displayName}</span>
                      <span className="mdoc-feat-desc">{m.description || ''}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="mdoc-grid">
              {pub.map(m => (
                <button key={m.id} className={'mdoc-row' + (m.id === currentId ? ' current' : '')} onClick={() => setSel(m.id)}>
                  {modIcon(m)}
                  <span className="mdoc-row-meta">
                    <span className="mdoc-row-name">{m.displayName}</span>
                    <span className="mdoc-row-desc">{m.description || ''}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
