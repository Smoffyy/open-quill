import { useState, useEffect, useCallback } from 'react';
import { subscribeLightbox } from '../../lib/lightbox.js';
import { useLayer } from '../../lib/dismiss.js';
import CloseButton from '../ui/CloseButton.jsx';
import { t } from '../../i18n.jsx';

export default function Lightbox() {
  const [img, setImg] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => { setImg(null); setLeaving(false); }, 220);
  }, []);
  useEffect(() => subscribeLightbox((d) => { setLeaving(false); setImg(d); }), []);
  useLayer(!!img, close, { modal: true });
  if (!img) return null;
  return (
    <div className={'lightbox' + (leaving ? ' leaving' : '')} onClick={close} role="dialog" aria-modal="true" aria-label={img.alt || t('Image viewer')}>
      <img src={img.src} alt={img.alt} onClick={(e) => e.stopPropagation()} />
      <a className="lightbox-open" href={img.src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{t("Open original ↗")}</a>
      <CloseButton plain className="lightbox-x" onClick={close} />
    </div>
  );
}
