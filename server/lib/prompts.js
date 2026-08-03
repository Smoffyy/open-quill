import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';
import * as sandbox from '../sandbox.js';
import { canonicalTool } from '../tools/aliases.js';
import { activePath } from './tree.js';
import { stripToolSyntax } from './history.js';
import { isTextLike, readUploadText } from './uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let SKILLS_CACHE = null;

function hostEnvSection() {
  const env = sandbox.hostEnvInfo();
  const L = [];
  L.push('## Host environment (READ THIS BEFORE EVERY bash CALL)');
  L.push(`- Operating system: **${env.osName}** (${env.arch}). Shell used by \`bash\`: \`${env.shellName}\`.`);
  if (env.interpreters.length) {
    L.push('- Programs installed on this host. These are the ONLY ones you may invoke:');
    for (const i of env.interpreters) L.push(`  - \`${i.name}\` — ${i.label}, ${i.version}${i.run ? ` (e.g. \`${i.run}\`)` : ''}`);
  } else {
    L.push('- **No language runtimes were detected on this host.** Do not assume `node`, `python`, `npm` or a compiler exist. Do everything with the file tools, and tell the user if a task genuinely needs a runtime that is missing.');
  }
  if (env.utils.length) L.push(`- Extra utilities on PATH, safe to call: ${env.utils.map(u => '`' + u + '`').join(', ')}.`);
  if (env.missingUtils.length) L.push(`- **NOT installed on this host.** Calling any of these fails, so never try, not even to check: ${env.missingUtils.map(u => '`' + u + '`').join(', ')}.`);
  if (env.pythonCmd && env.pythonCmd !== 'python3') L.push(`- The Python command here is \`${env.pythonCmd}\`. \`python3\` does NOT exist on this host.`);
  if (!env.pythonCmd) L.push('- Python is NOT installed here. Do not write `python`, `python3` or `pip` commands.');
  if (!env.runtimes.node) L.push('- Node.js is NOT installed here. Do not write `node` or `npm` commands.');
  if (!env.unix) {
    L.push('- This is **cmd.exe on Windows, not a Unix shell.** `find`, `sort` and `more` exist but are the Windows commands with different syntax, not the Unix ones.');
    L.push('- Unix FLAGS fail, even on commands that do exist: `mkdir -p`, `rm -rf`, `cp -r`, `ls -la`. Plain `mkdir a\\b` already creates parent folders.');
    L.push('- **In a `bash` command, cmd.exe\'s own builtins (`mkdir`, `del`, `copy`, `move`, `ren`, `rmdir`, `dir`, `type`) do NOT accept forward slashes as path separators — they read `/` as the start of a switch.** `mkdir src/main/java` fails with "The syntax of the command is incorrect." even though forward slashes work fine in `cd`, in every real interpreter, and in this app\'s own file tools. In `bash`, write these paths with backslashes: `mkdir src\\main\\java`. This is auto-corrected for you when it can be, but do not rely on that — write backslashes for these commands the first time. This does NOT apply to the `path` argument of `create_file`, `make_dir`, `view` and the other file tools, which always take forward slashes on every OS.');
    L.push('- cmd.exe mangles quotes and newlines in long one-liners. To run real logic, write a script file with `create_file` and then run that file, instead of a `-c "..."` one-liner.');
  } else {
    L.push('- Standard Unix utilities are available, but the file tools are still preferred for file work because their results are structured, versioned, and shown to the user.');
  }
  L.push('- Your shell working directory PERSISTS across `bash` calls: after `cd sub`, later commands run in `sub` until you `cd` elsewhere. The current directory is reported back with every result.');
  return L.join('\n');
}

const BOUNDARY_SECTION = [
  '## The workspace boundary is enforced',
  'You are confined to one folder. The harness checks this, so a violating call simply fails and wastes a turn. Get it right the first time.',
  '',
  '- **Every path is relative to the workspace root**: `src/app.py`, `data/in.csv`, `out.txt`.',
  '- Rejected in tool arguments AND in shell commands: `/etc/passwd`, `/usr/local/bin`, `C:\\Users\\...`, `\\\\server\\share`, `~/notes.txt`, `../../secret`.',
  '- There is no `/tmp`. Put scratch files inside the workspace, e.g. `tmp/scratch.txt`.',
  '- `cd` may only move into folders inside the workspace.',
  '- Host administration is blocked and cannot be worked around: `sudo`, `su`, `runas`, `shutdown`, `systemctl`, `service`, `reg`, `regedit`, `diskpart`, `format`, `mount`, `netsh`, `net`, `schtasks`, `crontab`, `taskkill`, `chown`, `icacls`, system package managers (`apt`, `apt-get`, `yum`, `dnf`, `pacman`, `brew`, `choco`, `winget`), `docker`, `kubectl`, `ssh`, `telnet`, `nc`.',
  '- Project-local installs are fine and encouraged: `npm install`, `pip install`, `cargo build` and the like, run inside the workspace.',
  '',
  'If a task genuinely needs something outside the workspace, say so plainly in your reply. Never retry a blocked call with a different spelling.'
].join('\n');

export function sandboxPromptFor(chatId) {
  if (SKILLS_CACHE === null) {
    try { SKILLS_CACHE = fs.readFileSync(path.join(__dirname, '..', 'skills', 'sandbox.md'), 'utf8'); }
    catch { SKILLS_CACHE = ''; }
  }
  let p = SKILLS_CACHE;
  p += '\n\n' + hostEnvSection();
  p += '\n\n' + BOUNDARY_SECTION;
  p += '\n\n## History markers are NOT a syntax\nEarlier tool activity may appear in this conversation as compact bracketed summaries like `[used bash: ...]` or `[used view: ...]`. The platform writes those AFTER a real tool call, purely to save space. Writing `[used view: file.txt]` yourself does NOTHING: no tool runs, nothing is read, and it looks broken to the user. The ONLY way to use a tool is a real tool call with JSON arguments. Never write `[used`, `[tool`, or any imitation tool-call text in a reply.';
  const { files, hidden } = sandbox.list(chatId, { withHidden: true });
  if (!files.length && !hidden) return p + '\n\n## Current workspace\nThe workspace is empty. Create what you need with `create_file`. There is nothing to read yet, so do not call `view` on files that do not exist.';
  const LIST_CAP = 200, INLINE_CAP = 12;
  p += '\n\n## Current workspace files\nThis is what is on disk RIGHT NOW, after every edit made so far. It is the truth: edit these, never an older version you remember. `vN` is the version number and increases on every change.\n';
  for (const f of files.slice(0, LIST_CAP)) p += `- ${f.path} (v${f.v}, ${f.size} bytes)\n`;
  if (files.length > LIST_CAP) p += `- … and ${files.length - LIST_CAP} more file(s). The list is truncated to protect context; use \`list_files\`, \`find\` or \`search\` to reach anything not shown here.\n`;
  if (hidden) p += `\n(${hidden} file(s) inside dependency or build folders (node_modules, .venv, target, dist, and similar) and anything matched by .gitignore are hidden from this listing to keep context clean. They still exist on disk and your commands use them normally; pass \`all: true\` to \`list_files\`/\`find\` to see them, or reference them by exact path.)\n`;
  p += '\n## Latest file contents (a sample; use `view` for anything not shown)\n';
  let budget = 40000, inlined = 0;
  for (const f of files) {
    if (inlined >= INLINE_CAP || budget <= 0) break;
    if (f.ext === 'zip' || !sandbox.isText(f.path)) continue;
    const txt = sandbox.readText(chatId, f.path) || '';
    if (txt.length > 8000 || txt.length > budget) {
      p += `\n### ${f.path} (v${f.v}), ${f.size} bytes, too large to inline; use the \`view\` tool to read it.\n`;
      continue;
    }
    p += `\n### ${f.path} (v${f.v})\n\`\`\`${f.ext || ''}\n${txt}\n\`\`\`\n`;
    budget -= txt.length; inlined++;
  }
  p += '\n---\nREMINDER: the workspace is ON and the files above are the current truth. Change existing files with `str_replace`, never by rewriting them from scratch. Use the file tools (`copy_file`, `move_file`, `make_dir`, `delete_file`, `find`, `search`, `bundle_zip`, `extract_zip`) for file work, with relative paths only. Keep calling tools until the task is genuinely finished: do not stop to ask permission, never paste whole files or fake terminal output into the chat, and when a tool fails read the error and change approach instead of repeating the same call. Never write imitation tool text like `[used bash: ...]`; make real tool calls.';
  return p;
}

const BASH_TOOLS = new Set(['bash', 'run', 'shell']);

export function cleanCall(call) {
  const o = { tool: canonicalTool(call.tool) };
  if (call.path != null) o.path = call.path;
  if (BASH_TOOLS.has(o.tool)) { o.cmd = call.cmd ?? call.command ?? ''; if (call.workdir ?? call.cwd) o.workdir = call.workdir ?? call.cwd; }
  if (call.new_path != null || call.to != null) o.new_path = call.new_path ?? call.to;
  if (call.query != null) o.query = call.query;
  if (call.pattern != null) o.pattern = call.pattern;
  if (call.name != null) o.name = call.name;
  if (call.dest != null) o.dest = call.dest;
  if (call.start != null) o.start = call.start;
  if (call.end != null) o.end = call.end;
  if (call.replace_all === true || call.replace_all === 'true') o.replace_all = true;
  if (call.regex === true || call.regex === 'true') o.regex = true;
  if (call.all === true || call.all === 'true') o.all = true;
  return o;
}

const BODY_TOOLS = new Set(['create_file', 'write_file', 'str_replace', 'edit_file', 'insert_lines']);

export function cutOffError(tool, cut, hitOutputLimit) {
  const name = canonicalTool(tool) || tool || 'the call';
  const parts = [
    `this call was cut off before it finished sending, so it was NOT run and nothing was changed. The "${cut.key}" argument was still open after ${cut.chars} characters.`
  ];
  if (hitOutputLimit) parts.push('The reply reached its maximum output length mid-call.');
  if (BODY_TOOLS.has(canonicalTool(tool))) {
    parts.push(`Do not resend the same call: it will be cut off in the same place. Write the file in pieces instead — create_file with roughly the first half, then insert_lines to append the rest, one call each.`);
  } else {
    parts.push(`Send ${name} again with shorter arguments.`);
  }
  return parts.join(' ');
}

export function resultPayload(rawCall, r) {
  const call = { ...rawCall, tool: canonicalTool(rawCall.tool) };
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  if (r.v != null) o.v = r.v;
  if (r.adds != null) o.adds = r.adds;
  if (r.dels != null) o.dels = r.dels;
  if (r.bytes != null) o.bytes = r.bytes;
  if (r.unchanged) o.unchanged = true;
  if (r.lines != null) o.lines = r.lines;
  if (r.count != null) o.count = r.count;
  if (r.replaced != null) o.replaced = r.replaced;
  if (r.cleared != null) o.cleared = r.cleared;
  if (r.hidden != null) o.hidden = r.hidden;
  if (r.deps != null) o.deps = r.deps;
  if (r.note) o.note = r.note;
  if (r.path != null) o.path = r.path;
  if (r.from != null) o.from = r.from;
  if (r.cwd) o.cwd = r.cwd;
  if (BASH_TOOLS.has(call.tool)) { o.output = (r.output || '').slice(0, 8000); o.exit = r.exit ?? null; }
  if ((call.tool === 'list_files' || call.tool === 'ls' || call.tool === 'tree') && Array.isArray(r.files)) o.files = r.files.slice(0, 100).map(f => ({ path: f.path, size: f.size }));
  if ((call.tool === 'find' || call.tool === 'glob') && Array.isArray(r.matches)) o.matches = r.matches.slice(0, 60);
  if (call.tool === 'extract_zip' && Array.isArray(r.files)) o.files = r.files.slice(0, 60);
  if ((call.tool === 'search' || call.tool === 'grep') && Array.isArray(r.matches)) o.matches = r.matches.slice(0, 40);
  return o;
}

export function formatToolResult(rawCall, r) {
  const call = { ...rawCall, tool: canonicalTool(rawCall.tool) };
  const head = `${call.tool}${call.path ? ' ' + call.path : ''}`;
  if (!r.ok) return `${head} → ERROR: ${r.error}` + (r.output ? `\n${r.output}` : '');
  switch (call.tool) {
    case 'bash': case 'run': case 'shell': return `$ ${call.cmd ?? call.command ?? ''}\n${r.output || '(no output)'}\n(exit ${r.exit ?? 0}${r.cwd ? `, cwd: ${r.cwd || '.'}` : ''})`;
    case 'create_file': case 'write_file': return (r.unchanged ? `${head} → unchanged (already v${r.v}, identical content, no write needed)` : `${head} → created (v${r.v}, ${r.bytes} bytes, +${r.adds ?? 0}/-${r.dels ?? 0})`) + (r.note ? `\nNOTE: ${r.note}` : '');
    case 'str_replace': case 'edit_file': return `${head} → edited (now v${r.v}, +${r.adds ?? 0}/-${r.dels ?? 0}${r.replaced > 1 ? `, ${r.replaced} occurrences` : ''})` + (r.note ? `\nNOTE: ${r.note}` : '');
    case 'insert_lines': return `${head} → inserted ${r.adds} line(s) (now v${r.v})`;
    case 'view': case 'read_file': case 'cat': return `${head} →\n${r.content}`;
    case 'list_files': case 'ls': case 'tree': return `${head} →\n${r.tree || '(empty)'}` + (r.hidden ? `\n(${r.hidden} item(s) in ignored dependency/build folders hidden; pass all:true to include them)` : '');
    case 'find': case 'glob': return `find "${call.pattern ?? call.query}" → ${r.count} file(s)` + (r.matches && r.matches.length ? '\n' + r.matches.map(m => m.path).join('\n') : '');
    case 'delete_file': case 'rm': return `${head} → deleted`;
    case 'clear_sandbox': case 'delete_all': case 'reset': return `clear_sandbox → removed ${r.cleared} item(s); the directory is now empty`;
    case 'rename_file': case 'move_file': case 'mv': return `${head} → moved to ${r.path}`;
    case 'copy_file': case 'cp': return `${head} → copied to ${r.path}${r.count > 1 ? ` (${r.count} files)` : ''}`;
    case 'make_dir': case 'mkdir': return `${head} → directory ready`;
    case 'search': case 'grep': return `search "${call.query ?? call.pattern}" → ${r.count} match(es)` + (r.matches && r.matches.length ? '\n' + r.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') : '');
    case 'extract_zip': case 'unzip': return `extract_zip ${call.path} → ${r.count} file(s)` + (r.note ? ` (${r.note})` : '') + (r.files && r.files.length ? ':\n' + r.files.join('\n') : '');
    case 'bundle_zip': case 'zip': return `bundle_zip ${r.path} → created (${r.count} files)`;
    default: return `${head} → ok`;
  }
}

export function runChatSearchTool(userId, currentChatId, call) {
  if (call.tool === 'chat_search') {
    const q = String(call.query || '').trim().toLowerCase();
    if (!q) return { ok: false, error: 'Empty query.' };
    const matches = [];
    const chats = db.chats.byUser(userId).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, 300);
    let scanned = 0;
    for (const c of chats) {
      if (c.id === currentChatId) continue;
      if (scanned > 30000) break;
      const title = c.title || 'Untitled';
      if (title.toLowerCase().includes(q)) matches.push({ chat_id: c.id, title, date: new Date(c.updated_at || 0).toISOString().slice(0, 10), text: '(title match)' });
      if (matches.length >= 25) break;
      for (const m of db.messages.byChat(c.id)) {
        scanned++;
        const content = String(m.content || '');
        const idx = content.toLowerCase().indexOf(q);
        if (idx === -1) continue;
        const from = Math.max(0, idx - 80);
        matches.push({ chat_id: c.id, title, date: new Date(c.updated_at || 0).toISOString().slice(0, 10), role: m.role, text: content.slice(from, idx + q.length + 120).replace(/\s+/g, ' ') });
        if (matches.length >= 25) break;
      }
      if (matches.length >= 25) break;
    }
    return { ok: true, query: call.query, count: matches.length, matches };
  }
  if (call.tool === 'chat_view') {
    const c = db.chats.byId(String(call.chat_id || ''));
    if (!c || c.user_id !== userId) return { ok: false, error: 'No such chat.' };
    const limit = Math.min(60, Math.max(1, parseInt(call.limit) || 20));
    const msgs = activePath(c.id).filter(m => m.role === 'user' || m.role === 'assistant').slice(-limit)
      .map(m => ({ role: m.role, content: stripToolSyntax(String(m.content || '')).slice(0, 2000) }));
    return { ok: true, chat_id: c.id, title: c.title || 'Untitled', count: msgs.length, messages: msgs };
  }
  return { ok: false, error: 'Unknown chat tool.' };
}

export function formatChatSearchResult(call, r) {
  if (!r.ok) return `${call.tool} \u2192 ERROR: ${r.error}`;
  if (call.tool === 'chat_search') {
    return `chat_search "${call.query}" \u2192 ${r.count} match(es)` + (r.matches.length ? '\n' + r.matches.map(m => `[${m.chat_id}] ${m.title} (${m.date})${m.role ? ' ' + m.role : ''}: ${m.text}`).join('\n') : '');
  }
  return `chat_view ${r.chat_id} \u2014 ${r.title} \u2192\n` + r.messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

export function chatSearchPayload(call, r) {
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  if (r.count != null) o.count = r.count;
  if (r.title) o.title = r.title;
  if (call.tool === 'chat_search' && Array.isArray(r.matches)) o.matches = r.matches.slice(0, 10).map(m => ({ chat_id: m.chat_id, title: m.title }));
  return o;
}

export function endChatPromptFor(model) {
  let p = '## Ending conversations\nYou have an `end_conversation` tool. Calling it PERMANENTLY closes this chat: the user cannot reply, edit, regenerate, or branch it afterwards. When you decide to end a conversation, first clearly explain to the user in your reply why the conversation is being ended, and only then call the tool with a short `reason`. Never call it silently or without explanation, and never mention it as a threat.';
  const extra = String(model.end_chat_prompt || '').trim();
  if (extra) p += '\n\nAdditional instructions from the administrator about when to end conversations:\n' + extra;
  return p;
}

export function fmtDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}${rm ? ` ${rm} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}${h % 24 ? ` ${h % 24} h` : ''}`;
}

export function longConvoReminderFor(chatId) {
  const msgs = activePath(chatId).filter(m => m.role === 'user' || m.role === 'assistant');
  if (!msgs.length) return '';
  const first = msgs[0].created_at || Date.now();
  const last = msgs[msgs.length - 1].created_at || Date.now();
  const nowTs = Date.now();
  const gap = nowTs - last;
  const fresh = gap < 3 * 60 * 60 * 1000;
  let p = '## Long conversation awareness\n';
  p += `This conversation started ${fmtDuration(nowTs - first)} ago (${new Date(first).toLocaleString()}). `;
  p += `It contains ${msgs.length} messages. The previous message was ${fmtDuration(gap)} ago (${new Date(last).toLocaleString()}). Current time: ${new Date(nowTs).toLocaleString()}.\n`;
  if (fresh && msgs.length >= 20) {
    p += 'This has been a long continuous session. If the moment is natural (a task just finished, a stopping point was reached), you may gently suggest the user take a short break, without being pushy or repeating the suggestion every message.';
  } else {
    p += 'Use these timestamps for temporal awareness. If the session becomes very long and continuous, you may gently suggest a short break at a natural stopping point \u2014 at most once in a while, never repeatedly.';
  }
  return p;
}

export const CHAT_SEARCH_PROMPT = "## Past conversations\nYou can search the user's other conversations in this app with `chat_search` (pass `query`) and read one with `chat_view` (pass `chat_id`). Use these when the user refers to something discussed in a previous chat instead of saying you have no memory of it.";

export function pinnedFilesPrompt(chat) {
  const pins = Array.isArray(chat?.pinned_files) ? chat.pinned_files : [];
  if (!pins.length) return '';
  const blocks = pins.map(a => (isTextLike(a)
    ? `--- Pinned file: ${a.name} ---\n${readUploadText(a.url)}`
    : `[Pinned file: ${a.name} (not readable as text)]`));
  return 'The user has pinned the following file(s) to this conversation. Keep their contents available as context for every turn:\n\n' + blocks.join('\n\n');
}
