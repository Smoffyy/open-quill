import { useState } from 'react';
import { t } from '../../../i18n.jsx';
import { valueOf, lineDiff } from '../../../lib/changeset.js';
import { MODEL_FIELDS, SETTINGS, SETTING_DETAIL, THEME_FIELDS } from './labels.js';

export function fieldLabel(c) {
  if (c.scope === 'model') {
    if (c.kind === 'order') return t('Order');
    if (!c.field) return c.kind === 'create' ? t('New model') : t('Removed from the catalog');
    return MODEL_FIELDS[c.field] ? t(MODEL_FIELDS[c.field]) : c.field;
  }
  if (c.scope === 'theme') {
    if (!c.field) return c.kind === 'create' ? t('New theme') : t('Theme deleted');
    return THEME_FIELDS[c.field] ? t(THEME_FIELDS[c.field]) : c.field;
  }
  const base = SETTINGS[c.target] ? t(SETTINGS[c.target]) : c.target;
  return SETTING_DETAIL[c.target] ? base + ' ' + SETTING_DETAIL[c.target] : base;
}

function summary(c) {
  if (c.kind === 'order') return t('The catalog was reordered.');
  if (c.scope === 'theme' && c.field === 'doc') return c.count === 1 ? t('1 style change') : t('{n} style changes', { n: c.count || 0 });
  if (c.scope === 'theme' && c.kind === 'create') return c.after?.name || '';
  if (c.scope === 'theme' && c.kind === 'delete') return c.before?.name || '';
  if (c.scope === 'model' && !c.field) return c.kind === 'create' ? t('Members will see it once published.') : t('Members lose access once published.');
  return null;
}

function Value({ v }) {
  if (v.kind === 'hidden') return <span className="ch-val dim">{t('hidden')}</span>;
  if (v.kind === 'empty') return <span className="ch-val dim">{t('empty')}</span>;
  if (v.kind === 'flag') return <span className="ch-val">{v.on ? t('On') : t('Off')}</span>;
  if (v.kind === 'list') {
    const text = v.items.join(', ');
    return <span className="ch-val" data-tip={text}>{text}</span>;
  }
  return <span className="ch-val" data-tip={v.text}>{v.text}</span>;
}

function Diff({ before, after }) {
  return (
    <pre className="ch-diff" aria-label={t('Line by line comparison')}>
      {lineDiff(before, after).map((l, i) => (
        <span key={i} className={'ch-diff-' + l.op}>
          <i aria-hidden="true">{l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '}</i>
          {l.op === 'add' && <span className="sr-only">{t('added')} </span>}
          {l.op === 'del' && <span className="sr-only">{t('removed')} </span>}
          {l.text || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

export function ChangeRow({ change: c, checked, onToggle, label, ago }) {
  const [open, setOpen] = useState(false);
  const said = summary(c);
  const before = said == null ? valueOf(c, 'before') : null;
  const after = said == null ? valueOf(c, 'after') : null;
  const long = before?.kind === 'long' || after?.kind === 'long';
  const by = (c.authors || []).map(a => a.name).filter(Boolean).join(', ');

  return (
    <li className={'ch-row' + (onToggle ? (checked ? '' : ' off') : ' bare')}>
      {onToggle && <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} aria-label={label} />}
      <div className="ch-main">
        <div className="ch-line">
          <span className="ch-field">{label}</span>
          {said != null ? <span className="ch-val dim">{said}</span> : (
            <span className="ch-vals">
              <Value v={before} />
              <span className="ch-arrow" aria-label={t('changed to')}>→</span>
              <Value v={after} />
            </span>
          )}
          {long && (
            <button type="button" className="linklike ch-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>
              {open ? t('Hide comparison') : t('Compare')}
            </button>
          )}
        </div>
        {open && long && <Diff before={before.text ?? ''} after={after.text ?? ''} />}
      </div>
      <span className="ch-meta">{[by || (onToggle ? t('Unattributed') : ''), ago].filter(Boolean).join(' · ')}</span>
    </li>
  );
}