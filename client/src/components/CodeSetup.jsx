import { Terminal, CodeTag, Wrench, Chat, Plug, Chevron } from './icons.jsx';
import { t, tk } from '../i18n.jsx';

const SURFACES = [
  { id: 'terminal', label: tk('Terminal'), Icon: Terminal },
  { id: 'vscode', label: tk('VS Code'), Icon: CodeTag },
  { id: 'jetbrains', label: tk('JetBrains'), Icon: Wrench },
  { id: 'mobile', label: tk('Mobile'), Icon: Chat },
  { id: 'slack', label: tk('Slack'), Icon: Plug }
];

export default function CodeSetup({ onContinue, onPick }) {
  return (
    <div className="code-setup">
      <div className="code-setup-col">
        <h1 className="code-setup-title">{t('Set up and start coding')}</h1>
        <p className="code-setup-sub">{t('Install the desktop app, or pick where you want to start.')}</p>

        <div className="code-card">
          <div className="code-card-copy">
            <h2 className="code-card-title">{t('Coding workspace')}</h2>
            <p className="code-card-desc">{t('Write code, review diffs, and merge PRs, all in one place.')}</p>
            <button className="lib-primary code-card-cta" onClick={() => onPick && onPick('desktop')}>
              <Terminal /> {t('Set up workspace')}
            </button>
          </div>
          <div className="code-card-art" aria-hidden="true">
            <div className="code-card-art-frame">
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} className="code-card-art-line" style={{ width: (34 + ((i * 23) % 56)) + '%' }} />
              ))}
            </div>
          </div>
        </div>

        <div className="code-surfaces">
          {SURFACES.map(({ id, label, Icon }) => (
            <button key={id} className="code-surface" onClick={() => onPick && onPick(id)}>
              <Icon /> <span>{t(label)}</span>
            </button>
          ))}
        </div>

        <div className="code-setup-foot">
          <p className="code-setup-later">{t('Want to set up apps later?')}</p>
          <button className="code-continue" onClick={onContinue}>
            {t('Continue on web')} <Chevron />
          </button>
        </div>
      </div>
    </div>
  );
}
