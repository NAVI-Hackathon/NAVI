import { openConditions } from './workspace.js';

// What the guide card shows besides the plan itself. Everything comes from data NAVI already has: the
// knowledge snapshot (which entries belong to a service) and the journey the server returned (what is
// still open). Nothing here decides whether the user may apply.

const samePlace = (a, b) => Boolean(a && b) && a.path === b.path && (a.anchor ?? null) === (b.anchor ?? null);

/**
 * Things to have ready before going to this place, when the place is one of this journey's own
 * destinations (its next action or a claim channel). Another place gets nothing: the journey says
 * nothing about it.
 * @returns {string[]}
 */
export function journeyPrerequisites(journey, destination) {
  if (!journey || !destination) return [];
  const channel = journey.claimContext?.channels.find(c => samePlace(c.destination, destination));
  if (!channel && !samePlace(journey.nextAction?.destination, destination)) return [];
  const items = [
    ...(channel?.eligibility?.unconfirmedRequirements ?? []),
    ...journey.requirements.filter(r => r.required && r.status === 'missing').map(r => `尚缺：${r.name}`),
    ...openConditions(journey).map(condition => condition.text),
  ];
  return [...new Set(items)];
}

/**
 * Keeps only the steps of one service: the plan's own entry and the entries the snapshot links to it.
 * A step outside that (another service's form or page) is left out, never shown as part of this guide.
 */
export function serviceSteps(plan, entries) {
  const root = entries.find(entry => entry.id === plan.rootSourceId);
  if (!root) return { plan, service: null, dropped: [] };
  const own = new Set([root.id, ...root.relatedIds]);
  const steps = plan.steps.filter(step => own.has(step.sourceId));
  const dropped = plan.steps.filter(step => !own.has(step.sourceId)).map(step => step.sourceId);
  return { plan: { ...plan, steps: steps.map((step, index) => ({ ...step, order: index + 1 })) }, service: root.title, dropped };
}

/** A place reached in one move, shown with the same card as a guide (no steps, no excerpt to invent). */
export function singleStepPlan(destination, entry) {
  return {
    version: 1, rootSourceId: entry?.id ?? null, execution: 'user_guided',
    disclaimer: '只提供頁面導覽，不會登入、填表、送件或判斷理賠資格。',
    steps: [{ id: 'step-1', order: 1, sourceId: entry?.id ?? null, action: 'VIEW_INFORMATION', instruction: '前往官網位置', source: destination.source, destination, evidence: [] }],
  };
}
