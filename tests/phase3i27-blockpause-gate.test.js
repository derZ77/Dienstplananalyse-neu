import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.27 – the BLOCK BREAK gate.
//
// Professional correction: the JNV 1/6 rule applies ONLY to duties WITHOUT a block break. A duty
// that carries a block break conforming to the collective agreement is not a 1/6 duty at all — it
// is out of scope before any eligibility question is even asked.
//
//   block break = at least 30 minutes (the same threshold BV010 already uses)
//
// The gate comes FIRST: no quota, no requirement, no turnaround crediting. Everything downstream
// of it — the line-18 admission, the night-shift admission, the ceiling, the 11-minute rule,
// deadhead handling — is untouched.
import { evaluateOneSixthRule, BLOCK_BREAK_MINIMUM_MINUTES } from '../js/v2/analysis/one-sixth-rule.js';

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

const segment = (serviceNumber, line, startMinutes, durationMinutes) => ({
  serviceNumber, kind: 'service', line, startMinutes, endMinutes: startMinutes + durationMinutes,
  durationMinutes, source: { serviceNumber, activityIndex: null, sourceType: 'umlauftafel' }
});
const circulation = (code, drivingSegments) => ({
  code, drivingSegments, drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
  services: [...new Set(drivingSegments.map(s => s.serviceNumber).filter(Boolean))],
  statistics: { drivingMinutes: drivingSegments.reduce((t, s) => t + s.durationMinutes, 0) }, warnings: []
});
const turnaround = (id, code, from, span) => ({ id, circulationCode: code, startMinutes: from, endMinutes: from + span, observedSpanMinutes: span, creditedMinutes: span, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: [] });
// A pure line-18 duty of 300 driving minutes with a 68-minute turnaround — PASS without a break.
const PURE_18 = (serviceNumber = '2221', code = '18100', from = 302) =>
  circulation(code, [segment(serviceNumber, '18', from, 150), segment(serviceNumber, '18', from + 218, 150)]);
const CREDIT = (code = '18100', from = 302) => turnaround(`t-${code}`, code, from + 150, 68);

const run = (circulations, { serviceStarts = {}, blockBreaks = {}, candidates = [] } = {}) => evaluateOneSixthRule({
  drivingProjection: { metadata: { serviceRegime: 'unknown', dayType: 'mo_do', dutyStartTime: null, circulationCount: circulations.length }, circulations, warnings: [] },
  turnaroundDetection: { status: 'complete', candidates },
  ruleConfig: CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: null, serviceStarts, blockBreaks }
});
const forService = (result, serviceNumber) => result.services.find(s => s.serviceNumber === serviceNumber);

// ===== A. a duty WITHOUT a block break is assessed exactly as before =====
test('A: without a block break the existing assessment is unchanged', () => {
  const r = run([PURE_18()], { serviceStarts: { 2221: 292 }, candidates: [CREDIT()] });
  const duty = forService(r, '2221');
  assert.equal(duty.status, 'PASS');
  assert.equal(duty.eligibilityReason, 'PURE_LINE_18');
  assert.equal(duty.drivingMinutes, 300);
  assert.equal(duty.requiredMinutes, 50, 'ceil(300/6) — the ceiling is untouched');
  assert.equal(duty.creditedMinutes, 68);
});
test('A: an absent block-break input changes nothing at all', () => {
  const withInput = run([PURE_18()], { serviceStarts: { 2221: 292 }, blockBreaks: {}, candidates: [CREDIT()] });
  const withoutInput = run([PURE_18()], { serviceStarts: { 2221: 292 }, candidates: [CREDIT()] });
  assert.deepEqual(withInput.services[0], withoutInput.services[0]);
});
test('A: a night shift without a block break stays admitted', () => {
  const r = run([circulation('10901', [segment('2299', '10', 1306, 120), segment('2299', '10', 1470, 118)])],
    { serviceStarts: { 2299: 21 * 60 + 36 }, candidates: [turnaround('t', '10901', 1426, 44)] });
  assert.equal(forService(r, '2299').eligibilityReason, 'NIGHT_SHIFT');
  assert.equal(forService(r, '2299').status, 'PASS');
});

// ===== B. exactly 30 minutes is a block break =====
test('B: the threshold is 30 minutes', () => {
  assert.equal(BLOCK_BREAK_MINIMUM_MINUTES, 30, 'the same value BV010 uses for a Blockpause');
});
test('B: a 30-minute block break makes the duty NOT_APPLICABLE', () => {
  const r = run([PURE_18()], { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: 30 }, candidates: [CREDIT()] });
  const duty = forService(r, '2221');
  assert.equal(duty.status, 'NOT_APPLICABLE');
  assert.equal(duty.eligibilityReason, 'BLOCKPAUSE_PRESENT');
});
test('B: and no quota of any kind is derived for it', () => {
  const duty = forService(run([PURE_18()], { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: 30 }, candidates: [CREDIT()] }), '2221');
  assert.equal(duty.drivingMinutes, null, 'no basis');
  assert.equal(duty.requiredMinutes, null, 'no requirement');
  assert.equal(duty.deficitMinutes, null, 'no deficit');
  assert.equal(duty.creditedMinutes, 0, 'no turnaround is credited to a duty outside the scope');
  assert.deepEqual(duty.violations, []);
});
test('B: the gate wins over the line-18 admission', () => {
  // The duty WOULD be admitted as a pure line-18 duty. The block break decides first.
  const duty = forService(run([PURE_18()], { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: 30 }, candidates: [CREDIT()] }), '2221');
  assert.notEqual(duty.eligibilityReason, 'PURE_LINE_18');
  assert.equal(duty.eligibilityReason, 'BLOCKPAUSE_PRESENT');
});
test('B: the gate wins over the night-shift admission too', () => {
  const r = run([circulation('10901', [segment('2299', '10', 1306, 120), segment('2299', '10', 1470, 118)])],
    { serviceStarts: { 2299: 21 * 60 + 36 }, blockBreaks: { 2299: 45 }, candidates: [turnaround('t', '10901', 1426, 44)] });
  assert.equal(forService(r, '2299').eligibilityReason, 'BLOCKPAUSE_PRESENT');
  assert.equal(forService(r, '2299').status, 'NOT_APPLICABLE');
});

// ===== C. more than 30 minutes =====
test('C: a longer block break is a block break as well', () => {
  for (const minutes of [31, 45, 60, 120]) {
    const duty = forService(run([PURE_18()], { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: minutes }, candidates: [CREDIT()] }), '2221');
    assert.equal(duty.status, 'NOT_APPLICABLE', `${minutes} min must close the rule`);
    assert.equal(duty.eligibilityReason, 'BLOCKPAUSE_PRESENT');
  }
});

// ===== D. below 30 minutes is not a block break =====
test('D: an interruption under 30 minutes leaves the rule active', () => {
  for (const minutes of [1, 15, 29]) {
    const duty = forService(run([PURE_18()], { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: minutes }, candidates: [CREDIT()] }), '2221');
    assert.equal(duty.status, 'PASS', `${minutes} min is no block break`);
    assert.equal(duty.eligibilityReason, 'PURE_LINE_18');
  }
});
test('D: an unusable value is never read as a block break', () => {
  for (const value of [null, undefined, NaN, -30, 'lang']) {
    const duty = forService(run([PURE_18()], { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: value }, candidates: [CREDIT()] }), '2221');
    assert.equal(duty.eligibilityReason, 'PURE_LINE_18', `${String(value)} must not close the rule`);
  }
});

// ===== E. a block break across midnight =====
test('E: a break spanning midnight is measured by its duration, not by its clock values', () => {
  // 23:50 → 00:35 of the next day = 45 minutes. The caller hands in absolute minutes (Phase 3I.23
  // resolves the operational day), so the crossing is already accounted for.
  const across = (1440 + 35) - (23 * 60 + 50);
  assert.equal(across, 45);
  const r = run([circulation('10901', [segment('2299', '10', 1306, 120), segment('2299', '10', 1470, 118)])],
    { serviceStarts: { 2299: 21 * 60 + 36 }, blockBreaks: { 2299: across }, candidates: [turnaround('t', '10901', 1426, 44)] });
  assert.equal(forService(r, '2299').eligibilityReason, 'BLOCKPAUSE_PRESENT');
});
test('E: a 29-minute break across midnight is still no block break', () => {
  const across = (1440 + 19) - (23 * 60 + 50);
  assert.equal(across, 29);
  const r = run([circulation('10901', [segment('2299', '10', 1306, 120), segment('2299', '10', 1470, 118)])],
    { serviceStarts: { 2299: 21 * 60 + 36 }, blockBreaks: { 2299: across }, candidates: [turnaround('t', '10901', 1426, 44)] });
  assert.equal(forService(r, '2299').eligibilityReason, 'NIGHT_SHIFT');
});

// ===== F. a duty running several circulations =====
test('F: one circulation with a block break closes the WHOLE duty', () => {
  // The break belongs to the DUTY, not to a circulation — every unit of that duty is out of scope.
  const r = run([PURE_18('2221', '18100', 302), PURE_18('2221', '18200', 800)],
    { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: 45 }, candidates: [CREDIT('18100', 302), CREDIT('18200', 800)] });
  const units = r.services.filter(s => s.serviceNumber === '2221');
  assert.equal(units.length, 2, 'both circulations of the duty are present');
  assert.ok(units.every(u => u.status === 'NOT_APPLICABLE'), 'and both are out of scope');
  assert.ok(units.every(u => u.eligibilityReason === 'BLOCKPAUSE_PRESENT'));
});
test('F: a neighbouring duty without a break is untouched', () => {
  const r = run([PURE_18('2221', '18100', 302), PURE_18('2278', '18200', 800)],
    { serviceStarts: { 2221: 292, 2278: 790 }, blockBreaks: { 2221: 45 }, candidates: [CREDIT('18100', 302), CREDIT('18200', 800)] });
  assert.equal(forService(r, '2221').eligibilityReason, 'BLOCKPAUSE_PRESENT');
  assert.equal(forService(r, '2278').status, 'PASS', 'the block break of one duty never touches another');
  assert.equal(forService(r, '2278').eligibilityReason, 'PURE_LINE_18');
});
test('F: a unit without a duty number is never closed by somebody else\'s break', () => {
  const r = run([circulation('18100', [segment('2221', '18', 302, 300), segment(null, null, 800, 300)])],
    { serviceStarts: { 2221: 292 }, blockBreaks: { 2221: 45 } });
  assert.equal(forService(r, '2221').eligibilityReason, 'BLOCKPAUSE_PRESENT');
  const unattributed = r.services.find(s => s.serviceNumber === null);
  assert.notEqual(unattributed.eligibilityReason, 'BLOCKPAUSE_PRESENT', 'no break is attributed to an unattributed unit');
});

// ===== G. nothing else was touched =====
test('G: matcher, joint timeline, projection and config carry no Phase 3I.27 change', () => {
  for (const path of ['../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/analysis/driving-projection.js', '../js/v2/identity/operational-circuit-identity.js']) {
    assert.doesNotMatch(src(path), /3I\.27|BLOCKPAUSE/, `${path} must be untouched`);
  }
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false, 'still not activated');
});
test('G: the gate is the FIRST unit step of the eligibility chain', () => {
  const rule = src('../js/v2/analysis/one-sixth-rule.js');
  const steps = /ELIGIBILITY_STEPS = Object\.freeze\(\[([^\]]+)\]/.exec(rule)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.ok(steps.includes('blockBreak'));
  assert.ok(steps.indexOf('blockBreak') < steps.indexOf('dayType'), 'it decides before any other unit question');
});
