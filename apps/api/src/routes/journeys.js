import { createPersistentHandoffService } from '../services/persistentHandoffService.js';
import { validateMedia } from '../services/mediaValidationService.js';
import express from 'express';
import { understandTasks } from '../services/taskService.js';
import { CorrectJourneyIntentRequestSchema, CorrectJourneyIntentResponseSchema } from '../../../../shared/serviceTasks.js';
import { getKnowledgeVersion } from '../services/knowledgeVersionService.js';
import { NavigationPlanRequestSchema, HandoffConfirmRequestSchema } from '../../../../shared/competition.js';
import { createNavigationService } from '../services/navigationService.js';
import { searchVerifiedKnowledge } from '../../../../shared/knowledge/evidence.js';
import { explainJourney, createHandoffConfirmationService } from '../services/competitionService.js';
import { z } from 'zod';
import { CreateJourneyRequestSchema, ReviewRequestSchema, ManualDocumentInformationRequestSchema, MAX_DOCUMENT_BYTES } from '../../../../shared/journey.js';
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
export function createJourneyRouter({ config, provider, repository, sessions, service: suppliedService }) {
  const router = express.Router();
  const service = suppliedService ?? createJourneyService({ config, provider, repository });
  const navigation = createNavigationService(config);
  const handoff = config.store ? createPersistentHandoffService({getJourney:service.get,store:config.store}) : createHandoffConfirmationService({getJourney:id=>repository.get(id)});
  router.post('/navigation/plans', (req, res) => res.json(navigation(validate(NavigationPlanRequestSchema, req.body))));
  router.get('/knowledge/version', (req, res) => res.json(getKnowledgeVersion({ allowSynthetic: !config.production })));
  router.get('/knowledge/versioned-evidence', (req, res) => res.json({ knowledgeVersion: getKnowledgeVersion({ allowSynthetic: !config.production }).knowledgeVersion, evidence: searchVerifiedKnowledge(validate(z.string().trim().min(1).max(500), req.query.query)) }));
  router.get('/knowledge/evidence', (req, res) => res.json(searchVerifiedKnowledge(validate(z.string().trim().min(1).max(500), req.query.query))));
  router.get('/journeys/:id/explanation', async (req, res) => res.json(explainJourney(await service.get(req.params.id))));
  router.post('/journeys/:id/handoff/preview', async (req, res) => {
    validate(z.object({}).strict(), req.body);
    res.status(201).json(await handoff.preview(req.params.id,await sessions.owner?.(req)));
  });
  router.post('/journeys/:id/handoff/confirm', async (req, res) => res.json(await handoff.confirm(req.params.id,validate(HandoffConfirmRequestSchema,req.body),await sessions.owner?.(req))));
  router.post('/intelligence/tasks', async (req, res) => {
    const { message } = validate(RequestSchema, req.body);
    let result = await understandTasks(message, { config, provider, signal: requestSignal(res) });
    if(config.tasks)result=await config.tasks.save(req,result);
    for (const task of result.tasks) await sessions?.remember(req, task.input, task.data, task.id);
    res.json(result);
  });
  router.post('/journeys/:id/intent-correction', async (req, res) => {
    const { message } = validate(CorrectJourneyIntentRequestSchema, req.body);
    res.json(CorrectJourneyIntentResponseSchema.parse(await service.correctIntent(req.params.id, message, requestSignal(res))));
  });
  router.post('/analyze-intent', async (req, res) => {
    const { message } = validate(RequestSchema, req.body);
    const result = await understandIntent(message, { config, provider, signal: requestSignal(res) });
    await sessions?.remember(req, message, result.data);
    res.json(result.data);
  });
  router.post('/journeys', async (req, res) => {
    const input = validate(CreateJourneyRequestSchema, req.body);
    const signal = requestSignal(res);
    const journey = await sessions.createJourney(req, input, (trusted, id) => service.create(input, signal, trusted, id));
    await sessions?.own(req, journey.id);
    res.status(201).json(journey);
  });
  router.post('/journeys/:id/manual-document-information', async (req, res) => {
    res.json(await service.addManualDocumentInformation(req.params.id, validate(ManualDocumentInformationRequestSchema, req.body)));
  });
  router.delete('/journeys/:id/manual-document-information/:documentType', async (req, res) => {
    res.json(await service.removeManualDocumentInformation(req.params.id, validate(z.enum(['diagnosis_certificate', 'bank_passbook']), req.params.documentType)));
  });
  router.get('/journeys/:id', async (req, res) => res.json(await service.get(req.params.id)));
  let activeUploads=0;
  const uploadCapacity=(req,res,next)=>{if(!config.productMode)return next();if(activeUploads>=2)return next(new ApiError('AI_BUSY','目前有文件正在處理，請稍後再上傳；尚未送交 AI。',429,true));activeUploads++;let released=false;const release=()=>{if(!released){released=true;activeUploads--;}};res.once('finish',release);res.once('close',release);next();};
  router.post('/journeys/:id/documents', uploadCapacity, express.raw({ type: 'multipart/form-data', limit: MAX_DOCUMENT_BYTES + 64 * 1024, inflate: false }), async (req, res) => {
    await service.get(req.params.id);
    let upload;
    try {
      upload = await parseUpload(req);
      await sessions?.authorizeDocument(req);
      await validateMedia(upload, config, requestSignal(res));
      res.json(await service.addDocument(req.params.id, upload, requestSignal(res)));
    } finally { upload?.bytes.fill(0); if (Buffer.isBuffer(req.body)) req.body.fill(0); }
  });
  router.delete('/journeys/:id/documents/:documentId', async (req, res) => res.json(await service.removeDocument(req.params.id, req.params.documentId)));
  router.post('/journeys/:id/review', async (req, res) => {
    validate(ReviewRequestSchema, req.body);
    res.json(await service.review(req.params.id));
  });
  router.get('/journeys/:id/handoff-summary', async (req, res) => {
    const summary = await service.handoffSummary(req.params.id);
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
