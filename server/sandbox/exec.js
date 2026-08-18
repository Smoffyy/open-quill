import { SANDBOX_TOOLS, resolveToolName, nearestTool } from '../tools/aliases.js';
import { argText, argBody, argBool, argInt, argList, argPath, argDest, missingArg } from './args.js';
import {
  createFile, strReplace, insertLines, view, treeString, list, findFiles, search,
  deleteFile, renameFile, copyFile, makeDir, extractZip, bundleZip, clearAll,
  overCap, capError, dirSize
} from './files.js';
import { bash } from './shell.js';

const CONTENT_KEYS = ['content', 'text', 'file_text', 'contents', 'body', 'data', 'code', 'source', 'file_content', 'value'];
const NOT_CONTENT = new Set([
  'path', 'file', 'filename', 'file_path', 'filepath', 'new_path', 'to', 'destination', 'dest', 'target',
  'tool', 'name', 'command', 'cmd', 'type', 'mode', 'encoding', 'overwrite', 'language', 'lang', 'id',
  'description', 'reason', 'thought', 'summary', 'dir', 'directory', 'old_str', 'old_string', 'old', 'search'
]);

export function unknownToolError(name) {
  const guess = nearestTool(name);
  return {
    ok: false,
    error: `There is no tool called "${name}".${guess ? ` Did you mean "${guess}"?` : ''} The tools you can call in this workspace are: ${SANDBOX_TOOLS.join(', ')}. Use one of those exact names.`
  };
}

// One entry per canonical tool. Each handler receives the already-normalized
// relative path, so no handler re-parses or re-validates a path itself.
const HANDLERS = {
  async bash(chatId, call, { signal } = {}) {
    const t = argInt(call, 'timeout_s', 'timeout');
    const ms = Number.isFinite(t) && t > 0 ? Math.min(t, 600) * 1000 : 60000;
    return bash(chatId, argText(call, 'cmd', 'command', 'script'), ms, argText(call, 'workdir', 'cwd'), signal);
  },

  create_file(chatId, call, { rel, missing, maxBytes }) {
    if (missing) return missingArg('create_file', 'path', 'It is the relative path of the file to write, e.g. "src/app.py".', '{"path": "src/app.py", "content": "print(1)"}');
    const body = argBody(call, CONTENT_KEYS, NOT_CONTENT);
    if (body.text == null) return missingArg('create_file', 'content', 'It is the COMPLETE text of the file as a single string (use "" for an empty file). Never write a placeholder like "rest unchanged", and never send the path on its own.', `{"path": ${JSON.stringify(rel)}, "content": "<the whole file here>"}`);
    if (overCap(chatId, Buffer.byteLength(body.text, 'utf8'), maxBytes)) return capError(maxBytes);
    const r = createFile(chatId, rel, body.text);
    if (r.ok && body.salvaged) r.note = `there was no "content" argument, so the file was written from "${body.key}". Send the text as "content" next time.`;
    return r;
  },

  str_replace(chatId, call, { rel, missing }) {
    if (missing) return missingArg('str_replace', 'path', 'It is the relative path of the file to edit, e.g. "src/app.py".', '{"path": "src/app.py", "old_str": "...", "new_str": "..."}');
    const oldStr = argText(call, 'old_str', 'old_string', 'old', 'search');
    if (oldStr == null) return missingArg('str_replace', 'old_str', 'It is the exact text to find, copied character for character from the file (view it first).');
    const newStr = argBody(call, ['new_str', 'new_string', 'new', 'replace', 'replacement']);
    if (newStr.text == null) return missingArg('str_replace', 'new_str', 'It is the replacement text; pass an empty string "" to delete old_str.');
    return strReplace(chatId, rel, oldStr, newStr.text, argBool(call, 'replace_all'));
  },

  insert_lines(chatId, call, { rel, missing }) {
    if (missing) return missingArg('insert_lines', 'path', 'It is the relative path of the file to edit.');
    const body = argBody(call, ['content', 'text', 'contents', 'body', 'new_str']);
    if (body.text == null) return missingArg('insert_lines', 'content', 'It is the text to insert.');
    return insertLines(chatId, rel, argInt(call, 'line', 'at', 'insert_line'), body.text);
  },

  view(chatId, call, { rel }) {
    return view(chatId, rel, argInt(call, 'start', 'from'), argInt(call, 'end', 'to'));
  },

  list_files(chatId, call, { rel }) {
    const all = argBool(call, 'all');
    const under = rel || (argPath(call, ['dir', 'directory']).rel || '');
    const t = treeString(chatId, under, all);
    return { ok: true, path: under || '.', tree: t.text, hidden: t.hidden, files: list(chatId, { all, under }) };
  },

  find(chatId, call, { rel }) {
    const pattern = argText(call, 'pattern', 'glob', 'query') || rel;
    if (!pattern) return missingArg('find', 'pattern', 'It is a glob such as "**/*.py" or "src/**/*.ts".');
    return findFiles(chatId, pattern, argBool(call, 'all'));
  },

  search(chatId, call) {
    const query = argText(call, 'query', 'pattern', 'text', 'q');
    if (!query) return missingArg('search', 'query', 'It is the text (or regex, with regex:true) to look for inside files.');
    return search(chatId, query, argText(call, 'path', 'glob', 'filter'), argBool(call, 'regex'));
  },

  delete_file(chatId, call, { rel, missing }) {
    if (missing) return missingArg('delete_file', 'path', 'It is the relative path of the file or folder to delete.');
    return deleteFile(chatId, rel);
  },

  move_file(chatId, call, { rel, missing }) {
    if (missing) return missingArg('move_file', 'path', 'It is the current relative path.');
    const to = argDest(call);
    if (!to.ok) return { ok: false, error: to.error };
    if (to.missing) return missingArg('move_file', 'new_path', 'It is the new relative path.');
    return renameFile(chatId, rel, to.rel);
  },

  copy_file(chatId, call, { rel, missing, maxBytes }) {
    if (missing) return missingArg('copy_file', 'path', 'It is the source relative path.');
    const to = argDest(call);
    if (!to.ok) return { ok: false, error: to.error };
    if (to.missing) return missingArg('copy_file', 'new_path', 'It is the destination relative path.');
    return copyFile(chatId, rel, to.rel, maxBytes);
  },

  make_dir(chatId, call, { rel, missing }) {
    if (missing) return missingArg('make_dir', 'path', 'It is the relative path of the folder to create, e.g. "src/utils".');
    return makeDir(chatId, rel);
  },

  extract_zip(chatId, call, { rel, missing, maxBytes }) {
    if (missing) return missingArg('extract_zip', 'path', 'It is the relative path of a .zip already in your workspace.');
    if (overCap(chatId, 0, maxBytes)) return capError(maxBytes);
    const budget = maxBytes ? Math.max(0, maxBytes - dirSize(chatId)) : 0;
    return extractZip(chatId, rel, argText(call, 'dest', 'destination'), budget);
  },

  bundle_zip(chatId, call) {
    return bundleZip(chatId, argText(call, 'name', 'zip_name'), argList(call, 'paths'), argBool(call, 'all'));
  },

  clear_sandbox(chatId) {
    return clearAll(chatId);
  }
};

export async function execTool(chatId, call, maxBytes = 0, signal = null) {
  try {
    const tool = resolveToolName(call.tool, true);
    const handler = tool && HANDLERS[tool];
    if (!handler) return unknownToolError(call.tool);
    const p = argPath(call);
    if (!p.ok) return { ok: false, error: p.error };
    return await handler(chatId, call, { rel: p.rel, missing: p.missing, maxBytes, signal });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
