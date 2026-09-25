import { useRef } from 'react';
import { useFocusTrap } from '../../lib/focus.js';

export default function Dialog({
  onClose, onEscape, label, labelledBy, className = '', overlayClassName = '', initialFocus, focusField = false, focusSelf = false,
  escape = true, dismissOnBackdrop = true, children, ...rest
}) {
  const ref = useRef(null);
  useFocusTrap(ref, onEscape || onClose, { initial: focusSelf ? ref : initialFocus, field: focusField, escape });
  return (
    <div className={'overlay' + (overlayClassName ? ' ' + overlayClassName : '')}
      onMouseDown={dismissOnBackdrop ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}>
      <div ref={ref} className={className} role="dialog" aria-modal="true" tabIndex={focusSelf ? -1 : undefined}
        aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} {...rest}>
        {children}
      </div>
    </div>
  );
}
