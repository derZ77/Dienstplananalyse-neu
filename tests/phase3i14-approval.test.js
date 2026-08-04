import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.14 – the formal approval. The versioned JNV one-sixth rule set is now `approved` with a
// named approver, and it stays DISABLED: approval is a statement about the contract, activation is
// a separate decision that this phase deliberately does not take.
import { validateRuleConfig } from '../js/v2/rules/config/rule-config-validator.js';
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

const configUrl = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const RAW = readFileSync(configUrl, 'utf8');
const CONFIG = JSON.parse(RAW);
const leaf = (node) => node?.value;
const APPROVER = 'JNV_RULE_APPROVAL_2026_PHASE3I15C';

// ===== the approval itself =====
test('the rule set is approved', () => {
  assert.equal(CONFIG.status, 'approved');
});
test('the approval names its approver', () => {
  assert.equal(CONFIG.approvedBy, APPROVER);
});
test('the approved rule set passes the configuration validator', () => {
  const result = validateRuleConfig(CONFIG);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});
test('the approval rests on sources, no open parameters and no provisional value', () => {
  assert.ok(CONFIG.sourceReferences.length > 0, 'an approved rule set needs sources');
  assert.deepEqual(leaf(CONFIG.parameters.openParameters), [], 'Open-Count 0');
  const provisional = [];
  for (const [group, entries] of Object.entries(CONFIG.parameters)) {
    if (group === 'openParameters') continue;
    for (const [name, node] of Object.entries(entries)) {
      if (node && typeof node === 'object' && 'status' in node && node.status !== 'confirmed') provisional.push(`${group}.${name}`);
    }
  }
  assert.deepEqual(provisional, []);
});

// ===== approval is not activation =====
test('the approved rule set is still disabled', () => {
  assert.equal(leaf(CONFIG.parameters.activation.enabled), false, 'approved ≠ enabled');
});
test('the raw configuration contains no activation', () => {
  assert.doesNotMatch(RAW, /"enabled"\s*:\s*\{\s*"value"\s*:\s*true/);
  assert.doesNotMatch(RAW, /"status"\s*:\s*"active"/);
});
test('the productive default rule set is disabled and untouched by the approval', () => {
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.ruleId, 'BV015_BV018');
});
test('the rule still produces no verdict productively', () => {
  const r = evaluateOneSixthRule({
    drivingProjection: { metadata: { dayType: 'saturday' }, circulations: [{ code: '1', drivingSegments: [] }] },
    turnaroundDetection: { status: 'complete', candidates: [] },
    ruleConfig: DEFAULT_ONE_SIXTH_RULE_CONFIG, context: { organization: 'JNV', mode: 'bus' }
  });
  assert.equal(r.status, 'DISABLED');
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.services, []);
  assert.deepEqual(r.warnings, [{ code: 'RULE_DISABLED' }]);
});

// ===== the approval changes no calculation =====
const RULE_CONFIG = (over = {}) => ({
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true,
  ...over
});
const projection = () => ({
  metadata: { serviceRegime: 'school', dayType: 'saturday', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: [
      { serviceNumber: '2101', kind: 'deadhead', line: null, startMinutes: 0, endMinutes: 30, durationMinutes: 30, source: { sourceType: 'pdf' } },
      { serviceNumber: '2101', kind: 'service', line: '5', startMinutes: 30, endMinutes: 426, durationMinutes: 396, source: { sourceType: 'pdf' } }
    ],
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 426, nonDrivingMinutes: 0, knownTotalMinutes: 0 }, warnings: []
  }],
  warnings: []
});
const evaluate = () => evaluateOneSixthRule({
  drivingProjection: projection(),
  turnaroundDetection: { status: 'complete', candidates: [], warnings: [], statistics: { candidateCount: 0 } },
  ruleConfig: RULE_CONFIG(), context: { organization: 'JNV', mode: 'bus' },
  eligibility: { dutyStartMinutes: null, serviceStarts: {} }
});
test('the rule arithmetic is exactly what it was before the approval', () => {
  const s = evaluate().services[0];
  assert.equal(s.drivingMinutes, 426, 'Phase 3I.13: deadhead run counts in full');
  assert.equal(s.requiredMinutes, 71, 'ceil(426/6)');
  assert.equal(s.status, 'FAIL', 'nothing credited');
});
test('the rule module knows nothing about the approval state', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/analysis/one-sixth-check.js', '../js/v2/analysis/jnv-rule-analysis-controller.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /approvedBy|JNV_RULE_APPROVAL/, `${path} must not read the approval`);
  }
});
test('no interface, explorer, session or runner file learned about the approval', () => {
  for (const path of ['../js/v2/ui/check-explorer.js', '../js/v2/explorer/check-explorer-session-bridge.js',
    '../js/v2/import/multi-document-import-controller.js', '../js/v2/checks/check-runner.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /approvedBy|JNV_RULE_APPROVAL|one-?sixth/i, `${path} must stay generic`);
  }
});
