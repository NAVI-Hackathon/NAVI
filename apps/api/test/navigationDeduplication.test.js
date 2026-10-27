import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationPlan, planNavigation, verifyNavigationPlan } from '../../../shared/knowledge/navigationPlan.js';
import { knowledgeEntries, verifyNavigationDestination } from '../../../shared/knowledge/index.js';

test('Address navigation is two relevant destinations; contract form is one, inpatient document plan remains three', () => {
  const address = buildNavigationPlan('service:change_address');
  assert.deepEqual(address.steps.map(step => step.sourceId), ['service:change_address', 'form:form_contract_change']);
  const form = buildNavigationPlan('form:form_contract_change');
  assert.deepEqual(form.steps.map(step => step.sourceId), ['form:form_contract_change']);
  assert.equal(form.steps[0].destination.anchor, 'form-contract-change-investment');
  const hospital = buildNavigationPlan('claim-doc:2');
  assert.deepEqual(hospital.steps.map(step => step.sourceId), ['claim-doc:2', 'form:claim_1.1.1', 'service:claim_by_mail']);
  assert.equal(buildNavigationPlan('missing'), null);
});

test('All plans have distinct real destinations, canonical order and no reverse-linked unrelated service padding', () => {
  for (const entry of knowledgeEntries) {
    const plan = buildNavigationPlan(entry.id); assert.ok(verifyNavigationPlan(plan));
    const keys = plan.steps.map(step => `${step.destination.path}#${step.destination.anchor}`);
    assert.equal(new Set(keys).size, keys.length, entry.id);
    assert.ok(plan.steps.every(step => verifyNavigationDestination(step.destination, step.sourceId)));
    if (entry.type === 'form' || entry.type === 'faq') assert.equal(plan.steps.length, 1, entry.id);
  }
});

test('Judge 2 natural-language form and address queries select only their necessary destinations', () => {
  for (const [query, expected] of [
    ['我要下載保險契約內容變更申請書。', ['form:form_contract_change']],
    ['我搬家了，要變更保單地址。', ['service:change_address', 'form:form_contract_change']],
  ]) {
    const result = planNavigation({ query });
    assert.equal(result.status, 'answered');
    assert.deepEqual(result.plan.steps.map(step => step.sourceId), expected);
    assert.ok(verifyNavigationPlan(result.plan));
  }
});

