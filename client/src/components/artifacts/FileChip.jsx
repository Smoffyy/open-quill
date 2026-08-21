import { EXT_COLOR } from '../../lib/artifacts.js';

export default function FileChip({ ext, size = 'sm' }) {
  const e = (ext || '').toLowerCase();
  const color = EXT_COLOR[e] || '#9aa0a6';
  const label = (ext || 'file').toUpperCase().slice(0, 4);
  return <span className={'file-chip ' + size} style={{ color, background: color + '24' }}>{label}</span>;
}
