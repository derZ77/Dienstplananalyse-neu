import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.15c – the approval is carried forward after the line-18 correction. The Phase 3I.14
// approval confirmed a contract whose line-18 semantics has since been corrected, so it is REPLACED
// by a new approval reference rather than silently kept. Nothing is activated.
import { validateRuleConfig } from '../js/v2/rules/config/rule-config-validator.js';
import {
  evaluateOneSixthRule, evaluateOneSixthEligibility,
  ELIGIBILITY_STATUS, ELIGIBILITY_REASON, LINE_18_CLASSIFICATION
} from '../js/v2/analysis/one-sixth-rule.js';
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

const configUrl = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const RAW = readFileSync(configUrl, 'utf8');
const CONFIG = JSON.parse(RAW);
const leaf = (node) => node?.value;
const APPROVER = 'JNV_RULE_APPROVAL_2026_PHASE3I15C';
const PREVIOUS_APPROVER = 'JNV_RULE_APPROVAL_2026_PHASE3I14';   // the superseded one

// ===== 1. the approval carried forward =====
test('the rule set is approved under the new reference', () => {
  assert.equal(CONFIG.status, 'approved');
  assert.equal(CONFIG.approvedBy, APPROVER);
});
test('the carried-forward rule set passes the configuration validator', () => {
  const result = validateRuleConfig(CONFIG);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});
test('the rule set cites the correction that made the new approval necessary', () => {
  assert.ok(CONFIG.sourceReferences.some(ref => /3I\.15b/.test(ref)), 'the corrected semantics');
  assert.ok(CONFIG.sourceReferences.some(ref => /3I\.15c/.test(ref)), 'the carried-forward approval');
});

// ===== 2. the superseded approval reference is gone from the contract =====
test('the previous approval reference no longer appears in the configuration', () => {
  assert.doesNotMatch(RAW, new RegExp(PREVIOUS_APPROVER),
    'the Phase 3I.14 approval covered the old line-18 semantics and is superseded');
  assert.notEqual(CONFIG.approvedBy, PREVIOUS_APPROVER);
});
test('exactly one approver is recorded', () => {
  const matches = RAW.match(/JNV_RULE_APPROVAL_[A-Z0-9_]+/g) ?? [];
  assert.deepEqual([...new Set(matches)], [APPROVER], 'no stacked approval history in the contract');
});

// ===== 3. no stale segment-exception parameter survives =====
test('the removed segment-exception parameter is gone', () => {
  assert.ok(!('ambiguousSegmentAssignmentOutcome' in CONFIG.parameters.eligibility),
    'it described a calculation that no longer exists');
  assert.doesNotMatch(RAW, /ambiguousSegmentAssignmentOutcome/);
});
test('no parameter describes a removed calculation any more', () => {
  assert.doesNotMatch(RAW, /exceptionLineScope|mixedLineHandling|affected_segments_only|segment_based|exceptedSegment/);
});
test('the parameters that stay are all present and confirmed', () => {
  const e = CONFIG.parameters.eligibility;
  for (const key of ['admissionLines', 'admissionLineEffect', 'admissionLineRequiresPureDuty',
    'nightShiftStart', 'nightShiftStartInclusive']) {
    assert.ok(key in e, `${key} must stay`);
    assert.equal(e[key].status, 'confirmed', key);
  }
  assert.equal(CONFIG.parameters.calculation.deadheadTreatment.value, 'counts_as_driving_time');
  assert.equal(CONFIG.parameters.calculation.deadheadTreatment.status, 'confirmed');
});
test('no parameter is open or provisional', () => {
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

// ===== 4. approval is still not activation =====
test('the carried-forward approval leaves the rule disabled', () => {
  assert.equal(leaf(CONFIG.parameters.activation.enabled), false);
  assert.doesNotMatch(RAW, /"enabled"\s*:\s*\{\s*"value"\s*:\s*true/);
  assert.doesNotMatch(RAW, /"status"\s*:\s*"active"/);
});
test('the productive default is untouched and still disabled', () => {
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false);
  const r = evaluateOneSixthRule({
    drivingProjection: { metadata: { dayType: 'saturday' }, circulations: [{ code: '1', drivingSegments: [] }] },
    turnaroundDetection: { status: 'complete', candidates: [] },
    ruleConfig: DEFAULT_ONE_SIXTH_RULE_CONFIG, context: { organization: 'JNV', mode: 'bus' }
  });
  assert.equal(r.status, 'DISABLED');
  assert.deepEqual(r.violations, []);
});
test('an approved rule set without an approver is still refused', () => {
  const broken = JSON.parse(RAW);
  broken.approvedBy = null;
  const codes = validateRuleConfig(broken).errors.map(e => e.code);
  assert.ok(codes.includes('APPROVED_WITHOUT_APPROVER'));
});
test('an approved rule set with an open parameter is still refused', () => {
  const broken = JSON.parse(RAW);
  broken.parameters.calculation.deadheadTreatment = { value: null, status: 'open', unit: 'text' };
  const codes = validateRuleConfig(broken).errors.map(e => e.code);
  assert.ok(codes.includes('APPROVED_WITH_OPEN_PARAMETERS'));
});
test('an invented rule-set status is still refused', () => {
  const broken = { ...JSON.parse(RAW), status: 'active' };
  const codes = validateRuleConfig(broken).errors.map(e => e.code);
  assert.ok(codes.includes('INVALID_STATUS'), 'approved is not active');
});
test('no code reads the approval state', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/analysis/one-sixth-check.js', '../js/v2/analysis/jnv-rule-analysis-controller.js',
    '../js/v2/checks/check-runner.js', '../js/v2/ui/check-explorer.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /approvedBy|JNV_RULE_APPROVAL/, `${path} must not read the approval`);
  }
});

// ===== 5./6. the corrected line-18 semantics the new approval confirms =====
const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: leaf(CONFIG.parameters.calculation.requiredRatioNumerator),
  requiredRatioDenominator: leaf(CONFIG.parameters.calculation.requiredRatioDenominator),
  roundingRule: leaf(CONFIG.parameters.calculation.roundingRule),
  minimumObservedSpanMinutes: leaf(CONFIG.parameters.turnaround.minimumObservedSpanMinutes),
  creditingMethod: leaf(CONFIG.parameters.turnaround.creditingMethod),
  acceptedTurnaroundConfidence: leaf(CONFIG.parameters.turnaround.acceptedTurnaroundConfidence),
  locationMismatchBlocksCrediting: leaf(CONFIG.parameters.turnaround.locationMismatchBlocksCrediting),
  allowedDayTypes: leaf(CONFIG.parameters.eligibility.allowedDayTypes),
  nightShiftIsException: leaf(CONFIG.parameters.eligibility.nightShiftIsException),
  nightShiftStart: leaf(CONFIG.parameters.eligibility.nightShiftStart),
  nightShiftStartInclusive: leaf(CONFIG.parameters.eligibility.nightShiftStartInclusive),
  admissionLines: leaf(CONFIG.parameters.eligibility.admissionLines),
  admissionLineRequiresPureDuty: leaf(CONFIG.parameters.eligibility.admissionLineRequiresPureDuty)
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };
const projection = (segments) => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: segments.map((s, i) => ({
      serviceNumber: '2221', kind: 'service', line: s.line,
      startMinutes: i * 600, endMinutes: i * 600 + s.duration, durationMinutes: s.duration,
      source: { serviceNumber: '2221', activityIndex: i, sourceType: 'pdf' }
    })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: segments.reduce((t, s) => t + s.duration, 0), nonDrivingMinutes: 0, knownTotalMinutes: 0 },
    warnings: []
  }],
  warnings: []
});
const candidate = (credited) => ({
  id: 'c#1', circulationCode: '11100',
  previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip', line: '18' },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip', line: '18' },
  startMinutes: 360, endMinutes: 360 + credited, observedSpanMinutes: credited,
  creditedMinutes: credited, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
});
const eligibility = { dutyStartMinutes: null, serviceStarts: { 2221: 5 * 60 } };
const verdict = (segments) => evaluateOneSixthEligibility({
  drivingProjection: projection(segments), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility
});
const rule = (segments, candidates = []) => evaluateOneSixthRule({
  drivingProjection: projection(segments), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility,
  turnaroundDetection: { status: 'complete', candidates, warnings: [], statistics: { candidateCount: candidates.length } }
});

test('the approved contract still admits a pure line-18 weekday duty', () => {
  const unit = verdict([{ line: '18', duration: 358 }]).circulations[0];
  assert.equal(unit.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unit.eligibilityReason, ELIGIBILITY_REASON.PURE_LINE_18);
  assert.equal(unit.line18Classification, LINE_18_CLASSIFICATION.PURE_LINE_18_ONLY);
});
test('the approved contract gives it the ordinary, undiminished quota', () => {
  const service = rule([{ line: '18', duration: 358 }], [candidate(112)]).services[0];
  assert.equal(service.drivingMinutes, 358, 'the whole duty');
  assert.equal(service.requiredMinutes, 60, 'ceil(358/6)');
  assert.equal(service.creditedMinutes, 112, 'line-18 turnarounds count normally');
  assert.equal(service.status, 'PASS');
  assert.ok(!('exceptedDrivingMinutes' in service));
});
test('the approved contract denies the line-18 admission to a mixed duty', () => {
  const unit = verdict([{ line: '18', duration: 200 }, { line: '10', duration: 158 }]).circulations[0];
  assert.equal(unit.line18Classification, LINE_18_CLASSIFICATION.MIXED_WITH_OTHER_LINES);
  assert.equal(unit.status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
  assert.equal(unit.eligibilityReason, ELIGIBILITY_REASON.NOT_ELIGIBLE);
});
test('a mixed duty admitted by its day type is assessed in full', () => {
  const weekend = { ...projection([{ line: '18', duration: 396 }, { line: '5', duration: 396 }]) };
  weekend.metadata = { ...weekend.metadata, dayType: 'saturday' };
  const r = evaluateOneSixthRule({
    drivingProjection: weekend, ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility,
    turnaroundDetection: { status: 'complete', candidates: [], warnings: [], statistics: { candidateCount: 0 } }
  });
  assert.equal(r.services[0].drivingMinutes, 792, 'nothing is removed');
  assert.equal(r.services[0].requiredMinutes, 132, 'ceil(792/6)');
});
