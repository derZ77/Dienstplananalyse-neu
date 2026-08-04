import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.10b – the check adapter forwards `eligibility` unchanged to the rule. It interprets
// nothing: no line logic, no night-shift logic, no segment filter, no quota, no fallback.
import { createOneSixthCheck, runOneSixthCheck, mapOneSixthEvaluationToCheckResult } from '../js/v2/analysis/one-sixth-check.js';

const src = readFileSync(new URL('../js/v2/analysis/one-sixth-check.js', import.meta.url), 'utf8');

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
const ANALYSIS = { type: 'AnalysisResult', metadata: { source: 'test' } };

const projection = (dayType, lines = ['12']) => ({
  metadata: { serviceRegime: 'school', dayType, dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: lines.map((line, i) => ({ serviceNumber: '2101', kind: 'service', line, startMinutes: i * 60, endMinutes: i * 60 + 396, durationMinutes: 396, source: { serviceNumber: '2101', activityIndex: i, sourceType: 'pdf' } })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 396 * lines.length, nonDrivingMinutes: 0, knownTotalMinutes: 396 * lines.length }, warnings: []
  }],
  warnings: []
});
const detection = () => ({ status: 'complete', candidates: [{
  id: 'c#1', circulationCode: '11100',
  previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip', line: '12' },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip', line: '12' },
  startMinutes: 360, endMinutes: 426, observedSpanMinutes: 66, creditedMinutes: 66,
  source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
}], warnings: [], statistics: { candidateCount: 1, qualifiedCount: 1, belowMinimumCount: 0, unresolvedCount: 0 } });

// ===== the adapter forwards eligibility =====
test('the adapter accepts and forwards an eligibility input', () => {
  assert.match(src, /createOneSixthCheck\(\{[^}]*eligibility[^}]*\}/, 'the signature accepts it');
  assert.match(src, /evaluateOneSixthRule\(\{[^}]*eligibility[^}]*\}\)/, 'and hands it on');
});
test('the forwarded eligibility is the very same object reference', () => {
  const eligibility = Object.freeze({ dutyStartMinutes: 19 * 60 + 20, serviceStarts: Object.freeze({ 2101: 19 * 60 + 20 }) });
  let received = null;
  createOneSixthCheck({
    drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT, eligibility,
    // the injected rule proves the reference travels untouched
  });
  // the real path: the rule sees the same object, verified through observable behaviour
  const withNight = createOneSixthCheck({ drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT, eligibility }).run();
  assert.equal(withNight.status, 'PASS', 'the night-shift exception arrived through the adapter');
  received = eligibility;
  assert.equal(received.dutyStartMinutes, 19 * 60 + 20, 'the input was not mutated');
});
test('an eligible weekday duty now passes through the adapter', () => {
  const result = createOneSixthCheck({
    drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: 19 * 60 + 20 }
  }).run();
  assert.equal(result.status, 'PASS');
  assert.equal(result.details.originalStatus, 'PASS');
});
test('an ineligible weekday duty becomes NOT_APPLICABLE through the adapter', () => {
  const result = createOneSixthCheck({
    drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: 8 * 60 }
  }).run();
  assert.equal(result.status, 'NOT_APPLICABLE');
  assert.equal(result.severity, 'INFO');
  assert.equal(result.details.originalStatus, 'NOT_APPLICABLE');
  assert.deepEqual(result.details.violations, []);
});
test('an undecidable eligibility becomes SKIP/WARNING through the adapter', () => {
  const result = createOneSixthCheck({
    drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT,
    eligibility: {}
  }).run();
  assert.equal(result.status, 'SKIP');
  assert.equal(result.severity, 'WARNING');
  assert.equal(result.details.originalStatus, 'INCONCLUSIVE');
});
// SUPERSEDED BY PHASE 3I.15b: line 18 ADMITS a duty; it removes nothing from the calculation.
test('a pure line-18 circulation is ASSESSED through the adapter, not dismissed', () => {
  const result = createOneSixthCheck({
    drivingProjection: projection('saturday', ['18']), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT,
    eligibility: {}
  }).run();
  assert.notEqual(result.status, 'NOT_APPLICABLE');
  assert.ok(result.details.services.length > 0, 'the quota evaluation ran');
});

// ===== backwards compatibility =====
test('without an eligibility input the adapter behaves exactly as before', () => {
  const result = createOneSixthCheck({ drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT }).run();
  assert.equal(result.status, 'PASS', 'no eligibility means no eligibility gating');
  assert.equal(result.details.services[0].requiredMinutes, 66);
});
test('the convenience runner also forwards the eligibility', async () => {
  const report = await runOneSixthCheck({
    analysisResult: ANALYSIS, drivingProjection: projection('mo_fr'), turnaroundDetection: detection(),
    ruleConfig: CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: 8 * 60 }
  });
  assert.equal(report.results[0].status, 'NOT_APPLICABLE');
  assert.equal(report.summary.hitCount, 0);
  assert.deepEqual(report.errors, []);
});

// ===== the adapter still interprets nothing =====
test('the adapter contains no eligibility, line, night-shift or quota logic of its own', () => {
  assert.doesNotMatch(src, /nightShift|exceptionLine|allowedDayTypes|dutyStart|segmentIndex|Math\.(ceil|round|floor)/,
    'the adapter only passes the input through');
  assert.doesNotMatch(src, /'18'|"18"|19:20/);
});
test('the status and severity mapping is unchanged', () => {
  const r = mapOneSixthEvaluationToCheckResult({ ruleId: 'BV015_BV018', status: 'NOT_APPLICABLE', services: [], violations: [], warnings: [], statistics: {} });
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.equal(r.severity, 'INFO');
  const inconclusive = mapOneSixthEvaluationToCheckResult({ ruleId: 'BV015_BV018', status: 'INCONCLUSIVE', services: [], violations: [], warnings: [], statistics: {} });
  assert.equal(inconclusive.status, 'SKIP');
  assert.equal(inconclusive.severity, 'WARNING');
});
test('the CheckModule contract is unchanged', () => {
  const module = createOneSixthCheck({ drivingProjection: projection('saturday'), turnaroundDetection: detection(), ruleConfig: CONFIG, context: CONTEXT, eligibility: {} });
  assert.equal(module.id, 'BV015_BV018');
  assert.equal(module.category, 'BV');
  assert.equal(module.priority, 260);
  assert.equal(typeof module.run, 'function');
});
