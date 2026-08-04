import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.13 – the quota consequences: a deadhead run counts in full towards the regular basis,
// and it can carry a circulation whose only line trip is excepted. The excepted minutes stay out.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthEvaluation } from '../js/v2/analysis/one-sixth-validation.js';
import { mapOneSixthEvaluationToCheckResult } from '../js/v2/analysis/one-sixth-check.js';
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

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

const projection = (segments) => ({
  metadata: { serviceRegime: 'school', dayType: 'saturday', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: segments.map((s, i) => ({
      serviceNumber: '2101', kind: s.kind, line: s.line,
      startMinutes: i * 600, endMinutes: i * 600 + s.duration, durationMinutes: s.duration,
      source: { serviceNumber: '2101', activityIndex: i, sourceType: 'pdf' }
    })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: segments.reduce((t, s) => t + s.duration, 0), nonDrivingMinutes: 0, knownTotalMinutes: 0 },
    warnings: []
  }],
  warnings: []
});
const candidate = (over) => ({
  id: over.id ?? 'c#1', circulationCode: '11100',
  previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip', line: over.from },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip', line: over.to },
  startMinutes: 360, endMinutes: 360 + over.credited, observedSpanMinutes: over.credited,
  creditedMinutes: over.credited, source: 'umlauftafel', confidence: over.confidence ?? 'exact',
  eligibility: over.eligibility ?? 'qualified', warnings: []
});
const detection = (candidates) => ({ status: 'complete', candidates, warnings: [], statistics: { candidateCount: candidates.length } });
const ELIGIBILITY = { dutyStartMinutes: null, serviceStarts: {} };
const run = (segments, candidates = []) => evaluateOneSixthRule({
  drivingProjection: projection(segments), turnaroundDetection: detection(candidates),
  ruleConfig: CONFIG, context: CONTEXT, eligibility: ELIGIBILITY
});
const one = (...args) => run(...args).services[0];

const DEADHEAD = (duration) => ({ kind: 'deadhead', line: null, duration });
const SERVICE = (line, duration) => ({ kind: 'service', line, duration });

// ===== the two mandated examples =====
test('example 1: 30 min deadhead + 396 min regular line → 426 / 71', () => {
  const s = one([DEADHEAD(30), SERVICE('5', 396)]);
  assert.equal(s.drivingMinutes, 426);
  assert.equal(s.requiredMinutes, 71, 'ceil(426/6)');
  assert.ok(!('exceptedDrivingMinutes' in s), 'SUPERSEDED BY PHASE 3I.15b: no exception bookkeeping');
});
// SUPERSEDED BY PHASE 3I.15b: line 18 admits a duty; it removes nothing from the calculation.
test('SUPERSEDED BY PHASE 3I.15b: 30 min deadhead + 396 min line 18 → 426 / 71', () => {
  const r = run([DEADHEAD(30), SERVICE('18', 396)]);
  const s = r.services[0];
  assert.equal(s.status, 'FAIL', 'assessed, nothing credited');
  assert.notEqual(s.status, 'NOT_APPLICABLE');
  assert.equal(s.drivingMinutes, 426, '30 + 396 — the line-18 time is part of the basis (was 30)');
  assert.equal(s.requiredMinutes, 71, 'ceil(426/6) (was 5)');
  assert.ok(!('exceptedDrivingMinutes' in s));
});
// SUPERSEDED BY PHASE 3I.15b: line 18 admits a duty; it removes nothing from the calculation.
test('SUPERSEDED BY PHASE 3I.15b: a line-18 trip alone is ASSESSED', () => {
  const r = run([SERVICE('18', 396)]);
  assert.notEqual(r.status, 'NOT_APPLICABLE', 'line 18 admits it');
  assert.equal(r.services.length, 1);
  assert.equal(r.services[0].drivingMinutes, 396);
  assert.equal(r.services[0].requiredMinutes, 66, 'ceil(396/6)');
});

// ===== the deadhead run counts in full =====
test('several deadhead runs all count towards the regular basis', () => {
  const s = one([DEADHEAD(30), SERVICE('5', 396), DEADHEAD(24)]);
  assert.equal(s.drivingMinutes, 450);
  assert.equal(s.requiredMinutes, 75);
});
test('a deadhead run is never discounted', () => {
  const withDeadhead = one([DEADHEAD(60), SERVICE('5', 396)]);
  const withoutDeadhead = one([SERVICE('5', 396)]);
  assert.equal(withDeadhead.drivingMinutes - withoutDeadhead.drivingMinutes, 60);
});
// SUPERSEDED BY PHASE 3I.15b: line 18 admits a duty; it removes nothing from the calculation.
test('SUPERSEDED BY PHASE 3I.15b: every segment counts, nothing is excepted', () => {
  const s = one([DEADHEAD(30), SERVICE('18', 396), SERVICE('5', 396)]);
  assert.equal(s.drivingMinutes, 822, '30 + 396 + 396 (was 426)');
  assert.equal(s.requiredMinutes, 137, 'ceil(822/6)');
  assert.ok(!('exceptedDrivingMinutes' in s));
});
test('a deadhead run adds no warning of its own', () => {
  const r = run([DEADHEAD(30), SERVICE('5', 396)]);
  assert.deepEqual(r.warnings.filter(w => /LINE/.test(w.code)), []);
  assert.deepEqual(r.services[0].warnings, []);
});

// ===== the untouched arithmetic =====
test('the ceiling rounding is unchanged', () => {
  assert.equal(one([DEADHEAD(1), SERVICE('5', 0)]).requiredMinutes, 1, 'ceil(1/6) = 1');
  assert.equal(one([DEADHEAD(6), SERVICE('5', 0)]).requiredMinutes, 1);
  assert.equal(one([DEADHEAD(7), SERVICE('5', 0)]).requiredMinutes, 2);
});
test('the 11-minute crediting threshold is unchanged', () => {
  const below = one([DEADHEAD(30), SERVICE('5', 396)], [candidate({ from: '5', to: '5', credited: 10, eligibility: 'below_minimum' })]);
  assert.equal(below.creditedMinutes, 0, 'a candidate below the minimum credits nothing');
  const at = one([DEADHEAD(30), SERVICE('5', 396)], [candidate({ from: '5', to: '5', credited: 11 })]);
  assert.equal(at.creditedMinutes, 11);
});
test('the exact/probable acceptance is unchanged', () => {
  const probable = one([DEADHEAD(30), SERVICE('5', 396)], [candidate({ from: '5', to: '5', credited: 71, confidence: 'probable' })]);
  assert.equal(probable.status, 'PASS');
  const ambiguous = one([DEADHEAD(30), SERVICE('5', 396)], [candidate({ from: '5', to: '5', credited: 71, confidence: 'ambiguous' })]);
  assert.equal(ambiguous.creditedMinutes, 0, 'an ambiguous candidate is not credited');
});
// SUPERSEDED BY PHASE 3I.15b: line 18 admits a duty; it removes nothing from the calculation.
test('SUPERSEDED BY PHASE 3I.15b: every turnaround is an ordinary turnaround', () => {
  const regular = one([DEADHEAD(30), SERVICE('18', 396)], [candidate({ from: '5', to: '5', credited: 71 })]);
  assert.equal(regular.creditedMinutes, 71);
  const onLine18 = one([DEADHEAD(30), SERVICE('18', 396)], [candidate({ from: '18', to: '18', credited: 71 })]);
  assert.equal(onLine18.creditedMinutes, 71, '18 ↔ 18 is credited normally now');
  const mixed = one([DEADHEAD(30), SERVICE('18', 396)], [candidate({ from: '18', to: '5', credited: 71 })]);
  assert.equal(mixed.creditedMinutes, 71, 'a mixed transition is no longer ambiguous');
  assert.equal(mixed.status, 'PASS');
});
test('a duplicate candidate id is still counted once', () => {
  const s = one([DEADHEAD(30), SERVICE('5', 396)], [
    candidate({ id: 'dup', from: '5', to: '5', credited: 71 }),
    candidate({ id: 'dup', from: '5', to: '5', credited: 71 })
  ]);
  assert.equal(s.creditedMinutes, 71, 'no double counting');
});

// ===== result, statistics, validator and adapter =====
test('the statistics stay finite and consistent', () => {
  const s = run([DEADHEAD(30), SERVICE('18', 396), SERVICE('5', 396)]).statistics;
  assert.equal(s.evaluatedServices, 1);
  assert.equal(s.notApplicableServices, 0);
  assert.equal(s.totalDrivingMinutes, 822);   // SUPERSEDED BY PHASE 3I.15b (was 426)
  assert.equal(s.totalRequiredMinutes, 137);
  for (const value of Object.values(s)) assert.ok(Number.isFinite(value), 'no NaN, no Infinity');
});
test('the evaluation passes the existing validator unchanged', () => {
  for (const segments of [[DEADHEAD(30), SERVICE('5', 396)], [DEADHEAD(30), SERVICE('18', 396)], [SERVICE('18', 396)]]) {
    assert.deepEqual(validateOneSixthEvaluation(run(segments), CONFIG).errors, [], JSON.stringify(segments.map(s => s.kind)));
  }
});
test('the adapter mapping is unchanged', () => {
  const mapped = mapOneSixthEvaluationToCheckResult(run([DEADHEAD(30), SERVICE('18', 396)]));
  assert.equal(mapped.status, 'FAIL');
  assert.equal(mapped.severity, 'VIOLATION');
  assert.equal(mapped.details.services[0].drivingMinutes, 426);   // SUPERSEDED BY PHASE 3I.15b (was 30)
});
test('the productive rule set is still disabled', () => {
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false);
  const raw = readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(config.parameters.calculation.deadheadTreatment.value, 'counts_as_driving_time');
  assert.equal(config.parameters.calculation.deadheadTreatment.status, 'confirmed');
});
test('without an eligibility input the full basis is unchanged', () => {
  const r = evaluateOneSixthRule({
    drivingProjection: projection([DEADHEAD(30), SERVICE('18', 396)]),
    turnaroundDetection: detection([]), ruleConfig: CONFIG, context: CONTEXT
  });
  assert.equal(r.services[0].drivingMinutes, 426, 'the whole driving time, as before');
  assert.equal(r.services[0].requiredMinutes, 71);
});
