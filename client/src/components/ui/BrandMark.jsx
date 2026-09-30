import { BRAND_ICON } from '../../lib/brand.js';

export default function BrandMark({ src, className = '' }) {
  if (src && src !== BRAND_ICON) return <img src={src} className={className || undefined} alt="" aria-hidden="true" />;
  return <span className={'brand-mark' + (className ? ' ' + className : '')} aria-hidden="true" />;
}
