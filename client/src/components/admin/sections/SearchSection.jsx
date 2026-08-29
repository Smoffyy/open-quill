import { useAdmin } from '../store.jsx';
import { Block, Row, Fields, Field, Input, Area, Select, Switch } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function SearchSection() {
  const { workspace } = useAdmin();
  const { settings, set } = workspace;
  const on = !!settings.webSearchEnabled;

  return (
    <>
      <Block>
        <Row label={t('Web search tool')}
          note={t('Adds a per-chat toggle in the attachment menu. While it is on for a chat, the model may call the tool on its own.')}>
          <Switch on={on} label={t('Web search tool')} onToggle={() => set('webSearchEnabled', !on)} />
        </Row>
      </Block>

      {on && (
        <>
          <Block title={t('Backend')} sub={t('The server queries this instance directly. Keys and URLs never reach the browser.')}>
            <Fields cols={2}>
              <Field label={t('Engine')}>
                <Select value={settings.webSearchEngine || 'searxng'} onChange={(v) => set('webSearchEngine', v)}
                  options={[{ value: 'searxng', label: 'SearXNG' }]} />
              </Field>
              <Field label={t('Query URL')}
                hint={t('The server calls {path} on this base. JSON output must be enabled in your SearXNG settings.py.', { path: '/search?format=json' })}>
                <Input mono value={settings.searxngUrl || ''} placeholder="http://localhost:8888"
                  onChange={(e) => set('searxngUrl', e.target.value)} />
              </Field>
            </Fields>
          </Block>

          <Block title={t('Scope')} sub={t('How much the model reads per search, and which hosts it may read from.')}>
            <Fields cols={2}>
              <Field label={t('Pages per search')} hint={t('Between 1 and 20. Each page is fetched and read in full, so higher costs latency and context.')}>
                <Input type="number" min="1" max="20" value={settings.webSearchCount ?? 5}
                  onChange={(e) => set('webSearchCount', e.target.value)} />
              </Field>
              <Field label={t('Host allowlist')}
                hint={t('One host per line. Subdomains are included. Results from anywhere else are discarded before the model sees them. Empty means any host.')}>
                <Area mono rows={4} spellCheck={false} value={settings.webSearchDomains || ''}
                  placeholder={'wikipedia.org\narxiv.org'}
                  onChange={(e) => set('webSearchDomains', e.target.value)} />
              </Field>
            </Fields>
          </Block>

          <Block title={t('Tool instructions')}
            sub={t('Appended to the system prompt only for chats where search is on. Use it to say when searching is worth the round trip.')}>
            <Area rows={6} value={settings.webSearchPrompt ?? ''}
              placeholder={t('Search only when the answer depends on current information, or when you are unsure.')}
              onChange={(e) => set('webSearchPrompt', e.target.value)} />
          </Block>
        </>
      )}
    </>
  );
}
