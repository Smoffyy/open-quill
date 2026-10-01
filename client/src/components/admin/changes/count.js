import { t } from '../../../i18n.jsx';

export function changeCount(n) {
  return n === 1 ? t('1 change') : t('{n} changes', { n });
}
