import { useAdmin } from '../store.jsx';
import { Card, Input, Btn, IconBtn, Acts, Table, Empty } from '../ui.jsx';
import { GlyphPicker } from '../media.jsx';
import { Plus, Trash, Chat } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const MAX_PROMPTS = 8;

export default function LauncherSection() {
  const { workspace } = useAdmin();
  const { config, setConfig } = workspace;
  const prompts = config.quickPrompts || [];

  const editGreeting = (i, v) => setConfig(c => ({ ...c, greetings: c.greetings.map((x, j) => (j === i ? v : x)) }));
  // The screen needs somewhere to put a greeting, so the last row is emptied
  // rather than removed.
  const dropGreeting = (i) => setConfig(c => {
    const next = c.greetings.filter((_, j) => j !== i);
    return { ...c, greetings: next.length ? next : [''] };
  });
  const editPrompt = (i, patch) => setConfig(c => ({
    ...c, quickPrompts: c.quickPrompts.map((x, j) => (j === i ? { ...x, ...patch } : x))
  }));
  const dropPrompt = (i) => setConfig(c => ({ ...c, quickPrompts: c.quickPrompts.filter((_, j) => j !== i) }));

  return (
    <>
      <Card title={t('Greetings')} flush
        sub={t('One is picked at random each time the new chat screen opens. Leave a single entry for a fixed greeting.')}
        actions={<Btn size="sm" onClick={() => setConfig(c => ({ ...c, greetings: [...c.greetings, ''] }))}>
          <Plus /> {t('Add')}
        </Btn>}>
        <Table head={[{ label: t('Text') }, { label: '', fit: true }]}>
          {config.greetings.map((g, i) => (
            <tr key={i}>
              <td>
                <Input value={g} placeholder={t('How can I help you?')} aria-label={t('Text')}
                  onChange={(e) => editGreeting(i, e.target.value)} />
              </td>
              <td className="acts">
                <Acts end>
                  <IconBtn kind="danger" label={t('Remove')} onClick={() => dropGreeting(i)}><Trash /></IconBtn>
                </Acts>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title={t('Starter prompts')} flush
        sub={t('Buttons under the message box on the new chat screen. Selecting one sends its prompt immediately. Up to {n}.', { n: MAX_PROMPTS })}
        actions={prompts.length < MAX_PROMPTS
          ? <Btn size="sm" onClick={() => setConfig(c => ({ ...c, quickPrompts: [...(c.quickPrompts || []), { icon: 'none', label: '', prompt: '' }] }))}>
            <Plus /> {t('Add')}
          </Btn>
          : null}>
        {prompts.length === 0
          ? <Empty icon={Chat} title={t('No starter prompts')}>{t('Without any, the new chat screen shows the greeting and the message box alone.')}</Empty>
          : (
            <Table head={[
              { label: t('Glyph'), fit: true },
              { label: t('Label'), width: '180px' },
              { label: t('Prompt sent') },
              { label: '', fit: true }
            ]}>
              {prompts.map((q, i) => (
                <tr key={i}>
                  <td className="fit"><GlyphPicker value={q.icon || 'none'} onPick={(icon) => editPrompt(i, { icon })} /></td>
                  <td>
                    <Input value={q.label || ''} placeholder={t('Label')} aria-label={t('Label')}
                      onChange={(e) => editPrompt(i, { label: e.target.value })} />
                  </td>
                  <td>
                    <Input value={q.prompt || ''} placeholder={t('The full prompt this button sends')} aria-label={t('Prompt sent')}
                      onChange={(e) => editPrompt(i, { prompt: e.target.value })} />
                  </td>
                  <td className="acts">
                    <Acts end>
                      <IconBtn kind="danger" label={t('Remove')} onClick={() => dropPrompt(i)}><Trash /></IconBtn>
                    </Acts>
                  </td>
                </tr>
              ))}
            </Table>
          )}
      </Card>
    </>
  );
}
