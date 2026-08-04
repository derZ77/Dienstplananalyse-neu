import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.15b – the corrected contract: line 18 is an ADMISSION GROUND, not a calculation
// exception. A duty whose entire driving performance is line 18 is admitted to the 1/6 check and
// then assessed IN FULL. A mixed duty gets no line-18 admission at all.
import {
  evaluateOneSixthEligibility, evaluateOneSixthRule,
  ELIGIBILITY_STATUS, ELIGIBILITY_REASON, LINE_18_CLASSIFICATION
} from '../js/v2/analysis/one-sixth-rule.js';

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

const circulation = (code, segments) => ({
  code,
  drivingSegments: segments.map((s, i) => ({
    serviceNumber: s.service ?? '2221', kind: s.kind ?? 'service', line: s.line,
    startMinutes: i * 600, endMinutes: Number.isFinite(s.duration) ? i * 600 + s.duration : null,
    durationMinutes: s.duration, source: { serviceNumber: s.service ?? '2221', activityIndex: i, sourceType: 'pdf' }
  })),
  drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
  statistics: {
    drivingMinutes: segments.reduce((t, s) => t + (Number.isFinite(s.duration) ? s.duration : 0), 0),
    nonDrivingMinutes: 0, knownTotalMinutes: 0
  },
  warnings: []
});
const projection = (dayType, units) => ({
  metadata: { serviceRegime: 'school', dayType, dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: units.length },
  circulations: units.map(u => circulation(u.code, u.segments)),
  warnings: []
});
const candidate = (over) => ({
  id: over.id ?? 'c#1', circulationCode: over.code ?? 'A',
  previousSegmentRef: { circulationCode: over.code ?? 'A', sequence: 1, type: 'service_trip', line: over.from },
  nextSegmentRef: { circulationCode: over.code ?? 'A', sequence: 2, type: 'service_trip', line: over.to },
  startMinutes: 360, endMinutes: 360 + over.credited, observedSpanMinutes: over.credited,
  creditedMinutes: over.credited, source: 'umlauftafel', confidence: over.confidence ?? 'exact',
  eligibility: over.eligibility ?? 'qualified', warnings: []
});
const detection = (candidates = []) => ({ status: 'complete', candidates, warnings: [], statistics: { candidateCount: candidates.length } });
const eligibilityInput = (starts = {}) => ({ dutyStartMinutes: null, serviceStarts: starts });

const verdict = (dayType, units, starts) => evaluateOneSixthEligibility({
  drivingProjection: projection(dayType, units), ruleConfig: CONFIG, context: CONTEXT, eligibility: eligibilityInput(starts)
});
const rule = (dayType, units, candidates = [], starts = {}) => evaluateOneSixthRule({
  drivingProjection: projection(dayType, units), turnaroundDetection: detection(candidates),
  ruleConfig: CONFIG, context: CONTEXT, eligibility: eligibilityInput(starts)
});
const unitOf = (result, code) => result.circulations.find(c => c.circulationCode === code);

const L18 = (duration, over = {}) => ({ line: '18', duration, ...over });
const LINE = (line, duration, over = {}) => ({ line, duration, ...over });
const DEADHEAD = (duration) => ({ kind: 'deadhead', line: null, duration });

// ===== 1. Mon–Fri, a pure line-18 duty is admitted and assessed =====
test('a Mon–Fri duty running only line 18 is eligible with reason PURE_LINE_18', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(358)] }]);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS);
  const unit = unitOf(r, 'A');
  assert.equal(unit.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unit.eligibilityReason, ELIGIBILITY_REASON.PURE_LINE_18);
  assert.equal(unit.line18Classification, LINE_18_CLASSIFICATION.PURE_LINE_18_ONLY);
});
test('the real reference duty 2221 is assessed instead of dismissed', () => {
  // 358 driving minutes → ceil(358/6) = 60 required; 112 credited turnaround minutes → PASS.
  const r = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [candidate({ from: '18', to: '18', credited: 112 })]);
  const service = r.services[0];
  assert.equal(service.status, 'PASS');
  assert.notEqual(service.status, 'NOT_APPLICABLE');
  assert.equal(service.drivingMinutes, 358, 'the whole duty, nothing removed');
  assert.equal(service.requiredMinutes, 60, 'ceil(358/6)');
  assert.equal(service.creditedMinutes, 112);
  assert.equal(r.status, 'PASS');
});
test('the line-18 duty carries no exception bookkeeping any more', () => {
  const service = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [candidate({ from: '18', to: '18', credited: 112 })]).services[0];
  assert.ok(!('exceptedDrivingMinutes' in service), 'line 18 never reduces the basis');
  assert.ok(!('exceptedSegmentCount' in service));
  assert.ok(!('exceptedSegmentIndexes' in service));
});

// ===== 2. Mon–Fri, line 18 mixed with another line is NOT admitted =====
test('a Mon–Fri duty mixing line 18 with line 10 is not admitted through line 18', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(200), LINE('10', 158)] }], { 2221: 5 * 60 });
  const unit = unitOf(r, 'A');
  assert.equal(unit.line18Classification, LINE_18_CLASSIFICATION.MIXED_WITH_OTHER_LINES);
  assert.equal(unit.status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
  assert.equal(unit.eligibilityReason, ELIGIBILITY_REASON.NOT_ELIGIBLE);
});
test('a Mon–Fri duty mixing line 18 with line 5 is not admitted either', () => {
  const r = rule('mo_fr', [{ code: 'A', segments: [L18(200), LINE('5', 158)] }], [], { 2221: 5 * 60 });
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.deepEqual(r.violations, []);
});
test('the mixed duty is not silently assessed with a reduced basis', () => {
  // SUPERSEDED BY PHASE 3I.24: the unit is no longer discarded — it keeps its OWN undecidable
  // verdict. What still must hold: no quota is derived from a reduced basis.
  const r = rule('mo_fr', [{ code: 'A', segments: [L18(200), LINE('5', 158)] }], [], { 2221: 5 * 60 });
  assert.equal(r.services.length, 1);
  assert.equal(r.services[0].status, 'NOT_APPLICABLE');
  assert.equal(r.services[0].drivingMinutes, null, 'no quota at all — not a line-5-only quota');
  assert.equal(r.services[0].requiredMinutes, null);
});

// ===== 3. Mon–Fri night shift, mixed lines allowed =====
test('a Mon–Fri night shift is eligible with reason NIGHT_SHIFT even across mixed lines', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [LINE('10', 200, { service: '3301' }), LINE('16', 158, { service: '3301' })] }], { 3301: 19 * 60 + 30 });
  const unit = unitOf(r, 'A');
  assert.equal(unit.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unit.eligibilityReason, ELIGIBILITY_REASON.NIGHT_SHIFT);
  assert.equal(unit.line18Classification, LINE_18_CLASSIFICATION.MIXED_WITH_OTHER_LINES, 'classified, but irrelevant here');
});
test('the night-shift boundary stays inclusive at 19:20', () => {
  const at = verdict('mo_fr', [{ code: 'A', segments: [LINE('10', 358, { service: '3301' })] }], { 3301: 19 * 60 + 20 });
  const before = verdict('mo_fr', [{ code: 'A', segments: [LINE('10', 358, { service: '3301' })] }], { 3301: 19 * 60 + 19 });
  assert.equal(unitOf(at, 'A').status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unitOf(before, 'A').status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
});
test('an ordinary Mon–Fri day duty stays outside the rule', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [LINE('10', 358, { service: '3301' })] }], { 3301: 5 * 60 });
  assert.equal(unitOf(r, 'A').status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
  assert.equal(unitOf(r, 'A').eligibilityReason, ELIGIBILITY_REASON.NOT_ELIGIBLE);
});
test('a pure line-18 duty needs no known duty start', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(358)] }], {});
  assert.equal(unitOf(r, 'A').status, ELIGIBILITY_STATUS.PASS, 'admission does not depend on the night shift');
  assert.equal(unitOf(r, 'A').eligibilityReason, ELIGIBILITY_REASON.PURE_LINE_18);
});

// ===== 4. Several blocks / circulations, all line 18 =====
test('a line-18 duty spread over several blocks stays pure and is assessed as one duty', () => {
  const r = rule('mo_fr', [{ code: 'A', segments: [L18(120), L18(118), L18(120)] }], [candidate({ from: '18', to: '18', credited: 112 })]);
  const service = r.services[0];
  assert.equal(service.status, 'PASS');
  assert.equal(service.drivingMinutes, 358, '120 + 118 + 120');
  assert.equal(service.requiredMinutes, 60);
});
test('several circulations of the same pure line-18 duty are each admitted', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(180)] }, { code: 'B', segments: [L18(178)] }]);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS);
  for (const code of ['A', 'B']) {
    assert.equal(unitOf(r, code).eligibilityReason, ELIGIBILITY_REASON.PURE_LINE_18);
  }
});
test('one mixed unit does not remove the admission of a pure one', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(180)] }, { code: 'B', segments: [LINE('5', 178)] }], { 2221: 5 * 60 });
  assert.equal(unitOf(r, 'A').status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unitOf(r, 'B').status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
});

// ===== 5. A deadhead run does not break the purity, and it counts =====
test('a deadhead run without a line does not prevent PURE_LINE_18', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [DEADHEAD(30), L18(328)] }]);
  const unit = unitOf(r, 'A');
  assert.equal(unit.line18Classification, LINE_18_CLASSIFICATION.PURE_LINE_18_ONLY);
  assert.equal(unit.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unit.eligibilityReason, ELIGIBILITY_REASON.PURE_LINE_18);
});
test('the deadhead minutes count towards the driving time of the admitted duty', () => {
  const service = rule('mo_fr', [{ code: 'A', segments: [DEADHEAD(30), L18(328)] }], [candidate({ from: '18', to: '18', credited: 112 })]).services[0];
  assert.equal(service.drivingMinutes, 358, '30 + 328 — the deadhead run is driving time (Phase 3I.12/3I.13)');
  assert.equal(service.requiredMinutes, 60);
  assert.equal(service.status, 'PASS');
});
test('a duty of deadhead runs only is not admitted through line 18', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [DEADHEAD(30), DEADHEAD(20)] }], { 2221: 5 * 60 });
  const unit = unitOf(r, 'A');
  assert.equal(unit.line18Classification, LINE_18_CLASSIFICATION.NO_LINE_INFORMATION);
  assert.equal(unit.status, ELIGIBILITY_STATUS.NOT_APPLICABLE, 'no line-18 performance to admit it');
});

// ===== 6. An unattributable line trip is undecidable =====
test('line 18 next to a line trip without a line is inconclusive', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(200), { kind: 'service', line: null, duration: 158 }] }]);
  const unit = unitOf(r, 'A');
  assert.equal(unit.status, ELIGIBILITY_STATUS.INCONCLUSIVE, 'purity cannot be proven');
  assert.equal(unit.eligibilityReason, ELIGIBILITY_REASON.SEGMENT_LINE_AMBIGUOUS);
  assert.notEqual(unit.line18Classification, LINE_18_CLASSIFICATION.PURE_LINE_18_ONLY);
});
test('the inconclusive duty reaches no verdict and no violation', () => {
  const r = rule('mo_fr', [{ code: 'A', segments: [L18(200), { kind: 'service', line: null, duration: 158 }] }]);
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.deepEqual(r.violations, []);
});
test('an unknown segment kind without a line is not assumed to be line 18', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(200), { kind: 'unknown', line: null, duration: 158 }] }]);
  assert.equal(unitOf(r, 'A').status, ELIGIBILITY_STATUS.INCONCLUSIVE);
});

// ===== 7. Line-18 turnarounds are ordinary turnarounds =====
test('an 18 ↔ 18 turnaround is credited like any other', () => {
  const service = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [candidate({ from: '18', to: '18', credited: 112 })]).services[0];
  assert.equal(service.creditedMinutes, 112, 'no longer discarded');
  assert.equal(service.creditedTurnaroundCount, 1);
  assert.equal(service.status, 'PASS');
});
test('several line-18 turnarounds add up', () => {
  const service = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [
    candidate({ id: 'c#1', from: '18', to: '18', credited: 60 }),
    candidate({ id: 'c#2', from: '18', to: '18', credited: 52 })
  ]).services[0];
  assert.equal(service.creditedMinutes, 112);
  assert.equal(service.status, 'PASS');
});
test('a line-18 duty can still fail when the turnaround time is short', () => {
  const service = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [candidate({ from: '18', to: '18', credited: 20 })]).services[0];
  assert.equal(service.status, 'FAIL');
  assert.equal(service.deficitMinutes, 40, '60 − 20');
});
test('the 11-minute threshold and the confidence filter still apply on line 18', () => {
  const below = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [candidate({ from: '18', to: '18', credited: 10, eligibility: 'below_minimum' })]).services[0];
  assert.equal(below.creditedMinutes, 0);
  const ambiguous = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [candidate({ from: '18', to: '18', credited: 112, confidence: 'ambiguous' })]).services[0];
  assert.equal(ambiguous.creditedMinutes, 0);
});
test('a duplicate line-18 candidate is still counted once', () => {
  const service = rule('mo_fr', [{ code: 'A', segments: [L18(358)] }], [
    candidate({ id: 'dup', from: '18', to: '18', credited: 112 }),
    candidate({ id: 'dup', from: '18', to: '18', credited: 112 })
  ]).services[0];
  assert.equal(service.creditedMinutes, 112);
});

// ===== the weekend keeps its own admission ground =====
test('a weekend duty is eligible with reason WEEKEND, whatever its lines', () => {
  const r = verdict('saturday', [{ code: 'A', segments: [LINE('5', 358)] }]);
  assert.equal(unitOf(r, 'A').eligibilityReason, ELIGIBILITY_REASON.WEEKEND);
  assert.equal(unitOf(r, 'A').status, ELIGIBILITY_STATUS.PASS);
});
test('a weekend line-18 duty is assessed in full and never dismissed', () => {
  const service = rule('saturday', [{ code: 'A', segments: [L18(358)] }], [candidate({ from: '18', to: '18', credited: 112 })]).services[0];
  assert.equal(service.status, 'PASS');
  assert.equal(service.drivingMinutes, 358);
});

// ===== 8. Regression: without an eligibility input nothing changes =====
test('without an eligibility input the rule behaves exactly as before', () => {
  const r = evaluateOneSixthRule({
    drivingProjection: projection('mo_fr', [{ code: 'A', segments: [L18(200), LINE('5', 158)] }]),
    turnaroundDetection: detection([candidate({ from: '5', to: '5', credited: 60 })]),
    ruleConfig: CONFIG, context: CONTEXT
  });
  assert.equal(r.services[0].drivingMinutes, 358, 'the whole driving time, no eligibility chain');
  assert.equal(r.services[0].requiredMinutes, 60);
  assert.equal(r.services[0].creditedMinutes, 60);
  assert.equal(r.services[0].status, 'PASS');
});
test('the ceiling, the ratio and the unknown-duration contract are unchanged', () => {
  assert.equal(rule('mo_fr', [{ code: 'A', segments: [L18(1)] }]).services[0].requiredMinutes, 1, 'ceil(1/6)');
  assert.equal(rule('mo_fr', [{ code: 'A', segments: [L18(7)] }]).services[0].requiredMinutes, 2);
  const unknown = rule('mo_fr', [{ code: 'A', segments: [L18(null)] }]).services[0];
  assert.equal(unknown.status, 'INCONCLUSIVE');
  assert.equal(unknown.drivingMinutes, null);
  assert.equal(unknown.requiredMinutes, null);
});

// ===== an unknown duty start never decides against the duty =====
test('a Mon–Fri duty with an unknown start stays inconclusive instead of being dismissed', () => {
  // The night-shift ground cannot be ruled out without a start, so the question stays open.
  const r = verdict('mo_fr', [{ code: 'A', segments: [LINE('10', 358)] }], {});
  assert.equal(unitOf(r, 'A').status, ELIGIBILITY_STATUS.INCONCLUSIVE);
  assert.equal(unitOf(r, 'A').eligibilityReason, ELIGIBILITY_REASON.DAY_TYPE_UNKNOWN);
});
test('but a pure line-18 duty is admitted even then', () => {
  const r = verdict('mo_fr', [{ code: 'A', segments: [L18(358)] }], {});
  assert.equal(unitOf(r, 'A').status, ELIGIBILITY_STATUS.PASS);
});
