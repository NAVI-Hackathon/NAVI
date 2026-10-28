import { z } from 'zod';

const fraction = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
export function latency(values) {
  if (values.some(v => !Number.isFinite(v) || v < 0)) throw Error('Invalid latency');
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50: sorted.length ? sorted[Math.ceil(sorted.length * .5) - 1] : null, p95: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null };
}
export const ObservationSchema = z.object({
  id: z.string().min(1), mode: z.enum(['mock_transport', 'live_gemini']), provider: z.literal('gemini'),
  model: z.string().min(1), gitSha: z.string().regex(/^[a-f0-9]{40}$/), timestamp: z.iso.datetime(),
  latencyMs: z.number().finite().nonnegative(), requests: z.number().int().min(0).max(1),
  tokenUsage: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).strict().nullable(),
  fallbackUsed: z.literal(false), errorCode: z.string().nullable(),
  tasks: z.array(z.object({ serviceType: z.string(), outcome: z.string(), extractedData: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional() }).strict()).optional(),
  extraction: z.object({ documentType: z.string(), fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) }).strict().optional(),
  documentStatus: z.enum(['verified', 'needs_review', 'rejected']).optional(), issues: z.array(z.string()).optional(),
}).strict();
function sameTasks(expected, actual = []) {
  if (expected.length !== actual.length) return false;
  const remaining = [...actual];
  return expected.every(task => {
    const index = remaining.findIndex(row => row.serviceType === task.serviceType && row.outcome === task.outcome &&
      Object.entries(task.extractedData ?? {}).every(([key, value]) => (row.extractedData?.[key] ?? null) === value));
    if (index < 0) return false;
    remaining.splice(index, 1); return true;
  });
}
const label = (a = []) => a.map(t => t.serviceType).sort().join('+') || '__error__';
const present = value => value !== null && value !== undefined;

export function scoreObservations(cases, input) {
  const observations = input.map(row => ObservationSchema.parse(row));
  if (new Set(observations.map(row => row.id)).size !== observations.length) throw Error('Duplicate observations');
  const indexed = new Map(cases.map(row => [row.id, row]));
  if (observations.some(row => !indexed.has(row.id))) throw Error('Unknown case ID');
  if (new Set(observations.map(row => row.mode)).size > 1 || new Set(observations.map(row => row.gitSha)).size > 1 || new Set(observations.map(row => row.model)).size > 1) throw Error('Do not pool different evidence modes, versions or models');
  const rows = observations.map(actual => {
    const entry = indexed.get(actual.id); const gt = entry.groundTruth;
    let pass;
    if (entry.kind === 'intent') pass = !actual.errorCode && sameTasks(gt.tasks, actual.tasks);
    else {
      const expectedError = gt.status === 'rejected';
      pass = expectedError ? gt.errorCodes.includes(actual.errorCode) && actual.documentStatus !== 'verified'
        : !actual.errorCode && actual.extraction?.documentType === gt.documentType && actual.documentStatus === gt.status &&
          Object.entries(gt.fields).every(([key, value]) => (actual.extraction?.fields[key] ?? null) === value);
      pass &&= JSON.stringify([...(actual.issues ?? [])].sort()) === JSON.stringify([...gt.issues].sort());
    }
    return { id: entry.id, kind: entry.kind, category: entry.category, groundTruth: gt, actual, pass: Boolean(pass) };
  });
  const intents = rows.filter(row => row.kind === 'intent'); const docs = rows.filter(row => row.kind === 'document');
  const confusion = {}; const perClass = {};
  for (const { groundTruth, actual } of intents) {
    const expected = label(groundTruth.tasks); const predicted = actual.errorCode ? '__error__' : label(actual.tasks);
    (confusion[expected] ??= {})[predicted] = (confusion[expected]?.[predicted] ?? 0) + 1;
    const truth = new Set(groundTruth.tasks.map(t => t.serviceType));
    const guesses = new Set(actual.errorCode ? [] : (actual.tasks ?? []).map(t => t.serviceType));
    for (const value of new Set([...truth, ...guesses])) {
      const count = perClass[value] ??= { tp: 0, fp: 0, fn: 0 };
      if (truth.has(value) && guesses.has(value)) count.tp++;
      else if (truth.has(value)) count.fn++;
      else count.fp++;
    }
  }
  for (const count of Object.values(perClass)) {
    count.precision = fraction(count.tp, count.tp + count.fp); count.recall = fraction(count.tp, count.tp + count.fn);
  }
  let tp = 0; let fp = 0; let fn = 0;
  for (const { groundTruth, actual } of docs.filter(row => row.actual.requests > 0)) {
    const predicted = actual.extraction?.fields ?? {}; const expected = groundTruth.fields;
    // Extra non-null fields count as hallucinations; missing/wrong expected values count as omissions.
    for (const key of new Set([...Object.keys(expected), ...Object.keys(predicted)])) {
      const value = predicted[key]; const truth = expected[key];
      if (present(value) && value === truth) tp++;
      else { if (present(value)) fp++; if (present(truth)) fn++; }
    }
  }
  const categoryRate = (selected, condition) => fraction(selected.filter(condition).length, selected.length);
  const unknown = intents.filter(row => row.groundTruth.tasks.every(t => t.serviceType === 'unknown'));
  const irrelevant = docs.filter(row => ['blank', 'unrelated', 'unrelated_pet'].includes(row.category));
  const incomplete = docs.filter(row => ['incomplete', 'low_confidence', 'blurred', 'tilted'].includes(row.category));
  const conflicts = docs.filter(row => row.groundTruth.issues.length);
  const injections = rows.filter(row => row.category.includes('injection'));
  const timeout = row => row.actual.errorCode === 'AI_TIMEOUT';
  const apiError = row => Boolean(row.actual.errorCode?.startsWith('AI_') && !['AI_RESPONSE_INVALID', 'AI_SAFETY_REJECTION'].includes(row.actual.errorCode));
  const extractionDocs = docs.filter(row => row.actual.requests > 0);
  return {
    evidenceType: observations[0]?.mode ?? 'not_run', measuredCases: rows.length, datasetCases: cases.length,
    notRunIds: cases.filter(row => !observations.some(obs => obs.id === row.id)).map(row => row.id),
    pass: fraction(rows.filter(row => row.pass).length, rows.length),
    intent: { exactTasks: fraction(intents.filter(row => row.pass).length, intents.length), perClass, confusion,
      unknownHandling: categoryRate(unknown, row => row.pass),
      unsupportedHandling: categoryRate(intents.filter(row => row.category === 'unsupported_service'), row => row.pass),
      outOfScopeHandling: categoryRate(intents.filter(row => row.category === 'out_of_scope'), row => row.pass),
      timeoutRate: categoryRate(intents, timeout), apiErrorRate: categoryRate(intents, apiError), latencyMs: latency(intents.map(row => row.actual.latencyMs)) },
    document: { fields: { tp, fp, fn, precision: fraction(tp, tp + fp), recall: fraction(tp, tp + fn), f1: fraction(2 * tp, 2 * tp + fp + fn) },
      typeAccuracy: categoryRate(extractionDocs, row => row.actual.extraction?.documentType === row.groundTruth.documentType),
      incompleteRefusal: categoryRate(incomplete, row => row.pass && row.actual.documentStatus !== 'verified'),
      irrelevantFalseAccept: categoryRate(irrelevant, row => row.actual.documentStatus === 'verified'),
      consistencyHandling: categoryRate(conflicts, row => row.pass),
      timeoutRate: categoryRate(docs, timeout), apiErrorRate: categoryRate(docs, apiError), latencyMs: latency(docs.map(row => row.actual.latencyMs)) },
    injectionHandling: categoryRate(injections, row => row.pass), requests: observations.reduce((sum, row) => sum + row.requests, 0),
    rows,
  };
}
