import test from 'node:test';
import assert from 'node:assert/strict';
import { understandTasks } from '../src/services/taskService.js';
import { loadConfig } from '../src/config/env.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
const demo = createDemoProvider();

for (const [message, inputs] of [
  ['我想改地址，也想知道要怎麼申請住院理賠。', ['我想改地址', '我也想知道要怎麼申請住院理賠']],
  ['我想改地址，也想知道住院怎麼理賠。', ['我想改地址', '我也想知道住院怎麼理賠']],
  ['我要變更地址，順便下載申請書。', ['我要變更地址', '我順便下載申請書']],
  ['我昨天只是門診，沒有住院，也想問文件。', ['我昨天只是門診，沒有住院，也想問文件。']],
  ['我想改地址，但不想變更要保人。', ['我想改地址，但不想變更要保人。']],
  ['我有兩件事，第一個改地址，第二個查理賠。', ['我有兩件事，第一個改地址', '第二個查理賠']],
]) test(`Demo task wording preserves evidence and negation: ${message}`, async () => {
  const response = await understandTasks(message, { config: { ...loadConfig({ AI_MODE: 'demo' }), aiMaxAttempts: 1 }, provider: demo });
  assert.equal(response.isMock, true); assert.deepEqual(response.tasks.map(task => task.input), inputs);
  if (message.includes('沒有住院')) assert.ok(response.tasks.every(task => task.data.serviceType !== 'hospitalization_claim'));
});

