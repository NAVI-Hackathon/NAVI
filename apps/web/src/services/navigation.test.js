import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createMockAdapter } from './adapters.js';
import { DEMO_STORY } from '../mocks/hospitalClaim.js';
import { NavigationTargetSchema } from '../../../../shared/journey.js';
import { knowledgeEntries } from '../../../../shared/knowledge/index.js';
import raw from '../../../../data/cardif_seed_data.json' with { type: 'json' };

// Paths that exist in apps/mock-site, derived from its app/ directory: route groups "(…)" and private "_…" folders add no segment.
const mockSiteApp = new URL('../../../mock-site/app/', import.meta.url);
const MOCK_SITE_PATHS = new Set(readdirSync(mockSiteApp, { recursive: true })
  .filter(file => /(^|[\\/])page\.tsx$/.test(file))
  .map(file => '/' + file.split(/[\\/]/).slice(0, -1).filter(segment => !/^\(.*\)$/.test(segment)).join('/'))
  .filter(path => !path.split('/').some(segment => segment.startsWith('_'))));

function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}

test('every Golden Path NextAction points at a valid mock-site location', async () => {
  const service = createMockAdapter({ storage: memoryStorage(), analysisDelayMs: 0, documentDelayMs: 0 });
  const steps = [(await service.analyze(DEMO_STORY)).snapshot];
  steps.push(await service.uploadDocument('diagnosis_certificate', { sample: true }));
  steps.push(await service.uploadDocument('bank_passbook', { sample: true }));
  steps.push(service.confirm());
  const destinations = steps.map(s => s.journey.nextAction.destination);
  for (const destination of destinations) {
    NavigationTargetSchema.parse(destination);
    assert.ok(MOCK_SITE_PATHS.has(destination.path), destination.path);
    assert.match(destination.source.url, /^https:\/\/life\.cardif\.com\.tw\//);
  }
  assert.deepEqual(destinations.map(d => d.kind), ['page', 'page', 'form', 'entry_point']);
  assert.deepEqual(destinations.map(d => d.anchor), ['claim-doc-2', 'claim-rule-7', 'form-claim-1-1-1', 'service-claim-hospital-upload']);
});

test('row anchors follow the data file order shared with the mock site', () => {
  assert.equal(Object.keys(raw.claim_document_requirements)[1], '住院醫療');
  assert.match(raw.claim_general_rules[6], /存摺影本/);
  assert.equal(raw.forms.some(f => f.id === 'claim_1.1.1' && f.name === '保險金申請書'), true);
});

test('every claim channel offers a destination and the partner channel reflects the hospital', async () => {
  const service = createMockAdapter({ storage: memoryStorage(), analysisDelayMs: 0, documentDelayMs: 0 });
  const { journey } = (await service.analyze(DEMO_STORY)).snapshot;
  for (const channel of journey.claimContext.channels) {
    NavigationTargetSchema.parse(channel.destination);
    assert.ok(channel.notes.length > 0);
  }
  assert.deepEqual(journey.claimContext.reminders.map(r => /10日內|30萬|診斷書/.test(r)), [true, true, true]);
});

// Each page's source decides which anchors it renders; check every knowledge answer against it.
const pageSource = path => readFileSync(new URL(`(site)${path === '/' ? '' : path}/page.tsx`, mockSiteApp), 'utf8');
const formsPage = pageSource('/services/forms');
const versionedForms = new Set(JSON.parse(formsPage.match(/VERSIONED_FORMS = new Set\((\[[^\]]*\])\)/)[1]));
const claimSections = [...formsPage.matchAll(/prefix: "([^"]+)"/g)].map(m => m[1]);

test('every knowledge answer leads to a page and anchor the mock site renders', () => {
  for (const entry of knowledgeEntries) {
    const { path, anchor, source } = NavigationTargetSchema.parse(entry.destination);
    assert.ok(MOCK_SITE_PATHS.has(path), `${entry.id} → ${path}`);
    assert.match(source.url, /^https:\/\/life\.cardif\.com\.tw\//);
    const page = pageSource(path);
    const [, id] = entry.id.split(/:(.*)/);
    if (entry.type === 'service') {
      const service = raw.services.find(s => s.id === id);
      assert.ok(page.includes(`getService("${id}")`) || page.includes(`servicesByCategory("${service.category}")`), `${entry.id} is not rendered on ${path}`);
      assert.equal(anchor, `service-${id.replace(/[_.]+/g, '-')}`);
    } else if (entry.type === 'form') {
      if (id.startsWith('claim_')) assert.ok(claimSections.some(prefix => id.startsWith(prefix)), `${entry.id} has no section`);
      assert.equal(anchor.endsWith('-investment'), versionedForms.has(id), entry.id);
    } else {
      const template = { faq: 'faqTourId', claim_documents: '`claim-doc-${index + 1}`', claim_rule: '`claim-rule-${index + 1}`' }[entry.type];
      assert.ok(page.includes(template), `${entry.id}: ${path} does not render ${template}`);
    }
  }
});
