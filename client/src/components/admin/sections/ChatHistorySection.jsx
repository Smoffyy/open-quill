import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function ChatHistorySection() {
  const { workspace } = useAdmin();
  const { settings, set } = workspace;

  return (
    <Card title={t('Chat history tools')}
      sub={t('Adds chat_search and chat_view so a model can look things up in earlier conversations.')}>
      <Rows>
        <ToggleRow label={t('Search past chats')} on={!!settings.chatSearchEnabled}
          onToggle={() => set('chatSearchEnabled', !settings.chatSearchEnabled)}
          note={t('Scoped to the requesting member’s own chats, and never the conversation in progress. Requires a model with tool calling.')} />
      </Rows>
    </Card>
  );
}