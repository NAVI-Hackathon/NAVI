import { TaskUnderstandingSchema } from '../../../../shared/serviceTasks.js';
import { mockUnderstanding } from './understanding.js';

// Demo-mode task splitting (POST /intelligence/tasks has no counterpart offline). The split rule is the
// backend demo provider's (apps/api/src/ai/demoProvider.js understandTasks); tasks.test.js checks they
// still agree. Each part is understood by the demo rules, never by the AI.
export const DEMO_TASKS_DISCLAIMER = '示範模式：依固定規則拆分需求，不是 AI 分析。';

export function splitDemoMessage(message) {
  // Keep conjunctions and negations; a vague follow-up may depend on the preceding medical context.
  const parts = message.split(/(?:[，,；;]\s*)?(?=也想|另外|順便|第二個|第三個|第四個)/u).map(part => part.trim()).filter(Boolean);
  const independent = parts.slice(1).every(part => /地址|受益人|要保人|住院|門診|理賠|申請書|信用卡|扣款|保單|借款|密碼|表單/.test(part));
  return parts.length > 4 || !independent ? [message.trim()] : parts;
}

/** The same shape as the server's TaskUnderstanding (validated), so the chat handles both alike. */
export function mockTasks(message) {
  return TaskUnderstandingSchema.parse({
    tasks: splitDemoMessage(message).map((input, i) => {
      const understanding = mockUnderstanding(input);
      return { id: `task-${i + 1}`, input, data: understanding.data, outcome: understanding.meta.outcome };
    }),
    nextStep: 'confirm_one_task', provider: 'demo', isMock: true, disclaimer: DEMO_TASKS_DISCLAIMER,
  });
}
