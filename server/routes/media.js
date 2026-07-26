import multer from 'multer';
import { getSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import * as membank from '../membank.js';
import { diskStore } from '../lib/uploads.js';
import { roleLimit } from '../lib/models.js';

const upload = multer({ storage: diskStore, limits: { fileSize: 8 * 1024 * 1024 } });
const membankUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const voiceUrl = (base, p) => String(base || '').trim().replace(/\/+$/, '') + p;

export default function registerMediaRoutes(app) {
  app.post('/api/admin/upload', authMiddleware, adminOnly, (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (max 8 MB).' : 'Upload failed.' });
      if (!req.file) return res.status(400).json({ error: 'No file received.' });
      res.json({ url: `/uploads/${req.file.filename}` });
    });
  });

  app.post('/api/upload', authMiddleware, (req, res) => {
    const mb = roleLimit('upload_limit_mb', !!req.user.is_admin, 8) || 8;
    const mw = multer({ storage: diskStore, limits: { fileSize: Math.max(1, mb) * 1024 * 1024 } }).array('files', 10);
    mw(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `That file is too large (max ${mb} MB).` : 'Upload failed.' });
      res.json({ files: (req.files || []).map(f => ({ url: `/uploads/${f.filename}`, name: f.originalname, type: f.mimetype, size: f.size })) });
    });
  });

  app.post('/api/voice/transcribe', authMiddleware, voiceUpload.single('audio'), async (req, res) => {
    if (getSetting('voice_mic_enabled', '0') !== '1' && getSetting('voice_call_enabled', '0') !== '1') return res.status(403).json({ error: 'Voice features are disabled.' });
    if (getSetting('voice_stt_engine', 'browser') !== 'server') return res.status(400).json({ error: 'Server transcription is not enabled.' });
    const base = getSetting('voice_stt_url', '');
    if (!base) return res.status(400).json({ error: 'No transcription endpoint configured.' });
    if (!req.file || !req.file.buffer || !req.file.buffer.length) return res.status(400).json({ error: 'No audio received.' });
    try {
      const fd = new FormData();
      fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), req.file.originalname || 'audio.webm');
      fd.append('model', getSetting('voice_stt_model', 'whisper-1'));
      fd.append('response_format', 'json');
      const key = getSetting('voice_stt_key', '');
      const r = await fetch(voiceUrl(base, '/audio/transcriptions'), { method: 'POST', headers: key ? { Authorization: 'Bearer ' + key } : {}, body: fd });
      if (!r.ok) { const err = await r.text().catch(() => ''); return res.status(502).json({ error: 'Transcription failed (' + r.status + ').' + (err ? ' ' + err.slice(0, 200) : '') }); }
      const d = await r.json().catch(() => ({}));
      res.json({ text: String(d.text || '').trim() });
    } catch { res.status(502).json({ error: 'Could not reach the transcription endpoint.' }); }
  });

  app.post('/api/voice/speak', authMiddleware, async (req, res) => {
    if (getSetting('voice_call_enabled', '0') !== '1') return res.status(403).json({ error: 'Voice calls are disabled.' });
    if (getSetting('voice_tts_engine', 'browser') !== 'server') return res.status(400).json({ error: 'Server speech is not enabled.' });
    const base = getSetting('voice_tts_url', '');
    if (!base) return res.status(400).json({ error: 'No speech endpoint configured.' });
    const text = String((req.body || {}).text || '').trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'Nothing to speak.' });
    try {
      const key = getSetting('voice_tts_key', '');
      const speed = Number(getSetting('voice_tts_speed', 1)) || 1;
      const r = await fetch(voiceUrl(base, '/audio/speech'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        body: JSON.stringify({ model: getSetting('voice_tts_model', 'tts-1'), voice: getSetting('voice_tts_voice', 'alloy') || 'alloy', input: text, speed, response_format: 'mp3' })
      });
      if (!r.ok) return res.status(502).json({ error: 'Speech synthesis failed (' + r.status + ').' });
      const buf = Buffer.from(await r.arrayBuffer());
      res.set('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
      res.set('Cache-Control', 'no-store');
      res.send(buf);
    } catch { res.status(502).json({ error: 'Could not reach the speech endpoint.' }); }
  });

  app.get('/api/admin/membank', authMiddleware, adminOnly, async (req, res) => {
    try { await membank.ensureIndexedAll(); } catch {}
    res.json({ files: membank.list(), enabled: getSetting('membank_enabled', '0') === '1' });
  });
  app.post('/api/admin/membank', authMiddleware, adminOnly, membankUpload.array('files', 20), async (req, res) => {
    let saved = 0;
    for (const f of (req.files || [])) { try { await membank.saveUpload(f.originalname, f.buffer); saved++; } catch {} }
    res.json({ files: membank.list(), saved });
  });
  app.delete('/api/admin/membank/:name', authMiddleware, adminOnly, (req, res) => {
    membank.remove(req.params.name);
    res.json({ files: membank.list() });
  });
  app.patch('/api/admin/membank/:name', authMiddleware, adminOnly, (req, res) => {
    if ('folder' in req.body && !('name' in req.body)) {
      membank.setFileMeta(req.params.name, { folder: req.body.folder });
      return res.json({ files: membank.list() });
    }
    const r = membank.rename(req.params.name, req.body.name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    if ('folder' in req.body) membank.setFileMeta(req.body.name, { folder: req.body.folder });
    res.json({ files: membank.list() });
  });
  app.put('/api/admin/membank/order', authMiddleware, adminOnly, (req, res) => {
    const r = membank.reorder(req.body.items);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ files: r.files });
  });
}
