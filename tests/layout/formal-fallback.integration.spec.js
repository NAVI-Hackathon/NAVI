import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ConversationReplySchema } from '../../shared/product.js';

// NAVI-001: formal mode must never go blank when the server answers from official sources only
// (retrieval), including after an AI failure. The persistent service is stubbed at the network layer with
// the shared fixture (tests/fixtures/conversation-replies.json, valid ConversationReplySchema replies), so
// no request reaches a backend or Gemini.
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/conversation-replies.json', import.meta.url), 'utf8'));
const ASK = '我搬家了，保單地址要怎麼改？';

async function persistentService(page, reply) {
  const sent = [];
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': 'live' }, body: JSON.stringify(body) });
    if (pathname === '/api/ai/status') return json({ mode: 'live', available: true, syntheticOnly: true, product: { enabled: true, persistence: true, conversation: true, retentionDays: 30 } });
    if (pathname === '/api/session') return json({ registrationAvailable: false, emailDeliveryConfigured: false, authRequired: false, authenticated: false, consentAccepted: true, retentionDays: 30 });
    if (pathname === '/api/history') return json({ journeys: [], conversations: [] });
    if (pathname === '/api/conversations/messages') { sent.push(route.request().postDataJSON().message); return json(reply()); }
    return json({ success: false, error: { code: 'NOT_FOUND', message: '找不到此服務。', retryable: false } }, 404);
  });
  return sent;
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function ask(page, text = ASK) {
  await page.locator('#story-input').fill(text);
  await page.locator('#story-input').press('Enter');
}

/** After any reply: the page is there, the input still works, and nothing was thrown. */
async function stillUsable(page, errors) {
  await expect(page.locator('#story-input')).toBeEnabled();
  await page.locator('#story-input').fill('還有其他問題');
  await expect(page.locator('#story-input')).toHaveValue('還有其他問題');
  expect(errors).toEqual([]);
}

test('the shared fixture is a valid ConversationReplySchema reply in every case', () => {
  for (const [name, reply] of Object.entries(fixtures)) if (!name.startsWith('_')) ConversationReplySchema.parse(reply);
});

for (const width of [390, 1280]) test(`E13: a retrieval-only reply shows its official source, no blank page — ${width}px`, async ({ page }) => {
  const errors = watchErrors(page);
  const sent = await persistentService(page, () => fixtures.retrieval_answered);
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/');
  await ask(page);
  const log = page.getByRole('log');
  await expect(log.getByText('在官網資料中找到：')).toBeVisible();
  await expect(log.locator('.answer-card').last()).toBeVisible();
  await expect(log.getByText(/AI .*無法/)).toHaveCount(0); // a clean retrieval reply is not called a failure
  expect(sent).toEqual([ASK]);
  await stillUsable(page, errors);
});

for (const [name, title] of [['provider_error', '分析服務暫時無法回應'], ['quota', '今日 AI 分析次數已用完']]) {
  test(`AI failure (${name}): the sources stay readable, the reason is named, retry is by hand`, async ({ page }) => {
    const errors = watchErrors(page);
    let next = fixtures[name];
    const sent = await persistentService(page, () => next);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await ask(page);
    const log = page.getByRole('log');
    await expect(log.getByRole('note').filter({ hasText: `${title}，以下是已核對來源的官網資料。` })).toBeVisible();
    await expect(log.locator('.answer-card').last()).toBeVisible();
    await page.waitForTimeout(800);
    expect(sent).toHaveLength(1); // never re-sent on its own
    next = fixtures.retrieval_answered;
    await log.getByRole('button', { name: '重新分析' }).click();
    await expect.poll(() => sent.length).toBe(2);
    await expect(log.getByText('在官網資料中找到：').last()).toBeVisible();
    await stillUsable(page, errors);
  });
}

test('AI timeout with no matching source: a readable note and a manual retry, not a demo answer', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = await persistentService(page, () => fixtures.timeout);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ask(page);
  const log = page.getByRole('log');
  await expect(log.getByText('分析時間較長')).toBeVisible();
  await expect(log.getByRole('button', { name: '重新分析' })).toBeVisible();
  await expect(log.getByText('在官網資料中找到：')).toHaveCount(0); // no stand-in answer
  await expect(log.getByRole('link', { name: '改用示範模式' })).toBeVisible(); // demo only if the user picks it
  expect(sent).toHaveLength(1);
  await stillUsable(page, errors);
});

test('a reply citing a source this snapshot does not know is refused as incomplete, no crash', async ({ page }) => {
  const errors = watchErrors(page);
  const unknown = structuredClone(fixtures.retrieval_answered);
  unknown.evidence.results[0].source.id = 'entry-not-in-this-snapshot';
  await persistentService(page, () => unknown);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ask(page);
  await expect(page.getByRole('log').getByRole('note').filter({ hasText: '分析結果尚不完整' })).toBeVisible();
  await expect(page.getByRole('log').getByRole('button', { name: '重新分析' })).toBeVisible();
  await stillUsable(page, errors);
});
