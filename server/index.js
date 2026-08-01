import './lib/dataroot.js';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSetting } from './db.js';
import { parseCookies } from './auth.js';
import { setCustomPresets } from './pricing.js';
import * as mcp from './mcp.js';
import { pruneAudit } from './lib/audit.js';
import { UPLOADS } from './lib/uploads.js';
import { initWs } from './lib/ws/index.js';
import registerAuthRoutes from './routes/auth.js';
import registerChatRoutes from './routes/chats/index.js';
import registerProjectRoutes from './routes/projects.js';
import registerArtifactRoutes from './routes/artifacts.js';
import registerModelRoutes from './routes/models.js';
import registerPlaygroundRoutes from './routes/playground.js';
import registerSettingsRoutes from './routes/settings.js';
import registerAdminRoutes from './routes/admin.js';
import registerMediaRoutes from './routes/media.js';
import registerSpaceRoutes from './routes/spaces.js';
import registerMiscRoutes from './routes/misc.js';
import { localOnlyMiddleware } from './lib/localonly.js';
import { installEgressGuard } from './lib/egress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

installEgressGuard();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(parseCookies);
app.use('/uploads', (req, res, next) => { res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'"); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); }, express.static(UPLOADS));

registerAuthRoutes(app);
registerChatRoutes(app);
registerProjectRoutes(app);
registerArtifactRoutes(app);
registerModelRoutes(app);
registerPlaygroundRoutes(app);
registerSettingsRoutes(app);
registerAdminRoutes(app);
registerMediaRoutes(app);
registerSpaceRoutes(app);
registerMiscRoutes(app);

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(localOnlyMiddleware);
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

try { setCustomPresets(getSetting('custom_presets', [])); } catch {}

const server = http.createServer(app);
initWs(server);

process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); });
process.on('exit', () => { try { mcp.shutdown(); } catch {} });

server.listen(PORT, HOST, () => console.log(`open-quill running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
pruneAudit();
setInterval(pruneAudit, 24 * 60 * 60 * 1000).unref();
