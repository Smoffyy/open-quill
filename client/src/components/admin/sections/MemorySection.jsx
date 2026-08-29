import { useAdmin } from '../store.jsx';
import { Block, Row, Area, Switch } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function MemorySection() {
  const { workspace } = useAdmin();
  const { settings, set } = workspace;
  const mem = !!settings.memoryEnabled;

  return (
    <>
      <Block title={t('Long-term memory')}
        sub={t('A short profile built from each member’s own chats and prepended to their system prompt. Members can read, edit, or clear theirs under Settings, and opt out entirely.')}>
        <Row label={t('Build and inject memory')}
          note={t('Refreshed in the background at most once every few hours, using whichever model that member is chatting with.')}>
          <Switch on={mem} label={t('Build and inject memory')} onToggle={() => set('memoryEnabled', !mem)} />
        </Row>
        {mem && (
          <div style={{ paddingTop: 14 }}>
            <Area rows={7} value={settings.memoryPrompt ?? ''}
              placeholder={t('Instructions for rewriting a member’s memory from their recent conversations.')}
              onChange={(e) => set('memoryPrompt', e.target.value)} />
            <div className="cp-hint">{t('Sent to the model when it rewrites a memory. Clear the field to restore the built-in prompt.')}</div>
          </div>
        )}
      </Block>

      <Block title={t('Chat history tools')}
        sub={t('Adds chat_search and chat_view so a model can look things up in earlier conversations.')}>
        <Row label={t('Search past chats')}
          note={t('Scoped to the requesting member’s own chats, and never the conversation in progress. Requires a model with tool calling.')}>
          <Switch on={!!settings.chatSearchEnabled} label={t('Search past chats')}
            onToggle={() => set('chatSearchEnabled', !settings.chatSearchEnabled)} />
        </Row>
      </Block>
    </>
  );
}
