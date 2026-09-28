import { useAdmin } from '../../store.jsx';
import { Card, Rows, Row, Btn } from '../../ui.jsx';
import { LongText, useEditor } from '../bind.jsx';
import { t, tk } from '../../../../i18n.jsx';
import { promptFeaturesOf } from '../../state/useWorkspace.js';
import { missingBlocks, addBlocks } from '../../../../lib/promptblocks.js';

const DATE = '{{currentDateTime}}';
const USER = '{{currentUser}}';

const VARIABLES = [
  ['currentUser', tk('The member’s display name.')],
  ['currentDateTime', tk('The date and time the message is sent.')],
  ['userInstructions', tk('The member’s own instructions from Settings.')],
  ['memories', tk('The member’s saved memories, with ids. Empty while their memory is off.')],
  ['userMemory', tk('True or False: whether the member has memory turned on.')],
  ['projectInstructions', tk('Instructions of the project the chat belongs to.')],
  ['chatInstructions', tk('Instructions set on this one chat.')],
  ['pinnedFiles', tk('The text of files pinned to the chat.')],
  ['responseStyle', tk('The response style the member picked.')],
  ['conversationSummary', tk('The summary that replaces compacted messages.')],
  ['conversationTiming', tk('When the chat started, how many messages it has, and the time since the last one.')],
  ['sandboxHost', tk('The operating system, shell and programs installed on this server.')],
  ['sandboxWorkspace', tk('The files in the chat’s workspace, with a sample of their contents.')],
  ['referenceFiles', tk('The list of reference files.')],
  ['skills', tk('The skills available to the member.')],
  ['mcpTools', tk('The connectors and tools available to the member.')]
];

const labelOf = (id) => {
  const [kind, name] = id.split(':');
  return kind === 'tool' ? `<tool name="${name}">` : `<section name="${name}">`;
};

export default function Prompts() {
  const { workspace } = useAdmin();
  const { models, editEach } = useEditor();
  const calls = !!workspace.settings.voiceCallEnabled || models.some(m => m.call_prompt);
  const features = promptFeaturesOf(workspace.settings);
  const missing = [...new Set(models.flatMap(m => missingBlocks(m.system_prompt || '', m, features)))];

  function restore(ids) {
    const want = new Set(ids);
    editEach(m => {
      const ownMissing = new Set(missingBlocks(m.system_prompt || '', m, features).filter(id => want.has(id)));
      return ownMissing.size ? { system_prompt: addBlocks(m.system_prompt || '', ownMissing) } : null;
    });
  }

  return (
    <>
      <Card title={t('System prompt')}
        sub={t('Sent at the start of every conversation, exactly as written here. Turning a tool on adds its instructions as a <tool> block inside <tools>, and the member’s context sits in <section> blocks inside <context>. Every block can be edited. A tool block is only sent when that tool is on for the chat, and a block whose variables are all empty is left out.')}>
        <LongText k="system_prompt" mono rows={18} counter label={t('System prompt')}
          placeholder={t('You are a helpful assistant…')}
          inserts={[[t('date'), DATE], [t('user'), USER]]} />
      </Card>
      {missing.length > 0 && (
        <Card title={t('Missing blocks')}
          sub={t('These are on for this model, but their block is not in the system prompt, so the model gets no instructions for them.')}
          actions={missing.length > 1 ? <Btn size="sm" onClick={() => restore(missing)}>{t('Restore all')}</Btn> : null}>
          <Rows>
            {missing.map(id => (
              <Row key={id} label={<code>{labelOf(id)}</code>}>
                <Btn size="sm" onClick={() => restore([id])}>{t('Restore')}</Btn>
              </Row>
            ))}
          </Rows>
        </Card>
      )}
      {calls && (
        <Card title={t('Voice calls')} sub={t('Replaces the text outside the <tools> and <context> blocks during a call, where replies are spoken. The blocks still apply.')}>
          <LongText k="call_prompt" rows={5} counter label={t('Voice calls')}
            placeholder={t('You are on a voice call. Keep replies short and easy to listen to.')} />
        </Card>
      )}
      <Card title={t('Variables')} sub={t('Filled in when a message is sent. Write them in double braces anywhere in the prompt.')}>
        <Rows>
          {VARIABLES.map(([name, desc]) => (
            <Row key={name} label={<code>{`{{${name}}}`}</code>} note={t(desc)} />
          ))}
        </Rows>
      </Card>
    </>
  );
}
