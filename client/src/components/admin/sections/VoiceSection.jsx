import { useAdmin } from '../store.jsx';
import { Block, Row, Fields, Field, Input, Seg, Switch, Note } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function VoiceSection() {
  const { workspace } = useAdmin();
  const { settings, set, setSettings } = workspace;
  const mic = !!settings.voiceMicEnabled;
  const call = !!settings.voiceCallEnabled;
  const stt = settings.voiceSttEngine || 'browser';
  const tts = settings.voiceTtsEngine || 'browser';

  return (
    <>
      <Block title={t('Composer buttons')} sub={t('Each control disappears from the message bar entirely when off.')}>
        <Row label={t('Dictation')}
          note={t('A microphone button that transcribes speech into the message box. Nothing is sent until the user submits.')}>
          <Switch on={mic} label={t('Dictation')} onToggle={() => set('voiceMicEnabled', !mic)} />
        </Row>
        <Row label={t('Calls')}
          note={t('A hands-free panel where spoken turns are saved to the chat like typed ones and replies are read back. Turning this on also enables dictation.')}>
          <Switch on={call} label={t('Calls')}
            onToggle={() => setSettings(s => ({ ...s, voiceCallEnabled: !call, voiceMicEnabled: !call ? true : s.voiceMicEnabled }))} />
        </Row>
      </Block>

      {(mic || call) && (
        <Block title={t('Speech to text')} sub={t('Where recorded audio is transcribed.')}>
          <Fields>
            <Field label={t('Engine')}>
              <Seg value={stt} label={t('Speech to text engine')} onChange={(v) => set('voiceSttEngine', v)}
                options={[{ value: 'browser', label: t('Browser') }, { value: 'server', label: t('Server endpoint') }]} />
            </Field>
          </Fields>
          {stt === 'browser'
            ? <Note>{t('Chrome uploads the audio to Google to transcribe it, so this path needs internet and is not local. Use a server endpoint to keep audio on your own machines.')}</Note>
            : (
              <Fields cols={3}>
                <Field label={t('Base URL')} hint={t('The server posts to {path} on this base.', { path: '/audio/transcriptions' })}>
                  <Input mono value={settings.voiceSttUrl || ''} placeholder="http://localhost:8000/v1"
                    onChange={(e) => set('voiceSttUrl', e.target.value)} />
                </Field>
                <Field label={t('API key')} optional>
                  <Input mono type="password" value={settings.voiceSttKey || ''} placeholder={t('none')}
                    onChange={(e) => set('voiceSttKey', e.target.value)} />
                </Field>
                <Field label={t('Model')}>
                  <Input mono value={settings.voiceSttModel || ''} placeholder="whisper-1"
                    onChange={(e) => set('voiceSttModel', e.target.value)} />
                </Field>
              </Fields>
            )}
          {stt === 'server' && (
            <div style={{ marginTop: 12 }}>
              <Note>{t('Any OpenAI-compatible transcription endpoint works: whisper.cpp server, faster-whisper-server, Speaches, or OpenAI itself.')}</Note>
            </div>
          )}
        </Block>
      )}

      {call && (
        <Block title={t('Text to speech')} sub={t('How replies are read aloud during a call.')}>
          <Fields>
            <Field label={t('Engine')}>
              <Seg value={tts} label={t('Text to speech engine')} onChange={(v) => set('voiceTtsEngine', v)}
                options={[{ value: 'browser', label: t('Browser') }, { value: 'server', label: t('Server endpoint') }]} />
            </Field>
          </Fields>
          {tts === 'browser'
            ? <Note>{t('Uses the voices Chrome exposes. A locally installed system voice is preferred automatically; Chrome network voices are synthesised by Google and need internet.')}</Note>
            : (
              <Fields cols={3}>
                <Field label={t('Base URL')} hint={t('The server posts to {path} on this base.', { path: '/audio/speech' })}>
                  <Input mono value={settings.voiceTtsUrl || ''} placeholder="http://localhost:8880/v1"
                    onChange={(e) => set('voiceTtsUrl', e.target.value)} />
                </Field>
                <Field label={t('API key')} optional>
                  <Input mono type="password" value={settings.voiceTtsKey || ''} placeholder={t('none')}
                    onChange={(e) => set('voiceTtsKey', e.target.value)} />
                </Field>
                <Field label={t('Model')}>
                  <Input mono value={settings.voiceTtsModel || ''} placeholder="tts-1"
                    onChange={(e) => set('voiceTtsModel', e.target.value)} />
                </Field>
              </Fields>
            )}
          <div style={{ marginTop: 14 }}>
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
          </div>
        </Block>
      )}
    </>
  );
}
