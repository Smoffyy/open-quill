import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeToolState, codePrompt } from '../lib/codeprompt.js';
import { buildTools, SANDBOX_READONLY } from '../tools/index.js';

const vars = {
  modelName: 'Sonata', instanceName: 'open-quill', currentUser: 'Ada', currentDate: 'today',
  sandboxHost: 'host facts', sandboxWorkspace: 'workspace facts', todoList: '(no plan yet)',
  userInstructions: '', chatInstructions: '', conversationSummary: ''
};

test('a code session always has the workspace and never the chat-only tools', () => {
  const s = codeToolState({ id: 'c1', user_id: 'u1' }, { canAsk: true });
  assert.equal(s.code, true);
  assert.equal(s.sandboxOn, true);
  assert.equal(s.todoOn, true);
  assert.equal(s.askUserOn, true);
  for (const k of ['membankOn', 'chatSearchOn', 'skillsOn', 'mcpOn', 'memoryOn', 'calculatorOn', 'consultOn', 'endChatOn']) assert.equal(s[k], false, k);
  assert.equal(codeToolState({ id: 'c1' }).askUserOn, false, 'asking needs a live socket');
  assert.equal(codeToolState(null).todoOn, false, 'the plan belongs to a chat');
});

test('the code prompt carries the workspace block and drops empty sections', () => {
  const { text } = codePrompt(vars, codeToolState({ id: 'c1' }));
  assert.match(text, /^You are Sonata, a coding agent/);
  assert.match(text, /<tool name="sandbox">[\s\S]*host facts[\s\S]*workspace facts/);
  assert.match(text, /<tool name="todo">/);
  assert.doesNotMatch(text, /<tool name="ask_user">|<tool name="web_search">|<section name="user_instructions">|\{\{/);
  assert.doesNotMatch(text, /Plan mode is ON/);
});

test('plan mode says so in the prompt and only offers tools that read', () => {
  const state = codeToolState({ id: 'c1' }, { plan: true, webSearchOn: true });
  assert.equal(state.planMode, true);
  const { text } = codePrompt({ ...vars, userInstructions: 'Be brief.' }, state);
  assert.match(text, /Plan mode is ON/);
  assert.match(text, /<tool name="web_search">/);
  assert.match(text, /<section name="user_instructions">\nThe user has provided[\s\S]*Be brief\./);
  const names = buildTools({ sandboxOn: true, todoOn: true, readOnly: true }).map(s => s.function.name);
  assert.ok(names.includes('todo'));
  for (const n of names.filter(n => n !== 'todo')) assert.ok(SANDBOX_READONLY.has(n), n + ' can change files');
  assert.ok(buildTools({ sandboxOn: true }).some(s => s.function.name === 'create_file'));
});