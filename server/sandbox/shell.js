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

export function bash(chatId, cmd, timeoutMs = 60000, workdir) {
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

  const win = process.platform === 'win32';
  const shell = pickShell();
  const xlat = win ? winTranslate(cmd) : { cmd: String(cmd), notes: [] };
  const wrapped = wrapCommand(base, xlat.cmd);

  return new Promise((resolve) => {
    let child;
    try {
      if (win) child = spawn(shell, ['/d', '/s', '/v:on', '/c', `"${wrapped}"`], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: true });
      else child = spawn(shell, ['-c', wrapped], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, output: '', error: String(e.message || e), exit: null }); }

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
      if (size > MAX) { killed = true; try { child.kill('SIGKILL'); } catch {} }
    };
    const transcript = () => (chars <= HEAD_KEEP ? head : head + tail);
    child.stdout.on('data', grab('out'));
    child.stderr.on('data', grab('err'));
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);

    const finalize = (raw) => {
      let text = raw;
      const mi = text.lastIndexOf(CWD_MARK);
      if (mi !== -1) {
        const after = text.slice(mi + CWD_MARK.length);
        const nl = after.indexOf('\n');
        const cwdAbs = (nl === -1 ? after : after.slice(0, nl)).trim();
        text = text.slice(0, mi).replace(/\n$/, '');
        if (cwdAbs) { try { const r = relOf(chatId, path.resolve(cwdAbs)); if (!r.startsWith('..') && !path.isAbsolute(r)) setCwd(chatId, r); else setCwd(chatId, ''); } catch {} }
      } else if (workdir != null && String(workdir).trim()) { try { setCwd(chatId, relOf(chatId, base)); } catch {} }
      return text;
    };

    const done = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
    child.on('error', (e) => done({ ok: false, output: capOut(finalize(transcript())), error: String(e.message || e), exit: null }));
    child.on('close', (code) => {
      const text = finalize(transcript());
      if (timedOut) return done({ ok: false, output: capOut(text), error: `Timed out after ${Math.round(timeoutMs / 1000)}s`, exit: null });
      if (killed) return done({ ok: false, output: capOut(text), error: `Output exceeded ${Math.round(MAX / 1048576)} MB; process killed.`, exit: null });
      const exit = typeof code === 'number' ? code : 1;
      const cwd = getCwd(chatId);
      const xnote = xlat.notes.length ? `\n\n[Adjusted for Windows: ${xlat.notes.join(', ')}. Unix flags like -p and -rf do not exist here; prefer the dedicated file tools.]` : '';
      if (exit === 0) return done({ ok: true, output: capOut(text) + xnote, exit: 0, cwd });
      let hinted = (capOut(text) || `Exited with code ${exit}`) + xnote;
      const notFound = /is not recognized as an internal or external command/i.test(hinted)
        || /: (?:command )?not found/i.test(hinted) || exit === 9009 || exit === 127;
      const badSlash = win && /invalid switch|the syntax of the command is incorrect/i.test(hinted);
      if (notFound) hinted += '\n\nHINT: ' + missingCommandHint();
      else if (badSlash) hinted += '\n\nHINT: this is almost always cmd.exe reading a `/` inside a path as a switch, not a separator. `mkdir a/b`, `del x/y.txt` and similar fail this way even though `cd`, this app\'s file tools, and every real interpreter accept forward slashes fine. Rewrite the path with backslashes (`mkdir a\\b`) or, better, use the dedicated file tools (make_dir, create_file, delete_file, copy_file, move_file) which take forward-slash paths on every OS.';
      return done({ ok: false, output: hinted, exit, error: `Exited with code ${exit}`, cwd });
    });
  });
}
