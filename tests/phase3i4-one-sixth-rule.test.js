import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.4 – the JNV 1/6 rule module. It compares the required creditable turnaround
// (ceil(drivingMinutes / 6)) with the sum of credited turnarounds. Rule only: no CheckModule, no
// runner registration, no UI.
import { evaluateOneSixthRule, ONE_SIXTH_STATUS } from '../js/v2/analysis/one-sixth-rule.js';

const src = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');

// An explicitly enabled TEST configuration — the productive config stays draft/disabled.
const CONFIG = {
  ruleId: 'BV015_BV018',
  enabled: true,
  organizations: ['JNV'],
  modes: ['bus', 'tram'],
  requiredRatioNumerator: 1,
  requiredRatioDenominator: 6,
  roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11,
  creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'],
  locationMismatchBlocksCrediting: false
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const projection = (circulations) => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: circulations.length },
  circulations: circulations.map(c => ({
    code: c.code,
    drivingSegments: (c.serviceNumbers ?? ['2101']).map(sn => ({ serviceNumber: sn, kind: 'service', startMinutes: 0, endMinutes: 10, durationMinutes: 10, source: { serviceNumber: sn, activityIndex: 0, sourceType: 'pdf' } })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: c.drivingMinutes, nonDrivingMinutes: 0, knownTotalMinutes: c.drivingMinutes },
    warnings: []
  })),
  warnings: []
});
const candidate = (over = {}) => ({
  id: over.id ?? `c#${over.n ?? 1}`,
  circulationCode: over.code ?? '11100',
  previousSegmentRef: { circulationCode: over.code ?? '11100', sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: over.code ?? '11100', sequence: 2, type: 'service_trip' },
  startMinutes: 360, endMinutes: 360 + (over.span ?? 15),
  observedSpanMinutes: over.span ?? 15,
  creditedMinutes: (over.span ?? 15) >= 11 ? (over.span ?? 15) : 0,
  source: 'umlauftafel',
  confidence: over.confidence ?? 'exact',
  eligibility: (over.span ?? 15) >= 11 ? 'qualified' : 'below_minimum',
  warnings: over.warnings ?? []
});
const detection = (candidates, status = 'complete') => ({ status, candidates, warnings: [], statistics: { candidateCount: candidates.length, qualifiedCount: candidates.filter(c => c.eligibility === 'qualified').length, belowMinimumCount: candidates.filter(c => c.eligibility === 'below_minimum').length, unresolvedCount: 0 } });

// NB: `in` instead of `??` so an explicitly passed null is honoured rather than defaulted away.
const pick = (over, key, fallback) => (key in over ? over[key] : fallback);
const run = (over = {}) => evaluateOneSixthRule({
  drivingProjection: pick(over, 'drivingProjection', projection([{ code: '11100', drivingMinutes: 396 }])),
  turnaroundDetection: pick(over, 'turnaroundDetection', detection([candidate({ span: 66 })])),
  ruleConfig: pick(over, 'ruleConfig', CONFIG),
  context: pick(over, 'context', CONTEXT)
});
const one = (over) => run(over).services[0];

test('the module contains no check/runner/UI integration and no storage or network', () => {
  assert.doesNotMatch(src, /createCheckModule|runCheckModules|CheckReport|document\.|localStorage|fetch\s*\(|Math\.random|new Date/);
});
test('the closed status vocabulary is PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE/DISABLED', () => {
  assert.deepEqual(Object.values(ONE_SIXTH_STATUS).sort(), ['DISABLED', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'PASS']);
});
test('the result shape is {ruleId, status, services, violations, warnings, statistics}', () => {
  const r = run();
  assert.deepEqual(Object.keys(r).sort(), ['ruleId', 'services', 'statistics', 'status', 'violations', 'warnings']);
  assert.equal(r.ruleId, 'BV015_BV018');
});

// ===== comparison =====
test('exactly meeting the requirement passes (396 driving → 66 required, 66 credited)', () => {
  const s = one();
  assert.equal(s.drivingMinutes, 396);
  assert.equal(s.requiredMinutes, 66);
  assert.equal(s.creditedMinutes, 66);
  assert.equal(s.deficitMinutes, 0);
  assert.equal(s.status, 'PASS');
});
test('exceeding the requirement passes', () => {
  assert.equal(one({ turnaroundDetection: detection([candidate({ span: 80 })]) }).status, 'PASS');
});
test('a one-minute shortfall fails and reports the deficit', () => {
  const s = one({ turnaroundDetection: detection([candidate({ span: 65 })]) });
  assert.equal(s.status, 'FAIL');
  assert.equal(s.creditedMinutes, 65);
  assert.equal(s.requiredMinutes, 66);
  assert.equal(s.deficitMinutes, 1);
});
test('multiple turnarounds are summed', () => {
  const s = one({ turnaroundDetection: detection([candidate({ n: 1, span: 30 }), candidate({ n: 2, span: 36 })]) });
  assert.equal(s.creditedMinutes, 66);
  assert.equal(s.creditedTurnaroundCount, 2);
  assert.equal(s.status, 'PASS');
});

// ===== crediting rules =====
test('a below-minimum candidate credits nothing', () => {
  const s = one({ turnaroundDetection: detection([candidate({ n: 1, span: 66 }), candidate({ n: 2, span: 10 })]) });
  assert.equal(s.creditedMinutes, 66);
  assert.equal(s.creditedTurnaroundCount, 1);
});
test('an 11-minute turnaround credits 11 and a 15-minute one credits 15 (no technical minute deducted)', () => {
  const s = one({ drivingProjection: projection([{ code: '11100', drivingMinutes: 60 }]), turnaroundDetection: detection([candidate({ n: 1, span: 11 }), candidate({ n: 2, span: 15 })]) });
  assert.equal(s.creditedMinutes, 26);
  assert.notEqual(s.creditedMinutes, 24, 'no observed-span-minus-one');
  assert.notEqual(s.creditedMinutes, 20, 'no flat 10-minute crediting');
});
test('exact and probable candidates both count', () => {
  const s = one({ turnaroundDetection: detection([candidate({ n: 1, span: 33, confidence: 'exact' }), candidate({ n: 2, span: 33, confidence: 'probable' })]) });
  assert.equal(s.creditedMinutes, 66);
  assert.equal(s.status, 'PASS');
});
test('a LOCATION_MISMATCH stays a warning and does not block crediting', () => {
  const r = run({ turnaroundDetection: detection([candidate({ span: 66, confidence: 'probable', warnings: ['LOCATION_MISMATCH'] })]) });
  assert.equal(r.services[0].creditedMinutes, 66);
  assert.equal(r.services[0].status, 'PASS');
  assert.ok(r.warnings.some(w => w.code === 'LOCATION_MISMATCH_ACCEPTED'));
});
test('an ambiguous candidate does not count', () => {
  const s = one({ turnaroundDetection: detection([candidate({ n: 1, span: 66, confidence: 'ambiguous' })]) });
  assert.equal(s.creditedMinutes, 0);
  assert.equal(s.status, 'FAIL');
});
test('a duplicate candidate id is counted only once', () => {
  const r = run({ turnaroundDetection: detection([candidate({ id: 'dup', span: 66 }), candidate({ id: 'dup', span: 66 })]) });
  assert.equal(r.services[0].creditedMinutes, 66);
  assert.ok(r.warnings.some(w => w.code === 'DUPLICATE_TURNAROUND'));
});

// ===== ceiling =====
test('the required minutes always round UP to a full minute', () => {
  const required = (drivingMinutes) => one({ drivingProjection: projection([{ code: '11100', drivingMinutes }]) }).requiredMinutes;
  assert.equal(required(396), 66);
  assert.equal(required(397), 67);
  assert.equal(required(400), 67);
  assert.equal(required(401), 67);
});
test('no commercial rounding or flooring is used anywhere in the rule', () => {
  const validationSrc = readFileSync(new URL('../js/v2/analysis/one-sixth-validation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.round|Math\.floor/);
  assert.doesNotMatch(validationSrc, /Math\.round|Math\.floor/);
  // the ceiling lives in the single shared helper that the rule imports
  assert.match(validationSrc, /Math\.ceil/);
  assert.match(src, /requiredTurnaroundMinutes/);
});

// ===== gates =====
test('a disabled rule yields DISABLED without evaluating', () => {
  const r = run({ ruleConfig: { ...CONFIG, enabled: false } });
  assert.equal(r.status, 'DISABLED');
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.services, []);
});
test('an invalid configuration yields DISABLED with a warning', () => {
  const r = run({ ruleConfig: { ...CONFIG, requiredRatioDenominator: 0 } });
  assert.equal(r.status, 'DISABLED');
  assert.ok(r.warnings.some(w => w.code === 'RULE_CONFIG_INVALID'));
});
test('a non-JNV context yields NOT_APPLICABLE', () => {
  const r = run({ context: { organization: 'JES', mode: 'bus' } });
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.ok(r.warnings.some(w => w.code === 'NOT_JNV'));
  assert.deepEqual(r.violations, []);
});
test('an unsupported mode yields NOT_APPLICABLE', () => {
  const r = run({ context: { organization: 'JNV', mode: 'train' } });
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.ok(r.warnings.some(w => w.code === 'UNSUPPORTED_MODE'));
});
test('a missing driving projection yields NOT_APPLICABLE', () => {
  const r = run({ drivingProjection: { metadata: null, circulations: [], warnings: [] } });
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.ok(r.warnings.some(w => w.code === 'INVALID_ONE_SIXTH_INPUT'));
});

// ===== inconclusive =====
test('an unavailable driving time yields INCONCLUSIVE and no violation', () => {
  const r = run({ drivingProjection: projection([{ code: '11100', drivingMinutes: null }]) });
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.deepEqual(r.violations, []);
  assert.ok(r.warnings.some(w => w.code === 'DRIVING_TIME_UNAVAILABLE'));
});
test('unavailable turnaround data yields INCONCLUSIVE, never a fabricated FAIL', () => {
  const r = run({ turnaroundDetection: detection([], 'inconclusive') });
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.deepEqual(r.violations, []);
  assert.ok(r.warnings.some(w => w.code === 'TURNAROUND_DATA_UNAVAILABLE'));
});
test('a missing turnaround detection yields INCONCLUSIVE', () => {
  const r = run({ turnaroundDetection: null });
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.deepEqual(r.violations, []);
});

// ===== violations =====
test('a violation is produced only for a definitive FAIL', () => {
  const failing = run({ turnaroundDetection: detection([candidate({ span: 20 })]) });
  assert.equal(failing.status, 'FAIL');
  assert.equal(failing.violations.length, 1);
  const violation = failing.violations[0];
  assert.equal(violation.ruleId, 'BV015_BV018');
  assert.equal(violation.severity, 'VIOLATION');
  assert.equal(violation.requiredMinutes, 66);
  assert.equal(violation.creditedMinutes, 20);
  assert.equal(violation.deficitMinutes, 46);
  assert.ok(Array.isArray(violation.sourceRefs));
  assert.equal(run().violations.length, 0, 'no violation on PASS');
});

// ===== service assignment =====
test('a circulation with exactly one service number resolves the service', () => {
  const s = one();
  assert.equal(s.serviceNumber, '2101');
  assert.equal(s.circulationCode, '11100');
});
// SUPERSEDED BY PHASE 3I.24 — a circulation driven by two duties is no longer ONE ambiguous unit.
// It is two duty units, each with its own service number. The ambiguity was an artefact of the
// old granularity, not a property of the data.
test('several service numbers in one circulation yield one unit per duty', () => {
  const r = run({ drivingProjection: projection([{ code: '11100', drivingMinutes: 396, serviceNumbers: ['2101', '2102'] }]) });
  assert.equal(r.services.length, 2);
  assert.deepEqual(r.services.map(s => s.serviceNumber).sort(), ['2101', '2102']);
  assert.ok(r.services.every(s => s.circulationCode === '11100'), 'the circulation reference stays on both');
  assert.ok(!r.warnings.some(w => w.code === 'SERVICE_ASSIGNMENT_AMBIGUOUS'), 'nothing is ambiguous any more');
});
test('turnarounds of another circulation are not credited', () => {
  const s = one({ turnaroundDetection: detection([candidate({ code: '99999', span: 66 })]) });
  assert.equal(s.creditedMinutes, 0);
  assert.equal(s.status, 'FAIL');
});

// ===== aggregation and purity =====
test('the top-level status aggregates: any FAIL wins, else any INCONCLUSIVE', () => {
  const two = projection([{ code: 'a', drivingMinutes: 396 }, { code: 'b', drivingMinutes: 396 }]);
  const mixed = detection([candidate({ id: 'a1', code: 'a', span: 66 }), candidate({ id: 'b1', code: 'b', span: 20 })]);
  assert.equal(evaluateOneSixthRule({ drivingProjection: two, turnaroundDetection: mixed, ruleConfig: CONFIG, context: CONTEXT }).status, 'FAIL');
});
test('the statistics are neutral sums', () => {
  const r = run();
  for (const key of ['evaluatedServices', 'passedServices', 'failedServices', 'inconclusiveServices', 'totalDrivingMinutes', 'totalRequiredMinutes', 'totalCreditedMinutes', 'totalDeficitMinutes', 'turnaroundCandidateCount', 'creditedTurnaroundCount']) {
    assert.equal(typeof r.statistics[key], 'number', `missing statistic ${key}`);
  }
  assert.doesNotMatch(JSON.stringify(r.statistics), /score|weight|recommend/i);
});
test('the evaluation is deterministic and does not mutate its inputs', () => {
  const input = { drivingProjection: projection([{ code: '11100', drivingMinutes: 397 }]), turnaroundDetection: detection([candidate({ span: 66 })]), ruleConfig: CONFIG, context: CONTEXT };
  const snapshot = JSON.stringify(input);
  const a = evaluateOneSixthRule(input);
  const b = evaluateOneSixthRule(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
});
test('the productive configuration file stays draft and disabled', () => {
  const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
  assert.equal(config.status, 'approved');   // SUPERSEDED BY PHASE 3I.14 — approval is not activation
  assert.equal(config.parameters.activation.enabled.value, false);
  assert.equal(config.parameters.calculation.roundingRule.value, 'ceil_to_full_minute');
  assert.deepEqual(config.parameters.turnaround.acceptedTurnaroundConfidence.value, ['exact', 'probable']);
  assert.equal(config.parameters.turnaround.locationMismatchBlocksCrediting.value, false);
  assert.equal(config.parameters.turnaround.locationMismatchProducesWarning.value, true);
});
