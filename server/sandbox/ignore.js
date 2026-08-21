import path from 'path';
import fs from 'fs';
import { dirFor } from './paths.js';

const TEXT_EXT = new Set(['txt', 'text', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'json5', 'jsonc', 'ndjson', 'js', 'cjs', 'mjs', 'jsx', 'ts', 'cts', 'mts', 'tsx', 'py', 'pyi', 'pyw', 'rb', 'lua', 'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl', 'xml', 'yml', 'yaml', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'hh', 'java', 'kt', 'kts', 'go', 'rs', 'php', 'sql', 'ini', 'cfg', 'conf', 'toml', 'properties', 'log', 'glsl', 'vert', 'frag', 'comp', 'wgsl', 'svg', 'gitignore', 'dockerignore', 'npmignore', 'editorconfig', 'env', 'swift', 'dart', 'r', 'jl', 'ex', 'exs', 'erl', 'hs', 'elm', 'clj', 'cljs', 'scala', 'groovy', 'gradle', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto', 'tf', 'tfvars', 'hcl', 'ipynb', 'm', 'mm', 'nim', 'zig', 'v', 'sol', 'cmake', 'lock', 'diff', 'patch']);

export function extOf(name) { return path.extname(name || '').slice(1).toLowerCase(); }
function baseLower(name) { return path.basename(String(name || '')).toLowerCase(); }
export function isText(name) {
  const b = baseLower(name);
  if (b === 'makefile' || b === 'dockerfile' || b === 'cmakelists.txt' || b.startsWith('.env') || b === 'license' || b === 'readme') return true;
  return TEXT_EXT.has(extOf(name));
}

export const IGNORED_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn', '.npm',
  '.git', '.hg', '.svn', '.bzr',
  '__pycache__', '.venv', 'venv', 'env', 'virtualenv', '.tox', '.nox', '.eggs', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages', '.ipynb_checkpoints',
  'target', '.gradle', 'build', 'dist', 'out', 'bin', 'obj', 'Debug', 'Release',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo', '.parcel-cache', '.cache', '.vite', '.angular', '.output',
  'vendor', 'Pods', 'Carthage', 'DerivedData', '.swiftpm',
  '.dart_tool', '.pub-cache',
  'coverage', '.nyc_output',
  '.idea', '.vscode', '.vs',
  '.terraform', '.serverless',
  '.stack-work', 'dist-newstyle', '_build', 'deps'
]);

export function isIgnoredDir(name) {
  if (IGNORED_DIRS.has(name)) return true;
  return name.endsWith('.egg-info') || name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace') || /^cmake-build-/.test(name);
}

const GITIGNORE_CACHE_MAX = 32;
const gitignoreCache = new Map();
function gitignoreMatchers(chatId) {
  const gi = path.join(dirFor(chatId), '.gitignore');
  let mtime;
  try { mtime = fs.statSync(gi).mtimeMs; } catch { mtime = 0; }
  const cached = gitignoreCache.get(chatId);
  if (cached && cached.mtime === mtime) return cached.m;
  const m = { names: new Set(), globs: [], negNames: new Set() };
  if (mtime) {
    let lines = [];
    try { lines = fs.readFileSync(gi, 'utf8').split(/\r?\n/); } catch {}
    for (const raw of lines) {
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const neg = line.startsWith('!');
      if (neg) line = line.slice(1).trim();
      line = line.replace(/\/+$/, '').replace(/^\/+/, '');
      if (!line) continue;
      if (line.includes('/') || line.includes('**')) { if (!neg) m.globs.push(globToRe(line)); continue; }
      if (line.includes('*') || line.includes('?')) { if (neg) m.negNames.add(line); else m.globs.push(globToReBase(line)); continue; }
      if (neg) m.negNames.add(line); else m.names.add(line);
    }
  }
  gitignoreCache.delete(chatId);
  gitignoreCache.set(chatId, { mtime, m });
  if (gitignoreCache.size > GITIGNORE_CACHE_MAX) gitignoreCache.delete(gitignoreCache.keys().next().value);
  return m;
}

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') { if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '(?:/.*)?$');
}
function globToReBase(glob) {
  let re = '';
  for (const c of glob) {
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return { base: new RegExp('^' + re + '$') };
}

export function isIgnoredRel(chatId, rel) {
  const parts = String(rel || '').split('/').filter(Boolean);
  if (!parts.length) return false;
  for (let i = 0; i < parts.length - 1; i++) if (isIgnoredDir(parts[i])) return true;
  const gi = gitignoreMatchers(chatId);
  const base = parts[parts.length - 1];
  if (gi.negNames.has(base)) return false;
  for (const seg of parts) if (gi.names.has(seg)) return true;
  for (const g of gi.globs) { if (g.base) { if (g.base.test(base)) return true; } else if (g.test(rel)) return true; }
  return false;
}
export function isIgnoredPath(rel) { return String(rel || '').split('/').slice(0, -1).some(isIgnoredDir); }

export { globToRe, globToReBase };

export function gitignoreCacheDrop(chatId) { gitignoreCache.delete(chatId); }
