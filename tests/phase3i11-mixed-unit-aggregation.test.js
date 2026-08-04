import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.11 – units are judged independently and the top-level status follows the EXISTING
// priority FAIL > INCONCLUSIVE > PASS > NOT_APPLICABLE. A not-applicable unit never counts as a
// pass, never produces a hit, and never changes the outcome of another unit.
import { evaluateOneSixthRule, evaluateOneSixthEligibility } from '../js/v2/analysis/one-sixth-rule.js';
import { mapOneSixthEvaluationToCheckResult, runOneSixthCheck } from '../js/v2/analysis/one-sixth-check.js';
import { createDrivingTimeLimitCheck } from '../js/v2/analysis/driving-time-limit-check.js';
import { DEFAULT_DRIVING_TIME_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { runCheckModules } from '../js/v2/checks/check-runner.js';

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
    serviceNumber: code, kind: 'service', line: s.line,
    startMinutes: i * 600, endMinutes: Number.isFinite(s.duration) ? i * 600 + s.duration : null,
    durationMinutes: s.duration, source: { serviceNumber: code, activityIndex: i, sourceType: 'pdf' }
  })),
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
const candidate = (code, credited) => ({
  id: `c#${code}`, circulationCode: code,
  previousSegmentRef: { circulationCode: code, sequence: 1, type: 'service_trip', line: '12' },
  nextSegmentRef: { circulationCode: code, sequence: 2, type: 'service_trip', line: '12' },
  startMinutes: 360, endMinutes: 360 + credited, observedSpanMinutes: credited,
  creditedMinutes: credited, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
});
const detection = (candidates) => ({ status: 'complete', candidates, warnings: [], statistics: { candidateCount: candidates.length } });
const run = (units, candidates = []) => evaluateOneSixthRule({
  drivingProjection: projection(units), turnaroundDetection: detection(candidates),
  ruleConfig: CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: null, serviceStarts: {} }
});
const statusOf = (r, code) => r.services.find(s => s.circulationCode === code)?.status;

// SUPERSEDED BY PHASE 3I.15b: a unit is no longer ruled out by LINE 18 — line 18 admits it. The
// protected statement of this file is unchanged in substance: units are judged independently, the
// top-level priority stays FAIL > INCONCLUSIVE > PASS > NOT_APPLICABLE, and a not-applicable unit
// never counts as a pass or produces a hit. Only the WAY a unit is ruled out changed: the day type.
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
const weekday = (units, candidates = []) => evaluateOneSixthRule({
  drivingProjection: {
    metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: units.length },
    circulations: units.map(u => ownCirculation(u.code, u.segments)), warnings: []
  },
  turnaroundDetection: detection(candidates), ruleConfig: CONFIG, context: CONTEXT,
  eligibility: { dutyStartMinutes: null, serviceStarts: { 2101: 5 * 60, 2102: 19 * 60 + 20, 2103: 5 * 60 } }
});
// 2101 → ordinary weekday duty, ruled out. 2102 → night shift, admitted.
const OUT = { code: '11100', segments: [{ line: '12', duration: 396, service: '2101' }] };
const IN = { code: '11200', segments: [{ line: '12', duration: 396, service: '2102' }] };
const IN_UNKNOWN = { code: '11200', segments: [{ line: '12', duration: null, service: '2102' }] };

// ===== the five mandated combinations, now driven by the day type =====
test('a ruled-out unit alone yields a not-applicable result without a quota', () => {
  const r = weekday([OUT]);
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.deepEqual(r.violations, []);
});
test('ruled out + passing unit: one NOT_APPLICABLE, one PASS, top level PASS', () => {
  const r = weekday([OUT, IN], [candidate('11200', 66)]);
  assert.equal(statusOf(r, '11100'), 'NOT_APPLICABLE');
  assert.equal(statusOf(r, '11200'), 'PASS');
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.violations, []);
});
test('ruled out + failing unit: one NOT_APPLICABLE, one FAIL, top level FAIL', () => {
  const r = weekday([OUT, IN], [candidate('11200', 20)]);
  assert.equal(statusOf(r, '11100'), 'NOT_APPLICABLE');
  assert.equal(statusOf(r, '11200'), 'FAIL');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.violations.length, 1, 'only the admitted unit is violated');
  assert.equal(r.violations[0].circulationCode, '11200');
});
test('ruled out + inconclusive unit: one NOT_APPLICABLE, one INCONCLUSIVE, top level INCONCLUSIVE', () => {
  const r = weekday([OUT, IN_UNKNOWN]);
  assert.equal(statusOf(r, '11100'), 'NOT_APPLICABLE');
  assert.equal(statusOf(r, '11200'), 'INCONCLUSIVE');
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.deepEqual(r.violations, []);
});
test('two ruled-out units: top level NOT_APPLICABLE', () => {
  const second = { code: '11300', segments: [{ line: '12', duration: 200, service: '2103' }] };
  const r = weekday([OUT, second]);
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.deepEqual(r.violations, []);
  const verdict = evaluateOneSixthEligibility({
    drivingProjection: {
      metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 2 },
      circulations: [ownCirculation(OUT.code, OUT.segments), ownCirculation(second.code, second.segments)], warnings: []
    },
    ruleConfig: CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: null, serviceStarts: { 2101: 5 * 60, 2103: 5 * 60 } }
  });
  assert.deepEqual(verdict.circulations.map(c => c.status), ['NOT_APPLICABLE', 'NOT_APPLICABLE']);
});

// ===== no unit changes another unit =====
test('the ruled-out unit does not turn a failing unit into a pass', () => {
  const withOut = weekday([OUT, IN], [candidate('11200', 20)]);
  const alone = weekday([IN], [candidate('11200', 20)]);
  assert.equal(statusOf(withOut, '11200'), statusOf(alone, '11200'));
  assert.equal(withOut.status, alone.status, 'the top-level verdict is unaffected');
});
test('the order of the units does not change any verdict', () => {
  const a = weekday([OUT, IN], [candidate('11200', 20)]);
  const b = weekday([IN, OUT], [candidate('11200', 20)]);
  assert.equal(a.status, b.status);
  assert.equal(statusOf(a, '11100'), statusOf(b, '11100'));
  assert.equal(statusOf(a, '11200'), statusOf(b, '11200'));
});
test('a failing unit outranks an inconclusive one, as before', () => {
  const third = { code: '11300', segments: [{ line: '12', duration: null, service: '2103' }] };
  const admittedThird = { ...third, segments: [{ line: '18', duration: null, service: '2103' }] };
  const r = weekday([IN, admittedThird], [candidate('11200', 20)]);
  assert.equal(r.status, 'FAIL', 'FAIL keeps the highest priority');
});

// ===== statistics =====
test('a not-applicable unit is counted separately, never as a pass', () => {
  const s = weekday([OUT, IN], [candidate('11200', 66)]).statistics;
  assert.equal(s.passedServices, 1, 'only the admitted unit passed');
  assert.equal(s.notApplicableServices, 1);
  assert.equal(s.evaluatedServices, 1);
  assert.equal(s.failedServices, 0);
  assert.equal(s.inconclusiveServices, 0);
});
test('the counters always add up to the number of result entries', () => {
  const r = weekday([OUT, IN], [candidate('11200', 20)]);
  const s = r.statistics;
  assert.equal(s.evaluatedServices + s.notApplicableServices, r.services.length);
  assert.equal(s.passedServices + s.failedServices + s.inconclusiveServices, s.evaluatedServices);
});
test('the totals stay finite and exclude the ruled-out unit', () => {
  const s = weekday([OUT, IN], [candidate('11200', 20)]).statistics;
  assert.equal(s.totalDrivingMinutes, 396);
  assert.equal(s.totalRequiredMinutes, 66);
  assert.equal(s.totalCreditedMinutes, 20);
  assert.equal(s.totalDeficitMinutes, 46);
  for (const value of Object.values(s)) assert.ok(Number.isFinite(value));
});

// ===== the existing adapter and runner mapping, unchanged =====
test('the adapter maps a mixed run onto the existing statuses without any change', () => {
  const passing = mapOneSixthEvaluationToCheckResult(weekday([OUT, IN], [candidate('11200', 66)]));
  assert.equal(passing.status, 'PASS');
  assert.equal(passing.severity, 'INFO');
  const failing = mapOneSixthEvaluationToCheckResult(weekday([OUT, IN], [candidate('11200', 20)]));
  assert.equal(failing.status, 'FAIL');
  assert.equal(failing.severity, 'VIOLATION');
  assert.deepEqual(failing.affectedServices, ['2102'], 'only the assessed unit');
});
test('an all-ruled-out evaluation maps onto NOT_APPLICABLE / INFO with no hit', async () => {
  const mapped = mapOneSixthEvaluationToCheckResult(weekday([OUT]));
  assert.equal(mapped.status, 'NOT_APPLICABLE');
  assert.equal(mapped.severity, 'INFO');
  const report = await runCheckModules({ type: 'AnalysisResult' }, [{
    id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => mapped
  }], {});
  assert.equal(report.summary.hitCount, 0, 'a not-applicable check is never a hit');
});
test('the ruled-out unit is visible in the small adapter projection', () => {
  const details = mapOneSixthEvaluationToCheckResult(weekday([OUT, IN], [candidate('11200', 66)])).details;
  const out = details.services.find(s => s.circulationCode === '11100');
  assert.equal(out.status, 'NOT_APPLICABLE');
  assert.equal(out.drivingMinutes, null);
  assert.equal(out.requiredMinutes, null);
});
test('the shared report keeps BV008 first and reports no errors', async () => {
  const drivingProjection = {
    metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 2 },
    circulations: [ownCirculation(OUT.code, OUT.segments), ownCirculation(IN.code, IN.segments)], warnings: []
  };
  const both = await runCheckModules({ type: 'AnalysisResult' }, [
    createDrivingTimeLimitCheck({ drivingProjection, ruleConfig: DEFAULT_DRIVING_TIME_RULE_CONFIG }),
    { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => mapOneSixthEvaluationToCheckResult(weekday([OUT, IN], [candidate('11200', 66)])) }
  ], {});
  assert.deepEqual(both.results.map(r => r.id), ['BV008', 'BV015_BV018']);
  assert.equal(both.summary.resultCount, 2);
  assert.deepEqual(both.errors, []);
});

// ===== regression: the corrected arithmetic =====
test('SUPERSEDED BY PHASE 3I.15b: a mixed unit counts ALL its segments', () => {
  const mixed = { code: '11200', segments: [{ line: '18', duration: 396, service: '2102' }, { line: '5', duration: 396, service: '2102' }] };
  const s = weekday([mixed], [candidate('11200', 132)]).services[0];
  assert.equal(s.drivingMinutes, 792, 'nothing is removed');
  assert.equal(s.requiredMinutes, 132, 'ceil(792/6)');
  assert.equal(s.status, 'PASS');
});
test('an unknown duration is still inconclusive', () => {
  const s = weekday([IN_UNKNOWN]).services[0];
  assert.equal(s.status, 'INCONCLUSIVE');
  assert.equal(s.requiredMinutes, null);
});
test('without an eligibility input the previous full basis is unchanged', () => {
  const mixed = { code: '11200', segments: [{ line: '18', duration: 396, service: '2102' }, { line: '5', duration: 396, service: '2102' }] };
  const r = evaluateOneSixthRule({
    drivingProjection: {
      metadata: { serviceRegime: 'school', dayType: 'saturday', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
      circulations: [ownCirculation(mixed.code, mixed.segments)], warnings: []
    },
    turnaroundDetection: detection([candidate('11200', 132)]), ruleConfig: CONFIG, context: CONTEXT
  });
  assert.equal(r.services[0].drivingMinutes, 792, 'the whole driving time, as before');
  assert.equal(r.services[0].requiredMinutes, 132);
  assert.equal(r.services[0].status, 'PASS');
});
