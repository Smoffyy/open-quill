import { Worker } from 'worker_threads';

// A user-supplied regular expression cannot be made safe by inspecting it. Catastrophic
// backtracking is a property of the pattern *and* the text together, static analysis of
// the pattern only ever catches the shapes someone thought to look for, and JavaScript
// offers no timeout and no step budget once RegExp.test has started. On a single-threaded
// server that means one bad search from a model stalls every request for every user.
//
// So the regex runs somewhere killable. This is the only sound fix short of adding a
// linear-time engine as a dependency, and worker_threads is built in.
//
// Only the regex path pays for this. Plain substring search stays in-process, because
// String.includes cannot backtrack.

const WORKER_URL = new URL('./regexsearch.worker.js', import.meta.url);

export function runRegexSearch({ files, source, flags = 'i', cap = 100, lineMax = 4000, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(WORKER_URL, { workerData: { files, source, flags, cap, lineMax } });
    } catch (e) {
      // Never fall back to running it here: that is the hang this exists to prevent.
      resolve({ ok: false, error: `Could not run the regex search (${String(e.message || e)}). Search for plain text instead by leaving regex off.` });
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(value);
    };

    const timer = setTimeout(() => finish({
      ok: false,
      timedOut: true,
      error: `That search did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped. A regular expression can take effectively forever on some text — narrow it with "filter" to the files you care about, simplify the pattern, or search for plain text instead.`
    }), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    worker.on('message', (m) => finish({ ok: true, matches: m.matches || [], truncated: !!m.truncated }));
    worker.on('error', (e) => finish({ ok: false, error: 'Invalid regex: ' + String(e.message || e) }));
    worker.on('exit', () => finish({ ok: false, error: 'The regex search stopped unexpectedly. Try a simpler pattern, or search for plain text.' }));
  });
}
