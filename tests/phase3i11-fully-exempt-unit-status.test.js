import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.11 – a unit the eligibility chain already ruled out never receives a quota. Before this
// phase a fully excepted unit standing NEXT TO a regular one was evaluated with an empty basis and
// came out as PASS with 0/0. It must be NOT_APPLICABLE with an unknown (null) basis instead.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthEvaluation } from '../js/v2/analysis/one-sixth-validation.js';

const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const segment = (code, s, i) => ({
  serviceNumber: `21${code.slice(-2)}`, kind: 'service', line: s.line,
  startMinutes: i * 600, endMinutes: Number.isFinite(s.duration) ? i * 600 + s.duration : null,
  durationMinutes: s.duration, source: { serviceNumber: `21${code.slice(-2)}`, activityIndex: i, sourceType: 'pdf' }
});
const circulation = (code, segments) => ({
  code, drivingSegments: segments.map((s, i) => segment(code, s, i)),
  drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
  statistics: {
    drivingMinutes: segments.reduce((total, s) => total + (Number.isFinite(s.duration) ? s.duration : 0), 0),
    nonDrivingMinutes: 0, knownTotalMinutes: 0
  },
  warnings: []
});
const projection = (units) => ({
  metadata: { serviceRegime: 'school', dayType: 'saturday', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: units.length },
  circulations: units.map(u => circulation(u.code, u.segments)),
  warnings: []
});
const candidate = (over) => ({
  id: over.id, circulationCode: over.code,
  previousSegmentRef: { circulationCode: over.code, sequence: 1, type: 'service_trip', line: over.from },
  nextSegmentRef: { circulationCode: over.code, sequence: 2, type: 'service_trip', line: over.to },
  startMinutes: 360, endMinutes: 360 + over.credited, observedSpanMinutes: over.credited,
  creditedMinutes: over.credited, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
});
const detection = (candidates) => ({ status: 'complete', candidates, warnings: [], statistics: { candidateCount: candidates.length } });

const run = (units, candidates = []) => evaluateOneSixthRule({
  drivingProjection: projection(units), turnaroundDetection: detection(candidates),
  ruleConfig: CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: null, serviceStarts: {} }
});
// A regular unit that reaches its quota, so the excepted unit is never alone in the result.
const REGULAR_PASS = { code: '11200', segments: [{ line: '12', duration: 396 }] };
const REGULAR_CANDIDATE = candidate({ id: 'c#regular', code: '11200', from: '12', to: '12', credited: 66 });
const EXEMPT = { code: '11100', segments: [{ line: '18', duration: 396 }] };

const unit = (result, code) => result.services.find(s => s.circulationCode === code);

// SUPERSEDED BY PHASE 3I.15b: a "fully excepted unit" no longer exists — line 18 ADMITS a duty.
// The protected statement of this file survives unchanged in substance: a unit the eligibility
// chain ruled out never receives a quota, and it never becomes a PASS with a 0/0 basis. Only the
// WAY a unit is ruled out changed: the day type, not the line.
// The shared helper derives the service number from the circulation code, so this file builds its
// own circulations: the day-type ground needs two DIFFERENT duty starts in one document.
const ownCirculation = (code, segments) => ({
  code,
  drivingSegments: segments.map((s, i) => ({
    serviceNumber: s.service, kind: 'service', line: s.line,
    startMinutes: i * 600, endMinutes: Number.isFinite(s.duration) ? i * 600 + s.duration : null,
    durationMinutes: s.duration, source: { serviceNumber: s.service, activityIndex: i, sourceType: 'pdf' }
  })),
  drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
  statistics: {
    drivingMinutes: segments.reduce((t, s) => t + (Number.isFinite(s.duration) ? s.duration : 0), 0),
    nonDrivingMinutes: 0, knownTotalMinutes: 0
  },
  warnings: []
});
const MON_FRI = (units, starts) => ({
  drivingProjection: {
    metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: units.length },
    circulations: units.map(u => ownCirculation(u.code, u.segments)), warnings: []
  },
  turnaroundDetection: detection([REGULAR_CANDIDATE]),
  ruleConfig: CONFIG, context: CONTEXT,
  eligibility: { dutyStartMinutes: null, serviceStarts: starts }
});
// 2101 is an ordinary weekday day duty → ruled out; 2102 is a night shift → admitted.
const OUT_OF_SCOPE = { code: '11100', segments: [{ line: '12', duration: 396, service: '2101' }] };
const ADMITTED = { code: '11200', segments: [{ line: '12', duration: 396, service: '2102' }] };
const STARTS = { 2101: 5 * 60, 2102: 19 * 60 + 20 };
const mixedRun = () => evaluateOneSixthRule(MON_FRI([OUT_OF_SCOPE, ADMITTED], STARTS));

// ===== the corrected unit status =====
test('a unit ruled out by the day type is NOT_APPLICABLE, not PASS', () => {
  const s = unit(mixedRun(), '11100');
  assert.equal(s.status, 'NOT_APPLICABLE');
  assert.notEqual(s.status, 'PASS');
});
test('the ruled-out unit carries no quota at all', () => {
  const s = unit(mixedRun(), '11100');
  assert.equal(s.drivingMinutes, null, 'no basis — not a known 0');
  assert.equal(s.requiredMinutes, null);
  assert.equal(s.deficitMinutes, null);
});
test('the ruled-out unit produces no violation', () => {
  const r = mixedRun();
  assert.deepEqual(unit(r, '11100').violations, []);
});
test('the ruled-out unit states a machine-readable reason', () => {
  const r = mixedRun();
  assert.ok(unit(r, '11100').warnings.includes('DAY_TYPE_NOT_ELIGIBLE'));
  assert.ok(r.warnings.some(w => w.code === 'DAY_TYPE_NOT_ELIGIBLE' && w.circulationCode === '11100'));
});
test('the ruled-out unit records WHY it was not admitted', () => {
  assert.equal(unit(mixedRun(), '11100').eligibilityReason, 'NOT_ELIGIBLE');
});
test('credited minutes stay a finite number on the ruled-out unit', () => {
  assert.equal(unit(mixedRun(), '11100').creditedMinutes, 0);
});
test('SUPERSEDED BY PHASE 3I.15b: a pure line-18 unit is ADMITTED instead of dismissed', () => {
  const pure = { code: '11300', segments: [{ line: '18', duration: 396, service: '2103' }] };
  const r = evaluateOneSixthRule(MON_FRI([pure], { 2103: 5 * 60 }));
  assert.notEqual(r.status, 'NOT_APPLICABLE', 'line 18 admits it');
  assert.equal(r.services[0].drivingMinutes, 396, 'its whole driving time');
  assert.equal(r.services[0].eligibilityReason, 'PURE_LINE_18');
});

// ===== the admitted unit is untouched by the ruled-out one =====
test('the admitted unit keeps its own quota', () => {
  const s = unit(mixedRun(), '11200');
  assert.equal(s.drivingMinutes, 396);
  assert.equal(s.requiredMinutes, 66, 'ceil(396/6)');
  assert.equal(s.eligibilityReason, 'NIGHT_SHIFT');
});
test('a ruled-out unit contributes nothing to the totals', () => {
  const r = mixedRun();
  assert.equal(r.statistics.totalDrivingMinutes, 396, 'only the admitted unit');
  assert.equal(r.statistics.totalRequiredMinutes, 66);
  for (const value of Object.values(r.statistics)) assert.ok(Number.isFinite(value), 'no NaN, no Infinity');
});

// ===== the validator =====
test('the corrected evaluation passes the evaluation validator', () => {
  assert.deepEqual(validateOneSixthEvaluation(mixedRun(), CONFIG).errors, []);
});
test('the validator rejects a not-applicable unit that still carries a quota', () => {
  const r = mixedRun();
  const broken = { ...r, services: r.services.map(s => s.circulationCode === '11100'
    ? { ...s, drivingMinutes: 396, requiredMinutes: 66, deficitMinutes: 66 } : s) };
  const codes = validateOneSixthEvaluation(broken, CONFIG).errors.map(e => e.code);
  assert.ok(codes.includes('NOT_APPLICABLE_WITH_QUOTA'));
});
test('the validator demands a reason for a not-applicable unit', () => {
  const r = mixedRun();
  const broken = { ...r, services: r.services.map(s => s.circulationCode === '11100' ? { ...s, warnings: [] } : s) };
  const codes = validateOneSixthEvaluation(broken, CONFIG).errors.map(e => e.code);
  assert.ok(codes.includes('NOT_APPLICABLE_WITHOUT_REASON'));
});
test('the validator still rejects a violation on a not-applicable unit', () => {
  const r = mixedRun();
  const broken = { ...r, services: r.services.map(s => s.circulationCode === '11100'
    ? { ...s, violations: [{ ruleId: 'BV015_BV018', severity: 'VIOLATION' }] } : s) };
  const codes = validateOneSixthEvaluation(broken, CONFIG).errors.map(e => e.code);
  assert.ok(codes.includes('VIOLATION_WITHOUT_FAIL'));
});
test('SUPERSEDED BY PHASE 3I.15b: the validator rejects a quota reduction attributed to a line', () => {
  const r = mixedRun();
  const broken = { ...r, services: r.services.map(s => ({ ...s, exceptedDrivingMinutes: 100 })) };
  const codes = validateOneSixthEvaluation(broken, CONFIG).errors.map(e => e.code);
  assert.ok(codes.includes('LINE_EXCEPTION_REDUCES_QUOTA'));
});
test('an inconclusive unit keeps its existing contract untouched', () => {
  const unknown = { code: '11200', segments: [{ line: '12', duration: null, service: '2102' }] };
  const s = unit(evaluateOneSixthRule(MON_FRI([OUT_OF_SCOPE, unknown], STARTS)), '11200');
  assert.equal(s.status, 'INCONCLUSIVE', 'unchanged since Phase 3I.7');
  assert.equal(s.drivingMinutes, null);
  assert.ok(s.warnings.includes('DRIVING_TIME_UNAVAILABLE'));
});
