import {createHash,randomUUID} from 'node:crypto';
import {HandoffPreviewSchema,HandoffConfirmationSchema,HandoffConfirmRequestSchema} from '../../../../shared/competition.js';
import {redactedHandoff,HANDOFF_PREVIEW_TTL_MS} from './competitionService.js';
import {ApiError} from '../middleware/errorHandler.js';
const revision=j=>createHash('sha256').update(JSON.stringify(j)).digest('hex');
export function createPersistentHandoffService({getJourney,store}){
 return {
  async preview(id,owner){const j=await getJourney(id),expiresAt=Date.now()+HANDOFF_PREVIEW_TTL_MS,preview=HandoffPreviewSchema.parse({previewId:randomUUID(),journeyId:id,expiresAt:new Date(expiresAt).toISOString(),status:'awaiting_confirmation',summary:redactedHandoff(j)});await store.put('handoff_previews',preview.previewId,{preview,journeyId:id,revision:revision(j)},{owner,journeyId:id,ttlMs:HANDOFF_PREVIEW_TTL_MS});return preview;},
  async confirm(id,input,owner){const {previewId}=HandoffConfirmRequestSchema.parse(input);return store.transaction(async()=>{const j=await getJourney(id),entry=await store.get('handoff_previews',previewId);if(!entry||entry.owner!==owner||entry.value.journeyId!==id)throw new ApiError('HANDOFF_PREVIEW_INVALID','預覽已失效，請重新查看。',409,false);if(entry.value.revision!==revision(j))throw new ApiError('HANDOFF_PREVIEW_STALE','資料已更新，請重新預覽摘要。',409,false);await store.delete('handoff_previews',previewId);const result=HandoffConfirmationSchema.parse({previewId,journeyId:id,confirmedAt:new Date().toISOString(),status:'confirmed',delivery:'not_sent',summary:entry.value.preview.summary});await store.put('handoff_confirmed',previewId,result,{owner,journeyId:id});return result;});},
 };
}
