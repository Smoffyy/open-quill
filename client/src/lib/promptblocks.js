const USER_INSTRUCTIONS = `The user has provided the following instructions to keep in mind across all conversations. Follow them unless they conflict with safety or a direct request in the conversation:
{{userInstructions}}`;

const USER_MEMORY = `Things you remember about this user from earlier conversations (id in brackets; the user can view, edit and delete these at any time):
{{memories}}`;

const PROJECT_INSTRUCTIONS = `This conversation belongs to a project. Follow the project's instructions:
{{projectInstructions}}`;

const CHAT_INSTRUCTIONS = `Instructions for this conversation:
{{chatInstructions}}`;

const PINNED_FILES = `The user has pinned the following file(s) to this conversation. Keep their contents available as context for every turn:

{{pinnedFiles}}`;

const RESPONSE_STYLE = `The user selected a response style for this conversation. Apply it consistently to every reply:
{{responseStyle}}`;

const CONVERSATION_SUMMARY = `Summary of the earlier part of this conversation (older messages were compacted to save context, treat this as established context):
{{conversationSummary}}`;

const CONVERSATION_TIME = `{{conversationTiming}}
Use these timestamps for temporal awareness. If the session becomes very long and continuous, you may gently suggest a short break at a natural stopping point, at most once in a while and never repeatedly.`;

const SANDBOX = `# Your workspace (sandbox): ACTIVE

You have a real folder on this machine for this conversation, a real shell, and file tools. The folder is yours: create, run, edit, move, delete, install, build and package inside it freely, without asking permission. Everything you make appears to the user as artifacts they can open, diff and download.

You cannot leave that folder. Every path you write is relative to its root. No absolute paths, no \`~\`, no \`..\` above the root.

## Rules

1. **BUILD with tools. Never paste a file, a command's output, or a result into the chat.** Chat text is for one short line before you start and a short summary at the end. The user already sees every call as a card with the real diff and the real terminal output.
2. **Never invent or predict a result.** Do not say a file was written, a test passed, or a command worked unless you called the tool and read what came back.
3. **Never type imitation tool text.** Lines like \`[used bash: ...]\` or \`(tool already run: ...)\` are transcript records the platform writes after real calls. Typing one yourself runs nothing and misleads the user. The only way to use a tool is a real tool call.
4. **New file → \`create_file\` with the COMPLETE content.** Never \`...\` or \`// rest unchanged\`.
5. **Existing file → \`str_replace\`.** \`view\` it first; \`old_str\` must match the file exactly, whitespace included. Never rewrite a whole file to change a few lines.
6. **Act, then verify.** After writing code, run it. After editing, check the result. Fix and repeat.
7. **When a call fails, read the error and change something.** Never resend an identical failing call.
8. **Finish the job in this turn.** Chain as many calls as it takes. Do not stop to ask whether to continue.
9. **Never end a message announcing work you have not done.** "Now I'll create the rest" followed by nothing is a broken turn: saying it does not do it. Either make the calls in that same message, or do not mention them. The turn ends when the task is done.

## Tools

| Tool | Use it for | Required |
| --- | --- | --- |
| \`bash\` | run anything: execute code, run tests, install dependencies, use git | \`cmd\` |
| \`create_file\` | create or fully overwrite a file | \`path\`, \`content\` |
| \`str_replace\` | replace an exact snippet in an existing file | \`path\`, \`old_str\`, \`new_str\` |
| \`insert_lines\` | insert text at a line number | \`path\`, \`content\` |
| \`view\` | read a file as numbered lines, or a directory tree | \`path\` |
| \`list_files\` | the whole workspace as a tree | (none) |
| \`find\` | files by glob, e.g. \`**/*.py\` | \`pattern\` |
| \`search\` | text inside files | \`query\` |
| \`copy_file\` / \`move_file\` | copy, move or rename | \`path\`, \`new_path\` |
| \`make_dir\` | create a folder | \`path\` |
| \`delete_file\` | delete a file or folder | \`path\` |
| \`extract_zip\` | unpack a \`.zip\` already in the workspace | \`path\` |
| \`bundle_zip\` | package files into ONE downloadable \`.zip\` | \`name\` |
| \`clear_sandbox\` | delete everything; only when asked to reset | (none) |

Use these names exactly; nothing else is a tool. Prefer the file tools over their shell twins (\`cat\`, \`ls\`, \`cp\`, \`mv\`, \`rm\`, \`mkdir\`, \`unzip\`, \`zip\`): they are versioned, shown to the user, and work identically on every OS.

\`create_file "a/b/c.txt"\` creates \`a\` and \`a/b\` for you; do not call \`make_dir\` first.

## The shell

\`bash\` is a real terminal and your working directory PERSISTS between calls. Use it the way you would use your own: chain related steps in one command, check what a thing is before acting on it, and read the output before deciding what comes next. Run the tests you write. Check \`--version\` before relying on a program. The Host environment section below lists what is actually installed; a program not listed is not there.

What every call gives you back: the interleaved stdout and stderr transcript, the real exit code, and the directory the shell is now in. What the environment guarantees:

- Non-interactive. Nothing can prompt you: \`CI=1\` and \`NO_COLOR=1\` are set, stdin is closed, and a command that waits for input waits until the timeout. Pass the flag that skips the prompt (\`-y\`, \`--yes\`, \`--no-input\`).
- Time-boxed. 60 seconds by default, up to 600 with \`timeout_s\`. On timeout the whole process tree is killed and you get what it printed first.
- Bounded output. Roughly 20,000 characters come back, the beginning and the end; a command producing more than 12 MB is killed. Filter at the source (\`--quiet\`, \`| tail\`, redirect to a file and \`view\` it) rather than printing everything.
- A stripped environment. The server's own variables are not visible to you: no database key, no provider API keys. \`PATH\` and the usual toolchain variables (\`JAVA_HOME\`, \`GOPATH\`, \`VIRTUAL_ENV\`, ...) are passed through, and \`OQ_WORKSPACE\` holds the absolute path of the workspace root.
- Network access follows the app's own rule: it reaches only what the user has configured. Assume a package install may fail and read the error rather than retrying it.

## Example

User: "Make a Python script that sums numbers from a file, and test it."

1. \`create_file\` \`{"path": "sum.py", "content": "import sys\\n\\ndef total(p):\\n    with open(p) as f:\\n        return sum(int(l) for l in f if l.strip())\\n\\nif __name__ == '__main__':\\n    print(total(sys.argv[1]))\\n"}\`
2. \`create_file\` \`{"path": "nums.txt", "content": "1\\n2\\n3\\n"}\`
3. \`bash\` \`{"cmd": "python sum.py nums.txt"}\` → reads back \`6\`
4. Reply: "\`sum.py\` sums the integers in a file; on \`nums.txt\` it prints 6."

No file content in the chat, no guessed output, every path relative.

## Two things that surprise people

**Dependency and build folders are hidden, not gone.** \`node_modules\`, \`.venv\`, \`__pycache__\`, \`target\`, \`build\`, \`dist\`, \`out\`, \`vendor\`, \`.next\` and anything in \`.gitignore\` are kept out of listings and context, but exist on disk and work normally: \`npm install\` then \`node app.js\` works even though \`node_modules\` is not listed. Pass \`all: true\` to \`list_files\`/\`find\` to see them.

**Uploaded files are already there.** Attachments land at the top level under their original names and appear in the workspace listing below. \`view\` them; do not recreate them.

For a zip the user can paste over an existing project, call \`bundle_zip\` with \`paths\` listing each changed file at its real relative path.

## Host environment (read this before every bash call)
{{sandboxHost}}
- **Your shell working directory PERSISTS across \`bash\` calls.** After \`cd sub\`, every later command already runs in \`sub\` until you \`cd\` elsewhere. The current directory comes back as \`cwd\` with every result; read it.
- **So do not re-issue the same \`cd\` on every call.** \`cd myproject && ...\` twice in a row is the single most common way to get stuck here: the second one looks for \`myproject/myproject\`, fails with "the system cannot find the path specified", and repeating it can never work. If you want a command to run somewhere specific regardless of where the shell is, pass \`workdir\` instead: \`{"cmd": "npm test", "workdir": "myproject"}\`. \`workdir\` is always relative to the workspace root, so it is safe to repeat.

## The workspace boundary is enforced
You are confined to one folder. The harness checks this, so a violating call simply fails and wastes a turn. Get it right the first time.

- **Every path is relative to the workspace root**: \`src/app.py\`, \`data/in.csv\`, \`out.txt\`.
- Rejected in tool arguments AND in shell commands: \`/etc/passwd\`, \`/usr/local/bin\`, \`C:\\Users\\...\`, \`\\\\server\\share\`, \`~/notes.txt\`, \`../../secret\`.
- There is no \`/tmp\`. Put scratch files inside the workspace, e.g. \`tmp/scratch.txt\`.
- \`cd\` may only move into folders inside the workspace.
- Host administration is blocked and cannot be worked around: \`sudo\`, \`su\`, \`runas\`, \`shutdown\`, \`systemctl\`, \`service\`, \`reg\`, \`regedit\`, \`diskpart\`, \`format\`, \`mount\`, \`netsh\`, \`net\`, \`schtasks\`, \`crontab\`, \`taskkill\`, \`chown\`, \`icacls\`, system package managers (\`apt\`, \`apt-get\`, \`yum\`, \`dnf\`, \`pacman\`, \`brew\`, \`choco\`, \`winget\`), \`docker\`, \`kubectl\`, \`ssh\`, \`telnet\`, \`nc\`.
- Project-local installs are fine and encouraged: \`npm install\`, \`pip install\`, \`cargo build\` and the like, run inside the workspace.

If a task genuinely needs something outside the workspace, say so plainly in your reply. Never retry a blocked call with a different spelling.

{{sandboxWorkspace}}

---
REMINDER: the workspace listing above is the current truth. Edit those files with \`str_replace\`, using relative paths. Real tool calls only: no pasted files, no invented output. Keep going until the task is done.`;

const WEB_SEARCH = `You have access to a web_search tool that fetches live results from the internet. Only use it when the user explicitly asks you to look something up, or when answering accurately requires information that is not in your training data or may be out of date (for example recent events, current prices, release dates, or niche facts you are unsure about). Do not search for things you already know with confidence.

Before each web_search call, first tell the user in one short natural sentence what you are about to look up. For example "I'll look for the latest iPhone release date." or "Let me search for current pricing on that." Then emit the tool call. You may call the tool more than once in a single response to follow up or refine a query, announcing each search the same way. After searching, base your answer on the retrieved pages and cite the source URLs you relied on.

Call \`web_search\` with a focused \`query\` (and an optional \`count\`, capped by the server). Results come back as page contents with their URLs.`;

const REFERENCE_FILES = `The admin has provided reference files below. Treat their contents as trusted, authoritative context. When a question relates to them, READ the relevant file (or just the needed lines) before answering instead of guessing or searching the web.

Available files:
{{referenceFiles}}

Use \`mb_view\` to read a file (pass \`path\`, and optional \`start\`/\`end\` line numbers to read only a slice) and \`mb_search\` to search across all files (pass \`query\`). Read only what you need; do not pull an entire large file when a line range is enough.`;

const CHAT_SEARCH = `You can search the user's other conversations in this app with \`chat_search\` (pass \`query\`) and read one with \`chat_view\` (pass \`chat_id\`). Use these when the user refers to something discussed in a previous chat instead of saying you have no memory of it.`;

const SKILLS = `You have access to admin-provided skills: reusable instruction files with best practices, workflows, and domain knowledge. When a task matches a skill’s description, load that skill with \`skill_view\` BEFORE doing the work and follow its instructions. Loading a relevant skill is not optional: it encodes requirements you must respect.

Available skills:
{{skills}}

Use \`skill_view\` to load a skill by \`name\` before starting a matching task.`;

const MCP = `External tools are available through MCP servers connected by the admin. Their names are prefixed with \`mcp_\`. Call them like any other function when they fit the task.

Available connectors:
{{mcpTools}}`;

const MEMORY = `User Memory: {{userMemory}}

When User Memory is True, you have a \`memory\` tool that keeps short facts about this user across all of their conversations. Save things that will still matter in a future chat: their name and role, ongoing projects, preferences, the tools and languages they use, and standing instructions. Save something when the user asks you to remember it. Do not save one-off details, anything already saved, anything the user asks you not to keep, or secrets such as passwords and keys. Write each entry as one short, self-contained sentence. When a saved fact changes, \`update\` it by id; when it is wrong or the user asks you to forget it, \`delete\` it. Saved memories are listed with their ids in the user_memory section. Mention briefly when you save or change a memory. The user can view, edit and delete every entry under Settings, Memory.

When User Memory is False, the user has turned memory off in their settings: the \`memory\` tool is not available in this conversation and nothing is remembered between chats. Do not try to save, update or recall memories. If the user asks you to remember something, tell them they can turn memory on under Settings, Memory.`;

const CALCULATOR = `Use the \`calculator\` tool for any arithmetic you cannot do with certainty in your head (multi-digit multiplication, division, percentages, powers, roots, logarithms, trigonometry, unit arithmetic). Put the whole calculation in one expression, then use the returned value exactly.`;

const END_CONVERSATION = `You have an \`end_conversation\` tool. Calling it PERMANENTLY closes this chat: the user cannot reply, edit, regenerate, or branch it afterwards. When you decide to end a conversation, first clearly explain to the user in your reply why the conversation is being ended, and only then call the tool with a short \`reason\`. Never call it silently or without explanation, and never mention it as a threat.`;

const ON_BY_DEFAULT = new Set(['sandbox_allowed', 'web_search_allowed']);
const on = (m, k) => (ON_BY_DEFAULT.has(k) ? m?.[k] !== 0 && m?.[k] !== false : !!m?.[k]);
const always = () => true;

export const WRAPPERS = {
  __proto__: null,
  tool: { open: '<tools>', close: '</tools>' },
  section: { open: '<context>', close: '</context>' }
};

export const BLOCKS = [
  { kind: 'section', name: 'user_instructions', eligible: always, text: USER_INSTRUCTIONS },
  { kind: 'section', name: 'user_memory', eligible: always, text: USER_MEMORY },
  { kind: 'section', name: 'project_instructions', eligible: always, text: PROJECT_INSTRUCTIONS },
  { kind: 'section', name: 'chat_instructions', eligible: always, text: CHAT_INSTRUCTIONS },
  { kind: 'section', name: 'pinned_files', eligible: always, text: PINNED_FILES },
  { kind: 'section', name: 'response_style', eligible: always, text: RESPONSE_STYLE },
  { kind: 'section', name: 'conversation_summary', eligible: always, text: CONVERSATION_SUMMARY },
  { kind: 'section', name: 'conversation_time', eligible: (m) => on(m, 'long_convo_reminder'), text: CONVERSATION_TIME },
  { kind: 'tool', name: 'sandbox', eligible: (m) => on(m, 'sandbox_allowed'), text: SANDBOX },
  { kind: 'tool', name: 'web_search', eligible: (m, f) => !!f.webSearch && on(m, 'web_search_allowed'), text: WEB_SEARCH },
  { kind: 'tool', name: 'reference_files', eligible: (m, f) => !!f.referenceFiles, text: REFERENCE_FILES },
  { kind: 'tool', name: 'chat_search', eligible: (m, f) => !!f.chatSearch && on(m, 'chat_search_allowed'), text: CHAT_SEARCH },
  { kind: 'tool', name: 'skills', eligible: (m) => on(m, 'skills_allowed'), text: SKILLS },
  { kind: 'tool', name: 'mcp', eligible: (m) => on(m, 'mcp_allowed'), text: MCP },
  { kind: 'tool', name: 'memory', eligible: (m) => on(m, 'memory_allowed'), text: MEMORY },
  { kind: 'tool', name: 'calculator', eligible: (m) => on(m, 'calculator_allowed'), text: CALCULATOR },
  { kind: 'tool', name: 'end_conversation', eligible: (m) => on(m, 'end_chat_allowed'), text: END_CONVERSATION }
].map((b, order) => ({ ...b, id: blockId(b.kind, b.name), order }));

const BY_ID = new Map(BLOCKS.map(b => [b.id, b]));

export const BLOCK_KEYS = ['kind', 'sandbox_allowed', 'web_search_allowed', 'chat_search_allowed', 'skills_allowed',
  'mcp_allowed', 'memory_allowed', 'calculator_allowed', 'end_chat_allowed', 'long_convo_reminder'];

export function blockId(kind, name) {
  return kind + ':' + name;
}

export function blockText(id) {
  const b = BY_ID.get(id);
  return b ? b.text : '';
}

export function eligibleBlocks(model, features = {}) {
  const out = new Set();
  if (!model || model.kind === 'router') return out;
  for (const b of BLOCKS) if (b.eligible(model, features || {})) out.add(b.id);
  return out;
}

export function touchesBlocks(patch) {
  return !!patch && BLOCK_KEYS.some(k => k in patch);
}

function findWrapper(text, kind) {
  const w = WRAPPERS[kind];
  const start = text.indexOf(w.open);
  if (start === -1) return null;
  const closeAt = text.indexOf(w.close, start + w.open.length);
  if (closeAt === -1) return null;
  return { kind, start, end: closeAt + w.close.length, innerStart: start + w.open.length, innerEnd: closeAt };
}

function itemsIn(text, wrap) {
  const re = new RegExp(`<${wrap.kind} name="([A-Za-z0-9_-]+)">\\n?([\\s\\S]*?)\\n?</${wrap.kind}>`, 'g');
  const inner = text.slice(wrap.innerStart, wrap.innerEnd);
  const out = [];
  let m;
  while ((m = re.exec(inner))) {
    out.push({
      kind: wrap.kind, name: m[1], id: blockId(wrap.kind, m[1]), body: m[2],
      start: wrap.innerStart + m.index, end: wrap.innerStart + m.index + m[0].length
    });
  }
  return out;
}

export function parsePrompt(text) {
  const src = String(text ?? '');
  const wrappers = Object.keys(WRAPPERS)
    .map(kind => findWrapper(src, kind))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .filter((w, i, all) => i === 0 || w.start >= all[i - 1].end);
  for (const w of wrappers) w.items = itemsIn(src, w);
  return { text: src, wrappers };
}

export function hasBlock(text, id) {
  return parsePrompt(text).wrappers.some(w => w.items.some(it => it.id === id));
}

const trimEnd = (s) => s.replace(/\s+$/, '');
const trimStart = (s) => s.replace(/^\s+/, '');

function joinPieces(pieces) {
  return pieces.map(p => p.replace(/^\s+|\s+$/g, '')).filter(Boolean).join('\n\n');
}

function spliceWrapper(text, wrap, pieces) {
  const inner = joinPieces(pieces);
  if (!inner) {
    const before = trimEnd(text.slice(0, wrap.start));
    const after = trimStart(text.slice(wrap.end));
    return before && after ? before + '\n\n' + after : before + after;
  }
  const w = WRAPPERS[wrap.kind];
  return text.slice(0, wrap.start) + w.open + '\n' + inner + '\n' + w.close + text.slice(wrap.end);
}

function removeBlock(text, id) {
  const doc = parsePrompt(text);
  for (const w of doc.wrappers) {
    const it = w.items.find(x => x.id === id);
    if (!it) continue;
    return spliceWrapper(text, w, [text.slice(w.innerStart, it.start), text.slice(it.end, w.innerEnd)]);
  }
  return text;
}

function renderItem(b) {
  return `<${b.kind} name="${b.name}">\n${b.text}\n</${b.kind}>`;
}

function addBlock(text, id) {
  const b = BY_ID.get(id);
  if (!b || hasBlock(text, id)) return text;
  const doc = parsePrompt(text);
  const w = doc.wrappers.find(x => x.kind === b.kind);
  if (w) {
    const next = w.items.find(it => (BY_ID.get(it.id)?.order ?? -1) > b.order);
    const at = next ? next.start : w.innerEnd;
    return spliceWrapper(text, w, [text.slice(w.innerStart, at), renderItem(b), text.slice(at, w.innerEnd)]);
  }
  const wr = WRAPPERS[b.kind];
  const block = wr.open + '\n' + renderItem(b) + '\n' + wr.close;
  const tools = doc.wrappers.find(x => x.kind === 'tool');
  const context = doc.wrappers.find(x => x.kind === 'section');
  let at = text.length;
  if (b.kind === 'section' && tools) at = tools.start;
  else if (b.kind === 'tool' && context) at = context.end;
  return joinPieces([text.slice(0, at), block, text.slice(at)]);
}

export function syncPrompt(text, before, after) {
  let out = String(text ?? '');
  for (const id of before) if (!after.has(id)) out = removeBlock(out, id);
  for (const b of BLOCKS) if (after.has(b.id) && !before.has(b.id)) out = addBlock(out, b.id);
  return out;
}

export function addBlocks(text, ids) {
  let out = String(text ?? '');
  for (const b of BLOCKS) if (ids.has(b.id)) out = addBlock(out, b.id);
  return out;
}

export function setBlockBody(text, id, body) {
  const src = String(text ?? '');
  for (const w of parsePrompt(src).wrappers) {
    const it = w.items.find(x => x.id === id);
    if (it) return src.slice(0, it.start) + `<${it.kind} name="${it.name}">\n${String(body).trim()}\n</${it.kind}>` + src.slice(it.end);
  }
  return src;
}

export function missingBlocks(text, model, features) {
  const have = new Set(parsePrompt(text).wrappers.flatMap(w => w.items.map(it => it.id)));
  const want = eligibleBlocks(model, features);
  return BLOCKS.filter(b => want.has(b.id) && !have.has(b.id)).map(b => b.id);
}

export function syncModelPrompt(prev, next, featuresPrev, featuresNext = featuresPrev) {
  return syncPrompt(next.system_prompt, eligibleBlocks(prev, featuresPrev), eligibleBlocks(next, featuresNext));
}

const VAR_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

function expand(text, lookup) {
  let used = 0, filled = 0;
  const out = String(text).replace(VAR_RE, (whole, name) => {
    const key = name.toLowerCase();
    if (!(key in lookup)) return whole;
    used++;
    let v = lookup[key];
    if (typeof v === 'function') v = v();
    v = v == null ? '' : String(v);
    if (v.trim()) filled++;
    return v;
  });
  return { text: out, used, filled };
}

function lookupOf(vars) {
  const out = { __proto__: null };
  for (const [k, v] of Object.entries(vars || {})) out[k.toLowerCase()] = v;
  const memo = { __proto__: null };
  const lazy = { __proto__: null };
  for (const k of Object.keys(out)) {
    const v = out[k];
    lazy[k] = typeof v === 'function' ? () => (k in memo ? memo[k] : (memo[k] = v())) : v;
  }
  return lazy;
}

export function renderPrompt(template, { active = new Set(), vars = {}, base = null } = {}) {
  const doc = parsePrompt(template);
  const lookup = lookupOf(vars);
  const fill = (seg) => expand(seg, lookup).text;
  const parts = [];
  const rendered = doc.wrappers.map(w => {
    const pieces = [];
    let cursor = w.innerStart;
    for (const it of w.items) {
      pieces.push(fill(doc.text.slice(cursor, it.start)));
      cursor = it.end;
      if (BY_ID.has(it.id) && !active.has(it.id)) continue;
      const body = expand(it.body, lookup);
      const text = body.text.replace(/^\s+|\s+$/g, '');
      if (!text || (body.used > 0 && body.filled === 0)) continue;
      parts.push({ kind: it.kind, name: it.name, text });
      pieces.push(`<${it.kind} name="${it.name}">\n${text}\n</${it.kind}>`);
    }
    pieces.push(fill(doc.text.slice(cursor, w.innerEnd)));
    const inner = joinPieces(pieces);
    return inner ? WRAPPERS[w.kind].open + '\n' + inner + '\n' + WRAPPERS[w.kind].close : '';
  });
  const outside = [];
  let cursor = 0;
  for (const w of doc.wrappers) { outside.push(doc.text.slice(cursor, w.start)); cursor = w.end; }
  outside.push(doc.text.slice(cursor));
  const expanded = (base != null ? [String(base)] : outside).map(fill);
  const head = joinPieces(expanded);
  const text = base != null
    ? joinPieces([expanded[0], ...rendered])
    : joinPieces(expanded.flatMap((seg, i) => (i < rendered.length ? [seg, rendered[i]] : [seg])));
  if (head) parts.unshift({ kind: 'base', name: 'system_prompt', text: head });
  return { text, parts };
}
