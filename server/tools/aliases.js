export const SANDBOX_TOOLS = [
  'bash', 'create_file', 'str_replace', 'insert_lines', 'view', 'list_files',
  'find', 'search', 'delete_file', 'move_file', 'copy_file', 'make_dir',
  'extract_zip', 'bundle_zip', 'clear_sandbox'
];

const SANDBOX_SET = new Set(SANDBOX_TOOLS);

const STRICT_ALIASES = {
  run: 'bash', shell: 'bash', exec: 'bash', execute: 'bash', terminal: 'bash',
  run_command: 'bash', execute_command: 'bash', run_terminal_cmd: 'bash', run_shell: 'bash',
  shell_command: 'bash', bash_command: 'bash', run_bash: 'bash', execute_bash: 'bash', run_script: 'bash',

  write_file: 'create_file', new_file: 'create_file', save_file: 'create_file',
  file_write: 'create_file', write_to_file: 'create_file', create_new_file: 'create_file',
  put_file: 'create_file', overwrite_file: 'create_file', full_file_write: 'create_file',

  edit_file: 'str_replace', replace_in_file: 'str_replace', str_replace_editor: 'str_replace',
  string_replace: 'str_replace', search_replace: 'str_replace', apply_patch: 'str_replace',
  modify_file: 'str_replace', patch_file: 'str_replace', replace_string: 'str_replace',
  file_edit: 'str_replace', update_file: 'str_replace',

  insert_line: 'insert_lines', insert_at_line: 'insert_lines', insert_text: 'insert_lines',

  read_file: 'view', open_file: 'view', file_read: 'view', show_file: 'view',
  get_file: 'view', view_file: 'view', cat_file: 'view', read_lines: 'view',

  list_dir: 'list_files', list_directory: 'list_files', list_dirs: 'list_files',
  directory_tree: 'list_files', file_tree: 'list_files', show_files: 'list_files',
  workspace_files: 'list_files', list_workspace: 'list_files',

  find_files: 'find', file_search: 'find', find_file: 'find', glob_files: 'find', glob_search: 'find',

  search_files: 'search', grep_search: 'search', search_in_files: 'search',
  search_content: 'search', code_search: 'search', text_search: 'search',

  remove_file: 'delete_file', delete_path: 'delete_file', unlink_file: 'delete_file',
  rm_file: 'delete_file', delete_dir: 'delete_file', remove_dir: 'delete_file',

  rename_file: 'move_file', move_path: 'move_file', rename_path: 'move_file',

  copy_path: 'copy_file', duplicate_file: 'copy_file',

  create_dir: 'make_dir', create_directory: 'make_dir', make_directory: 'make_dir',
  new_folder: 'make_dir', create_folder: 'make_dir', mkdirs: 'make_dir',

  unzip_file: 'extract_zip', extract_archive: 'extract_zip', unpack_zip: 'extract_zip',

  zip_files: 'bundle_zip', create_zip: 'bundle_zip', make_zip: 'bundle_zip',
  package_files: 'bundle_zip', bundle_files: 'bundle_zip', download_zip: 'bundle_zip',

  delete_all: 'clear_sandbox', reset_sandbox: 'clear_sandbox', clear_workspace: 'clear_sandbox',
  wipe_sandbox: 'clear_sandbox', empty_sandbox: 'clear_sandbox'
};

const LOOSE_ALIASES = {
  sh: 'bash', cmd: 'bash', command: 'bash',
  write: 'create_file', create: 'create_file',
  edit: 'str_replace', replace: 'str_replace', patch: 'str_replace',
  insert: 'insert_lines',
  read: 'view', open: 'view', cat: 'view', type: 'view',
  ls: 'list_files', dir: 'list_files', tree: 'list_files', list: 'list_files',
  glob: 'find',
  grep: 'search', rg: 'search', ripgrep: 'search',
  rm: 'delete_file', del: 'delete_file', remove: 'delete_file', delete: 'delete_file',
  mv: 'move_file', move: 'move_file', rename: 'move_file',
  cp: 'copy_file', copy: 'copy_file',
  mkdir: 'make_dir',
  unzip: 'extract_zip', extract: 'extract_zip',
  zip: 'bundle_zip', archive: 'bundle_zip', bundle: 'bundle_zip', compress: 'bundle_zip',
  reset: 'clear_sandbox', clear: 'clear_sandbox', wipe: 'clear_sandbox'
};

export function resolveToolName(name, loose = false) {
  const n = String(name || '').trim().replace(/^functions\./, '').replace(/^sandbox[._-]/, '');
  if (!n) return null;
  if (SANDBOX_SET.has(n)) return n;
  const lower = n.toLowerCase();
  if (SANDBOX_SET.has(lower)) return lower;
  if (STRICT_ALIASES[lower]) return STRICT_ALIASES[lower];
  if (loose && LOOSE_ALIASES[lower]) return LOOSE_ALIASES[lower];
  return null;
}

export function canonicalTool(name, loose = true) {
  return resolveToolName(name, loose) || String(name || '').trim();
}

export function makeToolResolver(enabled) {
  const names = enabled instanceof Set ? enabled : new Set(enabled || []);
  if (!names.size) return null;
  return (name) => {
    const raw = String(name || '').trim();
    if (names.has(raw)) return raw;
    const bare = raw.replace(/^functions\./, '');
    if (names.has(bare)) return bare;
    const canon = resolveToolName(bare, false);
    return canon && names.has(canon) ? canon : null;
  };
}

function distance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function nearestTool(name, pool = SANDBOX_TOOLS) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  let best = null, bestScore = Infinity;
  for (const t of pool) {
    const d = distance(n, t);
    if (d < bestScore) { bestScore = d; best = t; }
  }
  return bestScore <= Math.max(3, Math.floor(n.length / 2)) ? best : null;
}
