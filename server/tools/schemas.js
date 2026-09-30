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

const REL = 'Path RELATIVE to the workspace root, using forward slashes, e.g. "src/app.py". Absolute paths ("/etc/x", "C:\\\\Users\\\\x"), "~" and ".." above the root are rejected.';

function bashDescription(env) {
  const runtimes = env && env.interpreters && env.interpreters.length
    ? env.interpreters.map(i => `${i.name} (${i.version})`).join(', ')
    : 'none detected';
  const shell = env ? `${env.osName} / ${env.shellName}` : 'the host shell';
  const lines = [
    `Run one shell command inside your workspace directory on ${shell}. This is your main tool: run and test code, install project dependencies, scaffold, inspect data.`,
    `Programs available on this host: ${runtimes}.${env && env.utils && env.utils.length ? ` Utilities: ${env.utils.join(', ')}.` : ''} Calling anything else fails.`
  ];
  if (env && env.missingUtils && env.missingUtils.length) {
    lines.push(`NOT installed on this host, do not call them: ${env.missingUtils.join(', ')}.`);
  }
  if (env && !env.unix) {
    lines.push('This host is Windows cmd.exe, NOT a Unix shell: Unix flags (`-p`, `-rf`, `-r`, `-la`) fail even on commands that do exist, and `find`, `sort` and `more` are the Windows versions, not the Unix ones.');
    lines.push('cmd.exe builtins (`mkdir`, `del`, `copy`, `move`, `ren`, `rmdir`, `dir`, `type`) read a `/` inside a path as a switch, not a separator, so `mkdir a/b` fails — use backslashes in these commands, e.g. `mkdir a\\b`. This does not apply to the file tools\' own `path` argument, which always takes forward slashes.');
  }
  if (env && env.pythonCmd && env.pythonCmd !== 'python3') lines.push(`The Python command here is \`${env.pythonCmd}\`, not \`python3\`.`);
  lines.push('The shell is confined to the workspace: absolute paths, "~", ".." above the root, and host administration commands (sudo, systemctl, reg, apt, docker, ssh, shutdown, ...) are blocked.');
  lines.push('Your current directory PERSISTS between calls, so "cd sub" affects later commands. stdout, stderr and the real exit code are returned to you.');
  lines.push('For creating, editing, moving, deleting, zipping or reading files use the dedicated file tools instead — they are versioned, shown to the user, and behave identically on every OS.');
  return lines.join(' ');
}

export function sandboxToolSchemas(env = null) {
  return [
    fn('bash', bashDescription(env), {
      cmd: str('The shell command to run. May span multiple lines. Every path in it must be relative to the workspace root.'),
      workdir: str('Optional directory to run in for this call, relative to the workspace root. PREFER THIS over writing "cd <dir> && ..." — the shell keeps its directory between calls, so a cd you repeat every time compounds into <dir>/<dir> and fails. workdir is absolute from the workspace root and gives the same result no matter where the shell happens to be.'),
      timeout_s: int('Optional timeout in seconds (default 60, max 600). Raise it for slow installs or long builds.')
    }, ['cmd']),
    fn('create_file', 'Create a new file, or completely overwrite an existing one. BOTH arguments are required on every call: a call carrying only a path is invalid and does nothing. Provide the COMPLETE final text: never truncate, never write placeholders such as "rest of file unchanged" or "...". Missing parent folders are created automatically, so you do not need make_dir first. Every write is versioned so the user can diff and roll back. To change part of an existing file use str_replace instead.', {
      path: str(REL),
      content: str('The complete raw text content of the file. Pass "" to create an empty file.')
    }, ['path', 'content']),
    fn('str_replace', 'Change part of an existing file by replacing one exact snippet. This is the normal way to edit: do not rewrite a whole file to change a few lines. old_str must match the file EXACTLY, including indentation and line breaks, so view the file first and copy the text from it. By default old_str must appear exactly once; if it is not unique, include more surrounding lines or set replace_all.', {
      path: str(REL),
      old_str: str('The exact existing text to replace, copied character for character from the file, whitespace and indentation included.'),
      new_str: str('The replacement text. Pass "" to delete old_str.'),
      replace_all: bool('Optional. If true, replace every occurrence instead of requiring old_str to be unique.')
    }, ['path', 'old_str', 'new_str']),
    fn('insert_lines', 'Insert new text into an existing file at a line number, without replacing anything. Use str_replace when you need to change existing text.', {
      path: str(REL),
      line: int('Insert AFTER this many lines (0 inserts at the very top). Omit to append at the end.'),
      content: str('The text to insert.')
    }, ['path', 'content']),
    fn('view', 'Read a file as numbered lines, or view a directory as a tree. Always view a file before editing it so your str_replace matches exactly. Large files are truncated: page through them with start/end. Dependency and build folders such as node_modules are shown as "(ignored)".', {
      path: str('Relative path of a file or directory. Omit or "." for the whole workspace tree.'),
      start: int('Optional first line to show (1-indexed, files only).'),
      end: int('Optional last line to show (inclusive, files only).')
    }),
    fn('list_files', 'Show the workspace as a tree. Dependency and build folders (node_modules, .venv, target, dist, and so on) plus anything matched by .gitignore are hidden from the tree, but they still exist on disk and work normally from bash.', {
      path: str('Optional subdirectory to list, relative to the workspace root. Omit for the whole workspace.'),
      all: bool('Optional. If true, include ignored dependency/build folders too.')
    }),
    fn('find', 'Find files by glob pattern (e.g. "**/*.py", "src/**/*.ts", "*.json"). Searches file NAMES; use search to look inside file contents. Ignored dependency/build folders are excluded unless all is true.', {
      pattern: str('A glob pattern. "**" matches any depth, "*" matches within one path segment.'),
      all: bool('Optional. If true, also search inside ignored dependency/build folders.')
    }, ['pattern']),
    fn('search', 'Search the CONTENTS of workspace files and return matching lines with their paths and line numbers. Substring and case-insensitive by default, or a regular expression when regex is true. Ignored folders are skipped.', {
      query: str('Text to search for (case-insensitive), or a regex when regex is true.'),
      path: str('Optional path filter: a glob like "src/**/*.js" or a plain substring of the path.'),
      regex: bool('Optional. If true, treat query as a JavaScript regular expression.')
    }, ['query']),
    fn('delete_file', 'Permanently delete a file or folder from the workspace.', {
      path: str(REL)
    }, ['path']),
    fn('move_file', 'Move or rename a file or folder inside the workspace, keeping its version history.', {
      path: str('Current path, relative to the workspace root.'),
      new_path: str('New path, relative to the workspace root.')
    }, ['path', 'new_path']),
    fn('copy_file', 'Copy a file or folder to another path inside the workspace.', {
      path: str('Source path, relative to the workspace root.'),
      new_path: str('Destination path, relative to the workspace root.')
    }, ['path', 'new_path']),
    fn('make_dir', 'Create a directory, including any missing parent directories. You rarely need this: create_file already creates every missing parent folder on the way to the file. Use it only for a directory that must exist while still being empty.', {
      path: str(REL)
    }, ['path']),
    fn('extract_zip', 'Unpack a .zip that is already in the workspace. This is the only correct way to unpack an archive; shell `unzip`/`tar` may not exist. Files inside dependency/build folders are written to disk but kept out of listings automatically.', {
      path: str('Relative path of the zip file already in the workspace.'),
      dest: str('Optional destination folder to extract into, relative to the workspace root.')
    }, ['path']),
    fn('bundle_zip', 'Package workspace files into one downloadable .zip for the user. This is the only correct way to produce a zip; never build zips with shell commands. Pass paths to bundle only the files you changed; their folder structure is preserved so the user can extract it over an existing project.', {
      name: str('Base name for the zip, without the .zip extension.'),
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of relative paths to include, preserving their folder structure. Omit to bundle the whole workspace.' }
    }, ['name']),
    fn('clear_sandbox', 'Irreversibly delete EVERY file in the workspace. Only call this when the user explicitly asks to clear, reset or empty the workspace.', {})
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

export function memorySchema() {
  return fn('memory', "Save, change or remove a short fact about the user that should be remembered in all of their future conversations. Saved memories are listed with their ids in the system prompt.", {
    action: { type: 'string', enum: ['add', 'update', 'delete'], description: '"add" saves a new memory, "update" rewrites one by id, "delete" removes one by id.' },
    text: str('For add and update: the memory as one short, self-contained sentence, e.g. "Prefers TypeScript over JavaScript."'),
    id: str('For update and delete: the id of an existing memory, as shown in brackets in the system prompt.')
  }, ['action']);
}

export function calculatorSchema() {
  return fn('calculator', 'Evaluate a math expression exactly and return the number. Supports + - * / ^ (power), % (remainder), ! (factorial), parentheses, scientific notation (1.5e3), the constants pi, e and tau, and the functions sqrt, cbrt, abs, sign, exp, ln, log (base 10, or log(x, base)), log2, log10, sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, floor, ceil, trunc, round (round(x, digits)), min, max, hypot, pow, mod, factorial and ncr. Trigonometry uses radians; multiply degrees by pi/180. Write percentages as division, e.g. 15% of 80 is 0.15*80.', {
    expression: str('The expression to evaluate, e.g. "(1200 * 1.07^5) / 12".')
  }, ['expression']);
}

export function todoSchema() {
  return fn('todo', 'Write the plan for a multi-step task. The user sees it as a checklist. Every call replaces the whole list, so send every item each time with its current status. Keep exactly one item in_progress while working. Mark a step cancelled to drop it. The plan closes and disappears once every step is completed or cancelled; send an empty list to cancel the whole plan.', {
    items: {
      type: 'array',
      description: 'The complete list, in order. An empty list cancels and closes the plan.',
      items: {
        type: 'object',
        properties: {
          content: str('What the step is, in a few words.'),
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'The step\'s current status. Use cancelled for a step that is no longer needed.' }
        },
        required: ['content', 'status'],
        additionalProperties: false
      }
    }
  }, ['items']);
}

export function askUserSchema() {
  return fn('ask_user', 'Show the user a question with clickable options and wait for their answer, which comes back as the result. Your reply then continues.', {
    question: str('One clear question.'),
    options: { type: 'array', items: { type: 'string' }, description: 'Between 2 and 6 short, distinct answers the user can click.' },
    multiple: bool('Optional. If true, the user can pick more than one option before sending.')
  }, ['question', 'options']);
}

export function consultModelSchema(names = []) {
  return fn('consult_model', 'Send one self-contained question to another model and get its answer back. It sees only what you send, not this conversation.', {
    model: names.length ? { type: 'string', enum: names, description: 'Which model to ask.' } : str('Which model to ask.'),
    question: str('The full question, with all the context the other model needs.'),
    include_images: bool('Optional. If true, also send the images from the user\'s latest message.')
  }, ['model', 'question']);
}

export function buildTools({ sandboxOn, webSearchOn, membankOn, chatSearchOn, skillsOn, mcpSchemas, endChatOn, memoryOn = false, calculatorOn = false, todoOn = false, askUserOn = false, consultNames = [], hostEnv = null }) {
  const out = [];
  if (sandboxOn) out.push(...sandboxToolSchemas(hostEnv));
  if (webSearchOn) out.push(webSearchSchema());
  if (membankOn) out.push(...membankSchemas());
  if (chatSearchOn) out.push(...chatSearchSchemas());
  if (skillsOn) out.push(skillSchema());
  if (memoryOn) out.push(memorySchema());
  if (calculatorOn) out.push(calculatorSchema());
  if (todoOn) out.push(todoSchema());
  if (askUserOn) out.push(askUserSchema());
  if (consultNames.length) out.push(consultModelSchema(consultNames));
  if (endChatOn) out.push(endConversationSchema());
  if (mcpSchemas && mcpSchemas.length) out.push(...mcpSchemas);
  return out;
}

