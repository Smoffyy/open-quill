import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

const name = 'oqtest' + process.pid;
const dir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'data', 'databases', name);
process.env.OPEN_QUILL_DB = name;

after(async () => {
  const { closeDb } = await import('../db.js');
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});