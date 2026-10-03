import { useAdmin } from '../../store.jsx';
import { Card, Rows, Row, Btn } from '../../ui.jsx';
import { LongText, useEditor } from '../bind.jsx';
import { t, tk } from '../../../../i18n.jsx';
import { promptFeaturesOf } from '../../state/useWorkspace.js';
import { missingBlocks, addBlocks, eligibleBlocks } from '../../../../lib/promptblocks.js';
import { promptSegments } from '../../../../lib/promptview.js';

const VARIABLES = [
  [tk('Member'), [
    ['currentUser', tk('The member’s display name.')],
    ['userRole', tk('The member’s role: member, editor, publisher or owner.')],
    ['userLanguage', tk('The language the member uses the app in, such as Japanese.')],
    ['device', tk('phone or desktop, from the screen the message was sent on.')],
    ['userInstructions', tk('The member’s own instructions from Settings.')],
    ['memories', tk('The member’s saved memories, with ids. Empty while their memory is off.')],
    ['userMemory', tk('True or False: whether the member has memory turned on.')],
    ['responseStyle', tk('The response style the member picked.')]
  ]],
  [tk('Time'), [
    ['currentDate', tk('Today’s date in the member’s time zone. Changes once a day, so it keeps the prompt cacheable.')],
    ['currentTime', tk('The time the message is sent, in the member’s time zone.')],
    ['currentDateTime', tk('The date and time the message is sent, in the member’s time zone.')],
    ['timeZone', tk('The member’s time zone, such as Asia/Tokyo.')]
  ]],
  [tk('Chat'), [
    ['chatTitle', tk('The chat’s title, once it has one.')],
    ['projectName', tk('The name of the project the chat belongs to.')],
    ['projectInstructions', tk('Instructions of the project the chat belongs to.')],
    ['chatInstructions', tk('Instructions set on this one chat.')],
    ['pinnedFiles', tk('The text of files pinned to the chat.')],
    ['conversationSummary', tk('The summary that replaces compacted messages.')],
    ['conversationTiming', tk('When the chat started, how many messages it has, and the time since the last one.')]
  ]],
  [tk('Workspace'), [
    ['instanceName', tk('The app name set under Interface, Identity.')],
    ['supportContact', tk('The support contact set under Interface, Identity.')],
    ['sandboxHost', tk('The operating system, shell and programs installed on this server.')],
    ['sandboxWorkspace', tk('The files in the chat’s workspace, with a sample of their contents.')],
    ['referenceFiles', tk('The list of reference files.')],
    ['skills', tk('The skills available to the member.')],
    ['mcpTools', tk('The connectors and tools available to the member.')]
  ]],
  [tk('Model'), [
    ['modelName', tk('This model’s display name.')],
    ['modelId', tk('The first identifier under Model IDs.')],
    ['modelIds', tk('Every Model IDs row, one platform per line.')],
    ['modelDescription', tk('The one line under the model’s name.')],
    ['modelSummary', tk('The comparison summary.')],
    ['modelAbout', tk('The About this model text.')],
    ['modelBadge', tk('The badge: Latest, New, Preview or Legacy.')],
    ['modelGroup', tk('The sidebar group the model is listed under.')],
    ['modelNotice', tk('The notice shown at the top of the model’s page.')],
    ['modelNotes', tk('The Notes, one bullet per line.')]
  ]],
  [tk('Model specifications'), [
    ['modelParameters', tk('The total parameters, such as 175B.')],
    ['modelActiveParameters', tk('The active parameters, such as 35B.')],
    ['modelContextWindow', tk('The context window, such as 200K tokens.')],
    ['modelMaxOutput', tk('The most tokens the model writes in one reply.')],
    ['modelThinking', tk('How the model thinks before answering.')],
    ['modelEffort', tk('The default reasoning effort.')],
    ['modelLatency', tk('The comparative latency.')],
    ['modelInput', tk('What the model accepts, such as Text, Images.')],
    ['modelOutput', tk('What the model produces.')],
    ['modelKnowledgeCutoff', tk('The knowledge cutoff.')],
    ['modelTrainingCutoff', tk('The training data cutoff.')],
    ['modelIntelligence', tk('The intelligence rating, from Low to Highest.')],
    ['modelSpeed', tk('The speed rating, from Slow to Fastest.')]
  ]],
  [tk('Model pricing'), [
    ['modelPriceInput', tk('The input price per million tokens.')],
    ['modelPriceOutput', tk('The output price per million tokens.')],
    ['modelPriceCacheWrite', tk('The cache write price per million tokens.')],
    ['modelPriceCacheRead', tk('The cache read price per million tokens.')],
    ['modelPriceBatch', tk('The batch pricing.')]
  ]],
  [tk('Model availability'), [
    ['modelStatus', tk('The status, such as Active.')],
    ['modelReleased', tk('The release date.')],
    ['modelRetirement', tk('The retirement date.')],
    ['modelPlatforms', tk('The platforms the model is available on.')]
  ]]
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
  const eligible = eligibleBlocks(models[0], features);
  const mirror = (text, caret) => promptSegments(text, { eligible, caret });

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
        <LongText k="system_prompt" mono rows={18} counter label={t('System prompt')} mirror={mirror}
          placeholder={t('You are a helpful assistant…')}
          variables={VARIABLES} />
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
          <LongText k="call_prompt" rows={5} counter label={t('Voice calls')} variables={VARIABLES}
            placeholder={t('You are on a voice call. Keep replies short and easy to listen to.')} />
        </Card>
      )}
      <Card title={t('Variables')} sub={t('Filled in when a message is sent. Write them in double braces anywhere in the prompt, or right-click the prompt to insert one. The model variables come from this model’s page in the docs, and one left blank there is empty.')}>
        {VARIABLES.map(([group, list]) => (
          <div key={group} className="mc-var-group">
            <div className="mc-field-head">{t(group)}</div>
            <Rows>
              {list.map(([name, desc]) => (
                <Row key={name} label={<code>{`{{${name}}}`}</code>} note={t(desc)} />
              ))}
            </Rows>
          </div>
        ))}
      </Card>
    </>
  );
}