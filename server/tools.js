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

const bool = (description) => ({ type: 'boolean', description });

export function sandboxToolSchemas() {
  return [
    fn('bash', 'Run a shell command on your machine, inside your working directory. This is your main tool: run and test code, install packages, scaffold projects, inspect data, use git, anything (e.g. "python main.py", "npm install", "node test.js"). stdout and stderr are captured and the real exit code is returned. Your current directory PERSISTS between calls, so "cd sub" now affects later commands. Prefer the dedicated file tools (create_file, str_replace, view, move_file, etc.) for editing and moving files, since they are versioned and work identically on every host OS.', {
      cmd: str('The shell command to run. May span multiple lines.'),
      workdir: str('Optional directory to run in for this call (relative to your root). Also becomes the new persistent working directory.'),
      timeout_s: int('Optional timeout in seconds (default 60, max 600). Raise it for slow installs or long builds.')
    }, ['cmd']),
    fn('create_file', 'Create or fully overwrite a file. Provide the COMPLETE file content, never truncate or write placeholders like "rest unchanged". Parent folders are created automatically. Each write is versioned so the user can diff and roll back.', {
      path: str('Relative path of the file, e.g. "src/app.js". Never absolute.'),
      content: str('The complete raw text content of the file.')
    }, ['path', 'content']),
    fn('str_replace', 'Edit an existing file by replacing an exact snippet. By default old_str must occur exactly once (include enough surrounding lines to make it unique). This is the preferred way to edit; do not recreate a whole file to change part of it.', {
      path: str('Relative path of the file to edit.'),
      old_str: str('The exact text to replace, whitespace and indentation included.'),
      new_str: str('The replacement text.'),
      replace_all: bool('Optional. If true, replace every occurrence of old_str instead of requiring it to be unique.')
    }, ['path', 'old_str', 'new_str']),
    fn('view', 'Read a file (returns numbered lines; page large files with start/end) OR view a directory (returns its tree). Dependency and build folders like node_modules are shown as "(ignored)".', {
      path: str('Relative path of a file or directory. Omit or "." for the whole workspace tree.'),
      start: int('Optional first line to show (1-indexed, files only).'),
      end: int('Optional last line to show (inclusive, files only).')
    }),
    fn('list_files', 'Show your working directory as a tree. Dependency and build folders (node_modules, .venv, target, dist, and so on) plus anything in .gitignore are hidden from the tree but still exist on disk and are fully usable from bash.', {
      path: str('Optional subdirectory to list. Omit for the whole workspace.'),
      all: bool('Optional. If true, include ignored dependency/build folders too.')
    }),
    fn('find', 'Find files by glob pattern (e.g. "**/*.py", "src/**/*.ts", "*.json"). Ignored dependency/build folders are excluded unless all is true.', {
      pattern: str('A glob pattern. "**" matches any depth, "*" matches within one path segment.'),
      all: bool('Optional. If true, also search inside ignored dependency/build folders.')
    }, ['pattern']),
    fn('search', 'Search file contents across the workspace. Substring by default, or a regular expression when regex is true. Ignored folders are skipped.', {
      query: str('Text to search for (case-insensitive), or a regex when regex is true.'),
      path: str('Optional path filter: a glob like "src/**/*.js" or a plain substring of the path.'),
      regex: bool('Optional. If true, treat query as a JavaScript regular expression.')
    }, ['query']),
    fn('delete_file', 'Delete a file or folder.', {
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
    fn('extract_zip', 'Unpack a .zip that is already in your directory. Files inside dependency/build folders are unpacked to disk but kept out of listings automatically.', {
      path: str('Relative path of the zip file.'),
      dest: str('Optional destination folder to extract into.')
    }, ['path']),
    fn('bundle_zip', 'Package files into one downloadable .zip for the user. This is the only correct way to produce a zip; never build zips with shell commands.', {
      name: str('Base name for the zip (without extension).'),
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of relative paths to include, preserving their folder structure. Omit to bundle everything.' }
    }, ['name']),
    fn('clear_sandbox', 'Delete EVERYTHING in your directory. Only use when the user explicitly asks to clear or reset it.', {})
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

export function buildTools({ sandboxOn, webSearchOn, membankOn, chatSearchOn, skillsOn, mcpSchemas, endChatOn, projFilesOn }) {
  const out = [];
  if (sandboxOn) out.push(...sandboxToolSchemas());
  if (webSearchOn) out.push(webSearchSchema());
  if (membankOn) out.push(...membankSchemas());
  if (chatSearchOn) out.push(...chatSearchSchemas());
  if (skillsOn) out.push(skillSchema());
  if (endChatOn) out.push(endConversationSchema());
  if (projFilesOn) out.push(...projectFilesSchemas());
  if (mcpSchemas && mcpSchemas.length) out.push(...mcpSchemas);
  return out;
}

export function parseArgs(argsText) {
  if (argsText == null || argsText === '') return {};
  if (typeof argsText === 'object') return Array.isArray(argsText) ? {} : argsText;
  let text = String(argsText).trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  try {
    const v = JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  const partial = extractPartial(text);
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
