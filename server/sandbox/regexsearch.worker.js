import fs from 'fs';
import { parentPort, workerData } from 'worker_threads';

// Runs the model's regex against already-resolved absolute paths. It does no path logic:
// the parent validated every one of these through resolveSafe before handing them over.
//
// The point of being a worker at all is that this thread can be killed. A regex like
// /(?:a|aa)+b/ on a few thousand characters backtracks for longer than the universe has
// existed, and there is no way to interrupt it from inside — no timeout option, no step
// budget. terminate() from the parent is the only thing that stops it.

const { files, source, flags, cap, lineMax } = workerData;
const re = new RegExp(source, flags);
const matches = [];

for (const f of files) {
  let text;
  try { text = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].length > lineMax ? lines[i].slice(0, lineMax) : lines[i];
    if (!re.test(line)) continue;
    matches.push({ path: f.rel, line: i + 1, text: lines[i].trim().slice(0, 240) });
    if (matches.length >= cap) break;
  }
  if (matches.length >= cap) break;
}

parentPort.postMessage({ matches, truncated: matches.length >= cap });
