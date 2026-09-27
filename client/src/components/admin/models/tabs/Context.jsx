import { useState } from 'react';
import { api } from '../../../../lib/api.js';
import { Card, Rows, Fields, Btn } from '../../ui.jsx';
import { useEditor, NumberField, Choice, Flag, When } from '../bind.jsx';
import { t } from '../../../../i18n.jsx';

const HEADROOM = ['0.05', '0.1', '0.125', '0.2', '0.3', '0.45', '0.6'];

export default function Context() {
  const { models, editOne } = useEditor();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState('');

  async function detect() {
    setBusy(true);
    setReport('');
    let read = 0;
    let last = 0;
    for (const m of models) {
      try {
        const r = await api.get('/api/admin/detect-ctx?model=' + encodeURIComponent(m.internal_name || '')
          + '&provider=' + encodeURIComponent(m.provider_id || ''));
        if (r.ok && r.numCtx) { editOne(m.id, { num_ctx: r.numCtx }); read++; last = r.numCtx; }
      } catch {}
    }
    setReport(models.length === 1
      ? (read ? t('Read {n} tokens from the backend.', { n: last.toLocaleString() }) : t('The backend did not report a window.'))
      : t('Read a window for {n} of {total} models.', { n: read, total: models.length }));
    setBusy(false);
  }

  return (
    <>
      <Card title={t('Context window')} sub={t('What happens as a conversation approaches the model’s limit.')}
        actions={<Btn size="sm" disabled={busy} onClick={detect}>{busy ? t('Reading…') : t('Detect from backend')}</Btn>}>
        {report && <p className="cp-note-line" role="status">{report}</p>}
        <Fields cols={2}>
          <NumberField k="num_ctx" min="0" zeroBlank label={t('Window size')} placeholder="32768"
            hint={t('Tokens the backend can hold. Blank falls back to a conservative default.')} />
        </Fields>
        <Rows>
          <Choice k="ctx_trim_mode" row label={t('When the chat outgrows the window')} fallback="retain"
            note={t('Keeping history drops the least, but the prompt changes every turn and a local backend re-reads the whole conversation. Keeping the cache warm drops more but leaves the prefix stable.')}
            options={[{ value: 'retain', label: t('keep history') }, { value: 'cache', label: t('keep cache warm') }]} />
          <Flag k="long_convo_reminder" label={t('Conversation length awareness')} note={t('Tells the model how long the conversation has grown.')} />
        </Rows>
      </Card>

      <Card title={t('Compaction')}>
        <Rows>
          <Flag k="enable_summaries" label={t('Compact older turns')}
            note={t('Near the limit, earlier turns are replaced by a summary so the conversation can continue.')} />
        </Rows>
        <When k="enable_summaries" keep={['summary_padding', 'recent_window']}>
          <Fields cols={2}>
            <Choice k="summary_padding" label={t('Compact when this much is left')} fallback="0.125"
              hint={t('Compaction starts once less than this share of the window is free.')}
              options={HEADROOM.map(v => ({ value: v, label: Math.round(Number(v) * 1000) / 10 + '%' }))} />
            <NumberField k="recent_window" min="1" label={t('Turns kept verbatim')} placeholder="4"
              hint={t('Recent turns never compacted.')} />
          </Fields>
        </When>
      </Card>
    </>
  );
}
