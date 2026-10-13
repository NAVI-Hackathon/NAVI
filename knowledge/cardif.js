// Compatibility exports for Backend/Legacy callers; the snapshot index lives in shared only.
export {
  knowledgeEntries as cardifRecords, getKnowledgeEntry as getCardifRecord,
  knowledgeSource as cardifSource, retrieveKnowledgeContext as retrieveCardifContext,
} from '../shared/knowledge/index.js';
export { isDecisionQuestion } from '../shared/knowledge/vocabulary.js';
