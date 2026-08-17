import { t } from '../i18n.jsx';

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function safeHref(url) {
  const u = String(url || '').trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  return null;
}

export function renderDisclaimer(text) {
  const out = [];
  let last = 0, key = 0;
  LINK.lastIndex = 0;
  let m;
  while ((m = LINK.exec(text)) !== null) {
    const href = safeHref(m[2]);
    if (m.index > last) out.push(text.slice(last, m.index));
    if (href) out.push(<a key={key++} href={href} target="_blank" rel="noopener noreferrer">{m[1]}</a>);
    else out.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Disclaimer({ text }) {
  const raw = t(text || '');
  if (!raw.trim()) return null;
  return <div className="disclaimer">{renderDisclaimer(raw)}</div>;
}
