import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow, Field, Area } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function MemorySection() {
  const { workspace } = useAdmin();
  const { settings, set } = workspace;
  const mem = !!settings.memoryEnabled;

  return (
    <>
      <Card title={t('Long-term memory')}
        sub={t('A short profile built from each member’s own chats and prepended to their system prompt. Members can read, edit, or clear theirs under Settings, and opt out entirely.')}>
        <Rows>
          <ToggleRow label={t('Build and inject memory')} on={mem} onToggle={() => set('memoryEnabled', !mem)}
            note={t('Refreshed in the background at most once every few hours, using whichever model that member is chatting with.')} />
        </Rows>
        {mem && (
          <Field label={t('Rewrite prompt')}
            hint={t('Sent to the model when it rewrites a memory. Clear the field to restore the built-in prompt.')}>
            <Area rows={7} value={settings.memoryPrompt ?? ''}
              placeholder={t('Instructions for rewriting a member’s memory from their recent conversations.')}
              onChange={(e) => set('memoryPrompt', e.target.value)} />
          </Field>
        )}
      </Card>

      <Card title={t('Chat history tools')}
        sub={t('Adds chat_search and chat_view so a model can look things up in earlier conversations.')}>
        <Rows>
          <ToggleRow label={t('Search past chats')} on={!!settings.chatSearchEnabled}
            onToggle={() => set('chatSearchEnabled', !settings.chatSearchEnabled)}
            note={t('Scoped to the requesting member’s own chats, and never the conversation in progress. Requires a model with tool calling.')} />
        </Rows>
      </Card>
    </>
  );
}
