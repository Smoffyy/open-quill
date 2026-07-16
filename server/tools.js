function fn(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false }
    }
  };
}
const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });

export function sandboxToolSchemas() {
  return [
    fn('bash', 'Run a shell command inside the sandbox working directory. Use it to run and test code, install packages, and inspect data (e.g. "python3 main.py", "npm install"). stdout and stderr are captured. Prefer the dedicated file tools for copying, moving, or deleting files so the operation works on every host OS.', {
      cmd: str('The shell command to run. May span multiple lines.'),
      timeout_s: int('Optional timeout in seconds (default 60, max 300). Raise it for slow installs or long-running builds.')
    }, ['cmd']),
    fn('create_file', 'Create or fully overwrite a file in the sandbox. Provide the COMPLETE file content, never truncate or write placeholders like "rest unchanged". Parent folders are created automatically. Each write is versioned so the user can diff and roll back.', {
      path: str('Relative path of the file, e.g. "src/app.js". Never absolute.'),
      content: str('The complete raw text content of the file.')
    }, ['path', 'content']),
    fn('str_replace', 'Edit an existing file by replacing one exact, unique snippet. old_str must appear exactly once in the file, include enough surrounding lines to make it unique. This is the preferred way to edit; do not recreate whole files to change a part.', {
      path: str('Relative path of the file to edit.'),
      old_str: str('The exact text to replace. Must occur exactly once in the file.'),
      new_str: str('The replacement text.')
    }, ['path', 'old_str', 'new_str']),
    fn('view', 'Read a file from the sandbox. Returns numbered lines. For large files, pass start/end to page through them.', {
      path: str('Relative path of the file to read.'),
      start: int('Optional first line to show (1-indexed).'),
      end: int('Optional last line to show (inclusive).')
    }, ['path']),
    fn('list_files', 'List every file currently in the sandbox (dependency folders like node_modules are hidden).', {}),
    fn('search', 'Search the text contents of all sandbox files for a string.', {
      query: str('The text to search for (case-insensitive).'),
      path: str('Optional substring filter on file paths.')
    }, ['query']),
    fn('delete_file', 'Delete a file or folder from the sandbox.', {
      path: str('Relative path of the file or folder to delete.')
    }, ['path']),
    fn('move_file', 'Move or rename a file or folder, keeping its version history.', {
      path: str('Current relative path.'),
      new_path: str('New relative path.')
    }, ['path', 'new_path']),
    fn('copy_file', 'Copy a file or folder to a new path.', {
      path: str('Source relative path.'),
      new_path: str('Destination relative path.')
    }, ['path', 'new_path']),
    fn('make_dir', 'Create a directory (and any missing parents).', {
      path: str('Relative path of the directory to create.')
    }, ['path']),
    fn('extract_zip', 'Unpack a .zip file that is already in the sandbox.', {
      path: str('Relative path of the zip file.'),
      dest: str('Optional destination folder to extract into.')
    }, ['path']),
    fn('bundle_zip', 'Package sandbox files into one downloadable .zip. This is the only correct way to produce a zip for the user; never build zips with shell commands.', {
      name: str('Base name for the zip (without extension).'),
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of relative paths to include. Omit to bundle everything.' }
    }, ['name']),
    fn('clear_sandbox', 'Delete EVERYTHING in the sandbox. Only use when the user explicitly asks to clear or reset it.', {})
  ];
}

export function webSearchSchema() {
  return fn('web_search', 'Search the live web and read the top result pages. Use it when the answer needs current or niche information that may not be in your training data. Keep queries focused; call it again to refine or follow up.', {
    query: str('The search query.'),
    count: int('Optional number of results to fetch (capped by the server).')
  }, ['query']);
}

export function membankSchemas() {
  return [
    fn('mb_view', 'Read an admin-provided reference file from the memory bank. Pass start/end line numbers to read only the slice you need.', {
      path: str('The reference file name.'),
      start: int('Optional first line (1-indexed).'),
      end: int('Optional last line (inclusive).')
    }, ['path']),
    fn('mb_search', 'Search across all memory bank reference files for a term.', {
      query: str('The text to search for.')
    }, ['query'])
  ];
}

export function chatSearchSchemas() {
  return [
    fn('chat_search', "Search the user's OTHER past conversations in this app for relevant context (decisions, code, preferences discussed before). Returns matching snippets with chat ids. Use it when the user references something from a previous chat.", {
      query: str('The text to search for across past chat titles and messages (case-insensitive).')
    }, ['query']),
    fn('chat_view', 'Read the messages of one of the user\'s past chats found via chat_search. Returns the most recent messages, truncated.', {
      chat_id: str('The id of the chat, as returned by chat_search.'),
      limit: int('Optional number of most recent messages to return (default 20, max 60).')
    }, ['chat_id'])
  ];
}

export function skillSchema() {
  return fn('skill_view', 'Load an admin-provided skill file by name. Skills contain required instructions and best practices for specific kinds of tasks, load the matching skill before starting such a task.', {
    name: str('The skill name exactly as listed in the system prompt.')
  }, ['name']);
}

export function endConversationSchema() {
  return fn('end_conversation', 'Permanently end this conversation. After this call the user can no longer send messages, edit, regenerate, or branch this chat. Use it only when your instructions call for it. ALWAYS explain to the user in your reply text WHY you are ending the conversation BEFORE calling this tool, then call it with a short reason.', {
    reason: str('A short summary of why the conversation is being ended (shown to the user).')
  }, []);
}

export function projectFilesSchemas() {
  return [
    fn('pf_search', "Search across the documents the user attached to this project. Returns matching lines with file names and line numbers.", {
      query: str('Text to search for (case-insensitive).')
    }, ['query']),
    fn('pf_view', 'Read a project document by name, optionally a specific line range.', {
      name: str('The file name exactly as listed in the system prompt.'),
      from: int('Optional 1-based line to start from (default 1).'),
      lines: int('Optional number of lines to return (default 200, max 400).')
    }, ['name'])
  ];
}

export function customToolSchemas(list) {
  return (list || []).map(t => fn(
    t.name,
    (t.description || 'Admin-provided tool.').slice(0, 1000),
    Object.fromEntries((t.params || []).map(p => [p.name, str(p.desc || '')])),
    (t.params || []).filter(p => p.required).map(p => p.name)
  ));
}

export function buildTools({ sandboxOn, webSearchOn, membankOn, customToolsList, chatSearchOn, skillsOn, mcpSchemas, endChatOn, projFilesOn }) {
  const out = [];
  if (sandboxOn) out.push(...sandboxToolSchemas());
  if (webSearchOn) out.push(webSearchSchema());
  if (membankOn) out.push(...membankSchemas());
  if (chatSearchOn) out.push(...chatSearchSchemas());
  if (skillsOn) out.push(skillSchema());
  if (endChatOn) out.push(endConversationSchema());
  if (projFilesOn) out.push(...projectFilesSchemas());
  if (customToolsList && customToolsList.length) out.push(...customToolSchemas(customToolsList));
  if (mcpSchemas && mcpSchemas.length) out.push(...mcpSchemas);
  return out;
}

export function parseArgs(argsText) {
  if (argsText == null || argsText === '') return {};
  if (typeof argsText === 'object') return argsText;
  try {
    const v = JSON.parse(argsText);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch {}
  const partial = extractPartial(String(argsText));
  const out = {};
  for (const k of Object.keys(partial)) if (partial[k].closed) out[k] = partial[k].value;
  return out;
}

export function toCall(name, argsText) {
  return { tool: String(name || '').trim(), ...parseArgs(argsText) };
}

function unescapePartial(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n === 'n') { out += '\n'; i++; }
    else if (n === 't') { out += '\t'; i++; }
    else if (n === 'r') { out += '\r'; i++; }
    else if (n === '"') { out += '"'; i++; }
    else if (n === '\\') { out += '\\'; i++; }
    else if (n === '/') { out += '/'; i++; }
    else if (n === 'b') { out += '\b'; i++; }
    else if (n === 'f') { out += '\f'; i++; }
    else if (n === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; }
      else break;
    } else { out += n; i++; }
  }
  return out;
}

function extractPartial(text) {
  const out = {};
  const keyRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*/g;
  let m;
  while ((m = keyRe.exec(text))) {
    const key = m[1];
    let i = keyRe.lastIndex;
    const c = text[i];
    if (c === '"') {
      i++;
      let j = i, esc = false, closed = false;
      for (; j < text.length; j++) {
        const ch = text[j];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { closed = true; break; }
      }
      out[key] = { value: unescapePartial(text.slice(i, j)), closed };
      if (closed) keyRe.lastIndex = j + 1;
      else break;
    } else if (c === '{' || c === '[') {
      break;
    } else {
      const rest = text.slice(i);
      const vm = rest.match(/^(-?\d+(?:\.\d+)?|true|false|null)/);
      if (vm) {
        const raw = vm[1];
        out[key] = { value: raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number(raw), closed: true };
        keyRe.lastIndex = i + raw.length;
      } else break;
    }
  }
  return out;
}

const PREVIEW_TOOLS = new Set(['create_file', 'str_replace']);

export function livePreview(name, argsText) {
  const tool = String(name || '').trim();
  if (!tool) return null;
  const p = extractPartial(String(argsText || ''));
  const get = (k) => (p[k] ? p[k].value : undefined);
  if (!PREVIEW_TOOLS.has(tool)) {
    const live = { tool };
    const path = get('path'); if (p.path && p.path.closed && path) live.path = String(path).slice(0, 300);
    const query = get('query'); if (p.query && p.query.closed && query) live.query = String(query).slice(0, 300);
    const cmd = get('cmd'); if (cmd != null) live.cmd = String(cmd).slice(0, 300);
    const nm = get('name'); if (p.name && p.name.closed && nm) live.name = String(nm).slice(0, 120);
    return live;
  }
  const path = get('path');
  if (!p.path || !p.path.closed || !path) return { tool };
  if (tool === 'create_file') return { tool, path: String(path), content: String(get('content') ?? ''), oldStr: null };
  return { tool, path: String(path), content: String(get('new_str') ?? ''), oldStr: p.old_str && p.old_str.closed ? String(get('old_str')) : null };
}
