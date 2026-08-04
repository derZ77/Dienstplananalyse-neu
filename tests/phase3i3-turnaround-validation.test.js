import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.3 – structural validators for turnaround candidates and detection results.
// Structure and closed vocabularies only; no rule semantics, no aggregation.
import { validateTurnaroundCandidate, validateTurnaroundDetectionResult } from '../js/v2/rules/one-sixth-turnaround-validation.js';

const candidate = (over = {}) => ({
  id: '11100#1->2',
  circulationCode: '11100',
  previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip' },
  startMinutes: 360,
  endMinutes: 375,
  observedSpanMinutes: 15,
  creditedMinutes: 15,
  source: 'umlauftafel',
  confidence: 'exact',
  eligibility: 'qualified',
  warnings: [],
  ...over
});
const result = (over = {}) => ({
  status: 'complete',
  candidates: [candidate()],
  warnings: [],
  statistics: { candidateCount: 1, qualifiedCount: 1, belowMinimumCount: 0, unresolvedCount: 0 },
  ...over
});

test('a well-formed candidate validates', () => {
  assert.deepEqual(validateTurnaroundCandidate(candidate()), { valid: true, errors: [] });
});
test('a well-formed detection result validates', () => {
  assert.deepEqual(validateTurnaroundDetectionResult(result()), { valid: true, errors: [] });
});
test('non-objects are rejected without throwing', () => {
  assert.equal(validateTurnaroundCandidate(null).valid, false);
  assert.equal(validateTurnaroundDetectionResult(null).valid, false);
  assert.equal(validateTurnaroundDetectionResult([]).valid, false);
});

// ===== closed vocabularies =====
test('foreign status, source, confidence or eligibility values are rejected', () => {
  assert.equal(validateTurnaroundDetectionResult(result({ status: 'PASS' })).valid, false);
  assert.equal(validateTurnaroundCandidate(candidate({ source: 'guess' })).valid, false);
  assert.equal(validateTurnaroundCandidate(candidate({ confidence: 'certain' })).valid, false);
  assert.equal(validateTurnaroundCandidate(candidate({ eligibility: 'FAIL' })).valid, false);
});

// ===== time and crediting consistency =====
test('negative or inconsistent minutes are rejected', () => {
  assert.equal(validateTurnaroundCandidate(candidate({ startMinutes: -1 })).valid, false);
  assert.equal(validateTurnaroundCandidate(candidate({ endMinutes: 350 })).valid, false, 'end must not precede start');
  assert.equal(validateTurnaroundCandidate(candidate({ observedSpanMinutes: 99 })).valid, false, 'span must equal end - start');
});
test('the crediting contract is enforced: below 11 credits 0, from 11 the full span', () => {
  assert.equal(validateTurnaroundCandidate(candidate({ endMinutes: 370, observedSpanMinutes: 10, creditedMinutes: 10, eligibility: 'below_minimum' })).valid, false,
    'a 10-minute span must not credit 10 minutes');
  assert.deepEqual(validateTurnaroundCandidate(candidate({ endMinutes: 370, observedSpanMinutes: 10, creditedMinutes: 0, eligibility: 'below_minimum' })), { valid: true, errors: [] });
  assert.equal(validateTurnaroundCandidate(candidate({ creditedMinutes: 14 })).valid, false, 'no technical minute may be deducted');
  assert.equal(validateTurnaroundCandidate(candidate({ creditedMinutes: 10 })).valid, false, 'no flat-rate crediting');
});
test('the eligibility must match the observed span', () => {
  assert.equal(validateTurnaroundCandidate(candidate({ endMinutes: 370, observedSpanMinutes: 10, creditedMinutes: 0, eligibility: 'qualified' })).valid, false);
  assert.equal(validateTurnaroundCandidate(candidate({ eligibility: 'below_minimum', creditedMinutes: 0 })).valid, false, '15 minutes cannot be below the minimum');
});

// ===== ids, refs, privacy =====
test('duplicate candidate ids are rejected', () => {
  const duplicate = result({ candidates: [candidate(), candidate()], statistics: { candidateCount: 2, qualifiedCount: 2, belowMinimumCount: 0, unresolvedCount: 0 } });
  const v = validateTurnaroundDetectionResult(duplicate);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some(e => e.code === 'DUPLICATE_CANDIDATE_ID'));
});
test('segment references must be small and privacy-safe', () => {
  assert.equal(validateTurnaroundCandidate(candidate({ previousSegmentRef: { originalText: 'A/B 05:00 Depot' } })).valid, false);
  assert.equal(validateTurnaroundCandidate(candidate({ nextSegmentRef: { boundingBox: [1, 2, 3, 4] } })).valid, false);
});
test('file, workbook or byte objects are rejected', () => {
  assert.equal(validateTurnaroundCandidate(candidate({ previousSegmentRef: { buffer: new Uint8Array(2) } })).valid, false);
});
test('unknown warning codes are rejected', () => {
  assert.equal(validateTurnaroundDetectionResult(result({ warnings: [{ code: 'SOMETHING_ELSE' }] })).valid, false);
  assert.deepEqual(validateTurnaroundDetectionResult(result({ warnings: [{ code: 'LOCATION_MISMATCH' }] })), { valid: true, errors: [] });
});
test('no warning code expresses a rule violation', () => {
  assert.equal(validateTurnaroundDetectionResult(result({ warnings: [{ code: 'ONE_SIXTH_VIOLATED' }] })).valid, false);
});

// ===== purity =====
test('the validators never mutate or repair their input', () => {
  const c = candidate({ creditedMinutes: 14 });
  const snapshot = JSON.stringify(c);
  validateTurnaroundCandidate(c);
  assert.equal(JSON.stringify(c), snapshot);
  const r = result({ status: 'PASS' });
  const rs = JSON.stringify(r);
  validateTurnaroundDetectionResult(r);
  assert.equal(JSON.stringify(r), rs);
});
test('errors are reported as {code,path} without raw values', () => {
  const v = validateTurnaroundCandidate(candidate({ confidence: 'certain' }));
  assert.equal(v.valid, false);
  for (const error of v.errors) {
    assert.deepEqual(Object.keys(error).sort(), ['code', 'path']);
    assert.doesNotMatch(JSON.stringify(error), /certain/);
  }
});
