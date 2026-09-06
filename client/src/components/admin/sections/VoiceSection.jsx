import { useAdmin } from '../store.jsx';
import { Card, Rows, Row, ToggleRow, Fields, Field, Input, Seg, Note } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

// Speech-to-text and text-to-speech take exactly the same three fields, so the
// two panes cannot drift apart.
function Endpoint({ settings, set, prefix, path, urlPlaceholder, modelPlaceholder }) {
  return (
    <Fields cols={3}>
      <Field label={t('Base URL')} hint={t('The server posts to {path} on this base.', { path })}>
        <Input mono value={settings[prefix + 'Url'] || ''} placeholder={urlPlaceholder}
          onChange={(e) => set(prefix + 'Url', e.target.value)} />
      </Field>
      <Field label={t('API key')} optional>
        <Input mono type="password" value={settings[prefix + 'Key'] || ''} placeholder={t('none')}
          onChange={(e) => set(prefix + 'Key', e.target.value)} />
      </Field>
      <Field label={t('Model')}>
        <Input mono value={settings[prefix + 'Model'] || ''} placeholder={modelPlaceholder}
          onChange={(e) => set(prefix + 'Model', e.target.value)} />
      </Field>
    </Fields>
  );
}

export default function VoiceSection() {
  const { workspace } = useAdmin();
  const { settings, set, setSettings } = workspace;
  const mic = !!settings.voiceMicEnabled;
  const call = !!settings.voiceCallEnabled;
  const stt = settings.voiceSttEngine || 'browser';
  const tts = settings.voiceTtsEngine || 'browser';
  const engines = [{ value: 'browser', label: t('Browser') }, { value: 'server', label: t('Server endpoint') }];

  return (
    <>
      <Card title={t('Composer buttons')} sub={t('Each control disappears from the message bar entirely when off.')}>
        <Rows>
          <ToggleRow label={t('Dictation')} on={mic} onToggle={() => set('voiceMicEnabled', !mic)}
            note={t('A microphone button that transcribes speech into the message box. Nothing is sent until the user submits.')} />
          <ToggleRow label={t('Calls')} on={call}
            onToggle={() => setSettings(s => ({ ...s, voiceCallEnabled: !call, voiceMicEnabled: !call ? true : s.voiceMicEnabled }))}
            note={t('A hands-free panel where spoken turns are saved to the chat like typed ones and replies are read back. Turning this on also enables dictation.')} />
        </Rows>
      </Card>

      {(mic || call) && (
        <Card title={t('Speech to text')} sub={t('Where recorded audio is transcribed.')}>
          <Rows>
            <Row label={t('Engine')}>
              <Seg value={stt} label={t('Speech to text engine')} onChange={(v) => set('voiceSttEngine', v)} options={engines} />
            </Row>
          </Rows>
          {stt === 'browser'
            ? <Note>{t('Chrome uploads the audio to Google to transcribe it, so this path needs internet and is not local. Use a server endpoint to keep audio on your own machines.')}</Note>
            : (
              <>
                <Endpoint settings={settings} set={set} prefix="voiceStt" path="/audio/transcriptions"
                  urlPlaceholder="http://localhost:8000/v1" modelPlaceholder="whisper-1" />
                <Note>{t('Any OpenAI-compatible transcription endpoint works: whisper.cpp server, faster-whisper-server, Speaches, or OpenAI itself.')}</Note>
              </>
            )}
        </Card>
      )}

      {call && (
        <Card title={t('Text to speech')} sub={t('How replies are read aloud during a call.')}>
          <Rows>
            <Row label={t('Engine')}>
              <Seg value={tts} label={t('Text to speech engine')} onChange={(v) => set('voiceTtsEngine', v)} options={engines} />
            </Row>
          </Rows>
          {tts === 'browser'
            ? <Note>{t('Uses the voices Chrome exposes. A locally installed system voice is preferred automatically; Chrome network voices are synthesised by Google and need internet.')}</Note>
            : <Endpoint settings={settings} set={set} prefix="voiceTts" path="/audio/speech"
              urlPlaceholder="http://localhost:8880/v1" modelPlaceholder="tts-1" />}
          <Fields cols={2}>
            <Field label={t('Voice')}
              hint={tts === 'server'
                ? t('The voice id sent to the endpoint, for example alloy or af_bella.')
                : t('Matched against the names of voices installed in the browser. Blank uses the system default.')}>
              <Input mono value={settings.voiceTtsVoice || ''}
                placeholder={tts === 'server' ? 'alloy' : 'Google US English'}
                onChange={(e) => set('voiceTtsVoice', e.target.value)} />
            </Field>
            <Field label={t('Rate')} hint={t('Playback speed multiplier, 0.25 to 4.')}>
              <Input type="number" min="0.25" max="4" step="0.05" value={settings.voiceTtsSpeed ?? 1}
                onChange={(e) => set('voiceTtsSpeed', e.target.value)} />
            </Field>
          </Fields>
        </Card>
      )}
    </>
  );
}
