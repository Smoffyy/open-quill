import { t } from '../../i18n.jsx';
import { X } from '../ui/icons.jsx';

export default function QueuedMessages({ items, onRemove }) {
  return items.map(q => (
    <div key={q.id} className="queue-ghost">
      <div className="msg user ghost">
        <div className="bubble-user"><div className="ghost-text">{q.text}</div></div>
        <div className="ghost-row">
          <span className="ghost-note">{t('Queued')}</span>
          <button className="ghost-remove" onClick={() => onRemove(q.id)}><X style={{ width: 12 }} /> {t('Remove from queue')}</button>
        </div>
      </div>
      <div className="msg assistant ghost" aria-hidden="true">
        <div className="ghost-placeholder"><span /><span /><span /></div>
      </div>
    </div>
  ));
}
