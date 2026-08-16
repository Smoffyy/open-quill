import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, SettingRow } from '../widgets.jsx';
import { t } from '../../../i18n.jsx';

export default function WebSearchSection() {
  const A = useAdmin();
  const { settings, setSettings, settingsSave } = A;
  return (
    <>
      <Card title={t("Engine")} sub={t("Turn the tool on and point it at your search backend.")}>
        <SettingRow label={t("Enable web search")} note={t("When on, users get a Web Search toggle in the + menu. The model can call the tool whenever it's enabled for a chat.")}
          on={!!settings.webSearchEnabled} onToggle={() => setSettings(s => ({ ...s, webSearchEnabled: !s.webSearchEnabled }))} />
        {settings.webSearchEnabled && <>
          <div className="field"><label>{t("Search engine")}</label>
            <select value={settings.webSearchEngine || 'searxng'} onChange={(e) => setSettings(s => ({ ...s, webSearchEngine: e.target.value }))}>
              <option value="searxng">{t("SearXNG")}</option>
            </select>
          </div>
          {(settings.webSearchEngine || 'searxng') === 'searxng' && (
            <div className="field" style={{ marginBottom: 0 }}><label>{t("SearXNG query URL")}</label>
              <input value={settings.searxngUrl || ''} onChange={(e) => setSettings(s => ({ ...s, searxngUrl: e.target.value }))} placeholder={t("http://localhost:8888")} />
              <div className="muted-note">{t("Base URL of your SearXNG instance. The server calls /search with format=json, so JSON output must be enabled in your SearXNG settings.")}</div>
            </div>
          )}
        </>}
      </Card>
      {settings.webSearchEnabled && <>
        <Card title={t("Results & scope")} sub={t("How much the assistant reads, and from where.")}>
          <div className="field"><label>{t("Result count limit")}</label>
            <input type="number" min="1" max="20" value={settings.webSearchCount ?? 5} onChange={(e) => setSettings(s => ({ ...s, webSearchCount: e.target.value }))} style={{ maxWidth: 140 }} />
            <div className="muted-note">{t("How many result pages to fetch and read per search (1–20). Higher means more context but slower and heavier.")}</div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>{t("Allowed domains")}</label>
            <textarea rows={3} value={settings.webSearchDomains || ''} onChange={(e) => setSettings(s => ({ ...s, webSearchDomains: e.target.value }))} placeholder={'wikipedia.org\narxiv.org'} />
            <div className="muted-note">{t("One domain per line (or comma-separated). When set, the assistant can only read results from these domains and their subdomains, everything else is dropped. Leave empty to allow any site.")}</div>
          </div>
        </Card>
        <Card title={t("Search prompt")} sub={t("Guidance the model receives whenever web search is on.")}>
          <div className="field" style={{ marginBottom: 0 }}>
            <textarea rows={6} value={settings.webSearchPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, webSearchPrompt: e.target.value }))} />
            <div className="muted-note">{t("Appended to a model's system prompt only when web search is enabled for the chat. Use it to tell the model to search only when asked or when information is missing or outdated.")}</div>
          </div>
        </Card>
      </>}
      <AutosaveNote status={settingsSave} live />
    </>
  );
}
