import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api.js';
import { Card, Rows, Fields, Switch, Btn } from '../../ui.jsx';
import { useEditor, NumberField, Flag, Line } from '../bind.jsx';
import { useAdmin } from '../../store.jsx';
import { t } from '../../../../i18n.jsx';

function detectedNote(models, n, overriding) {
  if (models.length > 1) return t('Each model uses the window its backend reports.');
  if (n === undefined) return t('Not detected yet. Detect window sizes checks every model.');
  if (n > 0) {
    if (overriding) return t('The backend reports {n} tokens.', { n: n.toLocaleString() });
    return t('The backend reports {n} tokens. Turn this on to use a different size.', { n: n.toLocaleString() });
  }
  if (overriding) return t('The backend did not report a window.');
  return t('The backend did not report a window, so a conservative default is used. Turn this on to set one.');
}

export default function Context() {
  const { models, edit, editOne } = useEditor();
  const { catalog } = useAdmin();
  const [found, setFound] = useState({});
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const ids = models.map(m => m.id).join('|');
  useEffect(() => { setOpening(false); }, [ids]);
  const detectedOf = (m) => (m.id in found ? found[m.id] : (m.known_ctx || undefined));
  const overridden = models.length > 0 && models.every(m => Number(m.num_ctx) > 0);
  const overriding = overridden || opening;

  async function detectAll() {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/detect-ctx', {});
      setFound(r.numCtx || {});
      await catalog.reload();
    } catch {}
    setBusy(false);
  }

  function toggleOverride() {
    if (overriding) {
      setOpening(false);
      edit({ num_ctx: 0 });
      return;
    }
    setOpening(true);
    for (const m of models) {
      const n = detectedOf(m);
      if (n > 0 && !(Number(m.num_ctx) > 0)) editOne(m.id, { num_ctx: n });
    }
  }

  return (
    <>
      <Card title={t('Context window')} sub={t('What happens as a conversation approaches the model’s limit.')}>
        <Rows>
          <Line label={t('Override window size')} k="num_ctx" note={detectedNote(models, models[0] ? detectedOf(models[0]) : undefined, overriding)}>
            <Switch on={overriding} label={t('Override window size')} onToggle={toggleOverride} />
          </Line>
          <Line label={t('Detect window sizes')} note={t("Asks each model's backend for its window size. Local models load one at a time, so this can take a while.")}>
            <Btn size="sm" disabled={busy} onClick={detectAll}>{busy ? t('Detecting…') : t('Detect')}</Btn>
          </Line>
        </Rows>
        {overriding && (
          <Fields cols={2}>
            <NumberField k="num_ctx" min="0" zeroBlank label={t('Window size')} placeholder="32768"
              hint={t('Tokens the backend can hold. Used instead of the detected size.')} />
          </Fields>
        )}
        <Rows>
          <Flag k="parallel_requests" label={t('Allow parallel requests')}
            note={t('A llama.cpp server shares one window between everything it runs at once. Off, requests to this model wait their turn so a reply never runs out of room because of another one.')} />
          <Flag k="long_convo_reminder" label={t('Conversation length awareness')} note={t('Tells the model how long the conversation has grown.')} />
        </Rows>
      </Card>

      <Card title={t('Rolling summary')} sub={t('Once a conversation fills about two thirds of the window, the model folds its oldest turns into a summary after a reply, so the next message never waits for it.')}>
        <Fields cols={2}>
          <NumberField k="recent_window" min="1" label={t('Turns kept verbatim')} placeholder="4"
            hint={t('The most recent turns are never folded into the summary.')} />
        </Fields>
      </Card>
    </>
  );
}