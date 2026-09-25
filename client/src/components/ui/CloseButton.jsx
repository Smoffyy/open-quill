import { t } from '../../i18n.jsx';
import { X } from './icons.jsx';

export default function CloseButton({ onClick, className = '', label, plain = false }) {
  const name = label || t('Close');
  const cls = [plain ? '' : 'modal-close', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} aria-label={name} title={name}>
      <X />
    </button>
  );
}
