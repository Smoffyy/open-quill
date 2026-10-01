import { db, getSetting, setSetting } from '../db.js';
import { draftGet } from './draft.js';
import {
  BLOCKS, blockId, blockText, eligibleBlocks, addBlocks, setBlockBody, syncModelPrompt, renderPrompt
} from './promptblocks.js';
import * as referenceFiles from './referencefiles.js';
import * as workspaceSkills from './workspaceskills.js';
import * as userskills from './userskills.js';
import * as mcp from './mcp.js';
import * as projectfiles from './projectfiles.js';
import { userMemoryOn, memoriesText } from './memory.js';
import { todosOf, todoText } from './todo.js';
import { consultTargets, consultTargetsText } from './consult.js';
import { sandboxHostText, sandboxWorkspaceText, conversationTiming, pinnedFilesText } from './prompts.js';
import { promptVars } from './convo.js';

const MIGRATION_KEY = 'prompt_blocks_version';
const MIGRATION_VERSION = 1;
const SECTION_IDS = BLOCKS.filter(b => b.kind === 'section' && b.name !== 'conversation_time').map(b => b.id);

export function promptFeatures(get = getSetting) {
  return {
    webSearch: get('web_search_enabled', '0') === '1',
    chatSearch: get('chat_search_enabled', '0') === '1',
    referenceFiles: get('membank_enabled', '0') === '1'
  };
}

export const draftFeatures = () => promptFeatures(draftGet);

export function syncedPrompt(cur, patch, features = draftFeatures()) {
  const next = { ...cur, ...patch };
  const text = syncModelPrompt(cur, next, features);
  return text === (next.system_prompt ?? '') ? null : text;
}

export function syncAllModels(before, after) {
  const changed = [];
  for (const m of db.models.all()) {
    const text = syncModelPrompt(m, m, before, after);
    if (text === (m.system_prompt ?? '')) continue;
    db.models.update(m.id, { system_prompt: text });
    changed.push(m.id);
  }
  return changed;
}

export function toolState(chat, model, { sandboxOn = false, webSearchOn = false, canAsk = false } = {}) {
  const userId = chat?.user_id || null;
  const membankOn = getSetting('membank_enabled', '0') === '1' && referenceFiles.count() > 0;
  const chatSearchOn = !!model.chat_search_allowed && getSetting('chat_search_enabled', '0') === '1';
  const userSkills = userId ? userskills.enabledFor(userId).map(s => ({ name: s.name, description: s.description, content: s.body })) : [];
  const skillsOn = !!model.skills_allowed && (workspaceSkills.getEnabled().length + userSkills.length) > 0;
  const mcpSchemas = model.mcp_allowed ? mcp.toolSchemas(userId) : [];
  const mcpOn = mcpSchemas.length > 0;
  const endChatOn = !!model.end_chat_allowed;
  const user = userId ? db.users.byId(userId) : null;
  const memoryAllowed = !!model.memory_allowed && !!userId;
  const memoryOn = memoryAllowed && userMemoryOn(user);
  const calculatorOn = !!model.calculator_allowed;
  const todoOn = !!model.todo_allowed && !!chat?.id;
  const askUserOn = !!model.ask_user_allowed && !!chat?.id && canAsk;
  const consultWith = model.consult_allowed ? consultTargets(model, !!user?.is_admin) : [];
  const consultOn = consultWith.length > 0;
  const toolsOn = sandboxOn || webSearchOn || membankOn || chatSearchOn || skillsOn || mcpOn || endChatOn || memoryOn
    || calculatorOn || todoOn || askUserOn || consultOn;
  return {
    sandboxOn, webSearchOn, membankOn, chatSearchOn, skillsOn, userSkills, mcpSchemas, mcpOn, mcpUser: userId,
    endChatOn, memoryAllowed, memoryOn, calculatorOn, todoOn, askUserOn, consultOn, consultWith, toolsOn
  };
}

function activeBlocks(model, state) {
  const on = [
    ['sandbox', state.sandboxOn], ['web_search', state.webSearchOn], ['reference_files', state.membankOn],
    ['chat_search', state.chatSearchOn], ['skills', state.skillsOn], ['mcp', state.mcpOn],
    ['memory', state.memoryAllowed], ['calculator', state.calculatorOn], ['todo', state.todoOn],
    ['ask_user', state.askUserOn], ['consult_model', state.consultOn], ['end_conversation', state.endChatOn]
  ];
  const out = new Set(SECTION_IDS);
  if (model.long_convo_reminder) out.add(blockId('section', 'conversation_time'));
  for (const [name, yes] of on) if (yes) out.add(blockId('tool', name));
  return out;
}

export function systemPrompt(chat, model, state, { userId = null, styleText = '', callMode = false } = {}) {
  const row = chat ? (db.chats.byId(chat.id) || chat) : null;
  const uid = row?.user_id || userId;
  const u = row?.user_id ? db.users.byId(row.user_id) : null;
  const project = row?.project_id ? db.projects.byId(row.project_id) : null;
  const vars = {
    ...promptVars(uid),
    userInstructions: u?.instructions || '',
    memories: () => memoriesText(u),
    userMemory: state.memoryOn ? 'True' : 'False',
    projectInstructions: project?.instructions || '',
    chatInstructions: row?.instructions || '',
    pinnedFiles: () => pinnedFilesText(row),
    responseStyle: styleText,
    conversationSummary: row?.summary || '',
    conversationTiming: () => (row ? conversationTiming(row.id) : ''),
    sandboxHost: () => sandboxHostText(),
    sandboxWorkspace: () => (row ? sandboxWorkspaceText(projectfiles.workspaceFor(row), String(project?.name || '')) : ''),
    referenceFiles: () => referenceFiles.filesText(),
    skills: () => workspaceSkills.skillsText(state.userSkills),
    mcpTools: () => mcp.toolsText(state.mcpUser),
    todoList: () => todoText(row ? todosOf(row.id) : []),
    consultModels: () => consultTargetsText(model, state.consultWith || [])
  };
  const override = callMode && (model.call_prompt || '').trim() ? model.call_prompt
    : (row?.system_override || '').trim() ? row.system_override : null;
  return renderPrompt(model.system_prompt || '', { active: activeBlocks(model, state), vars, base: override });
}

function legacyBody(id, custom, keep) {
  const rest = blockText(id).split('\n\n').slice(keep).join('\n\n');
  return custom.trim() + (rest ? '\n\n' + rest : '');
}

function upgradeModel(m, features, legacy) {
  let text = addBlocks(m.system_prompt || '', eligibleBlocks(m, features));
  if (legacy.web) text = setBlockBody(text, blockId('tool', 'web_search'), legacyBody(blockId('tool', 'web_search'), legacy.web, 2));
  if (legacy.files) text = setBlockBody(text, blockId('tool', 'reference_files'), legacyBody(blockId('tool', 'reference_files'), legacy.files, 1));
  const endNote = String(m.end_chat_prompt || '').trim();
  if (endNote) {
    const id = blockId('tool', 'end_conversation');
    text = setBlockBody(text, id, blockText(id) + '\n\nAdditional instructions from the administrator about when to end conversations:\n' + endNote);
  }
  return text === (m.system_prompt || '') ? m : { ...m, system_prompt: text };
}

export function migratePromptBlocks() {
  if (Number(getSetting(MIGRATION_KEY, 0)) >= MIGRATION_VERSION) return 0;
  const legacy = {
    web: String(getSetting('web_search_prompt', '') || '').trim(),
    files: String(getSetting('membank_prompt', '') || '').trim()
  };
  const published = getSetting('published_models', null);
  if (Array.isArray(published)) {
    const live = promptFeatures(getSetting);
    setSetting('published_models', published.map(m => upgradeModel(m, live, legacy)));
  }
  const draft = draftFeatures();
  let changed = 0;
  for (const m of db.models.all()) {
    const next = upgradeModel(m, draft, legacy);
    if (next === m) continue;
    db.models.update(m.id, { system_prompt: next.system_prompt });
    changed++;
  }
  setSetting(MIGRATION_KEY, MIGRATION_VERSION);
  return changed;
}
