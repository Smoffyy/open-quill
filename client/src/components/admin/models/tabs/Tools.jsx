import { useAdmin } from '../../store.jsx';
import { Card, Rows, Fields } from '../../ui.jsx';
import { Flag, NumberField, LongText, Levels, Chips, When } from '../bind.jsx';
import { t } from '../../../../i18n.jsx';
import { LEVELS, usesTools } from '../../../../lib/modelcatalog.js';

export default function Tools() {
  const { workspace } = useAdmin();
  const webSearch = !!workspace.settings.webSearchEnabled;
  const chatSearch = !!workspace.settings.chatSearchEnabled;
  const access = [
    { value: 'off', label: t('Off') },
    { value: 'on', label: t('Members can turn it on') },
    { value: 'auto', label: t('On by default') }
  ];
  const extras = [
    ['skills_allowed', t('Skills'), t('Offers the skills defined under Tools.')],
    ['mcp_allowed', t('MCP tools'), t('Exposes tools from every enabled MCP server.')],
    ...(chatSearch ? [['chat_search_allowed', t('Past-chat search'), t('Lets the model search the member’s own earlier chats.')]] : []),
    ['end_chat_allowed', t('End conversation'), t('Lets the model close a chat for good. Ended chats cannot be reopened.')]
  ];

  return (
    <>
      <Card title={t('Capabilities')} sub={t('What this model is allowed to do inside a chat.')}>
        <Rows>
          <Flag k="has_vision" label={t('Image input')} note={t('Off, image attachments are refused for this model.')} />
          <Levels label={t('Sandbox tools')} level={LEVELS.sandbox} options={access}
            note={t('Code execution and a per-chat filesystem.')} />
          {webSearch && (
            <Levels label={t('Web search')} level={LEVELS.web} options={access}
              note={t('Lets members search the web from this model.')} />
          )}
          <Chips label={t('Other tools')} note={t('Each one the model may call. Hover a tool for what it does.')} items={extras} />
        </Rows>
        <When k="end_chat_allowed" keep="end_chat_prompt">
          <LongText k="end_chat_prompt" rows={4} label={t('When to end')}
            placeholder={t('End the conversation only when the member says goodbye.')} />
        </When>
      </Card>

      <When test={m => usesTools(m, { webSearch, chatSearch })} keep="agent_steps">
        <Card title={t('Agent loop')}>
          <Fields cols={2}>
            <NumberField k="agent_steps" min="0" zeroBlank label={t('Tool calls per turn')} placeholder={t('unlimited')}
              hint={t('Blank is unlimited. A ceiling stops runaway agent loops.')} />
          </Fields>
        </Card>
      </When>
    </>
  );
}
