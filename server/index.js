import './lib/dataroot.js';
import express from 'express';
import http from 'http';
import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSetting } from './db.js';
import { parseCookies, sessionFromRequest } from './auth.js';
import { setCustomPresets } from './pricing.js';
import * as mcp from './mcp.js';
import { pruneAudit } from './lib/audit.js';
import { pruneToolStats } from './lib/toolstats.js';
import { UPLOADS } from './lib/uploads.js';
import { initWs } from './lib/ws/index.js';
import registerAuthRoutes from './routes/auth.js';
import registerChatRoutes from './routes/chats/index.js';
import registerProjectRoutes from './routes/projects.js';
import registerArtifactRoutes from './routes/artifacts.js';
import registerTaskRoutes from './routes/tasks.js';
import registerSkillRoutes from './routes/skills.js';
import registerUserMcpRoutes from './routes/mcp.js';
import registerModelRoutes from './routes/models.js';
import registerPlaygroundRoutes from './routes/playground.js';
import registerSettingsRoutes from './routes/settings.js';
import registerAdminRoutes from './routes/admin.js';
import registerMediaRoutes from './routes/media.js';
import registerSpaceRoutes from './routes/spaces.js';
import registerMiscRoutes from './routes/misc.js';
import registerThemeRoutes from './routes/theme.js';
import { localOnlyMiddleware } from './lib/localonly.js';
import { installEgressGuard } from './lib/egress.js';
import { sameOriginGuard } from './lib/origin.js';
import { uploadHeaders, isPublicUpload } from './lib/uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

installEgressGuard();

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // authenticated JSON must never land in a shared or back/forward cache
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
});
// Auth is a cookie, so every state-changing endpoint is forgeable from another origin
// unless we check. SameSite=Lax already blocks the common case; this closes the rest.
app.use(sameOriginGuard);
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
app.use(parseCookies);
// 404 rather than 401 for a signed-out caller: whether a given upload exists is itself
// something only a member should learn.
const uploadAuth = (req, res, next) => {
  if (isPublicUpload(req.path) || sessionFromRequest(req)) return next();
  res.status(404).json({ error: 'not found' });
};
app.use('/uploads', uploadHeaders, uploadAuth, express.static(UPLOADS, { index: false, dotfiles: 'deny' }));

registerAuthRoutes(app);
registerChatRoutes(app);
registerProjectRoutes(app);
registerArtifactRoutes(app);
registerTaskRoutes(app);
registerSkillRoutes(app);
registerUserMcpRoutes(app);
registerModelRoutes(app);
registerPlaygroundRoutes(app);
registerSettingsRoutes(app);
registerAdminRoutes(app);
registerMediaRoutes(app);
registerSpaceRoutes(app);
registerThemeRoutes(app);
registerMiscRoutes(app);

// Unknown API routes answer in JSON. Falling through to the SPA handler below served a
// 200 and a page of HTML for, among other things, an upload that no longer exists.
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use('/uploads', (req, res) => res.status(404).json({ error: 'not found' }));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(localOnlyMiddleware);
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  console.error('[request]', req.method, req.path, err);
  if (res.headersSent) return res.end();
  res.status(err?.status || 500).json({ error: 'Something went wrong on the server.' });
});

try { setCustomPresets(getSetting('custom_presets', [])); } catch {}

const server = http.createServer(app);
initWs(server);

process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); });
process.on('exit', () => { try { mcp.shutdown(); } catch {} });

function warmHostEnv() {
  let worker;
  try { worker = new Worker(new URL('./sandbox/hostenv.worker.js', import.meta.url)); } catch { return; }
  worker.once('message', (env) => {
    import('./sandbox.js').then(s => { try { s.primeHostEnv(env); } catch {} }).catch(() => {});
    worker.terminate().catch(() => {});
  });
  worker.once('error', () => {});
  worker.unref();
}

server.listen(PORT, HOST, () => console.log(`open-quill running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
warmHostEnv();
const pruneOld = () => { pruneAudit(); pruneToolStats(); };
pruneOld();
setInterval(pruneOld, 24 * 60 * 60 * 1000).unref();
