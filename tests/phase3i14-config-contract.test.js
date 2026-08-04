import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.14 – the approval touched exactly two envelope fields. Every parameter, every value and
// every source reference of the confirmed contract stays as it was.
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

const configUrl = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const RAW = readFileSync(configUrl, 'utf8');
const CONFIG = JSON.parse(RAW);
const leaf = (node) => node?.value;

const leaves = (node, path = 'parameters', out = new Map()) => {
  for (const [key, child] of Object.entries(node)) {
    const childPath = `${path}.${key}`;
    if (child && typeof child === 'object' && !Array.isArray(child) && 'value' in child) out.set(childPath, child);
    else if (child && typeof child === 'object' && !Array.isArray(child)) leaves(child, childPath, out);
  }
  return out;
};
const ALL = leaves(CONFIG.parameters);

// ===== the envelope =====
test('the envelope carries the expected identity, unchanged', () => {
  assert.equal(CONFIG.schemaVersion, '1.0');
  assert.equal(CONFIG.ruleSetId, 'jnv-one-sixth-v1');
  assert.equal(CONFIG.organization, 'JNV');
  assert.deepEqual(CONFIG.profileIds, ['beu-stadtbus-v1']);
  assert.equal(CONFIG.validFrom, null, 'an approval is not a validity date');
});
test('the source references are unchanged since Phase 3I.12', () => {
  assert.equal(CONFIG.sourceReferences.length, 15);   // SUPERSEDED BY PHASE 3I.15b/3I.15c (+4 Quellen)
  assert.ok(CONFIG.sourceReferences.includes('PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md'));
  assert.ok(CONFIG.sourceReferences.some(ref => /3I\.8b/.test(ref)));
  assert.ok(CONFIG.sourceReferences.some(ref => /bv-check-catalog/.test(ref)));
});
test('exactly the two approval fields carry the change', () => {
  assert.equal(CONFIG.status, 'approved');
  assert.equal(CONFIG.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(leaf(CONFIG.parameters.activation.enabled), false, 'and enabled is NOT one of them');
});

// ===== every confirmed value of the contract =====
test('the scope parameters are unchanged', () => {
  assert.deepEqual(leaf(CONFIG.parameters.scope.organizations), ['JNV']);
  assert.deepEqual(leaf(CONFIG.parameters.scope.modes), ['bus', 'tram']);
});
test('the calculation parameters are unchanged', () => {
  const c = CONFIG.parameters.calculation;
  assert.equal(leaf(c.requiredRatioNumerator), 1);
  assert.equal(leaf(c.requiredRatioDenominator), 6);
  assert.equal(leaf(c.roundingRule), 'ceil_to_full_minute');
  assert.equal(leaf(c.deadheadTreatment), 'counts_as_driving_time');
  assert.equal(leaf(c.aggregationScope), 'duty');
});
test('the turnaround parameters are unchanged', () => {
  const t = CONFIG.parameters.turnaround;
  assert.equal(leaf(t.minimumObservedSpanMinutes), 11);
  assert.equal(leaf(t.creditingMethod), 'full_observed_span');
  assert.deepEqual(leaf(t.acceptedTurnaroundConfidence), ['exact', 'probable']);
  assert.equal(leaf(t.locationMismatchBlocksCrediting), false);
});
test('the eligibility parameters are unchanged', () => {
  const e = CONFIG.parameters.eligibility;
  assert.deepEqual(leaf(e.allowedDayTypes), ['SATURDAY', 'SUNDAY_HOLIDAY']);
  assert.equal(leaf(e.nightShiftIsException), true);
  assert.equal(leaf(e.nightShiftStart), '19:20');
  assert.equal(leaf(e.nightShiftStartInclusive), true);
  assert.equal(leaf(e.nightShiftStartBasis), 'duty_start_time');
  // SUPERSEDED BY PHASE 3I.15b: admission ground instead of segment exception.
  assert.deepEqual(leaf(e.admissionLines), ['18']);
  assert.equal(leaf(e.admissionLineEffect), 'admission_ground');
  assert.equal(leaf(e.admissionLineRequiresPureDuty), true);
  assert.ok(!('ambiguousSegmentAssignmentOutcome' in e));   // SUPERSEDED BY PHASE 3I.15c: dropped
});
test('the data strategy is unchanged', () => {
  const d = CONFIG.parameters.dataStrategy;
  assert.deepEqual(leaf(d.sourcePriority), ['umlauftafel', 'schedule_structured', 'schedule_fallback']);
  assert.equal(leaf(d.doubleCountingForbidden), true);
});

// ===== structural guarantees =====
test('every parameter leaf is confirmed', () => {
  const notConfirmed = [...ALL.entries()].filter(([, node]) => node.status !== 'confirmed').map(([path]) => path);
  assert.deepEqual(notConfirmed, []);
});
test('no parameter is open and the open list is empty', () => {
  assert.deepEqual(leaf(CONFIG.parameters.openParameters), []);
  const open = [...ALL.entries()].filter(([, node]) => node.status === 'open').map(([path]) => path);
  assert.deepEqual(open, []);
});
test('every leaf uses the closed unit vocabulary', () => {
  const units = new Set(['minutes', 'meters', 'ratio', 'weekdays', 'lines', 'flag', 'text', 'none']);
  const bad = [...ALL.entries()].filter(([, node]) => node.unit !== undefined && !units.has(node.unit)).map(([path]) => path);
  assert.deepEqual(bad, []);
});
test('the productive default still mirrors the approved values', () => {
  const e = CONFIG.parameters.eligibility;
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.allowedDayTypes], leaf(e.allowedDayTypes));
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.admissionLines], leaf(e.admissionLines));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.nightShiftStart, leaf(e.nightShiftStart));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.requiredRatioDenominator, leaf(CONFIG.parameters.calculation.requiredRatioDenominator));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false, 'mirrored values, still switched off');
});

// ===== privacy =====
test('the configuration holds no executable logic', () => {
  assert.doesNotMatch(RAW, /function|=>|\beval\b|\brequire\(|\bimport\b|\$\{|`/);
});
test('the configuration holds no path and no personal data', () => {
  assert.doesNotMatch(RAW, /\/Users\/|\/Volumes\/|C:\\\\|@[\w.-]+\.[a-z]{2,}/i);
});
test('the configuration is pure JSON without storage or network references', () => {
  assert.doesNotMatch(RAW, /localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|http:\/\/|https:\/\//);
  assert.doesNotThrow(() => JSON.parse(RAW));
});
