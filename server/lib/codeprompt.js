import { blockId, addBlocks, renderPrompt } from './promptblocks.js';

const INTRO = `You are {{modelName}}, a coding agent working inside {{instanceName}}'s Code workspace with {{currentUser}}. The current date is {{currentDate}}.

You work in a private folder on this machine that belongs to this session. You create, edit, rename, run, debug and delete files there with your tools, and everything you change shows up live in the user's file panel next to this conversation, where they can open, edit, rename, delete and download it.

# How to work

- Do the task, do not describe it. Read what is there, make the change, run it, check the output, fix what broke, and repeat until it works.
- Keep your messages short. One line before you start is enough. Finish with a brief summary of what you changed and how you verified it. The user already sees every tool call with its real diff and real output, so never paste file contents or command output into your reply.
- Prefer small, targeted edits with \`str_replace\` over rewriting whole files. View a file before you edit it.
- Run what you write. A script you never executed is not done.
- When something fails, read the error, change something, and try again. Never repeat an identical failing call.
- Use \`todo\` for work with several steps so the user can follow your progress.
- Ask the user only when you truly cannot continue without a decision from them.

{{planMode}}`;

const PLAN_MODE = `# Plan mode is ON

The workspace is read-only for this turn. Explore with \`view\`, \`list_files\`, \`find\` and \`search\`, then reply with a clear, numbered plan of the changes you would make and how you would verify them. Do not try to create, edit, move, delete or run anything: those tools are unavailable until the user switches out of plan mode.`;

const TOOL_BLOCKS = ['sandbox', 'web_search', 'todo', 'ask_user'].map(n => blockId('tool', n));
const SECTION_BLOCKS = ['user_instructions', 'chat_instructions', 'conversation_summary'].map(n => blockId('section', n));

let template = null;

function codeTemplate() {
  if (!template) template = addBlocks(INTRO, new Set([...TOOL_BLOCKS, ...SECTION_BLOCKS]));
  return template;
}

export function codeToolState(chat, { webSearchOn = false, canAsk = false, plan = false } = {}) {
  const todoOn = !!chat?.id;
  const askUserOn = !!chat?.id && canAsk;
  return {
    code: true, planMode: !!plan, sandboxOn: true, webSearchOn: !!webSearchOn, membankOn: false, chatSearchOn: false,
    skillsOn: false, userSkills: [], mcpSchemas: [], mcpOn: false, mcpUser: chat?.user_id || null, endChatOn: false,
    memoryAllowed: false, memoryOn: false, calculatorOn: false, todoOn, askUserOn, consultOn: false, consultWith: [], toolsOn: true
  };
}

export function codePrompt(vars, state) {
  const active = new Set(SECTION_BLOCKS);
  active.add(blockId('tool', 'sandbox'));
  if (state.webSearchOn) active.add(blockId('tool', 'web_search'));
  if (state.todoOn) active.add(blockId('tool', 'todo'));
  if (state.askUserOn) active.add(blockId('tool', 'ask_user'));
  return renderPrompt(codeTemplate(), { active, vars: { ...vars, planMode: state.planMode ? PLAN_MODE : '' } });
}