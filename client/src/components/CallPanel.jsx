import { useState, useEffect, useRef } from 'react';
import { voiceSubscribe, setVoiceActive, transcribeBlob, fetchSpeech, cleanForSpeech, extractSentences } from '../voice.js';
import { t } from '../i18n.jsx';

const MODES = { listening: 'Listening…', hearing: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking' };

export default function CallPanel({ chatId, model, voice, active = true, onSendText }) {
  const [mode, setMode] = useState('connecting');
  const [err, setErr] = useState('');
  const [, setLastHeard] = useState('');
  const [shown, setShown] = useState(false);
  const orbRef = useRef(null);
  const smooth = useRef(0);
  const orbClock = useRef(0);
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
  const closedRef = useRef(false);
  const suppressTts = useRef(false);

  const setModeSafe = (m) => { modeRef.current = m; setMode(m); };
  useEffect(() => { chatRef.current = chatId; }, [chatId]);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(!!active)); return () => cancelAnimationFrame(id); }, [active]);

  function level(analyser) {
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }

  let lastFrame = 0;
  function animate(ts) {
    const m = modeRef.current;
    let raw = 0;
    if (m === 'speaking' && voice.tts === 'server') raw = level(outAnalyser.current) * 2.6;
    else if (m === 'speaking') raw = 0.34 + Math.sin(Date.now() / 170) * 0.14;
    else if ((m === 'hearing' || m === 'listening') && !mutedRef.current) raw = level(micAnalyser.current) * 2.1;
    else if (m === 'thinking') raw = 0.16 + Math.sin(Date.now() / 300) * 0.06;
    smooth.current += (Math.min(1, raw) - smooth.current) * 0.16;

    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0.016;
    lastFrame = ts;
    orbClock.current += dt * (0.5 + smooth.current * 1.6);
    drawOrb(smooth.current, m);
    rafRef.current = requestAnimationFrame(animate);
  }

  function drawOrb(lvl, m) {
    const cvs = orbRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const W = cvs.width, H = cvs.height, cx = W / 2, cy = H / 2, R = W * 0.47;
    const tt = orbClock.current;
    const dim = (m === 'connecting' || m === 'error');
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    const base = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
    base.addColorStop(0, '#5566ec');
    base.addColorStop(0.5, '#8a97f4');
    base.addColorStop(1, '#c3cbfb');
    ctx.fillStyle = base;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    ctx.globalCompositeOperation = 'screen';
    const clouds = [
      { c: '255,255,255', fx: 0.55, fy: 0.8, ph: 0.0, rad: 0.72, oy: 0.28 },
      { c: '224,232,255', fx: 0.9, fy: 1.15, ph: 2.1, rad: 0.55, oy: 0.42 },
      { c: '255,255,255', fx: 1.25, fy: 0.65, ph: 4.2, rad: 0.46, oy: 0.5 },
      { c: '176,190,252', fx: 0.7, fy: 1.4, ph: 1.3, rad: 0.6, oy: -0.15 },
    ];
    const swing = R * (0.34 + lvl * 0.42);
    for (const b of clouds) {
      const bx = cx + Math.sin(tt * b.fx + b.ph) * swing;
      const by = cy + b.oy * R + Math.cos(tt * b.fy + b.ph * 1.4) * swing * 0.7;
      const br = R * b.rad * (0.9 + lvl * 0.45);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(${b.c},${(0.55 + lvl * 0.35).toFixed(3)})`);
      g.addColorStop(1, `rgba(${b.c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
    const shade = ctx.createRadialGradient(cx - R * 0.28, cy - R * 0.34, R * 0.2, cx, cy, R * 1.02);
    shade.addColorStop(0, 'rgba(255,255,255,0)');
    shade.addColorStop(0.72, 'rgba(40,50,120,0)');
    shade.addColorStop(1, 'rgba(30,38,96,0.42)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    cvs.style.transform = `scale(${(1 + lvl * 0.12).toFixed(3)})`;
    cvs.style.opacity = dim ? '0.5' : '1';
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
        } catch (e) { setErr(e.message || t('Transcription failed.')); setModeSafe('listening'); }
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
    if (!SR) { setErr(t('This browser has no built-in speech recognition. Switch the speech-to-text engine to a server in the admin panel, or use Chrome.')); return false; }
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
    rec.onerror = (e) => { if (e.error === 'not-allowed') setErr(t('Microphone permission denied.')); };
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
    } catch (e) { setErr(e.message || t('Speech playback failed.')); ttsQ.current = []; genDone.current = true; }
    ttsBusy.current = false;
    if (!closedRef.current) pumpTts();
  }

  function speakBrowser(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const local = voices.filter(v => v.localService !== false);
      const pool = local.length ? local : voices;
      if (voice.ttsVoice) {
        const want = voice.ttsVoice.toLowerCase();
        const named = (list) => list.find(v => v.name === voice.ttsVoice) || list.find(v => v.name.toLowerCase().includes(want));
        const match = named(pool) || named(voices);
        if (match) u.voice = match;
      }
      if (!u.voice && local.length) {
        const lang = (navigator.language || 'en').toLowerCase();
        u.voice = local.find(v => (v.lang || '').toLowerCase() === lang)
          || local.find(v => (v.lang || '').toLowerCase().startsWith(lang.slice(0, 2)))
          || local[0];
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
      audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('Audio playback failed.'))); };
      audio.src = url;
      audio.play().then(() => {
        if (!srcNode.current && ctxRef.current) {
          try {
            srcNode.current = ctxRef.current.createMediaElementSource(audio);
            srcNode.current.connect(outAnalyser.current);
            outAnalyser.current.connect(ctxRef.current.destination);
          } catch {}
        }
      }).catch(() => { URL.revokeObjectURL(url); reject(new Error(t('Audio playback blocked.'))); });
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
        setErr(t('Microphone access is required for calls. Allow the microphone and try again.'));
        setModeSafe('error');
      }
    })();

    const cvs = orbRef.current;
    if (cvs) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cvs.width = Math.round(cvs.clientWidth * dpr) || Math.round(150 * dpr);
      cvs.height = Math.round(cvs.clientHeight * dpr) || Math.round(150 * dpr);
    }

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

  const statusText = err || (mode === 'connecting' ? 'Connecting…' : MODES[mode] || '');

  return (
    <div className={'call-dock' + (shown ? ' shown' : '')}>
      <div className={'call-orb-wrap ' + mode}
        onClick={interrupt} title={mode === 'speaking' ? t('Tap to interrupt') : ''} role="img"
        aria-label={statusText || t('Voice call')}>
        <canvas ref={orbRef} className="call-orb" aria-hidden="true" />
      </div>
    </div>
  );
}
