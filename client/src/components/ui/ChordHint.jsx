import { t } from '../../i18n.jsx';
import { comboKeys } from '../../lib/keybinds.js';

export default function ChordHint({ hint }) {
  return (
    <div className="chord-hint" role="status">
      <div className="chord-hint-head">{comboKeys(hint.head).map((k, i) => <kbd key={i}>{k}</kbd>)}<span>{t('then…')}</span></div>
      <div className="chord-hint-list">
        {hint.items.map(({ action, key }) => (
          <div className="chord-hint-item" key={action.id}><kbd>{comboKeys(key).join('')}</kbd><span>{t(action.label)}</span></div>
        ))}
        {!hint.items.length && <div className="chord-hint-item muted">{t('No chords bound yet.')}</div>}
      </div>
    </div>
  );
}
