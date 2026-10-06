import { t } from '../../i18n.jsx';
import { Ghost } from '../ui/icons.jsx';
import { ModelMark } from '../ui/Weave.jsx';
import { useLayout } from '../../lib/uselayout.js';

function timeOfDay(hour) {
  if (hour < 5) return t('Working late');
  if (hour < 12) return t('Good morning');
  if (hour < 17) return t('Good afternoon');
  if (hour < 22) return t('Good evening');
  return t('Burning the midnight oil');
}

export default function Greeting({ incognito, incognitoLine, greeting, userName, icon }) {
  const layout = useLayout();
  if (incognito) {
    return (
      <div className="greeting">
        {layout.temporaryChatLabel
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
      <ModelMark src={icon} className="greeting-icon" />
      {icon ? ' ' : null}{line}
    </div>
  );
}