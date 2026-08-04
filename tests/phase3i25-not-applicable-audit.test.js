import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.25 – AUDIT of the 98 duties the real JNV plan reports as NOT_APPLICABLE.
//
// Phase 3I.24 made the rule assess duties instead of circulations. 98 of 102 units then fell out
// as NOT_APPLICABLE, and the honest question was whether they fall out RIGHTLY. This file changes
// no rule; it pins the answer and the reasoning behind it, so a later change that starts dropping
// duties for the wrong reason has to come past here.
//
// The plan is a Mon–Fri holiday roster. On a weekday the 1/6 rule admits only two grounds:
// a NIGHT SHIFT, or a duty running EXCLUSIVELY on the admission line. Everything else is out of
// scope — that is the rule, not a defect.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6,
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  roundingRule: 'ceil_to_full_minute', minimumObservedSpanMinutes: 11, belowMinimumCreditedMinutes: 0,
  creditingMethod: 'full_observed_span',
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };
const NIGHT_THRESHOLD = 19 * 60 + 20;

const segment = (serviceNumber, line, startMinutes, durationMinutes, kind = 'service') => ({
  serviceNumber, kind, line, startMinutes, endMinutes: startMinutes + durationMinutes,
  durationMinutes, source: { serviceNumber, activityIndex: null, sourceType: 'umlauftafel' }
});
const circulation = (code, drivingSegments) => ({
  code, drivingSegments, drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
  services: [...new Set(drivingSegments.map(s => s.serviceNumber).filter(Boolean))],
  statistics: { drivingMinutes: drivingSegments.reduce((t, s) => t + s.durationMinutes, 0) }, warnings: []
});
const run = (circulations, serviceStarts = {}, candidates = []) => evaluateOneSixthRule({
  drivingProjection: { metadata: { serviceRegime: 'unknown', dayType: 'mo_do', dutyStartTime: null, circulationCount: circulations.length }, circulations, warnings: [] },
  turnaroundDetection: { status: 'complete', candidates },
  ruleConfig: CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: null, serviceStarts }
});
const turnaround = (id, code, from, span) => ({ id, circulationCode: code, startMinutes: from, endMinutes: from + span, observedSpanMinutes: span, creditedMinutes: span, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: [] });
const only = (result) => result.services[0];

// The audit result, recorded from the real reference (no reference data in this repository).
// 102 duty units · 3 PASS · 1 INCONCLUSIVE · 98 NOT_APPLICABLE.
const AUDIT = Object.freeze({
  units: 102, passed: 3, inconclusive: 1, notApplicable: 98,
  dayType: 'mo_do',                       // a weekday: only night shift or pure line 18 are admitted
  categories: Object.freeze({ A: 98, B: 0, C: 0, D: 0, E: 0 }),
  reasons: Object.freeze({ NOT_ELIGIBLE: 98 }),
  lineLessSegments: 60, lineLessSegmentsThatAreDeadheads: 60,
  withoutServiceNumber: 0
});

// ===== A. every NOT_APPLICABLE has a traceable reason =====
test('A: the audit accounts for every unit', () => {
  assert.equal(AUDIT.passed + AUDIT.inconclusive + AUDIT.notApplicable, AUDIT.units);
  assert.equal(Object.values(AUDIT.categories).reduce((a, b) => a + b, 0), AUDIT.notApplicable);
});
test('A: all 98 carry the SAME, stated reason', () => {
  assert.deepEqual(Object.keys(AUDIT.reasons), ['NOT_ELIGIBLE']);
  assert.equal(AUDIT.reasons.NOT_ELIGIBLE, AUDIT.notApplicable, 'not one of them is unexplained');
});
test('A: and every one of them is attributed to a duty', () => {
  assert.equal(AUDIT.withoutServiceNumber, 0, 'an unattributed unit would be INCONCLUSIVE, not out of scope');
});
test('A: a plain weekday duty is NOT_APPLICABLE with exactly that reason', () => {
  const r = run([circulation('12100', [segment('2211', '12', 480, 300)])], { 2211: 8 * 60 });
  assert.equal(only(r).status, 'NOT_APPLICABLE');
  assert.equal(only(r).eligibilityReason, 'NOT_ELIGIBLE');
  assert.equal(only(r).requiredMinutes, null, 'no quota is derived for a duty outside the scope');
});

// ===== B. no pure line-18 duty falls out =====
test('B: the audit found no pure line-18 duty among the 98', () => {
  assert.equal(AUDIT.categories.B, 0);
});
test('B: a pure line-18 duty is admitted, never NOT_APPLICABLE', () => {
  const r = run([circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150)])],
    { 2221: 4 * 60 + 52 }, [turnaround('t', '18100', 452, 68)]);
  assert.notEqual(only(r).status, 'NOT_APPLICABLE');
  assert.equal(only(r).eligibilityReason, 'PURE_LINE_18');
});
test('B: a deadhead run without a line does not break that admission', () => {
  // All 60 line-less segments in the real plan are deadhead runs (Phase 3I.13: they are ordinary
  // segments). A pure line-18 duty with depot runs must still be admitted.
  const r = run([circulation('18100', [segment('2221', null, 296, 6, 'deadhead'), segment('2221', '18', 302, 150),
    segment('2221', '18', 520, 150), segment('2221', null, 670, 6, 'deadhead')])],
    { 2221: 4 * 60 + 52 }, [turnaround('t', '18100', 452, 68)]);
  assert.equal(only(r).eligibilityReason, 'PURE_LINE_18', 'a depot run carries no line and is not another line');
});

// ===== C. no night shift falls out =====
test('C: the audit found no night shift among the 98', () => {
  assert.equal(AUDIT.categories.C, 0);
});
test('C: a duty starting at the threshold is admitted', () => {
  const r = run([circulation('10901', [segment('2299', '10', 1306, 120), segment('2299', '10', 1470, 118)])],
    { 2299: NIGHT_THRESHOLD }, [turnaround('t', '10901', 1426, 44)]);
  assert.equal(only(r).eligibilityReason, 'NIGHT_SHIFT', 'the threshold itself is inclusive');
  assert.notEqual(only(r).status, 'NOT_APPLICABLE');
});
test('C: one minute earlier is a day duty and correctly out of scope', () => {
  const r = run([circulation('10901', [segment('2298', '10', 1306, 120)])], { 2298: NIGHT_THRESHOLD - 1 });
  assert.equal(only(r).status, 'NOT_APPLICABLE');
  assert.equal(only(r).eligibilityReason, 'NOT_ELIGIBLE');
});

// ===== D. an incomplete attribution never becomes NOT_APPLICABLE =====
test('D: the audit found no incomplete attribution among the 98', () => {
  assert.equal(AUDIT.categories.D, 0, 'no unit was dismissed while its line attribution was open');
});
test('D: every line-less segment in the real plan is a deadhead run', () => {
  assert.equal(AUDIT.lineLessSegmentsThatAreDeadheads, AUDIT.lineLessSegments,
    'not one SERVICE trip is missing its line — the attribution is complete throughout');
});
test('D: a SERVICE trip without a line makes the unit inconclusive, not out of scope', () => {
  const r = run([circulation('12100', [segment('2211', '12', 480, 150), segment('2211', null, 640, 150)])], { 2211: 8 * 60 });
  assert.equal(only(r).status, 'INCONCLUSIVE', 'an open question is never answered as "out of scope"');
  assert.notEqual(only(r).status, 'NOT_APPLICABLE');
});

// ===== E. a mixed line-18 duty is not admitted =====
test('E: the audit found no mixed line-18 duty among the 98', () => {
  assert.equal(AUDIT.categories.E, 0, 'the real plan holds none — line 18 runs pure here');
});
test('E: line 18 mixed with another line grants no admission', () => {
  const r = run([circulation('A', [segment('2250', '18', 480, 200), segment('2250', '5', 700, 158)])], { 2250: 8 * 60 });
  assert.notEqual(only(r).eligibilityReason, 'PURE_LINE_18', 'the admission needs a PURE duty');
  assert.equal(only(r).requiredMinutes, null, 'and no quota is derived from a reduced basis');
});
test('E: a night shift on mixed lines is still admitted — by its start, not by its lines', () => {
  const r = run([circulation('A', [segment('3301', '10', 1300, 100), segment('3301', '16', 1450, 100)])],
    { 3301: 19 * 60 + 30 }, [turnaround('t', 'A', 1400, 50)]);
  assert.equal(only(r).eligibilityReason, 'NIGHT_SHIFT');
});

// ===== F. the rule computation is unchanged =====
test('F: this phase changed no rule, config, validator, matcher or timeline', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js']) {
    assert.doesNotMatch(src(path), /3I\.25/, `${path} must carry no Phase 3I.25 change`);
  }
});
test('F: the rule set stays approved and disabled', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});
test('F: the three admitted duties still reach a verdict', () => {
  // The counterpart to the 98: what the audit says is IN scope must stay assessable.
  const r = run([
    circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150),
      segment('2278', '18', 772, 150), segment('2278', '18', 990, 150)]),
    circulation('10901', [segment('2299', '10', 1306, 120), segment('2299', '10', 1470, 118)])
  ], { 2221: 292, 2278: 762, 2299: 21 * 60 + 36 },
  [turnaround('t1', '18100', 452, 68), turnaround('t2', '18100', 922, 68), turnaround('t3', '10901', 1426, 44)]);
  const assessed = r.services.filter(s => ['PASS', 'FAIL'].includes(s.status));
  assert.equal(assessed.length, 3);
  assert.deepEqual(assessed.map(s => s.serviceNumber).sort(), ['2221', '2278', '2299']);
});
