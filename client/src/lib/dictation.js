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

  function stop(silent) {
    if (recRef.current) { try { recRef.current.stop(); } catch {} recRef.current = null; }
    if (mediaRef.current && mediaRef.current.state !== 'inactive') { try { mediaRef.current.stop(); } catch {} }
    if (!silent) setDictating(false);
  }
  useEffect(() => () => { stop(true); }, []);

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        mediaRef.current = null;
        setDictating(false);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 1500) return;
        setTranscribing(true);
        try { const text = await transcribeBlob(blob); if (text) appendText(text); }
        catch (e) { warn(e.message || t('Transcription failed.')); }
        setTranscribing(false);
      };
      mediaRef.current = mr;
      mr.start();
      setDictating(true);
    } catch { warn(t('Microphone access denied.')); }
  }

  return { dictating, transcribing, toggleDictation: toggle, stopDictation: stop, appendText };
}
