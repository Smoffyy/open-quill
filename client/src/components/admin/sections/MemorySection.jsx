import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, SettingRow } from '../widgets.jsx';
import { t } from '../../../i18n.jsx';

export default function MemorySection() {
  const A = useAdmin();
  const { settings, setSettings, settingsSave } = A;
  return (
    <>
      <Card title={t("User memory")} sub={t("Each user gets a compact long-term memory built from their own chats. Users can view, edit, disable, or clear it in Settings → Memory.")}>
        <SettingRow label={t("Enable user memory")} note={t("When on, memory is injected into the system prompt for users who keep it enabled, and refreshed in the background at most every few hours using the model they are chatting with.")}
          on={!!settings.memoryEnabled} onToggle={() => setSettings(s => ({ ...s, memoryEnabled: !s.memoryEnabled }))} />
        {settings.memoryEnabled && (
          <div className="field" style={{ borderBottom: 0, marginBottom: 0 }}><label>{t("Memory update prompt")}</label>
            <textarea rows={6} value={settings.memoryPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, memoryPrompt: e.target.value }))} />
            <div className="muted-note">{t("The instructions used when the model rewrites a user's memory from recent conversations. Clearing the field restores the default.")}</div>
          </div>
        )}
      </Card>
      <Card title={t("Past-chat search")} sub={t("Gives models chat_search and chat_view tools to look things up in the user's own previous conversations.")}>
        <SettingRow last label={t("Enable chat history search")} note={t("Only the requesting user's chats are searchable, and never the conversation currently in progress. Requires a model with tool calling.")}
          on={!!settings.chatSearchEnabled} onToggle={() => setSettings(s => ({ ...s, chatSearchEnabled: !s.chatSearchEnabled }))} />
      </Card>
      <AutosaveNote status={settingsSave} live />
    </>
  );
}
