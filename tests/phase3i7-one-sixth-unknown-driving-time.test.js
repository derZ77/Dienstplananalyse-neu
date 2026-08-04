import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.7 – an UNKNOWN driving time must be inconclusive, never a verdict. Before this phase the
// aggregate `statistics.drivingMinutes` was taken at face value, so an unknown segment duration
// (which the projection sums as 0) produced a requirement of ceil(0/6) = 0 and therefore a PASS
// without any knowledge. A genuinely known 0 stays a normal, assessable value.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthEvaluation } from '../js/v2/analysis/one-sixth-validation.js';
import { createOneSixthCheck } from '../js/v2/analysis/one-sixth-check.js';
import { createDrivingTimeLimitCheck } from '../js/v2/analysis/driving-time-limit-check.js';
import { runCheckModules } from '../js/v2/checks/check-runner.js';

const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };
const ANALYSIS = { type: 'AnalysisResult', metadata: { source: 'test' } };

const segment = (durationMinutes, serviceNumber = '2101') => ({
  serviceNumber, kind: 'service', startMinutes: 0,
  endMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
  durationMinutes, source: { serviceNumber, activityIndex: 0, sourceType: 'pdf' }
});
// `has` lets a test pass an explicit undefined / omit `statistics` entirely.
const circulation = (over) => {
  const c = {
    code: over.code ?? '11100',
    drivingSegments: 'segments' in over ? over.segments : [segment(10, over.serviceNumber ?? '2101')],
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    warnings: over.warnings ?? []
  };
  if (!over.noStatistics) {
    c.statistics = { drivingMinutes: over.drivingMinutes, nonDrivingMinutes: 0, knownTotalMinutes: over.drivingMinutes };
  }
  return c;
};
const projection = (circulations) => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: circulations.length },
  circulations: circulations.map(circulation),
  warnings: []
});
const candidate = (over = {}) => ({
  id: over.id ?? `c#${over.n ?? 1}`, circulationCode: over.code ?? '11100',
  previousSegmentRef: { circulationCode: over.code ?? '11100', sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: over.code ?? '11100', sequence: 2, type: 'service_trip' },
  startMinutes: 360, endMinutes: 360 + (over.span ?? 66), observedSpanMinutes: over.span ?? 66,
  creditedMinutes: over.span ?? 66, source: 'umlauftafel', confidence: 'exact',
  eligibility: 'qualified', warnings: []
});
const detection = (candidates) => ({
  status: 'complete', candidates, warnings: [],
  statistics: { candidateCount: candidates.length, qualifiedCount: candidates.length, belowMinimumCount: 0, unresolvedCount: 0 }
});
const run = (circulations, candidates = [candidate()]) => evaluateOneSixthRule({
  drivingProjection: projection(circulations), turnaroundDetection: detection(candidates),
  ruleConfig: CONFIG, context: CONTEXT
});
const only = (circulations, candidates) => run(circulations, candidates).services[0];

// ===== every flavour of "unknown" is inconclusive =====
const UNKNOWN_CASES = [
  ['undefined', { drivingMinutes: undefined }],
  ['null', { drivingMinutes: null }],
  ['NaN', { drivingMinutes: NaN }],
  ['Infinity', { drivingMinutes: Infinity }],
  ['-Infinity', { drivingMinutes: -Infinity }],
  ['a negative value', { drivingMinutes: -1 }],
  ['a non-numeric value', { drivingMinutes: '396' }],
  ['missing statistics', { noStatistics: true }]
];
for (const [label, over] of UNKNOWN_CASES) {
  test(`${label} driving time is inconclusive, never a verdict`, () => {
    const service = only([over]);
    assert.equal(service.status, 'INCONCLUSIVE', `${label} must not be assessed`);
    assert.equal(service.drivingMinutes, null);
    assert.equal(service.requiredMinutes, null, 'no artificial requirement of 0');
    assert.equal(service.deficitMinutes, null, 'no artificial deficit of 0');
    assert.deepEqual(service.violations, []);
    assert.ok(service.warnings.includes('DRIVING_TIME_UNAVAILABLE'));
  });
}

// ===== the real-world case: the aggregate hides an unknown segment duration =====
test('an unknown SEGMENT duration makes the aggregate untrustworthy and inconclusive', () => {
  // The projection sums only known durations, so one unknown segment silently lowers the total.
  const service = only([{ drivingMinutes: 10, segments: [segment(10), segment(null)] }]);
  assert.equal(service.status, 'INCONCLUSIVE');
  assert.equal(service.drivingMinutes, null, 'the partial sum is not reported as a known value');
  assert.equal(service.requiredMinutes, null);
  assert.ok(service.warnings.includes('DRIVING_TIME_UNAVAILABLE'));
});
test('the exact projection shape of a missing arrival time is inconclusive', () => {
  // what createDrivingProjection produces for a duty activity without an arrival time
  const service = only([{ drivingMinutes: 0, segments: [segment(null)], warnings: [{ code: 'MISSING_SEGMENT_TIME', umlaufCode: '11100', index: 0 }] }]);
  assert.equal(service.status, 'INCONCLUSIVE', 'this was the Phase 3I.6 known gap');
  assert.equal(service.requiredMinutes, null);
  assert.deepEqual(service.violations, []);
});

// ===== a genuinely known 0 stays assessable =====
test('a known driving time of 0 is a normal value and is assessed, not skipped', () => {
  const service = only([{ drivingMinutes: 0, segments: [segment(0)] }]);
  assert.equal(service.status, 'PASS');
  assert.equal(service.drivingMinutes, 0);
  assert.equal(service.requiredMinutes, 0, 'ceil(0/6) = 0');
  assert.equal(service.deficitMinutes, 0);
  assert.ok(!service.warnings.includes('DRIVING_TIME_UNAVAILABLE'), 'a known 0 is not an unknown');
});
test('a circulation without any driving segment keeps a known 0', () => {
  const service = only([{ drivingMinutes: 0, segments: [] }]);
  assert.equal(service.status, 'PASS');
  assert.equal(service.drivingMinutes, 0);
  assert.equal(service.requiredMinutes, 0);
});
test('a known driving time is still assessed exactly as before', () => {
  const service = only([{ drivingMinutes: 396 }]);
  assert.equal(service.status, 'PASS');
  assert.equal(service.requiredMinutes, 66, 'ceil(396/6) = 66');
  assert.equal(service.creditedMinutes, 66);
  assert.equal(service.deficitMinutes, 0);
});
test('a known driving time with too little credited turnaround still fails', () => {
  const result = run([{ drivingMinutes: 396 }], [candidate({ span: 20 })]);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].deficitMinutes, 46);
});

// ===== top-level aggregation =====
test('an inconclusive unit is never hidden behind other passing units', () => {
  const result = run([{ code: 'a', drivingMinutes: 396 }, { code: 'b', drivingMinutes: null }], [candidate({ code: 'a' })]);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.deepEqual(result.violations, []);
});
test('a definitive FAIL still outranks an inconclusive unit', () => {
  const result = run([{ code: 'a', drivingMinutes: 396 }, { code: 'b', drivingMinutes: null }], [candidate({ code: 'a', span: 20 })]);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].circulationCode, 'a');
});
test('several inconclusive units stay inconclusive', () => {
  const result = run([{ code: 'a', drivingMinutes: null }, { code: 'b', noStatistics: true }], []);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.equal(result.statistics.inconclusiveServices, 2);
  assert.deepEqual(result.violations, []);
});
test('all units known and satisfied still yields PASS', () => {
  const result = run([{ code: 'a', drivingMinutes: 396 }, { code: 'b', drivingMinutes: 396 }], [candidate({ code: 'a' }), candidate({ id: 'c#2', code: 'b' })]);
  assert.equal(result.status, 'PASS');
});

// ===== statistics =====
test('statistics exclude unknown units from every sum but count them as inconclusive', () => {
  const result = run([{ code: 'a', drivingMinutes: 396 }, { code: 'b', drivingMinutes: null }], [candidate({ code: 'a' })]);
  const s = result.statistics;
  assert.equal(s.evaluatedServices, 2);
  assert.equal(s.inconclusiveServices, 1);
  assert.equal(s.passedServices, 1);
  assert.equal(s.failedServices, 0);
  assert.equal(s.totalDrivingMinutes, 396, 'the unknown unit contributes nothing');
  assert.equal(s.totalRequiredMinutes, 66, 'no artificial 0 requirement is added');
  assert.equal(s.totalDeficitMinutes, 0);
  for (const value of Object.values(s)) {
    assert.equal(Number.isFinite(value), true, 'no NaN or Infinity in the statistics');
  }
});

// ===== purity =====
test('the evaluation is deterministic and mutates no input', () => {
  const circulations = [{ code: 'a', drivingMinutes: 396 }, { code: 'b', drivingMinutes: null }];
  const input = { drivingProjection: projection(circulations), turnaroundDetection: detection([candidate({ code: 'a' })]), ruleConfig: CONFIG, context: CONTEXT };
  const snapshot = JSON.stringify(input);
  const a = evaluateOneSixthRule(input);
  const b = evaluateOneSixthRule(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot, 'no input was mutated');
});

// ===== validator =====
const evaluationOf = (circulations, candidates) => run(circulations, candidates);
test('the validator accepts the inconclusive null shape produced by the rule', () => {
  const result = validateOneSixthEvaluation(evaluationOf([{ drivingMinutes: null }], []), CONFIG);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
test('the validator accepts a mixed known/unknown evaluation', () => {
  const result = validateOneSixthEvaluation(evaluationOf([{ code: 'a', drivingMinutes: 396 }, { code: 'b', drivingMinutes: null }], [candidate({ code: 'a' })]), CONFIG);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

const base = evaluationOf([{ drivingMinutes: null }], []);
const withService = (over) => ({ ...base, services: [{ ...base.services[0], ...over }] });
test('the validator rejects a substituted requirement of 0 for an unknown driving time', () => {
  assert.equal(validateOneSixthEvaluation(withService({ requiredMinutes: 0 }), CONFIG).valid, false);
});
test('the validator rejects a substituted deficit of 0 for an unknown driving time', () => {
  assert.equal(validateOneSixthEvaluation(withService({ deficitMinutes: 0 }), CONFIG).valid, false);
});
test('the validator rejects PASS or FAIL with an unknown driving time', () => {
  assert.equal(validateOneSixthEvaluation(withService({ status: 'PASS' }), CONFIG).valid, false);
  assert.equal(validateOneSixthEvaluation(withService({ status: 'FAIL' }), CONFIG).valid, false);
});
test('the validator rejects a violation on an inconclusive unit', () => {
  const broken = withService({ violations: [{ ruleId: 'BV015_BV018', serviceNumber: '2101', circulationCode: '11100', severity: 'VIOLATION', drivingMinutes: 396, requiredMinutes: 66, creditedMinutes: 20, deficitMinutes: 46, sourceRefs: [] }] });
  assert.equal(validateOneSixthEvaluation(broken, CONFIG).valid, false);
});
test('the validator still enforces the ceiling and deficit rules for known values', () => {
  const known = evaluationOf([{ drivingMinutes: 396 }]);
  assert.equal(validateOneSixthEvaluation(known, CONFIG).valid, true);
  const wrongCeiling = { ...known, services: [{ ...known.services[0], requiredMinutes: 65 }] };
  assert.equal(validateOneSixthEvaluation(wrongCeiling, CONFIG).valid, false);
});

// ===== adapter and runner regression (both files stay unchanged) =====
test('the unchanged adapter maps the corrected evaluation to SKIP/WARNING', () => {
  const result = createOneSixthCheck({
    drivingProjection: projection([{ drivingMinutes: null }]), turnaroundDetection: detection([candidate()]),
    ruleConfig: CONFIG, context: CONTEXT
  }).run();
  assert.equal(result.status, 'SKIP');
  assert.equal(result.severity, 'WARNING');
  assert.equal(result.details.originalStatus, 'INCONCLUSIVE');
  assert.deepEqual(result.details.violations, []);
  assert.deepEqual(result.affectedServices, []);
  assert.equal(result.details.services[0].requiredMinutes, null);
});
test('the unchanged runner produces a valid report with no hit for an unknown driving time', async () => {
  const report = await runCheckModules(ANALYSIS, [createOneSixthCheck({
    drivingProjection: projection([{ drivingMinutes: null }]), turnaroundDetection: detection([candidate()]),
    ruleConfig: CONFIG, context: CONTEXT
  })]);
  assert.equal(report.type, 'CheckReport');
  assert.equal(report.summary.hitCount, 0);
  assert.deepEqual(report.errors, []);
  assert.equal(report.results[0].status, 'SKIP');
});
test('the joint report with BV008 stays valid when the driving time is unknown', async () => {
  const drivingProjection = projection([{ drivingMinutes: null, segments: [segment(null)] }]);
  const report = await runCheckModules(ANALYSIS, [
    createDrivingTimeLimitCheck({ drivingProjection, ruleConfig: { ruleId: 'BV008', enabled: true, maxContinuousDrivingMinutes: 270, qualifyingInterruption: { singleMinimumMinutes: 45, splitSequence: [15, 30] } } }),
    createOneSixthCheck({ drivingProjection, turnaroundDetection: detection([candidate()]), ruleConfig: CONFIG, context: CONTEXT })
  ]);
  assert.deepEqual(report.results.map(r => r.id), ['BV008', 'BV015_BV018']);
  assert.equal(report.summary.resultCount, 2);
  assert.equal(report.summary.hitCount, 0, 'neither rule invents a verdict from unknown data');
  assert.deepEqual(report.errors, []);
  assert.equal(report.results[1].status, 'SKIP');
  assert.equal(report.results[1].severity, 'WARNING');
});
