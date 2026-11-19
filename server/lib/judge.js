import { getSetting, setSetting } from '../db.js';
import { oneShotFull } from '../llm/index.js';
import { resolveModelOrDefault } from './models.js';
import { recordUsage, usageCost } from './budget.js';
import { judgeMessages, parseVerdict } from './grader.js';

const JUDGE_TOKENS = 4000;
const JUDGE_TIMEOUT_MS = 180000;
export const JUDGE_LABEL = 'Evaluation judge';

export function judgeSettings() {
  return { modelId: getSetting('eval_judge_model', '') || '' };
}

export function setJudgeModel(id) {
  setSetting('eval_judge_model', typeof id === 'string' ? id.slice(0, 64) : '');
  return judgeSettings();
}

export function judgeModel() {
  return resolveModelOrDefault(judgeSettings().modelId, true);
}

export async function judge(input, { model = judgeModel(), userId = null, signal = null } = {}) {
  if (!model) return { error: 'There is no model to act as the judge.' };
  const messages = judgeMessages(input);
  const limit = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(JUDGE_TIMEOUT_MS)]);
  let spent = { prompt: 0, completion: 0, total: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await oneShotFull(model, messages, { signal: limit, maxTokens: JUDGE_TOKENS });
    if (r.usage) {
      recordUsage(userId, model, r.usage, JUDGE_LABEL);
      spent = { prompt: spent.prompt + (r.usage.prompt || 0), completion: spent.completion + (r.usage.completion || 0), total: spent.total + (r.usage.total || 0) };
    }
    if (signal?.aborted) return { error: 'Stopped.' };
    if (limit.aborted) return { error: 'The judge model did not answer in time.', cost: usageCost(model, spent) };
    const verdict = parseVerdict(r.text);
    if (!verdict.error) return { ...verdict, judge: model.display_name || model.internal_name || '', cost: usageCost(model, spent) };
    if (attempt === 1) return { error: r.text ? verdict.error : 'The judge model did not answer.', cost: usageCost(model, spent) };
  }
}