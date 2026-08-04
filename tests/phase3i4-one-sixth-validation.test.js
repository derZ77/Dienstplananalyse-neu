import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.4 – validators for the 1/6 rule configuration and evaluation. Structure, closed
// vocabularies and the ceiling/deficit consistency only; no rule execution.
import { validateOneSixthRuleConfig, validateOneSixthEvaluation } from '../js/v2/analysis/one-sixth-validation.js';

const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false
};
const service = (over = {}) => ({
  serviceNumber: '2101', circulationCode: '11100', status: 'PASS',
  drivingMinutes: 396, requiredMinutes: 66, creditedMinutes: 66, deficitMinutes: 0,
  turnaroundCount: 1, creditedTurnaroundCount: 1, warnings: [], violations: [], ...over
});
const evaluation = (over = {}) => ({
  ruleId: 'BV015_BV018', status: 'PASS', services: [service()], violations: [], warnings: [],
  statistics: { evaluatedServices: 1, passedServices: 1, failedServices: 0, inconclusiveServices: 0, totalDrivingMinutes: 396, totalRequiredMinutes: 66, totalCreditedMinutes: 66, totalDeficitMinutes: 0, turnaroundCandidateCount: 1, creditedTurnaroundCount: 1 },
  ...over
});
const violation = (over = {}) => ({ ruleId: 'BV015_BV018', serviceNumber: '2101', circulationCode: '11100', severity: 'VIOLATION', drivingMinutes: 396, requiredMinutes: 66, creditedMinutes: 20, deficitMinutes: 46, sourceRefs: [{ circulationCode: '11100', sequence: 1, type: 'service_trip' }], ...over });

// ===== configuration =====
test('the shipped productive configuration validates', () => {
  const raw = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
  const p = raw.parameters;
  const projected = {
    ruleId: raw.parameters.activation.ruleIds.value.join('_'),
    enabled: p.activation.enabled.value,
    organizations: p.scope.organizations.value,
    modes: p.scope.modes.value,
    requiredRatioNumerator: p.calculation.requiredRatioNumerator.value,
    requiredRatioDenominator: p.calculation.requiredRatioDenominator.value,
    roundingRule: p.calculation.roundingRule.value,
    minimumObservedSpanMinutes: p.turnaround.minimumObservedSpanMinutes.value,
    creditingMethod: p.turnaround.creditingMethod.value,
    acceptedTurnaroundConfidence: p.turnaround.acceptedTurnaroundConfidence.value,
    locationMismatchBlocksCrediting: p.turnaround.locationMismatchBlocksCrediting.value
  };
  assert.deepEqual(validateOneSixthRuleConfig(projected), { valid: true, errors: [] });
});
test('a well-formed configuration validates and defects are rejected', () => {
  assert.deepEqual(validateOneSixthRuleConfig(CONFIG), { valid: true, errors: [] });
  const bad = (over) => validateOneSixthRuleConfig({ ...CONFIG, ...over }).valid;
  assert.equal(validateOneSixthRuleConfig(null).valid, false);
  assert.equal(bad({ enabled: 'yes' }), false);
  assert.equal(bad({ organizations: [] }), false);
  assert.equal(bad({ modes: ['train'] }), false);
  assert.equal(bad({ requiredRatioDenominator: 0 }), false);
  assert.equal(bad({ roundingRule: 'round_half_up' }), false, 'only the ceiling rule is allowed');
  assert.equal(bad({ minimumObservedSpanMinutes: 0 }), false);
  assert.equal(bad({ acceptedTurnaroundConfidence: ['certain'] }), false);
  assert.equal(bad({ creditingMethod: 'flat_rate' }), false);
});

// ===== evaluation =====
test('a valid PASS and a valid FAIL evaluation validate', () => {
  assert.deepEqual(validateOneSixthEvaluation(evaluation()), { valid: true, errors: [] });
  const failing = evaluation({
    status: 'FAIL',
    services: [service({ status: 'FAIL', creditedMinutes: 20, deficitMinutes: 46, violations: [violation()] })],
    violations: [violation()],
    statistics: { evaluatedServices: 1, passedServices: 0, failedServices: 1, inconclusiveServices: 0, totalDrivingMinutes: 396, totalRequiredMinutes: 66, totalCreditedMinutes: 20, totalDeficitMinutes: 46, turnaroundCandidateCount: 1, creditedTurnaroundCount: 1 }
  });
  assert.deepEqual(validateOneSixthEvaluation(failing), { valid: true, errors: [] });
});
test('an out-of-vocabulary status is rejected', () => {
  assert.equal(validateOneSixthEvaluation(evaluation({ status: 'MAYBE' })).valid, false);
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ status: 'OK' })] })).valid, false);
  assert.equal(validateOneSixthEvaluation(null).valid, false);
});
test('a wrongly rounded requirement is rejected', () => {
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ drivingMinutes: 397, requiredMinutes: 66 })] })).valid, false, '397/6 must round up to 67');
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ drivingMinutes: 397, requiredMinutes: 67, creditedMinutes: 67 })] })).valid, true);
});
test('an inconsistent deficit is rejected', () => {
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ creditedMinutes: 20, deficitMinutes: 0, status: 'FAIL' })] })).valid, false);
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ deficitMinutes: 5 })] })).valid, false, 'a PASS has no deficit');
});
test('a PASS/FAIL inconsistency is rejected', () => {
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ status: 'PASS', creditedMinutes: 20, deficitMinutes: 46 })] })).valid, false);
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ status: 'FAIL', creditedMinutes: 66, deficitMinutes: 0 })] })).valid, false);
});
test('a violation without a definitive FAIL is rejected', () => {
  assert.equal(validateOneSixthEvaluation(evaluation({ violations: [violation()] })).valid, false, 'no violation on PASS');
  assert.equal(validateOneSixthEvaluation(evaluation({ status: 'INCONCLUSIVE', services: [service({ status: 'INCONCLUSIVE', requiredMinutes: 0, creditedMinutes: 0 })], violations: [violation()] })).valid, false);
});
test('missing fields and negative minutes are rejected', () => {
  assert.equal(validateOneSixthEvaluation(evaluation({ ruleId: undefined })).valid, false);
  assert.equal(validateOneSixthEvaluation(evaluation({ services: null })).valid, false);
  assert.equal(validateOneSixthEvaluation(evaluation({ services: [service({ drivingMinutes: -1 })] })).valid, false);
  assert.equal(validateOneSixthEvaluation(evaluation({ statistics: { ...evaluation().statistics, totalDeficitMinutes: -5 } })).valid, false);
});
test('duplicate service entries are rejected', () => {
  const duplicate = evaluation({ services: [service(), service()], statistics: { ...evaluation().statistics, evaluatedServices: 2, passedServices: 2 } });
  const result = validateOneSixthEvaluation(duplicate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.code === 'DUPLICATE_SERVICE_ENTRY'));
});
test('unsafe source references and payload objects are rejected', () => {
  assert.equal(validateOneSixthEvaluation(evaluation({ status: 'FAIL', services: [service({ status: 'FAIL', creditedMinutes: 20, deficitMinutes: 46 })], violations: [violation({ sourceRefs: [{ originalText: 'A/B 05:00 Depot' }] })] })).valid, false);
  assert.equal(validateOneSixthEvaluation(evaluation({ status: 'FAIL', services: [service({ status: 'FAIL', creditedMinutes: 20, deficitMinutes: 46 })], violations: [violation({ sourceRefs: [{ buffer: new Uint8Array(2) }] })] })).valid, false);
});
test('the validators never mutate or repair their input', () => {
  const target = evaluation({ services: [service({ drivingMinutes: 397, requiredMinutes: 66 })] });
  const snapshot = JSON.stringify(target);
  validateOneSixthEvaluation(target);
  assert.equal(JSON.stringify(target), snapshot);
  const config = { ...CONFIG, roundingRule: 'round_half_up' };
  const configSnapshot = JSON.stringify(config);
  validateOneSixthRuleConfig(config);
  assert.equal(JSON.stringify(config), configSnapshot);
});
test('errors are reported as {code,path} without raw values', () => {
  const result = validateOneSixthRuleConfig({ ...CONFIG, roundingRule: 'round_half_up' });
  assert.equal(result.valid, false);
  for (const error of result.errors) {
    assert.deepEqual(Object.keys(error).sort(), ['code', 'path']);
    assert.doesNotMatch(JSON.stringify(error), /round_half_up/);
  }
});
