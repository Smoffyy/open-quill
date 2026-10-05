import { useAdmin } from '../../store.jsx';
import { Card, Rows, Fields } from '../../ui.jsx';
import { Flag, NumberField, Levels, Chips, When, ModelPicks, useEditor } from '../bind.jsx';
import { t } from '../../../../i18n.jsx';
import { LEVELS, usesTools } from '../../../../lib/modelcatalog.js';

export default function Tools() {
  const { workspace, catalog } = useAdmin();
  const { single } = useEditor();
  const consultable = catalog.models.filter(m => m.kind !== 'router' && m.id !== single?.id);
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
    ['memory_allowed', t('Memory'), t('Lets the model save, update and delete facts about the member. Only works for members with memory turned on.')],
    ['calculator_allowed', t('Calculator'), t('Lets the model evaluate math expressions exactly instead of computing them itself.')],
    ['todo_allowed', t('To-do list'), t('Lets the model keep a checklist for multi-step work, shown to the member as a card.')],
    ['ask_user_allowed', t('Ask the member'), t('Lets the model stop and ask a question with answers the member can click.')],
    ['consult_allowed', t('Consult other models'), t('Lets the model send a question to other models you choose, and use their answers.')],
    ['end_chat_allowed', t('End conversation'), t('Lets the model close a chat for good. Ended chats cannot be reopened.')]
  ];

  return (
    <>
      <Card title={t('Capabilities')} sub={t('What this model is allowed to do inside a chat.')}>
        <Rows>
          <Flag k="has_vision" label={t('Image input')} note={t('Off, image attachments are refused for this model.')} />
          {webSearch && (
            <Levels label={t('Web search')} level={LEVELS.web} options={access}
              note={t('Lets members search the web from this model.')} />
          )}
          <Chips label={t('Other tools')} note={t('Each one the model may call. Hover a tool for what it does. Turning one on adds its instructions to the system prompt, where you can edit them.')} items={extras} />
        </Rows>
      </Card>

      <When k="consult_allowed" keep={['consult_models', 'consult_images']}>
        <Card title={t('Consult other models')}
          sub={t('Only admins can change these. The model is told which models it may ask, with their descriptions, in its consult_model block.')}>
          <Rows>
            <ModelPicks k="consult_models" label={t('Models it can ask')} candidates={consultable}
              note={t('Disabled and router models are skipped when a chat runs. Answers count toward the member’s usage under the model that gave them.')}
              empty={t('Add another model to the catalog first.')} />
            <Flag k="consult_images" label={t('Send images')}
              note={t('Lets the model forward the images from the member’s latest message to a chosen model that can see images.')} />
          </Rows>
        </Card>
      </When>

      <When test={m => usesTools(m, { webSearch, chatSearch })} keep={['agent_steps', 'hide_tool_calls']}>
        <Card title={t('Agent loop')}>
          <Rows>
            <Flag k="hide_tool_calls" label={t('Hide tool calls')}
              note={t('Members see only the reply, not the tool calls made while writing it. The model still gets every result.')} />
          </Rows>
          <Fields cols={2}>
            <NumberField k="agent_steps" min="0" zeroBlank label={t('Tool calls per turn')} placeholder={t('unlimited')}
              hint={t('Blank is unlimited. A ceiling stops runaway agent loops.')} />
          </Fields>
        </Card>
      </When>
    </>
  );
}