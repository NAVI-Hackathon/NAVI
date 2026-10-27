import { z } from 'zod';
import { IntentDataSchema, intentDisposition, MAX_MESSAGE_LENGTH } from '../../../../shared/intelligence.js';
import { TaskUnderstandingSchema } from '../../../../shared/serviceTasks.js';
import { normalizeGeminiIntent } from '../ai/schemas.js';
import { normalizeIntent } from '../schemas/intent.schema.js';
import { requestValidatedAI } from './providerRequest.js';
import { ApiError } from '../middleware/errorHandler.js';

export const ProviderTasksSchema = z.object({ tasks: z.array(z.object({ input: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH), data: IntentDataSchema }).strict()).min(1).max(4) }).strict();
export const tasksJsonSchema = z.toJSONSchema(ProviderTasksSchema);
export async function understandTasks(message, { provider, config, signal }) {
  if (!provider.understandTasks) throw new ApiError('AI_UNAVAILABLE', '目前無法分析多項需求，請一次描述一件想處理的事情。', 503, false);
  return requestValidatedAI(async combined => {
    const raw = ProviderTasksSchema.parse(await provider.understandTasks(message, combined));
    const seen = new Set();
    let uncovered = message;
    const tasks = raw.tasks.map(({ input, data }, index) => {
      // A task must cite a literal part of the input; the model cannot invent a new request.
      if (!message.includes(input) || seen.has(input)) throw new ApiError('AI_RESPONSE_INVALID', '需求拆解尚不完整，請一次描述一件事情。', 502, false);
      if (!uncovered.includes(input)) throw new ApiError('AI_RESPONSE_INVALID', '需求片段重疊，請一次描述一件事情。', 502, false);
      uncovered = uncovered.replace(input, '');
      seen.add(input);
      const normalized = normalizeIntent(normalizeGeminiIntent(data), input);
      // The provider must quote literal evidence; only the server supplies a missing grammatical subject.
      let displayInput = raw.tasks.length === 1 ? message : input.replace(/[。！？!?]+$/, '');
      if (index > 0 && /^(?:也想|順便)/.test(displayInput)) displayInput = `我${displayInput}`;
      else if (index > 0 && /也想[\s，,]*$/.test(message.slice(0, message.indexOf(input)))) displayInput = `我也想${displayInput}`;
      return { id: `task-${index + 1}`, input: displayInput, data: normalized, outcome: intentDisposition(normalized, config.confidenceThreshold) };
    });
    if (uncovered.replace(/(?:另外|以及|還要|然後|也想|也|和|\band\b|\balso\b)|[\s，。！？、；,.!?;]/gi, '')) throw new ApiError('AI_RESPONSE_INVALID', '部分需求尚未完整保留，請分步說明。', 502, false);
    return TaskUnderstandingSchema.parse({ tasks, nextStep: 'confirm_one_task', provider: provider.mode, isMock: provider.mode === 'demo', disclaimer: '請先確認要處理的項目；各項任務分開進行，不會自動建立旅程或判斷理賠資格。' });
  }, { config, signal });
}
