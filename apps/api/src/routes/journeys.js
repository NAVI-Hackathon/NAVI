import express from 'express';
import { z } from 'zod';
import { CreateJourneyRequestSchema, ReviewRequestSchema, MAX_DOCUMENT_BYTES } from '../../../../shared/journey.js';
import { RequestSchema } from '../schemas/intent.schema.js';
import { understandIntent } from '../services/intent.service.js';
import { createJourneyService } from '../services/journeyService.js';
import { parseUpload } from '../services/documentService.js';
import { retrieveKnowledge, searchPublicKnowledge } from '../services/knowledgeService.js';
import { answerKnowledge } from '../services/knowledgeAnswerService.js';
import { enhanceHandoff } from '../services/handoffService.js';
import { ApiError } from '../middleware/errorHandler.js';

function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError('INVALID_INPUT', '請提供正確且完整的資料。', 400, false);
  return result.data;
}
function requestSignal(res) {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  return controller.signal;
}
export function createJourneyRouter({ config, provider, repository }) {
  const router = express.Router();
  const service = createJourneyService({ config, provider, repository });
  router.post('/analyze-intent', async (req, res) => {
    const { message } = validate(RequestSchema, req.body);
    const result = await understandIntent(message, { config, provider, signal: requestSignal(res) });
    res.json(result.data);
  });
  router.post('/journeys', async (req, res) => {
    res.status(201).json(await service.create(validate(CreateJourneyRequestSchema, req.body), requestSignal(res)));
  });
  router.get('/journeys/:id', (req, res) => res.json(service.get(req.params.id)));
  router.post('/journeys/:id/documents', express.raw({ type: 'multipart/form-data', limit: MAX_DOCUMENT_BYTES + 64 * 1024, inflate: false }), async (req, res) => {
    service.get(req.params.id);
    res.json(await service.addDocument(req.params.id, await parseUpload(req), requestSignal(res)));
  });
  router.delete('/journeys/:id/documents/:documentId', (req, res) => res.json(service.removeDocument(req.params.id, req.params.documentId)));
  router.post('/journeys/:id/review', (req, res) => {
    validate(ReviewRequestSchema, req.body);
    res.json(service.review(req.params.id));
  });
  router.get('/journeys/:id/handoff-summary', async (req, res) => {
    const summary = service.handoffSummary(req.params.id);
    res.json(req.query.enhance === 'true' ? await enhanceHandoff(summary, { provider, config, signal: requestSignal(res) }) : summary);
  });
  router.post('/knowledge/answer', async (req, res) => {
    const { question } = validate(z.object({ question: z.string().trim().min(1).max(500) }).strict(), req.body);
    res.json(await answerKnowledge(question, { provider, config, signal: requestSignal(res) }));
  });
  router.get('/knowledge', (req, res) => res.json(retrieveKnowledge(validate(z.string().trim().min(1).max(500), req.query.query))));
  router.get('/knowledge/search', (req, res) => res.json(searchPublicKnowledge(validate(z.string().trim().min(1).max(500), req.query.query))));
  return router;
}
