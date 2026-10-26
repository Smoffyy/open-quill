import path from 'path';

export const ARTIFACT_EXT = new Set([
  'md', 'txt', 'html', 'svg', 'mmd', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'toml', 'ini',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'php',
  'lua', 'sh', 'ps1', 'sql', 'css', 'scss', 'r', 'dart', 'scala', 'tex'
]);

const NAME_MAX = 80;

export function artifactName(raw) {
  let name = String(raw ?? '').trim().replace(/\s+/g, '-');
  if (!name) return { ok: false, error: 'name is required, for example "notes.md".' };
  if (/[\\/]/.test(name) || name.startsWith('.')) return { ok: false, error: `"${name}" is not a valid artifact name. Use a plain file name without folders, such as "notes.md".` };
  if (!path.extname(name)) name += '.md';
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!ARTIFACT_EXT.has(ext)) return { ok: false, error: `".${ext}" is not an artifact type. Use one of: ${[...ARTIFACT_EXT].join(', ')}.` };
  if (name.length > NAME_MAX) return { ok: false, error: `The name is longer than ${NAME_MAX} characters.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(name)) return { ok: false, error: `"${name}" has characters a file name cannot use. Use letters, numbers, dots, dashes and underscores.` };
  return { ok: true, name };
}