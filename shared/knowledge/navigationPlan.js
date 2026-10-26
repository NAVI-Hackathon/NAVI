import { NavigationPlanSchema, NavigationPlanResponseSchema } from '../competition.js';
import { getKnowledgeEntry, searchKnowledge, verifyNavigationDestination } from './index.js';
import { verifiedEvidence } from './evidence.js';

const instructions = { VIEW_INFORMATION: '查看來源說明', VIEW_FORM: '查看相關表單', OPEN_SERVICE: '前往服務說明與入口' };
const disclaimer = '本計畫只提供頁面導覽，入口可導航不代表符合申請條件；不會登入、填表、送件或判斷理賠資格。';
export function buildNavigationPlan(sourceId, options) {
  const root = getKnowledgeEntry(sourceId);
  if (!root) return null;
  // Relationships come from the snapshot, not a model or caller-provided URL.
  const related = root.relatedIds.map(getKnowledgeEntry).filter(Boolean);
  // Form reverse-links and FAQ page neighbours describe other services, not additional user actions.
  const forward = root.type === 'service' ? related.filter(entry => entry.type === 'form') : root.type === 'claim_documents' ? related : [];
  const seen = new Set();
  const selected = [root, ...forward].filter(entry => {
    const key = `${entry.destination.path}#${entry.destination.anchor ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 4);
  const steps = selected.map((entry, index) => {
    const evidence = verifiedEvidence(entry.id, options);
    if (!evidence || !verifyNavigationDestination(entry.destination, entry.id)) return null;
    const action = entry.type === 'form' ? 'VIEW_FORM' : entry.type === 'service' && index > 0 ? 'OPEN_SERVICE' : 'VIEW_INFORMATION';
    return { id: `step-${index + 1}`, order: index + 1, sourceId: entry.id, action, instruction: instructions[action], source: evidence.source, destination: entry.destination, evidence: evidence.excerpts };
  });
  if (steps.some(step => !step)) return null;
  return NavigationPlanSchema.parse({ version: 1, rootSourceId: root.id, steps, execution: 'user_guided', disclaimer });
}
export function verifyNavigationPlan(value, options) {
  const parsed = NavigationPlanSchema.safeParse(value);
  if (!parsed.success) return false;
  const canonical = buildNavigationPlan(parsed.data.rootSourceId, options);
  return Boolean(canonical && JSON.stringify(parsed.data) === JSON.stringify(canonical));
}
export function planNavigation(input, options) {
  const search = searchKnowledge(input.query ?? input.sourceId);
  const sourceId = input.sourceId ?? search.results[0]?.id;
  const plan = search.status === 'answered' ? buildNavigationPlan(sourceId, options) : null;
  return NavigationPlanResponseSchema.parse({ status: plan ? 'answered' : search.status === 'out_of_scope' ? 'out_of_scope' : 'not_found', plan, hotline: search.hotline });
}
