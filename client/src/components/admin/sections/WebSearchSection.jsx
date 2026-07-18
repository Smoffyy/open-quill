import React from 'react';
import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, SettingRow } from '../widgets.jsx';

export default function WebSearchSection() {
  const A = useAdmin();
  const { settings, setSettings, settingsSave } = A;
  return (
    <>
      <Card title="Engine" sub="Turn the tool on and point it at your search backend.">
        <SettingRow label="Enable web search" note="When on, users get a Web Search toggle in the + menu. The model can call the tool whenever it's enabled for a chat."
          on={!!settings.webSearchEnabled} onToggle={() => setSettings(s => ({ ...s, webSearchEnabled: !s.webSearchEnabled }))} />
        {settings.webSearchEnabled && <>
          <div className="field"><label>Search engine</label>
            <select value={settings.webSearchEngine || 'searxng'} onChange={(e) => setSettings(s => ({ ...s, webSearchEngine: e.target.value }))}>
              <option value="searxng">SearXNG</option>
            </select>
          </div>
          {(settings.webSearchEngine || 'searxng') === 'searxng' && (
            <div className="field" style={{ marginBottom: 0 }}><label>SearXNG query URL</label>
              <input value={settings.searxngUrl || ''} onChange={(e) => setSettings(s => ({ ...s, searxngUrl: e.target.value }))} placeholder="http://localhost:8888" />
              <div className="muted-note">Base URL of your SearXNG instance. The server calls <code>/search?q=…&amp;format=json</code>, so JSON output must be enabled in your SearXNG settings.</div>
            </div>
          )}
        </>}
      </Card>
      {settings.webSearchEnabled && <>
        <Card title="Results & scope" sub="How much the assistant reads, and from where.">
          <div className="field"><label>Result count limit</label>
            <input type="number" min="1" max="20" value={settings.webSearchCount ?? 5} onChange={(e) => setSettings(s => ({ ...s, webSearchCount: e.target.value }))} style={{ maxWidth: 140 }} />
            <div className="muted-note">How many result pages to fetch and read per search (1–20). Higher means more context but slower and heavier.</div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>Allowed domains</label>
            <textarea rows={3} value={settings.webSearchDomains || ''} onChange={(e) => setSettings(s => ({ ...s, webSearchDomains: e.target.value }))} placeholder={'wikipedia.org\narxiv.org'} />
            <div className="muted-note">One domain per line (or comma-separated). When set, the assistant can only read results from these domains and their subdomains, everything else is dropped. Leave empty to allow any site.</div>
          </div>
        </Card>
        <Card title="Search prompt" sub="Guidance the model receives whenever web search is on.">
          <div className="field" style={{ marginBottom: 0 }}>
            <textarea rows={6} value={settings.webSearchPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, webSearchPrompt: e.target.value }))} />
            <div className="muted-note">Appended to a model's system prompt only when web search is enabled for the chat. Use it to tell the model to search only when asked or when information is missing or outdated.</div>
          </div>
        </Card>
      </>}
      <AutosaveNote status={settingsSave} live />
    </>
  );
}
