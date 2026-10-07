import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api.js';
import { Card, Rows, Fields, Switch } from '../../ui.jsx';
import { useEditor, NumberField, Flag, Line } from '../bind.jsx';
import { t } from '../../../../i18n.jsx';

function useDetected(models) {
  const [detected, setDetected] = useState({});
  const key = models.map(m => m.id + ':' + (m.provider_id || '') + ':' + (m.internal_name || '')).join('|');
  useEffect(() => {
    let on = true;
    setDetected({});
    for (const m of models) {
      api.get('/api/admin/detect-ctx?id=' + encodeURIComponent(m.id))
        .then(r => { if (on) setDetected(d => ({ ...d, [m.id]: r.numCtx || 0 })); })
        .catch(() => { if (on) setDetected(d => ({ ...d, [m.id]: 0 })); });
    }
    return () => { on = false; };
  }, [key]);
  return detected;
}

function detectedNote(models, detected, overriding) {
  if (models.length > 1) return t('Each model uses the window its backend reports.');
  const n = detected[models[0]?.id];
  if (n === undefined) return t('Reading the window from the backend…');
  if (n > 0) {
    if (overriding) return t('The backend reports {n} tokens.', { n: n.toLocaleString() });
    return t('The backend reports {n} tokens. Turn this on to use a different size.', { n: n.toLocaleString() });
  }
  if (overriding) return t('The backend did not report a window.');
  return t('The backend did not report a window, so a conservative default is used. Turn this on to set one.');
}

export default function Context() {
  const { models, edit, editOne } = useEditor();
  const detected = useDetected(models);
  const [opening, setOpening] = useState(false);
  const ids = models.map(m => m.id).join('|');
  useEffect(() => { setOpening(false); }, [ids]);
  const overridden = models.length > 0 && models.every(m => Number(m.num_ctx) > 0);
  const overriding = overridden || opening;

  function toggleOverride() {
    if (overriding) {
      setOpening(false);
      edit({ num_ctx: 0 });
      return;
    }
    setOpening(true);
    for (const m of models) if (detected[m.id] > 0 && !(Number(m.num_ctx) > 0)) editOne(m.id, { num_ctx: detected[m.id] });
  }

  return (
    <>
      <Card title={t('Context window')} sub={t('What happens as a conversation approaches the model’s limit.')}>
        <Rows>
          <Line label={t('Override window size')} k="num_ctx" note={detectedNote(models, detected, overriding)}>
            <Switch on={overriding} label={t('Override window size')} onToggle={toggleOverride} />
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