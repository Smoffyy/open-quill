import React, { useState, useEffect, useRef } from 'react';
import { voiceSubscribe, setVoiceActive, transcribeBlob, fetchSpeech, cleanForSpeech, extractSentences } from '../voice.js';
import { Mic, X } from './icons.jsx';

const MODES = { listening: 'Listening…', hearing: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking' };

export default function CallPanel({ chatId, model, voice, onSendText, onClose }) {
  const [mode, setMode] = useState('connecting');
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState('');
  const [lastHeard, setLastHeard] = useState('');
  const orbRef = useRef(null);
  const modeRef = useRef('connecting');
  const mutedRef = useRef(false);
  const chatRef = useRef(chatId);
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const micAnalyser = useRef(null);
  const outAnalyser = useRef(null);
  const rafRef = useRef(0);
  const recRef = useRef(null);
  const srRef = useRef(null);
  const vad = useRef({ speaking: false, above: 0, silentAt: 0, floor: 0.008 });
  const audioRef = useRef(null);
  const srcNode = useRef(null);
  const ttsQ = useRef([]);
  const ttsBusy = useRef(false);
  const sentBuf = useRef('');
  const genDone = useRef(true);
  const smooth = useRef(0);
  const closedRef = useRef(false);
  const suppressTts = useRef(false);

  const setModeSafe = (m) => { modeRef.current = m; setMode(m); };
  useEffect(() => { chatRef.current = chatId; }, [chatId]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  function level(analyser) {
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }

  function animate() {
    const m = modeRef.current;
    let raw = 0;
    if (m === 'speaking' && voice.tts === 'server') raw = level(outAnalyser.current) * 2.4;
    else if (m === 'speaking') raw = 0.28 + Math.sin(Date.now() / 180) * 0.1;
    else if (m === 'hearing' || m === 'listening') raw = level(micAnalyser.current) * 2.0;
    else if (m === 'thinking') raw = 0.1 + Math.sin(Date.now() / 300) * 0.06;
    smooth.current += (Math.min(1, raw) - smooth.current) * 0.18;
    const el = orbRef.current;
    if (el) el.style.transform = `scale(${1 + smooth.current * 0.45})`;
    rafRef.current = requestAnimationFrame(animate);
  }

  function vadTick() {
    if (voice.stt !== 'server') return;
    if (modeRef.current !== 'listening' && modeRef.current !== 'hearing') return;
    if (mutedRef.current) return;
    const rms = level(micAnalyser.current);
    const v = vad.current;
    v.floor = v.floor * 0.995 + Math.min(rms, v.floor) * 0.005;
    const threshold = Math.max(0.015, v.floor * 3);
    if (!v.speaking) {
      if (rms > threshold) { v.above++; if (v.above >= 4) startUtterance(); }
      else v.above = 0;
    } else {
      if (rms > threshold) v.silentAt = 0;
      else if (!v.silentAt) v.silentAt = Date.now();
      else if (Date.now() - v.silentAt > 900) endUtterance();
    }
  }

  function startUtterance() {
    const v = vad.current;
    v.speaking = true; v.above = 0; v.silentAt = 0;
    setModeSafe('hearing');
    try {
      const mr = new MediaRecorder(streamRef.current);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (closedRef.current || blob.size < 1500) { if (!closedRef.current) setModeSafe('listening'); return; }
        setModeSafe('thinking');
        try {
          const text = await transcribeBlob(blob);
          if (closedRef.current) return;
          if (text) { setLastHeard(text); sendUser(text); }
          else setModeSafe('listening');
        } catch (e) { setErr(e.message || 'Transcription failed.'); setModeSafe('listening'); }
      };
      recRef.current = mr;
      mr.start();
    } catch { v.speaking = false; }
  }

  function endUtterance() {
    const v = vad.current;
    v.speaking = false; v.silentAt = 0; v.above = 0;
    const mr = recRef.current;
    recRef.current = null;
    if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch {} }
  }

  function startBrowserSR() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('This browser has no built-in speech recognition. Switch the speech-to-text engine to a server in the admin panel, or use Chrome.'); return false; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      if (modeRef.current !== 'listening' && modeRef.current !== 'hearing') return;
      let fin = '', interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else interim += t;
      }
      if (interim && modeRef.current === 'listening') setModeSafe('hearing');
      if (fin.trim()) {
        setLastHeard(fin.trim());
        setModeSafe('thinking');
        try { rec.stop(); } catch {}
        sendUser(fin.trim());
      }
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') setErr('Microphone permission denied.'); };
    rec.onend = () => {
      if (closedRef.current) return;
      if ((modeRef.current === 'listening' || modeRef.current === 'hearing') && !mutedRef.current) {
        try { rec.start(); } catch {}
      }
    };
    srRef.current = rec;
    try { rec.start(); } catch {}
    return true;
  }

  function sendUser(text) {
    sentBuf.current = '';
    genDone.current = false;
    onSendText(text);
  }

  function enqueueTts(sentence) {
    if (suppressTts.current) return;
    const t = cleanForSpeech(sentence).trim();
    if (!t || t.length < 2) return;
    if (voice.tts === 'server') ttsQ.current.push({ text: t });
    else ttsQ.current.push({ text: t, browser: true });
    pumpTts();
  }

  async function pumpTts() {
    if (ttsBusy.current || closedRef.current) return;
    const item = ttsQ.current.shift();
    if (!item) {
      if (genDone.current && (modeRef.current === 'speaking' || modeRef.current === 'thinking')) resumeListening();
      return;
    }
    ttsBusy.current = true;
    setModeSafe('speaking');
    pauseMicInput();
    try {
      if (item.browser) await speakBrowser(item.text);
      else await speakServer(item.text);
    } catch (e) { setErr(e.message || 'Speech playback failed.'); ttsQ.current = []; genDone.current = true; }
    ttsBusy.current = false;
    if (!closedRef.current) pumpTts();
  }

  function speakBrowser(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      if (voice.ttsVoice) {
        const match = voices.find(v => v.name === voice.ttsVoice) || voices.find(v => v.name.toLowerCase().includes(voice.ttsVoice.toLowerCase()));
        if (match) u.voice = match;
      }
      u.rate = voice.ttsSpeed || 1;
      u.onend = resolve;
      u.onerror = resolve;
      window.speechSynthesis.speak(u);
    });
  }

  async function speakServer(text) {
    const blob = await fetchSpeech(text);
    if (closedRef.current) return;
    return new Promise((resolve, reject) => {
      const audio = audioRef.current;
      const url = URL.createObjectURL(blob);
      const done = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onended = done;
      audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Audio playback failed.')); };
      audio.src = url;
      audio.play().then(() => {
        if (!srcNode.current && ctxRef.current) {
          try {
            srcNode.current = ctxRef.current.createMediaElementSource(audio);
            srcNode.current.connect(outAnalyser.current);
            outAnalyser.current.connect(ctxRef.current.destination);
          } catch {}
        }
      }).catch(() => { URL.revokeObjectURL(url); reject(new Error('Audio playback blocked.')); });
    });
  }

  function pauseMicInput() {
    if (voice.stt === 'browser' && srRef.current) { try { srRef.current.stop(); } catch {} }
    if (vad.current.speaking) endUtterance();
  }

  function resumeListening() {
    if (closedRef.current) return;
    setModeSafe('listening');
    if (mutedRef.current) return;
    if (voice.stt === 'browser' && srRef.current) { try { srRef.current.start(); } catch {} }
  }

  function interrupt() {
    if (modeRef.current !== 'speaking') return;
    suppressTts.current = true;
    ttsQ.current = [];
    genDone.current = true;
    if (voice.tts === 'browser') { try { window.speechSynthesis.cancel(); } catch {} }
    const audio = audioRef.current;
    if (audio) { try { audio.pause(); audio.onended && audio.onended(); } catch {} }
    resumeListening();
  }

  useEffect(() => {
    setVoiceActive(true);
    const unsub = voiceSubscribe((e) => {
      if (e.chatId !== chatRef.current) return;
      if (e.type === 'start') { sentBuf.current = ''; genDone.current = false; suppressTts.current = false; return; }
      if (e.type === 'content') {
        sentBuf.current += e.text;
        const { sentences, rest } = extractSentences(sentBuf.current);
        sentBuf.current = rest;
        for (const s of sentences) enqueueTts(s);
        return;
      }
      if (e.type === 'done') {
        genDone.current = true;
        const tail = sentBuf.current.trim();
        sentBuf.current = '';
        if (tail) enqueueTts(tail);
        else if (!ttsBusy.current && !ttsQ.current.length) resumeListening();
        return;
      }
      if (e.type === 'error') {
        genDone.current = true;
        sentBuf.current = '';
        if (!ttsBusy.current && !ttsQ.current.length) resumeListening();
      }
    });

    (async () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ctxRef.current = new Ctx();
        try { await ctxRef.current.resume(); } catch {}
        outAnalyser.current = ctxRef.current.createAnalyser();
        outAnalyser.current.fftSize = 512;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        streamRef.current = stream;
        const src = ctxRef.current.createMediaStreamSource(stream);
        micAnalyser.current = ctxRef.current.createAnalyser();
        micAnalyser.current.fftSize = 512;
        src.connect(micAnalyser.current);
        audioRef.current = new Audio();
        setModeSafe('listening');
        if (voice.stt === 'browser') startBrowserSR();
      } catch {
        setErr('Microphone access is required for calls. Allow the microphone and try again.');
        setModeSafe('error');
      }
    })();

    const vadTimer = setInterval(vadTick, 50);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      closedRef.current = true;
      setVoiceActive(false);
      unsub();
      clearInterval(vadTimer);
      cancelAnimationFrame(rafRef.current);
      try { srRef.current && srRef.current.abort(); } catch {}
      try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
      try { audioRef.current && audioRef.current.pause(); } catch {}
      try { streamRef.current && streamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      try { ctxRef.current && ctxRef.current.close(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (mode !== 'listening') return;
    if (muted) pauseMicInput();
    else if (voice.stt === 'browser' && srRef.current) { try { srRef.current.start(); } catch {} }
  }, [muted]);

  const statusText = err || (mode === 'connecting' ? 'Connecting…' : muted && (mode === 'listening' || mode === 'hearing') ? 'Muted' : MODES[mode] || '');

  return (
    <div className="callpanel">
      <div className="cp-head">
        <div className="cp-title">
          {model?.staticIcon ? <img className="cp-model-icon" src={model.staticIcon} alt="" /> : null}
          <span>{model?.displayName || 'Voice call'}</span>
        </div>
        <button className="cp-close" onClick={onClose} title="Close panel"><X style={{ width: 16 }} /></button>
      </div>
      <div className="cp-stage" onClick={interrupt} title={mode === 'speaking' ? 'Tap to interrupt' : ''}>
        <div ref={orbRef} className={'cp-orb ' + mode + (muted ? ' muted' : '')} />
        <div className="cp-status">{statusText}</div>
        {lastHeard && !err && <div className="cp-heard">“{lastHeard}”</div>}
        {mode === 'speaking' && <div className="cp-hint">Tap the orb to interrupt</div>}
      </div>
      <div className="cp-bar">
        <button className={'cp-btn' + (muted ? ' on' : '')} onClick={() => setMuted(m => !m)} title={muted ? 'Unmute microphone' : 'Mute microphone'}>
          <Mic style={{ width: 18 }} />
          {muted && <span className="cp-slash" />}
        </button>
        <button className="cp-btn hangup" onClick={onClose} title="End call"><X style={{ width: 18 }} /></button>
      </div>
    </div>
  );
}
