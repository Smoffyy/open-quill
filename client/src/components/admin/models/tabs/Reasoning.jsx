import { Card, Rows, Fields } from '../../ui.jsx';
import { Flag, TextField, Levels, When } from '../bind.jsx';
import { t } from '../../../../i18n.jsx';
import { LEVELS } from '../../../../lib/modelcatalog.js';

export default function Reasoning() {
  return (
    <>
      <Card title={t('Display')}>
        <Rows>
          <Levels label={t('Thought process')} level={LEVELS.thoughts}
            note={t('How much of the thinking members see while and after the model reasons.')}
            options={[
              { value: 'shown', label: t('Visible, collapsible') },
              { value: 'status', label: t('Status line only') },
              { value: 'hidden', label: t('Hidden') }
            ]} />
        </Rows>
      </Card>

      <Card title={t('Thinking tags')} sub={t('The markers the model wraps its reasoning in. Blank uses the default think tags.')}>
        <Fields cols={2}>
          <TextField k="think_open" mono label={t('Opening tag')} placeholder="<think>" />
          <TextField k="think_close" mono label={t('Closing tag')} placeholder="</think>" />
        </Fields>
      </Card>

      <Card title={t('Prompt token switch')}>
        <Rows>
          <Flag k="has_reasoning" label={t('Switch modes with a prompt token')}
            note={t('For models that toggle thinking by a token in the prompt. Adds an extended-thinking control for members.')} />
        </Rows>
        <When k="has_reasoning" keep={['reasoning_token', 'non_reasoning_token']}>
          <Fields cols={2}>
            <TextField k="reasoning_token" mono label={t('Extended token')} placeholder="/think" />
            <TextField k="non_reasoning_token" mono label={t('Standard token')} placeholder="/no_think" />
          </Fields>
        </When>
      </Card>
    </>
  );
}