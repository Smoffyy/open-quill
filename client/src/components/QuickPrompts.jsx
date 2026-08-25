import { t } from '../i18n.jsx';
import { QpIcon } from '../qpIcons.jsx';

export default function QuickPrompts({ prompts, visible, disabled, onPick }) {
  const keepSpace = document.documentElement.getAttribute('data-preset') === 'openai';
  if (!visible && !keepSpace) return null;
  return (
    <div className={'quick-prompts' + (keepSpace && !visible ? ' qp-ghost' : '')}>
      {prompts.map((q, i) => (
        <button key={i} className="quick-prompt" onClick={() => onPick(t(q.prompt))} disabled={disabled}>
          {q.icon && q.icon !== 'none' && <span className="qp-icon"><QpIcon name={q.icon} style={{ width: 15, height: 15 }} /></span>}{t(q.label)}
        </button>
      ))}
    </div>
  );
}
