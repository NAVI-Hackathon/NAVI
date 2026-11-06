import { test, expect } from '@playwright/test';
import { judgeConversationFixtures as fixtures } from '../fixtures/judge-conversation.js';

// A5 (#36 contract): NAVI shows the backend's clarification as it is — the question and its options, never
// one written by the front end — and a refused promise as a safe answer, not an error. An option goes back
// through the Conversation API in the same conversation with a new request id. A failure the server marks
// not retryable offers no 重新分析. No confidence percentage is shown. Formal mode is stubbed at the network
// layer with B's fixtures (no backend, no Gemini); /demo runs the same shared rules locally.

async function persistentService(page, replies) {
  const sent = [];
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': 'live' }, body: JSON.stringify(body) });
    if (pathname === '/api/ai/status') return json({ mode: 'live', available: true, syntheticOnly: true, product: { enabled: true, persistence: true, conversation: true, retentionDays: 30 } });
    if (pathname === '/api/session') return json({ registrationAvailable: false, emailDeliveryConfigured: false, authRequired: false, authenticated: false, consentAccepted: true, retentionDays: 30 });
    if (pathname === '/api/history') return json({ journeys: [], conversations: [] });
    if (pathname === '/api/conversations/messages') { sent.push(route.request().postDataJSON()); return json(replies[Math.min(sent.length - 1, replies.length - 1)]); }
    return json({ success: false, error: { code: 'NOT_FOUND', message: '找不到此服務。', retryable: false } }, 404);
  });
  return sent;
}

const watchErrors = page => { const errors = []; page.on('pageerror', error => errors.push(error.message)); return errors; };
async function ask(page, text) {
  await page.locator('#story-input').fill(text);
  await page.locator('#story-input').press('Enter');
}
const lastNavi = page => page.getByRole('log').locator('.msg-navi').last();

for (const width of [390, 1280]) {
  test(`formal: the server's clarification, its options sent back in the same conversation — ${width}px`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const sent = await persistentService(page, [fixtures.clarification, fixtures.retrievalOnly]);
    await page.goto('/');
    await ask(page, '我不知道要辦什麼');
    const reply = lastNavi(page);
    await expect(reply).toContainText('先確認一下');
    await expect(reply).toContainText(fixtures.clarification.clarification.question);
    for (const option of fixtures.clarification.clarification.options) await expect(reply.getByRole('button', { name: option })).toBeVisible();
    await expect(reply.locator('.tone-error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /帶我去/ })).toHaveCount(0); // blocking: no navigation

    await reply.getByRole('button', { name: '保單資料變更' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].message).toBe('保單資料變更');
    expect(sent[1].conversationId).toBe(fixtures.clarification.conversationId);
    expect(sent[1].requestId).not.toBe(sent[0].requestId);
    await expect(page.getByRole('log').locator('.msg-user').last()).toHaveText('保單資料變更');
    expect(errors).toEqual([]);
  });
}

test('formal: a promise of payment is a safe refusal with the server\'s options, not an error', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = await persistentService(page, [fixtures.insuranceBoundary]);
  await page.goto('/');
  // The shared rules refuse this before any request: the same question and options as the server's fixture.
  await ask(page, '幫我保證一定可以理賠。');
  const reply = lastNavi(page);
  await expect(reply).toContainText('NAVI 不給投保建議，也不判斷能否理賠');
  await expect(reply).toContainText(fixtures.insuranceBoundary.clarification.question);
  for (const option of fixtures.insuranceBoundary.clarification.options) await expect(reply.getByRole('button', { name: option })).toBeVisible();
  await expect(reply.locator('.tone-error')).toHaveCount(0);
  expect(sent).toEqual([]);
  expect(errors).toEqual([]);
});

test('formal: retryable failures offer 重新分析; a spent quota does not, the demo is still offered', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = await persistentService(page, [fixtures.timeout, fixtures.quota]);
  await page.goto('/');
  await ask(page, '我要改通訊地址');
  await expect(lastNavi(page).getByRole('button', { name: '重新分析' })).toBeVisible();
  await ask(page, '我要改通訊地址');
  await expect.poll(() => sent.length).toBe(2);
  const quota = lastNavi(page);
  await expect(quota).toContainText('在官網資料中找到：');
  await expect(quota.getByRole('button', { name: '重新分析' })).toHaveCount(0);
  await expect(quota.getByRole('link', { name: '改用示範模式' })).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText(/AI_[A-Z_]+/);
  expect(errors).toEqual([]);
});

test('demo: the same shared rules ask first; a non-blocking question follows the sources; no confidence %', async ({ page }) => {
  const errors = watchErrors(page);
  const api = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.goto('/demo');

  await ask(page, '我不知道要辦什麼');
  await expect(lastNavi(page)).toContainText('先確認一下');
  await expect(lastNavi(page).getByRole('button', { name: '醫療理賠資料準備' })).toBeVisible();
  await lastNavi(page).getByRole('button', { name: '聯絡客服' }).click();
  await expect(lastNavi(page)).toContainText('真人客服');

  await ask(page, '我要改地址');
  await expect(page.getByRole('log').getByText('在官網資料中找到：').last()).toBeVisible();
  const asks = lastNavi(page);
  await expect(asks).toContainText('還需要確認一件事');
  await expect(asks).toContainText('通訊地址、戶籍地址，還是收費地址');
  await asks.getByRole('button', { name: '通訊地址' }).click();
  await expect(page.getByRole('log').locator('.msg-user').last()).toHaveText('通訊地址');
  await expect(lastNavi(page)).not.toContainText('還需要確認一件事'); // answered, not asked again

  await expect(page.getByRole('log')).not.toContainText(/信心|\d+\s*%/);
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});
