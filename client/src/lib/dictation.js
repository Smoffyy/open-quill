import { useState, useRef, useEffect } from 'react';
import { transcribeBlob } from '../voice.js';
import { toast } from '../toast.js';
import { t } from '../i18n.jsx';

function warn(msg) { try { toast(msg, { icon: 'info', kind: 'warn', duration: 4200 }); } catch {} }

export function useDictation({ sttEngine, valueRef, onChange }) {
  const [dictating, setDictating] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef(null);
  const mediaRef = useRef(null);
  const streamRef = useRef(null);
  const disposedRef = useRef(false);

  // The microphone is held by the MediaStream, not by the recorder, so every path out of
  // dictation has to release the tracks. Leaving it to onstop alone kept the mic light on
  // whenever the recorder failed to construct or the composer unmounted mid-getUserMedia.
  function releaseStream() {
    const s = streamRef.current;
    streamRef.current = null;
    if (s) { try { s.getTracks().forEach(track => track.stop()); } catch {} }
  }

  function stop(silent) {
    if (recRef.current) { try { recRef.current.stop(); } catch {} recRef.current = null; }
    const mr = mediaRef.current;
    if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch { mediaRef.current = null; releaseStream(); } }
    else if (mr) { mediaRef.current = null; releaseStream(); }
    else releaseStream();
    if (!silent) setDictating(false);
  }
  useEffect(() => () => { disposedRef.current = true; stop(true); }, []);

  function appendText(text) {
    const cur = valueRef.current || '';
    onChange((cur ? cur.replace(/\s+$/, '') + ' ' : '') + text.trim());
  }

  async function toggle() {
    if (dictating) { stop(); return; }
    if (sttEngine === 'browser') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { warn(t('This browser has no built-in speech recognition.')); return; }
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      let base = valueRef.current || '';
      rec.onresult = (e) => {
        let fin = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const piece = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += piece; else interim += piece;
        }
        if (fin) base = (base ? base.replace(/\s+$/, '') + ' ' : '') + fin.trim();
        onChange(base + (interim ? (base ? ' ' : '') + interim : ''));
      };
      rec.onend = () => { setDictating(false); recRef.current = null; };
      rec.onerror = () => { setDictating(false); recRef.current = null; };
      recRef.current = rec;
      try { rec.start(); setDictating(true); } catch {}
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch { warn(t('Microphone access denied.')); return; }
    streamRef.current = stream;
    // The await above can outlive the component; without this the mic stays open for good.
    if (disposedRef.current) { releaseStream(); return; }
    try {
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        releaseStream();
        mediaRef.current = null;
        setDictating(false);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 1500 || disposedRef.current) return;
        setTranscribing(true);
        try { const text = await transcribeBlob(blob); if (text && !disposedRef.current) appendText(text); }
        catch (e) { warn(e.message || t('Transcription failed.')); }
        setTranscribing(false);
      };
      mediaRef.current = mr;
      mr.start();
      setDictating(true);
    } catch {
      mediaRef.current = null;
      releaseStream();
      warn(t('Could not start recording on this browser.'));
    }
  }

  return { dictating, transcribing, toggleDictation: toggle, stopDictation: stop, appendText };
}
