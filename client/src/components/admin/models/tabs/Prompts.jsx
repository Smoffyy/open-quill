import { useAdmin } from '../../store.jsx';
import { Card } from '../../ui.jsx';
import { LongText, useEditor } from '../bind.jsx';
import { t } from '../../../../i18n.jsx';

const DATE = '{{currentDateTime}}';
const USER = '{{currentUser}}';

export default function Prompts() {
  const { workspace } = useAdmin();
  const { models } = useEditor();
  const calls = !!workspace.settings.voiceCallEnabled || models.some(m => m.call_prompt);
  return (
    <>
      <Card title={t('System prompt')}
        sub={t('Prepended to every conversation. {date} and {user} are substituted on the member’s own device at send time.', { date: DATE, user: USER })}>
        <LongText k="system_prompt" mono rows={18} counter label={t('System prompt')}
          placeholder={t('You are a helpful assistant…')}
          inserts={[[t('date'), DATE], [t('user'), USER]]} />
      </Card>
      {calls && (
        <Card title={t('Voice calls')} sub={t('Replaces the system prompt during a call, where replies are spoken.')}>
          <LongText k="call_prompt" rows={5} counter label={t('Voice calls')}
            placeholder={t('You are on a voice call. Keep replies short and easy to listen to.')} />
        </Card>
      )}
    </>
  );
}
