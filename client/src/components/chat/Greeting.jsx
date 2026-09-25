import { t } from '../../i18n.jsx';
import { Ghost } from '../ui/icons.jsx';

function timeOfDay(hour) {
  if (hour < 5) return t('Working late');
  if (hour < 12) return t('Good morning');
  if (hour < 17) return t('Good afternoon');
  if (hour < 22) return t('Good evening');
  return t('Burning the midnight oil');
}

export default function Greeting({ incognito, preset, incognitoLine, greeting, userName, icon }) {
  if (incognito) {
    return (
      <div className="greeting">
        {preset === 'openai'
          ? <span className="incog-title">{t('Temporary Chat')}</span>
          : <><Ghost style={{ width: 44 }} /> {t(incognitoLine)}</>}
      </div>
    );
  }
  const first = (userName || '').split(' ')[0];
  const part = timeOfDay(new Date().getHours());
  const line = greeting ? t(greeting) : (first ? part + ', ' + first : part);
  return (
    <div className="greeting">
      {icon && <img className="greeting-icon" src={icon} alt="" aria-hidden="true" />}
      {icon ? ' ' : null}{line}
    </div>
  );
}
