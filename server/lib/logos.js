import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, '..', '..', 'client');
const DIRS = [path.join(CLIENT, 'dist', 'assets'), path.join(CLIENT, 'public', 'assets')];

export function listLogos() {
  for (const dir of DIRS) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    const out = names.filter(n => n.toLowerCase().endsWith('.svg')).sort();
    if (out.length) return out;
  }
  return [];
}
