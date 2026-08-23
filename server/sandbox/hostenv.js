import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

let SHELL_CACHE;
function pickShell() {
  if (SHELL_CACHE !== undefined) return SHELL_CACHE;
  if (process.platform === 'win32') { SHELL_CACHE = process.env.ComSpec || 'cmd.exe'; return SHELL_CACHE; }
  for (const s of ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/bin/sh', '/usr/bin/sh']) { try { if (fs.existsSync(s)) { SHELL_CACHE = s; return s; } } catch {} }
  SHELL_CACHE = '/bin/sh';
  return SHELL_CACHE;
}

function pathDirs() {
  const raw = process.env.PATH || process.env.Path || '';
  return raw.split(path.delimiter).filter(Boolean);
}

let PATH_EXTS = null;
function pathExts() {
  if (PATH_EXTS) return PATH_EXTS;
  if (process.platform !== 'win32') { PATH_EXTS = ['']; return PATH_EXTS; }
  PATH_EXTS = String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase());
  return PATH_EXTS;
}

function whichBin(name) {
  if (name.includes('/') || name.includes('\\')) { try { return fs.existsSync(name) ? name : null; } catch { return null; } }
  for (const dir of pathDirs()) {
    for (const ext of pathExts()) {
      const p = path.join(dir, name + ext);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

const RUNTIME_PROBES = [
  { name: 'node', args: ['-v'], label: 'Node.js', run: 'node script.js' },
  { name: 'npm', args: ['-v'], label: 'npm', run: 'npm install <pkg>' },
  { name: 'npx', args: ['-v'], label: 'npx' },
  { name: 'bun', args: ['-v'], label: 'Bun' },
  { name: 'deno', args: ['-V'], label: 'Deno' },
  { name: 'python', args: ['--version'], label: 'Python', run: 'python script.py' },
  { name: 'python3', args: ['--version'], label: 'Python 3', run: 'python3 script.py' },
  { name: 'pip', args: ['--version'], label: 'pip', run: 'pip install <pkg>' },
  { name: 'pip3', args: ['--version'], label: 'pip3' },
  { name: 'git', args: ['--version'], label: 'git' },
  { name: 'gcc', args: ['--version'], label: 'gcc' },
  { name: 'g++', args: ['--version'], label: 'g++' },
  { name: 'clang', args: ['--version'], label: 'clang' },
  { name: 'make', args: ['--version'], label: 'make' },
  { name: 'java', args: ['-version'], label: 'Java' },
  { name: 'javac', args: ['-version'], label: 'javac' },
  { name: 'go', args: ['version'], label: 'Go' },
  { name: 'rustc', args: ['--version'], label: 'Rust' },
  { name: 'cargo', args: ['--version'], label: 'cargo' },
  { name: 'dotnet', args: ['--version'], label: '.NET' },
  { name: 'php', args: ['--version'], label: 'PHP' },
  { name: 'ruby', args: ['--version'], label: 'Ruby' },
  { name: 'perl', args: ['--version'], label: 'Perl' }
];

const UTIL_PROBES = [
  'curl', 'wget', 'tar', 'zip', 'unzip', 'grep', 'sed', 'awk', 'jq',
  'cat', 'ls', 'head', 'tail', 'wc', 'touch', 'which', 'xargs', 'diff', 'patch', 'rsync'
];

const WIN_DIFFERENT = ['find', 'sort', 'more', 'echo'];

function cleanVersion(text) {
  const line = String(text || '').trim().split(/\r?\n/)[0] || '';
  const flat = line.replace(/\s+/g, ' ').trim();
  const m = flat.match(/(\d+(?:\.\d+)+(?:[._-][A-Za-z0-9.]+)?)/);
  if (m) return m[1].slice(0, 32);
  return flat.split(' ').slice(0, 3).join(' ').slice(0, 32);
}

let ENV_CACHE = null;
export function primeHostEnv(env) {
  if (!ENV_CACHE && env && typeof env === 'object') ENV_CACHE = env;
  return ENV_CACHE;
}

export function hostEnvInfo() {
  if (ENV_CACHE) return ENV_CACHE;
  const win = process.platform === 'win32';
  const osName = win ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  const shellPath = String(pickShell());
  const shellName = path.basename(shellPath);
  const probe = (bin, args) => {
    const found = whichBin(bin);
    if (!found) return null;
    const opts = { timeout: 8000, windowsHide: true, encoding: 'utf8' };
    try {
      const r = /\.(cmd|bat)$/i.test(found)
        ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${found}" ${args.join(' ')}"`], { ...opts, windowsVerbatimArguments: true })
        : spawnSync(found, args, opts);
      if (r.error) return null;
      const text = cleanVersion(r.stdout || r.stderr || '');
      if (!text || /[\\/]/.test(text)) return 'available';
      return text;
    } catch {}
    return null;
  };

  const runtimes = {};
  const interpreters = [];
  for (const p of RUNTIME_PROBES) {
    const v = probe(p.name, p.args);
    if (!v) continue;
    runtimes[p.name] = v;
    interpreters.push({ name: p.name, label: p.label, version: v, run: p.run || '' });
  }
  const utils = UTIL_PROBES.filter(u => !!whichBin(u));
  const missingUtils = UTIL_PROBES.filter(u => !utils.includes(u));

  const pythonCmd = runtimes.python ? 'python' : runtimes.python3 ? 'python3' : null;
  const pipCmd = runtimes.pip ? 'pip' : runtimes.pip3 ? 'pip3' : null;

  let osVersion = '';
  try { osVersion = `${os.release()}`; } catch {}

  ENV_CACHE = {
    osName,
    osVersion,
    arch: process.arch,
    shellName,
    shellPath,
    shellKind: win ? 'cmd' : 'posix',
    unix: !win,
    pathSep: '/',
    runtimes,
    interpreters,
    utils,
    missingUtils,
    winDifferent: win ? WIN_DIFFERENT : [],
    pythonCmd,
    pipCmd,
    hasNode: !!runtimes.node,
    names: interpreters.map(i => i.name)
  };
  return ENV_CACHE;
}

export function missingCommandHint() {
  const env = hostEnvInfo();
  const have = env.interpreters.length ? env.interpreters.map(i => i.name).join(', ') : 'none';
  const parts = [`that program is not installed on this host (${env.osName}, ${env.shellName}).`];
  parts.push(`Commands available here: ${have}.`);
  if (env.utils.length) parts.push(`Utilities on PATH: ${env.utils.join(', ')}.`);
  if (env.missingUtils.length) parts.push(`NOT installed here: ${env.missingUtils.join(', ')}.`);
  if (!env.unix) parts.push('This is cmd.exe, not a Unix shell, so Unix flags such as `-p`, `-rf`, `-r`, `-la` fail even on commands that do exist.');
  if (env.pythonCmd && env.pythonCmd !== 'python3') parts.push(`Use \`${env.pythonCmd}\`, not \`python3\`.`);
  parts.push('For anything file-related use the file tools (view, list_files, find, search, create_file, str_replace, copy_file, move_file, make_dir, delete_file, extract_zip, bundle_zip) — they work identically on every OS. Do not retry the same command.');
  return parts.join(' ');
}

export { pickShell, whichBin };
