import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { samplePdf } from './sampleDocuments.js';

export const HOSPITAL_STORY = '我上週在台中榮總住院五天，要怎麼申請理賠？';
export const hospitalConfig = { ...loadConfig({ AI_MODE: 'demo', ALLOW_PAID_AI: 'false' }), rateLimit: 1000 };
export async function startHospitalApi({ provider = createDemoProvider(), repository = new InMemoryJourneyRepository(), config = hospitalConfig } = {}) {
  const server = createApp(config, provider, repository).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, body, method = body === undefined ? 'GET' : 'POST') => fetch(base + path, { method, ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  return {
    baseUrl: base.slice(0, -4), request, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
    async create(body = { message: HOSPITAL_STORY }) { const response = await request('/journeys', body); assert.equal(response.status, 201); return response.json(); },
    upload(id, documentType, { bytes = samplePdf(documentType), mime = 'application/pdf', filename = 'NAVI-synthetic.pdf', duplicate = false } = {}) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), filename);
      if (duplicate) form.append('file', new Blob([bytes], { type: mime }), 'duplicate.pdf');
      if (documentType !== undefined) form.set('documentType', documentType);
      return request(`/journeys/${id}/documents`, form);
    },
  };
}
