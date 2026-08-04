import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.13 – what the new classification means for the eligibility chain: a deadhead run keeps a
// circulation evaluable instead of making it undecidable, and it can even keep a circulation in
// scope whose only line trip is excepted.
import { evaluateOneSixthRule, evaluateOneSixthEligibility, ELIGIBILITY_STATUS } from '../js/v2/analysis/one-sixth-rule.js';

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
    serviceNumber: code, kind: s.kind, line: s.line,
    startMinutes: i * 600, endMinutes: Number.isFinite(s.duration) ? i * 600 + s.duration : null,
    durationMinutes: s.duration, source: { serviceNumber: code, activityIndex: i, sourceType: 'pdf' }
  })),
  drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
  statistics: {
    drivingMinutes: segments.reduce((t, s) => t + (Number.isFinite(s.duration) ? s.duration : 0), 0),
    nonDrivingMinutes: 0, knownTotalMinutes: 0
  },
  warnings: []
});
const projection = (units) => ({
  metadata: { serviceRegime: 'school', dayType: 'saturday', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: units.length },
  circulations: units.map(u => circulation(u.code, u.segments)),
  warnings: []
});
const detection = { status: 'complete', candidates: [], warnings: [], statistics: { candidateCount: 0 } };
const ELIGIBILITY = { dutyStartMinutes: null, serviceStarts: {} };
const verdict = (units) => evaluateOneSixthEligibility({
  drivingProjection: projection(units), ruleConfig: CONFIG, context: CONTEXT, eligibility: ELIGIBILITY
});
const rule = (units) => evaluateOneSixthRule({
  drivingProjection: projection(units), turnaroundDetection: detection,
  ruleConfig: CONFIG, context: CONTEXT, eligibility: ELIGIBILITY
});
const unitOf = (result, code) => result.circulations.find(c => c.circulationCode === code);

const DEADHEAD = (duration = 30) => ({ kind: 'deadhead', line: null, duration });
const SERVICE = (line, duration = 396) => ({ kind: 'service', line, duration });

// SUPERSEDED BY PHASE 3I.15b: a line-18 trip is no longer "excepted", so a circulation is never
// kept in scope by a surviving segment. What this file still guarantees: a deadhead run without a
// line is regular and neutral, a line trip without a line stays undecidable where the line decides,
// and an unknown duration is a TIME problem, never a line problem.

// ===== the deadhead run is regular and neutral =====
test('a circulation of deadhead runs only is eligible on a weekend', () => {
  assert.equal(verdict([{ code: 'a', segments: [DEADHEAD()] }]).status, ELIGIBILITY_STATUS.PASS);
});
test('a deadhead run beside a regular line trip is eligible', () => {
  const r = verdict([{ code: 'a', segments: [DEADHEAD(), SERVICE('5')] }]);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unitOf(r, 'a').lineAttributionComplete, true, 'the deadhead run is no gap');
});
test('SUPERSEDED BY PHASE 3I.15b: a deadhead run beside a line-18 trip keeps the duty PURE', () => {
  const r = verdict([{ code: 'a', segments: [DEADHEAD(), SERVICE('18')] }]);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unitOf(r, 'a').line18Classification, 'PURE_LINE_18_ONLY', 'the deadhead run is neutral');
});
test('SUPERSEDED BY PHASE 3I.15b: a pure line-18 circulation is admitted, not dismissed', () => {
  const r = verdict([{ code: 'a', segments: [SERVICE('18')] }]);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS, 'the Saturday day type admits it anyway');
  assert.equal(unitOf(r, 'a').line18Classification, 'PURE_LINE_18_ONLY');
});
test('a mixed circulation with line 18, a deadhead run and a regular line is classified as mixed', () => {
  const r = verdict([{ code: 'a', segments: [SERVICE('18'), DEADHEAD(), SERVICE('5')] }]);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(unitOf(r, 'a').line18Classification, 'MIXED_WITH_OTHER_LINES');
});

// ===== the conservative side, where the line actually decides =====
test('a service trip without a line makes a WEEKDAY circulation undecidable', () => {
  const weekdayProjection = {
    ...projection([{ code: 'a', segments: [DEADHEAD(), { kind: 'service', line: null, duration: 396 }] }]),
    metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 }
  };
  const r = evaluateOneSixthEligibility({
    drivingProjection: weekdayProjection, ruleConfig: CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: 5 * 60, serviceStarts: {} }
  });
  assert.equal(r.status, ELIGIBILITY_STATUS.INCONCLUSIVE);
});
test('an undecidable circulation is not hidden behind an eligible one', () => {
  const weekdayProjection = {
    ...projection([
      { code: 'a', segments: [SERVICE('18')] },
      { code: 'b', segments: [{ kind: 'service', line: null, duration: 396 }, SERVICE('12')] }
    ]),
    metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 2 }
  };
  const r = evaluateOneSixthEligibility({
    drivingProjection: weekdayProjection, ruleConfig: CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: 5 * 60, serviceStarts: {} }
  });
  assert.equal(unitOf(r, 'a').status, ELIGIBILITY_STATUS.PASS, 'admitted by line 18');
  assert.equal(unitOf(r, 'b').status, ELIGIBILITY_STATUS.INCONCLUSIVE);
  assert.equal(r.status, ELIGIBILITY_STATUS.INCONCLUSIVE);
});
test('no unit changes the eligibility of another unit', () => {
  const alone = verdict([{ code: 'a', segments: [DEADHEAD(), SERVICE('18')] }]);
  const beside = verdict([
    { code: 'a', segments: [DEADHEAD(), SERVICE('18')] },
    { code: 'b', segments: [SERVICE('5')] }
  ]);
  assert.equal(unitOf(alone, 'a').status, unitOf(beside, 'a').status);
  assert.equal(unitOf(alone, 'a').line18Classification, unitOf(beside, 'a').line18Classification);
});

// ===== unknown duration: a time problem, not a line problem =====
test('a deadhead run with an unknown duration is eligible but leaves the basis unknown', () => {
  const units = [{ code: 'a', segments: [{ kind: 'deadhead', line: null, duration: null }, SERVICE('5')] }];
  assert.equal(verdict(units).status, ELIGIBILITY_STATUS.PASS, 'eligibility is about lines, not times');
  const service = rule(units).services[0];
  assert.equal(service.status, 'INCONCLUSIVE');
  assert.equal(service.drivingMinutes, null);
  assert.ok(service.warnings.includes('DRIVING_TIME_UNAVAILABLE'), 'the reason is the time, not the line');
  assert.ok(!service.warnings.includes('SEGMENT_LINE_UNAVAILABLE'));
});
test('a deadhead run with a known duration is fully assessable', () => {
  const service = rule([{ code: 'a', segments: [DEADHEAD(), SERVICE('5')] }]).services[0];
  assert.equal(service.status, 'FAIL', 'assessed — 426 required 71, nothing credited');
  assert.equal(service.drivingMinutes, 426);
});
test('SUPERSEDED BY PHASE 3I.15b: a line-18 segment with an unknown duration DOES block the quota', () => {
  const service = rule([{ code: 'a', segments: [{ kind: 'service', line: '18', duration: null }, DEADHEAD(), SERVICE('5')] }]).services[0];
  assert.equal(service.status, 'INCONCLUSIVE', 'it is part of the basis now');
  assert.equal(service.drivingMinutes, null, 'never a partial sum');
});
