import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Block, Row, Fields, Field, Area, Select, Seg, Switch, Btn, Table, Empty, fmtAgo } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function GuardrailsSection() {
  const { workspace, catalog, confirm } = useAdmin();
  const { settings, set } = workspace;
  const on = !!settings.safetyEnabled;
  const [log, setLog] = useState(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => {
      try { const d = await api.get('/api/admin/safety-log'); setLog(d.entries || []); setTotal(d.total || 0); }
      catch { setLog([]); }
    })();
  }, []);

  function clearLog() {
    confirm({
      title: t('Clear screening log'),
      message: t('This deletes every recorded block. The setting itself is unchanged.'),
      confirm: t('Clear log'),
      onConfirm: async () => { try { await api.del('/api/admin/safety-log'); setLog([]); setTotal(0); } catch {} }
    });
  }

  return (
    <>
      <Block title={t('Prompt screening')}
        sub={t('Each prompt is shown to a model first. A refusal stops it reaching the assistant and returns a banner in the message bar.')}>
        <Row label={t('Screen prompts')} note={t('Adds one model round trip before every send.')}>
          <Switch on={on} label={t('Screen prompts')} onToggle={() => set('safetyEnabled', !on)} />
        </Row>
        {on && (
          <>
            <Row label={t('Show progress')} note={t('Displays a screening status in the message bar. Off, the check runs silently.')}>
              <Switch on={!!settings.safetyVerbose} label={t('Show progress')}
                onToggle={() => set('safetyVerbose', !settings.safetyVerbose)} />
            </Row>
            <Row label={t('Explain refusals')}
              note={t('Lets the screening model return a short reason, shown in place of the generic banner. The instruction is appended to the prompt below, so your own text is preserved.')}>
              <Switch on={!!settings.safetyReasonEnabled} label={t('Explain refusals')}
                onToggle={() => set('safetyReasonEnabled', !settings.safetyReasonEnabled)} />
            </Row>
          </>
        )}
      </Block>

      {on && (
        <>
          <Block title={t('Screening model')}>
            <Fields cols={2}>
              <Field label={t('Route through')}
                hint={t('The chatting model needs no extra load. A dedicated model gives consistent verdicts but keeps a second model resident.')}>
                <Seg value={settings.safetyModelMode || 'current'} label={t('Route through')}
                  onChange={(v) => set('safetyModelMode', v)}
                  options={[{ value: 'current', label: t('Chatting model') }, { value: 'specific', label: t('Dedicated model') }]} />
              </Field>
              {settings.safetyModelMode === 'specific' && (
                <Field label={t('Model')} hint={t('If this model is deleted, screening falls back to the chatting model.')}>
                  <Select value={settings.safetyModelId || ''} onChange={(v) => set('safetyModelId', v)}
                    options={[{ value: '', label: t('Choose a model') },
                      ...catalog.models.map(m => ({ value: m.id, label: m.display_name || m.internal_name }))]} />
                </Field>
              )}
            </Fields>
          </Block>

          <Block title={t('Screening prompt')}
            sub={t('The model must answer with JSON only, carrying a verdict that allows or refuses. Clear the field to restore the built-in prompt.')}>
            <Area rows={8} value={settings.safetyPrompt ?? ''} onChange={(e) => set('safetyPrompt', e.target.value)} />
          </Block>
        </>
      )}

      <Block title={t('Refusal log')}
        sub={total ? t('{n} prompts refused. Use these to tune the prompt and spot false positives.', { n: total }) : t('Prompts the screening model refused.')}
        actions={log && log.length ? <Btn kind="danger" size="sm" onClick={clearLog}>{t('Clear log')}</Btn> : null}>
        {log == null && <Empty title={t('Loading')} />}
        {log != null && log.length === 0 && (
          <Empty title={t('Nothing refused')}>{t('Prompts that the screening model turns down will be listed here with the reason it gave.')}</Empty>
        )}
        {log != null && log.length > 0 && (
          <Table head={[
            { label: t('When'), fit: true, mono: true },
            { label: t('Member'), mono: true },
            { label: t('Model'), mono: true },
            { label: t('Prompt') },
            { label: t('Reason') }
          ]}>
            {log.map(e => (
              <tr key={e.id}>
                <td className="mono dim">{fmtAgo(e.ts)}</td>
                <td className="mono">{e.user}</td>
                <td className="mono dim">{e.model}</td>
                <td>{e.snippet || <span className="dim">{t('(empty)')}</span>}</td>
                <td className="dim">{e.reason || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
    </>
  );
}
