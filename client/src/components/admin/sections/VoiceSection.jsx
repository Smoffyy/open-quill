import React from 'react';
import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, SegPick, SettingRow } from '../widgets.jsx';
import { t } from '../../../i18n.jsx';

export default function VoiceSection() {
  const A = useAdmin();
  const { settings, setSettings, settingsSave } = A;
  return (
    <>
      <Card title={t("Features")} sub={t("Both buttons disappear from the composer entirely when turned off.")}>
        <SettingRow label={t("Microphone (dictation)")} note={t("Adds a mic button to the input bar. Speech is transcribed into the message box, nothing sends until the user hits enter.")}
          on={!!settings.voiceMicEnabled} onToggle={() => setSettings(s => ({ ...s, voiceMicEnabled: !s.voiceMicEnabled }))} />
        <SettingRow last label={t("Voice calls")} note={t("Adds a call button that opens a hands-free voice conversation panel. Spoken turns are saved to the chat like typed messages, and replies are read aloud.")}
          on={!!settings.voiceCallEnabled} onToggle={() => setSettings(s => ({ ...s, voiceCallEnabled: !s.voiceCallEnabled, voiceMicEnabled: !s.voiceCallEnabled ? true : s.voiceMicEnabled }))} />
      </Card>
      {(settings.voiceMicEnabled || settings.voiceCallEnabled) && (
        <Card title={t("Speech-to-text")} sub={t("How spoken audio becomes text.")}>
          <div className="field"><label>{t("Engine")}</label>
            <SegPick value={settings.voiceSttEngine || 'browser'} options={[['browser', 'Browser built-in'], ['server', 'Server (Whisper)']]}
              onChange={(v) => setSettings(s => ({ ...s, voiceSttEngine: v }))} />
            <div className="muted-note">{t("Browser uses Chrome's built-in speech recognition, zero setup, no audio leaves the machine beyond what the browser does. Server sends recorded audio to any OpenAI-compatible transcription endpoint: whisper.cpp's server, faster-whisper-server, Speaches, or OpenAI itself.")}</div>
          </div>
          {settings.voiceSttEngine === 'server' && <>
            <div className="field"><label>{t("Base URL")}</label>
              <input value={settings.voiceSttUrl || ''} onChange={(e) => setSettings(s => ({ ...s, voiceSttUrl: e.target.value }))} placeholder={t("http://localhost:8000/v1")} />
              <div className="muted-note">The server calls <code>{'{base}'}/audio/transcriptions</code>. Keys never reach the browser.</div>
            </div>
            <div className="two-col">
              <div className="field"><label>API key <span className="muted-note" style={{ display: 'inline' }}>(optional for local)</span></label>
                <input value={settings.voiceSttKey || ''} onChange={(e) => setSettings(s => ({ ...s, voiceSttKey: e.target.value }))} placeholder={t("Not required for whisper.cpp")} /></div>
              <div className="field"><label>{t("Model")}</label>
                <input value={settings.voiceSttModel || ''} onChange={(e) => setSettings(s => ({ ...s, voiceSttModel: e.target.value }))} placeholder={t("whisper-1")} /></div>
            </div>
          </>}
        </Card>
      )}
      {settings.voiceCallEnabled && (
        <Card title={t("Text-to-speech")} sub={t("How replies are read aloud during calls.")}>
          <div className="field"><label>{t("Engine")}</label>
            <SegPick value={settings.voiceTtsEngine || 'browser'} options={[['browser', 'Browser built-in'], ['server', 'Server (OpenAI-compatible)']]}
              onChange={(v) => setSettings(s => ({ ...s, voiceTtsEngine: v }))} />
            <div className="muted-note">Browser uses the operating system voices via Chrome, fully local, zero setup. Server sends text to any OpenAI-compatible <code>/audio/speech</code> endpoint: openedai-speech, Kokoro-FastAPI, Piper wrappers, or OpenAI.</div>
          </div>
          {settings.voiceTtsEngine === 'server' && <>
            <div className="field"><label>{t("Base URL")}</label>
              <input value={settings.voiceTtsUrl || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsUrl: e.target.value }))} placeholder={t("http://localhost:8880/v1")} /></div>
            <div className="two-col">
              <div className="field"><label>API key <span className="muted-note" style={{ display: 'inline' }}>(optional for local)</span></label>
                <input value={settings.voiceTtsKey || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsKey: e.target.value }))} placeholder={t("Not required for local servers")} /></div>
              <div className="field"><label>{t("Model")}</label>
                <input value={settings.voiceTtsModel || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsModel: e.target.value }))} placeholder={t("tts-1")} /></div>
            </div>
          </>}
          <div className="two-col">
            <div className="field"><label>{t("Voice")}</label>
              <input value={settings.voiceTtsVoice || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsVoice: e.target.value }))} placeholder={settings.voiceTtsEngine === 'server' ? 'alloy' : 'e.g. Google US English'} />
              <div className="muted-note">{settings.voiceTtsEngine === 'server' ? 'The voice name sent to the endpoint (e.g. alloy, af_bella for Kokoro).' : 'Matched against the browser\u2019s installed voice names. Leave blank for the system default.'}</div>
            </div>
            <div className="field"><label>{t("Speed")}</label>
              <input type="number" min="0.25" max="4" step="0.05" value={settings.voiceTtsSpeed ?? 1} onChange={(e) => setSettings(s => ({ ...s, voiceTtsSpeed: e.target.value }))} placeholder="1" /></div>
          </div>
        </Card>
      )}
      <AutosaveNote status={settingsSave} live />
    </>
  );
}
