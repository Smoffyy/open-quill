import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { dirFor, resolveSafe, relOf } from './paths.js';
import { getCwd, setCwd } from './meta.js';
import { pickShell, missingCommandHint } from './hostenv.js';
import { screenCommand, normalizeRel } from '../lib/sandboxguard.js';

const OUT_CAP = 20000;
function capOut(s) { s = String(s ?? ''); return s.length > OUT_CAP ? s.slice(0, OUT_CAP) + `\n… [output truncated at ${OUT_CAP} characters]` : s; }

const CWD_MARK = '__OQ_CWD__';
function wrapCommand(base, cmd) {
  if (process.platform === 'win32') {
    return `cd /d "${base}" & ( ${cmd} ) & set "__oq_ec=!errorlevel!" & echo ${CWD_MARK}!CD!& exit /b !__oq_ec!`;
  }
  const quoted = "'" + String(base).replace(/'/g, `'\\''`) + "'";
  return `cd ${quoted} || exit 1\n${cmd}\n__oq_ec=$?\nprintf '\\n${CWD_MARK}%s\\n' "$PWD"\nexit $__oq_ec`;
}

const WIN_REWRITES = [
  [/^mkdir\s+-p\s+/i, 'mkdir '],
  [/^rm\s+-rf?\s+/i, 'rmdir /s /q '],
  [/^rm\s+-fr\s+/i, 'rmdir /s /q '],
  [/^rm\s+-f\s+/i, 'del /q /f '],
  [/^rm\s+/i, 'del /q '],
  [/^cp\s+-r\s+/i, 'xcopy /e /i /y '],
  [/^cp\s+/i, 'copy /y '],
  [/^mv\s+/i, 'move /y '],
  [/^cat\s+/i, 'type '],
  [/^ls\s+-[a-z]+\s*/i, 'dir '],
  [/^ls\s*$/i, 'dir'],
  [/^ls\s+/i, 'dir '],
  [/^which\s+/i, 'where '],
  [/^pwd\s*$/i, 'cd'],
  [/^python3(\s|$)/i, 'python$1'],
  [/^pip3(\s|$)/i, 'pip$1']
];

// cmd.exe's own builtins (unlike `cd`, unlike every actual interpreter, and unlike
// this app's own file tools) parse a bare `/` inside a path argument as the start of
// a switch, not as a separator: `mkdir a/b` is read as `mkdir a` plus a bogus `/b`
// flag and fails with "The syntax of the command is incorrect." This is the single
// most common way a model's first `bash` command fails on Windows, because every
// other context it has seen (this app's own tools, Python, Node, the URL bar) takes
// forward slashes fine. Rather than rely on the model remembering that, every path
// argument to these specific builtins is rewritten to backslashes before running.
const SLASH_SENSITIVE = new Set([
  'mkdir', 'md', 'rmdir', 'rd', 'del', 'erase', 'copy', 'move', 'ren', 'rename',
  'type', 'dir', 'xcopy', 'attrib'
]);

function fixWinSlashes(segment) {
  const m = segment.match(/^(\S+)(\s[\s\S]*)?$/);
  if (!m) return segment;
  const [, word, rest] = m;
  if (!rest || !SLASH_SENSITIVE.has(word.toLowerCase())) return segment;
  const fixedRest = rest.replace(/("[^"]*"|'[^']*'|\S+)/g, (tok) => {
    const quoted = tok.length >= 2 && (tok[0] === '"' || tok[0] === "'") && tok[tok.length - 1] === tok[0];
    const quote = quoted ? tok[0] : '';
    const inner = quoted ? tok.slice(1, -1) : tok;
    // a token starting with / is a real switch (/s, /q, /y, ...); leave it alone
    if (inner.startsWith('/') || !inner.includes('/')) return tok;
    return quote + inner.replace(/\//g, '\\') + quote;
  });
  return word + fixedRest;
}

export function winTranslate(cmd) {
  const src = String(cmd == null ? '' : cmd);
  const notes = [];
  const parts = src.split(/(\s*&&\s*|\s*\|\|\s*|\s*;\s*|\s*\|\s*)/);
  const out = parts.map((seg, i) => {
    if (i % 2 === 1) return seg;
    const trimmed = seg.trim();
    if (!trimmed) return seg;
    let working = trimmed;
    for (const [re, rep] of WIN_REWRITES) {
      if (re.test(working)) {
        const next = working.replace(re, rep);
        if (next !== working) notes.push(working.split(/\s+/)[0] + ' -> ' + next.split(/\s+/)[0]);
        working = next;
        break;
      }
    }
    const slashFixed = fixWinSlashes(working);
    if (slashFixed !== working) {
      notes.push(working.split(/\s+/)[0] + ': / -> \\ in path arguments');
      working = slashFixed;
    }
    return working === trimmed ? seg : seg.replace(trimmed, working);
  }).join('');
  return { cmd: out, notes };
}

// "the folder is already there" is the state the model asked for, not a failure. Reported
// as one it drives a retry loop, because every retry reproduces it exactly. Only the LAST
// segment is inspected: with `&&` or `&` a trailing mkdir means nothing after it was
// skipped, and any earlier command that also failed would put a non-matching line in the
// output, so `every` below refuses the shortcut.
const MKDIR_WORDS = new Set(['mkdir', 'md']);
const SEGMENT_SPLIT = /(?:&&|\|\||[;|&])/;
const MKDIR_EXISTS = /^(?:a subdirectory or file .+ already exists\.?|mkdir: cannot create directory .+: file exists)$/i;

function lastSegment(cmd) {
  const parts = String(cmd || '').split(SEGMENT_SPLIT);
  for (let i = parts.length - 1; i >= 0; i--) { const s = parts[i].trim(); if (s) return s; }
  return '';
}

function baseWord(segment) {
  const m = /^\s*"?([^\s"]+)"?/.exec(segment);
  if (!m) return '';
  return m[1].replace(/\\/g, '/').split('/').pop().replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
}

function onlyMkdirCollisions(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(l => MKDIR_EXISTS.test(l));
}

const CD_WORDS = new Set(['cd', 'chdir', 'pushd']);

function cdTargets(cmd) {
  const out = [];
  for (const seg of String(cmd || '').split(SEGMENT_SPLIT)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks.length || !CD_WORDS.has(toks[0].toLowerCase())) continue;
    let i = 1;
    while (i < toks.length && /^[-/][A-Za-z]$/.test(toks[i])) i++;
    if (i < toks.length) out.push(toks[i].replace(/^["']|["']$/g, ''));
  }
  return out;
}

function isDir(chatId, rel) {
  try { return fs.statSync(resolveSafe(chatId, rel)).isDirectory(); } catch { return false; }
}

// The shell's directory persists between bash calls, and small models re-issue the same
// `cd <project>` on every command. Once the shell is already inside <project> that resolves
// to <project>/<project> and fails with a generic "cannot find the path specified", which
// tells the model nothing — so it retries the identical command forever. Catch it before
// running and say exactly what happened.
function staleCdError(chatId, cmd, baseRel) {
  if (!baseRel) return null;
  for (const target of cdTargets(cmd)) {
    const t = target.replace(/\\/g, '/');
    if (!t || t === '.' || t.startsWith('..') || t.startsWith('/') || /^[A-Za-z]:/.test(t)) continue;
    const here = normalizeRel(baseRel + '/' + t, { allowEmpty: true });
    const atRoot = normalizeRel(t, { allowEmpty: true });
    if (!here.ok || !atRoot.ok || !atRoot.rel) continue;
    if (isDir(chatId, here.rel) || !isDir(chatId, atRoot.rel)) continue;
    const where = baseRel === atRoot.rel
      ? `you are already in it`
      : `you are already inside it, at "${baseRel}"`;
    return `Blocked: your shell is already in "${baseRel}", so "cd ${target}" looked for "${here.rel}", which does not exist. "${atRoot.rel}" is a folder at the workspace ROOT and ${where}.\n\nThe shell's working directory PERSISTS between bash calls and is reported as "cwd" with every result. Do not prefix "cd ${target}" again. Either run the rest of the command on its own, or pass workdir to be explicit and stateless: {"cmd": "<your command>", "workdir": "${atRoot.rel}"}.`;
  }
  return null;
}

// Killing the shell is not enough. `cmd.exe /c npm test` spawns a grandchild, and
// killing only cmd.exe leaves it running with the pipes still open, so 'close'
// never fires and the caller waits out the full timeout anyway. taskkill /T ends
// the whole tree; POSIX shells forward the signal to their child themselves.
function killTree(child) {
  if (!child || child.pid == null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }
    catch { try { child.kill('SIGKILL'); } catch {} }
    return;
  }
  try { child.kill('SIGKILL'); } catch {}
}

export function bash(chatId, cmd, timeoutMs = 60000, workdir, signal = null) {
  if (!cmd || !String(cmd).trim()) {
    return Promise.resolve({ ok: false, error: 'cmd is required. Pass the command line to run, for example {"cmd": "node app.js"}.', output: '' });
  }
  const root = dirFor(chatId);
  try { fs.mkdirSync(root, { recursive: true }); } catch {}
  let baseRel = getCwd(chatId);
  if (workdir != null && String(workdir).trim()) {
    const wd = normalizeRel(workdir, { allowEmpty: true, label: 'workdir' });
    if (!wd.ok) return Promise.resolve({ ok: false, error: wd.error, output: '' });
    baseRel = wd.rel;
  }
  let base;
  try { base = resolveSafe(chatId, baseRel); if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) { base = root; baseRel = ''; } }
  catch { base = root; baseRel = ''; }

  const screened = screenCommand(cmd, baseRel);
  if (!screened.ok) return Promise.resolve({ ok: false, error: screened.error, output: '', exit: null, cwd: baseRel, blocked: true });

  const stale = staleCdError(chatId, cmd, baseRel);
  if (stale) return Promise.resolve({ ok: false, error: stale, output: '', exit: null, cwd: baseRel, blocked: true });

  const win = process.platform === 'win32';
  const shell = pickShell();
  const xlat = win ? winTranslate(cmd) : { cmd: String(cmd), notes: [] };
  const wrapped = wrapCommand(base, xlat.cmd);

  return new Promise((resolve) => {
    let child;
    try {
      if (win) child = spawn(shell, ['/d', '/s', '/v:on', '/c', `"${wrapped}"`], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: true });
      else child = spawn(shell, ['-c', wrapped], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { resolve({ ok: false, output: '', error: String(e.message || e), exit: null }); return; }

    const MAX = 12 * 1024 * 1024;
    const HEAD_KEEP = OUT_CAP + 2000;
    const TAIL_KEEP = 4096;
    let head = '', tail = '', chars = 0, size = 0, killed = false, timedOut = false, settled = false;
    // stdout and stderr are interleaved into one transcript, and a chunk boundary can
    // land in the middle of a multi-byte character. Decoding each Buffer on its own
    // turned those into U+FFFD, so any non-ASCII program output came back mangled; one
    // decoder per stream carries the partial sequence across chunks instead.
    const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };
    const grab = (which) => (b) => {
      if (killed) return;
      size += b.length;
      const s = decoders[which].write(b);
      if (s) {
        chars += s.length;
        if (head.length < HEAD_KEEP) head += s.slice(0, HEAD_KEEP - head.length);
        tail = tail.length + s.length > TAIL_KEEP ? (tail + s).slice(-TAIL_KEEP) : tail + s;
      }
      if (size > MAX) { killed = true; killTree(child); }
    };
    const transcript = () => (chars <= HEAD_KEEP ? head : head + tail);
    child.stdout.on('data', grab('out'));
    child.stderr.on('data', grab('err'));
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);

    // Pressing stop should not leave a build or a test run grinding away for the
    // rest of its timeout. The child is killed the same way the timeout kills it,
    // and whatever it printed before dying is still returned and saved.
    let stoppedByUser = false;
    const onAbort = () => { stoppedByUser = true; killTree(child); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const parseTail = (raw) => {
      let text = raw;
      let nextCwd = null;
      const mi = text.lastIndexOf(CWD_MARK);
      if (mi !== -1) {
        const after = text.slice(mi + CWD_MARK.length);
        const nl = after.indexOf('\n');
        const cwdAbs = (nl === -1 ? after : after.slice(0, nl)).trim();
        text = text.slice(0, mi).replace(/\n$/, '');
        if (cwdAbs) {
          try {
            const r = relOf(chatId, path.resolve(cwdAbs));
            nextCwd = (!r.startsWith('..') && !path.isAbsolute(r)) ? r : '';
          } catch { nextCwd = null; }
        }
      } else if (workdir != null && String(workdir).trim()) {
        try { nextCwd = relOf(chatId, base); } catch { nextCwd = null; }
      }
      return { text, nextCwd };
    };

    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
      resolve(r);
    };
    child.on('error', (e) => done({ ok: false, output: capOut(parseTail(transcript()).text), error: String(e.message || e), exit: null, cwd: getCwd(chatId) }));
    child.on('close', (code) => {
      const { text, nextCwd } = parseTail(transcript());
      if (stoppedByUser) return done({ ok: false, output: capOut(text), error: 'Stopped by the user.', exit: null, cwd: getCwd(chatId) });
      if (timedOut) return done({ ok: false, output: capOut(text), error: `Timed out after ${Math.round(timeoutMs / 1000)}s`, exit: null, cwd: getCwd(chatId) });
      if (killed) return done({ ok: false, output: capOut(text), error: `Output exceeded ${Math.round(MAX / 1048576)} MB; process killed.`, exit: null, cwd: getCwd(chatId) });
      const exit = typeof code === 'number' ? code : 1;
      const benignMkdir = exit !== 0 && MKDIR_WORDS.has(baseWord(lastSegment(xlat.cmd))) && onlyMkdirCollisions(text);
      // The shell only moves when the command worked. A failed `cd dir && ...` that still
      // relocated the shell is what turns one mistake into an endless loop: the model
      // retries `cd dir && ...`, which now resolves to dir/dir, and never recovers.
      if ((exit === 0 || benignMkdir) && nextCwd !== null) setCwd(chatId, nextCwd);
      const cwd = getCwd(chatId);
      const xnote = xlat.notes.length ? `\n\n[Adjusted for Windows: ${xlat.notes.join(', ')}. Unix flags like -p and -rf do not exist here; prefer the dedicated file tools.]` : '';
      if (exit === 0) return done({ ok: true, output: capOut(text) + xnote, exit: 0, cwd });
      if (benignMkdir) {
        return done({
          ok: true, exit: 0, cwd, output: capOut(text) + xnote,
          note: 'the directory already existed, so there was nothing to create. This is the state you asked for — do not retry. `make_dir` succeeds whether or not the folder is already there.'
        });
      }
      let hinted = (capOut(text) || `Exited with code ${exit}`) + xnote;
      const notFound = /is not recognized as an internal or external command/i.test(hinted)
        || /: (?:command )?not found/i.test(hinted) || exit === 9009 || exit === 127;
      const unixFlavoured = win && /parameter format not correct|invalid number of parameters/i.test(hinted);
      const badSlash = win && /invalid switch|the syntax of the command is incorrect/i.test(hinted);
      if (notFound) hinted += '\n\nHINT: ' + missingCommandHint();
      else if (unixFlavoured) hinted += '\n\nHINT: `find`, `sort` and `more` exist on Windows but they are the WINDOWS commands, not the Unix ones. Windows `find` searches file contents for a literal string and does not understand `-name`, `-type`, `-exec` or `.` as a starting directory. Do not retry it with different flags. Use the dedicated file tools instead: `find` for name patterns (e.g. {"pattern": "**/*.java"}), `search` for text inside files, and `list_files` for the tree. They work identically on every OS.';
      else if (badSlash) hinted += '\n\nHINT: this is almost always cmd.exe reading a `/` inside a path as a switch, not a separator. `mkdir a/b`, `del x/y.txt` and similar fail this way even though `cd`, this app\'s file tools, and every real interpreter accept forward slashes fine. Rewrite the path with backslashes (`mkdir a\\b`) or, better, use the dedicated file tools (make_dir, create_file, delete_file, copy_file, move_file) which take forward-slash paths on every OS.';
      return done({ ok: false, output: hinted, exit, error: `Exited with code ${exit}`, cwd });
    });
  });
}
