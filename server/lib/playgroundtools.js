import { buildTools, toCall } from '../tools/index.js';
import { toolState } from './systemprompt.js';
import * as websearch from './websearch.js';
import * as referenceFiles from './referencefiles.js';
import * as workspaceSkills from './workspaceskills.js';
import * as mcp from './mcp.js';
import { runCalculator, formatCalculatorResult } from './calculator.js';
import { runConsult, formatConsult } from './consult.js';
import { runChatSearchTool, formatChatSearchResult, chatSearchPayload } from './prompts.js';

export const PREVIEW_CHARS = 1200;

// The tools a playground run may use: everything that needs no chat and leaves nothing
// behind in one. The sandbox, memory, to-do list, questions to the member and ending
// the conversation all act on a chat, so they stay off here.
export function playgroundState(model, userId) {
  const webSearchOn = websearch.webSearchAvailable() && model.web_search_allowed !== 0;
  const s = toolState({ user_id: userId }, model, { sandboxOn: false, webSearchOn, canAsk: false });
  const state = { ...s, memoryAllowed: false, memoryOn: false, todoOn: false, askUserOn: false, endChatOn: false };
  state.toolsOn = state.webSearchOn || state.membankOn || state.chatSearchOn || state.skillsOn || state.mcpOn || state.calculatorOn || state.consultOn;
  return state;
}

export function playgroundTools(state) {
  if (!state.toolsOn) return [];
  return buildTools({
    sandboxOn: false, webSearchOn: state.webSearchOn, membankOn: state.membankOn, chatSearchOn: state.chatSearchOn,
    skillsOn: state.skillsOn, mcpSchemas: state.mcpSchemas, endChatOn: false, memoryOn: false, calculatorOn: state.calculatorOn,
    todoOn: false, askUserOn: false, consultNames: state.consultOn ? state.consultWith.map(t => t.display_name || t.internal_name) : []
  });
}

export async function runPlaygroundTool(call, { model, state, userId, signal }) {
  const tool = call.tool;
  if (tool === 'calculator' && state.calculatorOn) {
    const r = runCalculator(call);
    return { ok: !!r.ok, formatted: formatCalculatorResult(r) };
  }
  if (tool === 'web_search' && state.webSearchOn) {
    const r = await websearch.runWebSearch(call);
    return { ok: websearch.webSearchResultPayload(call, r).ok !== false, formatted: websearch.formatWebSearchResult(call, r) };
  }
  if ((tool === 'mb_view' || tool === 'mb_search') && state.membankOn) {
    const r = referenceFiles.execTool(call);
    return { ok: referenceFiles.resultPayload(call, r).ok !== false, formatted: referenceFiles.formatResult(call, r) };
  }
  if (tool === 'skill_view' && state.skillsOn) {
    const r = workspaceSkills.execTool(call, state.userSkills);
    return { ok: workspaceSkills.resultPayload(call, r).ok !== false, formatted: workspaceSkills.formatResult(call, r) };
  }
  if ((tool === 'chat_search' || tool === 'chat_view') && state.chatSearchOn) {
    const r = runChatSearchTool(userId, null, call);
    return { ok: chatSearchPayload(call, r).ok !== false, formatted: formatChatSearchResult(call, r) };
  }
  if (tool === 'consult_model' && state.consultOn) {
    const r = await runConsult({ model, targets: state.consultWith, call, chatId: null, userId, signal });
    return { ok: !!r.ok, formatted: formatConsult(r) };
  }
  if (state.mcpOn && mcp.isMcpTool(tool, userId)) {
    const r = await mcp.execTool(call, userId);
    return { ok: !!r.ok, formatted: mcp.formatResult(call, r), images: r.images || [] };
  }
  return { ok: false, formatted: `${tool} → ERROR: there is no tool called "${tool}" here.` };
}

export function parseCall(c) {
  return toCall(c.name, c.argsText || '{}');
}
