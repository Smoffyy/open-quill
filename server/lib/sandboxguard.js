const SYSTEM_ROOTS = new Set([
  'bin', 'sbin', 'usr', 'etc', 'var', 'opt', 'root', 'home', 'proc', 'sys', 'boot',
  'lib', 'lib32', 'lib64', 'mnt', 'media', 'srv', 'run', 'tmp', 'private',
  'Users', 'Applications', 'Library', 'System', 'Volumes', 'Windows', 'ProgramData'
]);

const DEV_OK = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/zero', '/dev/urandom', '/dev/tty']);

const HOST_COMMANDS = new Map([
  ['sudo', 'runs commands as another user'], ['su', 'switches user'], ['doas', 'runs commands as another user'],
  ['runas', 'runs commands as another user'], ['pkexec', 'runs commands as another user'],
  ['shutdown', 'controls the host machine'], ['reboot', 'controls the host machine'],
  ['halt', 'controls the host machine'], ['poweroff', 'controls the host machine'],
  ['init', 'controls the host machine'], ['systemctl', 'controls host services'],
  ['service', 'controls host services'], ['launchctl', 'controls host services'],
  ['sc', 'controls host services'], ['reg', 'edits the Windows registry'],
  ['regedit', 'edits the Windows registry'], ['regedt32', 'edits the Windows registry'],
  ['bcdedit', 'edits the boot configuration'], ['diskpart', 'repartitions disks'],
  ['format', 'formats disks'], ['mkfs', 'formats disks'], ['fdisk', 'repartitions disks'],
  ['vssadmin', 'manages system snapshots'], ['mount', 'mounts filesystems'], ['umount', 'unmounts filesystems'],
  ['netsh', 'reconfigures host networking'], ['net', 'manages host accounts and shares'],
  ['schtasks', 'schedules host tasks'], ['crontab', 'schedules host tasks'], ['at', 'schedules host tasks'],
  ['wmic', 'administers the host'], ['taskkill', 'kills host processes'],
  ['killall', 'kills host processes'], ['pkill', 'kills host processes'],
  ['takeown', 'changes host file ownership'], ['icacls', 'changes host permissions'],
  ['chown', 'changes file ownership'], ['chgrp', 'changes file ownership'],
  ['useradd', 'manages host accounts'], ['usermod', 'manages host accounts'],
  ['userdel', 'manages host accounts'], ['passwd', 'manages host accounts'], ['visudo', 'edits sudo policy'],
  ['apt', 'installs software on the host'], ['apt-get', 'installs software on the host'],
  ['aptitude', 'installs software on the host'], ['yum', 'installs software on the host'],
  ['dnf', 'installs software on the host'], ['pacman', 'installs software on the host'],
  ['apk', 'installs software on the host'], ['zypper', 'installs software on the host'],
  ['brew', 'installs software on the host'], ['choco', 'installs software on the host'],
  ['winget', 'installs software on the host'], ['snap', 'installs software on the host'],
  ['docker', 'controls containers outside the workspace'], ['podman', 'controls containers outside the workspace'],
  ['kubectl', 'controls clusters outside the workspace'],
  ['ssh', 'opens a remote shell'], ['telnet', 'opens a remote shell'],
  ['nc', 'opens raw network connections'], ['ncat', 'opens raw network connections']
]);

const SEGMENT_SPLIT = /(?:&&|\|\||[;|\n\r])+/;

function stripQuotes(tok) {
  let t = tok;
  while (t.length > 1 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) t = t.slice(1, -1);
  return t;
}

export function tokenize(text) {
  const out = [];
  let cur = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null; else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function candidates(token) {
  const out = [];
  let t = stripQuotes(String(token || ''));
  t = t.replace(/^\d?(?:>>|>|<)/, '');
  if (!t) return out;
  out.push(t);
  const eq = t.indexOf('=');
  if (eq > 0 && eq < t.length - 1) out.push(stripQuotes(t.slice(eq + 1)));
  const colon = t.indexOf(':');
  if (colon > 1 && t.startsWith('--')) out.push(stripQuotes(t.slice(colon + 1)));
  return out;
}

function absoluteKind(value) {
  const v = String(value || '');
  if (!v) return null;
  if (DEV_OK.has(v) || DEV_OK.has(v.replace(/\/+$/, ''))) return null;
  if (/^[A-Za-z]:$/.test(v) || /^[A-Za-z]:[\\/]/.test(v)) return 'a Windows drive path';
  if (/^\\\\[^\\]/.test(v)) return 'a UNC network path';
  if (/^~(?:$|[/\\])/.test(v)) return 'a home-directory path';
  if (v === '/' || v === '/*') return 'the filesystem root';
  if (v[0] === '/') {
    const seg = v.slice(1).split('/').filter(Boolean);
    if (!seg.length) return 'the filesystem root';
    if (SYSTEM_ROOTS.has(seg[0]) || SYSTEM_ROOTS.has(seg[0].toLowerCase())) return 'a system directory';
    if (seg.length >= 2) return 'an absolute path';
  }
  return null;
}

function depthOf(rel) {
  return String(rel || '').split('/').filter(s => s && s !== '.').length;
}

function escapesRoot(value, fromDepth) {
  const v = String(value || '').replace(/\\/g, '/');
  if (!v.includes('..')) return false;
  let depth = fromDepth;
  for (const seg of v.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { depth--; if (depth < 0) return true; }
    else depth++;
  }
  return false;
}

const CD_WORDS = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl']);

function cdEscape(segment, startDepth) {
  const toks = tokenize(segment);
  let depth = startDepth;
  for (let i = 0; i < toks.length; i++) {
    if (!CD_WORDS.has(toks[i].toLowerCase())) continue;
    let j = i + 1;
    while (j < toks.length && /^[-/][A-Za-z]/.test(toks[j])) j++;
    if (j >= toks.length) return false;
    const target = stripQuotes(toks[j]).replace(/\\/g, '/');
    if (!target || target === '~') return true;
    if (target.startsWith('/') || /^[A-Za-z]:/.test(target)) return true;
    for (const seg of target.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { depth--; if (depth < 0) return true; }
      else depth++;
    }
    i = j;
  }
  return false;
}

function baseCommand(segment) {
  const toks = tokenize(segment);
  for (const raw of toks) {
    const t = stripQuotes(raw);
    if (!t) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
    const base = t.replace(/\\/g, '/').split('/').pop().replace(/\.(exe|cmd|bat|com)$/i, '');
    return base.toLowerCase();
  }
  return '';
}

export function screenCommand(cmd, baseRel = '') {
  const text = String(cmd == null ? '' : cmd);
  if (!text.trim()) return { ok: true };
  const startDepth = depthOf(baseRel);

  for (const token of tokenize(text)) {
    for (const value of candidates(token)) {
      const kind = absoluteKind(value);
      if (kind) {
        return {
          ok: false,
          error: `Blocked: "${value}" is ${kind}. This shell only runs inside your workspace, and every path must be RELATIVE to the workspace root (for example "src/app.py", never "${value}"). Rewrite the command using relative paths, or use the file tools (view, list_files, find, create_file) which are always workspace-relative.`
        };
      }
      if (value.startsWith('..') && escapesRoot(value, startDepth)) {
        return {
          ok: false,
          error: `Blocked: "${value}" points above the workspace root. You cannot read or write anything outside your workspace. Use a path inside it, such as "output/result.txt".`
        };
      }
    }
  }

  for (const segment of text.split(SEGMENT_SPLIT)) {
    const seg = segment.trim();
    if (!seg) continue;
    if (cdEscape(seg, startDepth)) {
      return {
        ok: false,
        error: 'Blocked: that command changes directory outside the workspace root. Your shell is confined to the workspace; cd only into folders you created inside it.'
      };
    }
    const base = baseCommand(seg);
    const why = base && HOST_COMMANDS.get(base);
    if (why) {
      return {
        ok: false,
        error: `Blocked: "${base}" ${why}, which is outside what this workspace allows. You can freely create, edit, run and package files inside the workspace, but you cannot administer, install onto, or connect out from the host machine. If the task truly needs this, explain to the user what is missing instead of retrying.`
      };
    }
  }

  return { ok: true };
}

export function normalizeRel(rel, { allowEmpty = false, label = 'path' } = {}) {
  let v = rel;
  if (v == null) v = '';
  if (typeof v !== 'string') v = String(v);
  v = v.trim();
  if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1).trim();
  if (!v || v === '.' || v === './') {
    if (allowEmpty) return { ok: true, rel: '' };
    return { ok: false, error: `${label} is required. Give a path relative to the workspace root, for example "src/app.py".` };
  }
  v = v.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(v)) {
    return { ok: false, error: `${label} "${rel}" is a Windows drive path. Paths must be RELATIVE to the workspace root: drop the drive and any leading folders, e.g. "src/app.py".` };
  }
  if (/^\/\//.test(v)) {
    return { ok: false, error: `${label} "${rel}" is a UNC network path. Only paths inside your workspace are allowed, e.g. "data/input.csv".` };
  }
  if (/^~(?:$|\/)/.test(v)) {
    return { ok: false, error: `${label} "${rel}" points at a home directory. You have no home directory; use a path relative to the workspace root, e.g. "notes.md".` };
  }
  if (v[0] === '/') {
    const first = v.replace(/^\/+/, '').split('/')[0] || '';
    if (SYSTEM_ROOTS.has(first) || SYSTEM_ROOTS.has(first.toLowerCase())) {
      return { ok: false, error: `${label} "${rel}" is a system directory outside the workspace. You can only touch files inside your own workspace; use a relative path such as "${first}.txt" or "data/${first}".` };
    }
    v = v.replace(/^\/+/, '');
  }
  const parts = [];
  for (const seg of v.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) {
        return { ok: false, error: `${label} "${rel}" points above the workspace root. Everything you can touch lives inside the workspace; use a path such as "build/out.txt".` };
      }
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const out = parts.join('/');
  if (!out && !allowEmpty) {
    return { ok: false, error: `${label} is required. Give a path relative to the workspace root, for example "src/app.py".` };
  }
  return { ok: true, rel: out };
}
