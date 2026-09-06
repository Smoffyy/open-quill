import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, Rows, Row, ToggleRow, Fields, Field, Area, Select, Seg, Btn, Table, Empty, fmtAgo } from '../ui.jsx';
import { Shield } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

export default function GuardrailsSection() {
  const { workspace, catalog, confirm } = useAdmin();
  const { settings, set } = workspace;
  const on = !!settings.safetyEnabled;
  const [log, setLog] = useState(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.get('/api/admin/safety-log');
        if (!alive) return;
        setLog(d.entries || []);
        setTotal(d.total || 0);
      } catch { if (alive) setLog([]); }
    })();
    return () => { alive = false; };
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
      <Card title={t('Prompt screening')}
        sub={t('Each prompt is shown to a model first. A refusal stops it reaching the assistant and returns a banner in the message bar.')}>
        <Rows>
          <ToggleRow label={t('Screen prompts')} on={on} onToggle={() => set('safetyEnabled', !on)}
            note={t('Adds one model round trip before every send.')} />
          {on && (
            <>
              <ToggleRow label={t('Show progress')} on={!!settings.safetyVerbose}
                onToggle={() => set('safetyVerbose', !settings.safetyVerbose)}
                note={t('Displays a screening status in the message bar. Off, the check runs silently.')} />
              <ToggleRow label={t('Explain refusals')} on={!!settings.safetyReasonEnabled}
                onToggle={() => set('safetyReasonEnabled', !settings.safetyReasonEnabled)}
                note={t('Lets the screening model return a short reason, shown in place of the generic banner. The instruction is appended to the prompt below, so your own text is preserved.')} />
            </>
          )}
        </Rows>
      </Card>

      {on && (
        <>
          <Card title={t('Screening model')}>
            <Rows>
              <Row label={t('Route through')}
                note={t('The chatting model needs no extra load. A dedicated model gives consistent verdicts but keeps a second model resident.')}>
                <Seg value={settings.safetyModelMode || 'current'} label={t('Route through')}
                  onChange={(v) => set('safetyModelMode', v)}
                  options={[{ value: 'current', label: t('Chatting model') }, { value: 'specific', label: t('Dedicated model') }]} />
              </Row>
            </Rows>
            {settings.safetyModelMode === 'specific' && (
              <Fields cols={2}>
                <Field label={t('Model')} hint={t('If this model is deleted, screening falls back to the chatting model.')}>
                  <Select value={settings.safetyModelId || ''} onChange={(v) => set('safetyModelId', v)} label={t('Model')}
                    options={[{ value: '', label: t('Choose a model') },
                      ...catalog.models.map(m => ({ value: m.id, label: m.display_name || m.internal_name }))]} />
                </Field>
              </Fields>
            )}
          </Card>

          <Card title={t('Screening prompt')}
            sub={t('The model must answer with JSON only, carrying a verdict that allows or refuses. Clear the field to restore the built-in prompt.')}>
            <Area mono rows={9} value={settings.safetyPrompt ?? ''} aria-label={t('Screening prompt')}
              onChange={(e) => set('safetyPrompt', e.target.value)} />
          </Card>
        </>
      )}

      <Card title={t('Refusal log')}
        sub={total ? t('{n} prompts refused. Use these to tune the prompt and spot false positives.', { n: total }) : t('Prompts the screening model refused.')}
        actions={log && log.length ? <Btn size="sm" kind="danger" onClick={clearLog}>{t('Clear log')}</Btn> : null}>
        {log == null && <Empty icon={Shield} title={t('Loading')} />}
        {log != null && log.length === 0 && (
          <Empty icon={Shield} title={t('Nothing refused')}>{t('Prompts that the screening model turns down will be listed here with the reason it gave.')}</Empty>
        )}
        {log != null && log.length > 0 && (
          <Table head={[
            { label: t('When'), fit: true },
            { label: t('Member'), mono: true },
            { label: t('Model'), mono: true },
            { label: t('Prompt') },
            { label: t('Reason') }
          ]}>
            {log.map(e => (
              <tr key={e.id}>
                <td className="dim">{fmtAgo(e.ts)}</td>
                <td className="mono">{e.user}</td>
                <td className="mono dim">{e.model}</td>
                <td className="wrap">{e.snippet || <span className="dim">{t('(empty)')}</span>}</td>
                <td className="dim wrap">{e.reason || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
