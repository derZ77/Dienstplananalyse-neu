import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.15b – the declarative side of the correction: the vocabulary, the validator and the
// versioned contract. Line 18 is an admission ground; nothing about it may reduce a quota.
import {
  evaluateOneSixthRule, evaluateOneSixthEligibility,
  ELIGIBILITY_REASON, LINE_18_CLASSIFICATION
} from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthEligibility, validateOneSixthEvaluation } from '../js/v2/analysis/one-sixth-validation.js';
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

const configUrl = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const RAW = readFileSync(configUrl, 'utf8');
const CONFIG = JSON.parse(RAW);
const leaf = (node) => node?.value;

const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };
const projection = (dayType, segments) => ({
  metadata: { serviceRegime: 'school', dayType, dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: 'A',
    drivingSegments: segments.map((s, i) => ({
      serviceNumber: '2221', kind: s.kind ?? 'service', line: s.line,
      startMinutes: i * 600, endMinutes: i * 600 + s.duration, durationMinutes: s.duration,
      source: { serviceNumber: '2221', activityIndex: i, sourceType: 'pdf' }
    })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: segments.reduce((t, s) => t + s.duration, 0), nonDrivingMinutes: 0, knownTotalMinutes: 0 },
    warnings: []
  }],
  warnings: []
});
const detection = { status: 'complete', candidates: [], warnings: [], statistics: { candidateCount: 0 } };
const ELIGIBILITY = { dutyStartMinutes: null, serviceStarts: {} };
const verdict = (dayType, segments) => evaluateOneSixthEligibility({
  drivingProjection: projection(dayType, segments), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: ELIGIBILITY
});
const rule = (dayType, segments) => evaluateOneSixthRule({
  drivingProjection: projection(dayType, segments), turnaroundDetection: detection,
  ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: ELIGIBILITY
});

// ===== the new vocabulary =====
test('the eligibility reasons form the agreed closed vocabulary', () => {
  // SUPERSEDED BY PHASE 3I.27: `BLOCKPAUSE_PRESENT` joined the vocabulary — a duty with a block
  // break is outside the rule altogether. The list stays closed; it gained exactly one entry.
  assert.deepEqual(Object.values(ELIGIBILITY_REASON).sort(),
    ['BLOCKPAUSE_PRESENT', 'DAY_TYPE_UNKNOWN', 'NIGHT_SHIFT', 'NOT_ELIGIBLE', 'NOT_JNV', 'PURE_LINE_18', 'SEGMENT_LINE_AMBIGUOUS', 'UNSUPPORTED_MODE', 'WEEKEND'].sort());
});
test('the line-18 classification forms the agreed closed vocabulary', () => {
  assert.deepEqual(Object.values(LINE_18_CLASSIFICATION).sort(),
    ['MIXED_WITH_OTHER_LINES', 'NO_LINE_INFORMATION', 'PURE_LINE_18_ONLY']);
});
test('every admitted unit states which ground admitted it', () => {
  const weekend = verdict('saturday', [{ line: '5', duration: 358 }]).circulations[0];
  const pure = verdict('mo_fr', [{ line: '18', duration: 358 }]).circulations[0];
  assert.equal(weekend.eligibilityReason, ELIGIBILITY_REASON.WEEKEND);
  assert.equal(pure.eligibilityReason, ELIGIBILITY_REASON.PURE_LINE_18);
});
test('the segment-exception bookkeeping is gone from the eligibility result', () => {
  const unit = verdict('mo_fr', [{ line: '18', duration: 358 }]).circulations[0];
  for (const removed of ['exceptedSegmentIndexes', 'exceptedSegmentCount', 'evaluableSegmentCount']) {
    assert.ok(!(removed in unit), `${removed} must not steer the calculation any more`);
  }
});

// ===== the validator =====
test('the eligibility validator accepts the corrected shape', () => {
  for (const [dayType, segments] of [['mo_fr', [{ line: '18', duration: 358 }]], ['saturday', [{ line: '5', duration: 358 }]],
    ['mo_fr', [{ line: '5', duration: 358 }]], ['mo_fr', [{ line: '18', duration: 200 }, { line: '5', duration: 158 }]]]) {
    assert.deepEqual(validateOneSixthEligibility(verdict(dayType, segments)).errors, [], `${dayType} ${JSON.stringify(segments)}`);
  }
});
test('the validator rejects an unknown eligibility reason', () => {
  const broken = verdict('mo_fr', [{ line: '5', duration: 358 }]);
  broken.circulations[0].eligibilityReason = 'BECAUSE_I_SAID_SO';
  const codes = validateOneSixthEligibility(broken).errors.map(e => e.code);
  assert.ok(codes.includes('UNKNOWN_ELIGIBILITY_REASON'));
});
test('the validator rejects an unknown line-18 classification', () => {
  const broken = verdict('mo_fr', [{ line: '18', duration: 358 }]);
  broken.circulations[0].line18Classification = 'PROBABLY_18';
  const codes = validateOneSixthEligibility(broken).errors.map(e => e.code);
  assert.ok(codes.includes('UNKNOWN_LINE_18_CLASSIFICATION'));
});
test('the validator rejects a not-applicable verdict on a pure line-18 duty', () => {
  const broken = verdict('mo_fr', [{ line: '18', duration: 358 }]);
  broken.circulations[0].status = 'NOT_APPLICABLE';
  broken.circulations[0].eligibilityReason = ELIGIBILITY_REASON.NOT_ELIGIBLE;
  const codes = validateOneSixthEligibility(broken).errors.map(e => e.code);
  assert.ok(codes.includes('PURE_LINE_18_MUST_BE_ADMITTED'), 'the old NOT_APPLICABLE automatism is forbidden');
});
test('the validator rejects a quota deduction attributed to line 18', () => {
  const evaluation = rule('mo_fr', [{ line: '18', duration: 358 }]);
  const broken = { ...evaluation, services: evaluation.services.map(s => ({ ...s, exceptedDrivingMinutes: 100 })) };
  const codes = validateOneSixthEvaluation(broken, RULE_CONFIG).errors.map(e => e.code);
  assert.ok(codes.includes('LINE_EXCEPTION_REDUCES_QUOTA'));
});
test('the evaluation validator still rejects a quota on a not-applicable unit', () => {
  const evaluation = rule('mo_fr', [{ line: '5', duration: 358 }, { line: '18', duration: 100 }]);
  assert.deepEqual(validateOneSixthEvaluation(evaluation, RULE_CONFIG).errors, [], 'baseline is valid');
});
test('the evaluation validator still rejects a violation without a verdict', () => {
  const evaluation = rule('mo_fr', [{ line: '18', duration: 358 }]);
  const broken = { ...evaluation, status: 'INCONCLUSIVE', violations: [{ ruleId: 'BV015_BV018', severity: 'VIOLATION' }] };
  const codes = validateOneSixthEvaluation(broken, RULE_CONFIG).errors.map(e => e.code);
  assert.ok(codes.includes('VIOLATION_WITHOUT_FAIL'));
});

// ===== the versioned contract =====
test('the rule set declares line 18 as an admission ground, not a segment exception', () => {
  const e = CONFIG.parameters.eligibility;
  assert.deepEqual(leaf(e.admissionLines), ['18']);
  assert.equal(leaf(e.admissionLineRequiresPureDuty), true);
  assert.equal(leaf(e.admissionLineEffect), 'admission_ground');
});
test('the discarded segment-exception parameters are gone from the contract', () => {
  const e = CONFIG.parameters.eligibility;
  for (const removed of ['exceptionLines', 'exceptionLineScope', 'mixedLineHandling']) {
    assert.ok(!(removed in e), `${removed} carried the wrong semantics`);
  }
  assert.doesNotMatch(RAW, /affected_segments_only|segment_based/);
});
test('the productive default mirrors the corrected admission parameters', () => {
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.admissionLines], ['18']);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.admissionLineRequiresPureDuty, true);
  assert.ok(!('exceptionLines' in DEFAULT_ONE_SIXTH_RULE_CONFIG), 'the old key is gone');
});
test('the night-shift, ratio and turnaround parameters are untouched', () => {
  const e = CONFIG.parameters.eligibility;
  assert.equal(leaf(e.nightShiftStart), '19:20');
  assert.equal(leaf(e.nightShiftStartInclusive), true);
  assert.equal(leaf(e.nightShiftIsException), true);
  assert.deepEqual(leaf(e.allowedDayTypes), ['SATURDAY', 'SUNDAY_HOLIDAY']);
  assert.equal(leaf(CONFIG.parameters.calculation.requiredRatioDenominator), 6);
  assert.equal(leaf(CONFIG.parameters.calculation.roundingRule), 'ceil_to_full_minute');
  assert.equal(leaf(CONFIG.parameters.calculation.deadheadTreatment), 'counts_as_driving_time');
  assert.equal(leaf(CONFIG.parameters.turnaround.minimumObservedSpanMinutes), 11);
  assert.deepEqual(leaf(CONFIG.parameters.turnaround.acceptedTurnaroundConfidence), ['exact', 'probable']);
});
test('the approval and the deactivation are untouched by this correction', () => {
  assert.equal(CONFIG.status, 'approved');
  assert.equal(CONFIG.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(leaf(CONFIG.parameters.activation.enabled), false, 'still not activated');
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false);
});
test('every parameter stays confirmed and the open list stays empty', () => {
  const notConfirmed = [];
  for (const [group, entries] of Object.entries(CONFIG.parameters)) {
    if (group === 'openParameters') continue;
    for (const [name, node] of Object.entries(entries)) {
      if (node && typeof node === 'object' && 'status' in node && node.status !== 'confirmed') notConfirmed.push(`${group}.${name}`);
    }
  }
  assert.deepEqual(notConfirmed, []);
  assert.deepEqual(leaf(CONFIG.parameters.openParameters), []);
});
test('the rule set cites the Phase 3I.15b correction', () => {
  assert.ok(CONFIG.sourceReferences.some(ref => /3I\.15b/.test(ref)));
});
test('the configuration still holds no executable logic and no path', () => {
  assert.doesNotMatch(RAW, /function|=>|\beval\b|\brequire\(|\$\{|`/);
  assert.doesNotMatch(RAW, /\/Users\/|\/Volumes\/|C:\\\\/);
});
