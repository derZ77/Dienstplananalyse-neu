import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.10b – with an active eligibility input the quota basis is SEGMENT-ADJUSTED: line-18
// segments raise neither the driving minutes nor the required minutes, and their turnarounds are
// not credited to the regular quota. Without an eligibility input everything stays as before.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';

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
      serviceNumber: '2101', kind: 'service', line: s.line,
      startMinutes: i * 600, endMinutes: Number.isFinite(s.duration) ? i * 600 + s.duration : null,
      durationMinutes: s.duration, source: { serviceNumber: '2101', activityIndex: i, sourceType: 'pdf' }
    })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: segments.reduce((t, s) => t + (Number.isFinite(s.duration) ? s.duration : 0), 0), nonDrivingMinutes: 0, knownTotalMinutes: 0 },
    warnings: []
  }],
  warnings: []
});
const candidate = (over) => ({
  id: over.id ?? 'c#1', circulationCode: '11100',
  previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip', line: over.from },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip', line: over.to },
  startMinutes: 360, endMinutes: 360 + (over.credited ?? 66), observedSpanMinutes: over.credited ?? 66,
  creditedMinutes: over.credited ?? 66, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
});
const detection = (candidates) => ({ status: 'complete', candidates, warnings: [], statistics: { candidateCount: candidates.length, qualifiedCount: candidates.length, belowMinimumCount: 0, unresolvedCount: 0 } });
const run = (segments, candidates = [candidate({ from: '12', to: '12' })], eligibility = {}) => evaluateOneSixthRule({
  drivingProjection: projection(segments), turnaroundDetection: detection(candidates), ruleConfig: CONFIG, context: CONTEXT, eligibility
});
const one = (...args) => run(...args).services[0];

// SUPERSEDED BY PHASE 3I.15b — the whole file. The real end-to-end test proved the segment-adjusted
// basis wrong: line 18 ADMITS a duty to the check, it never removes minutes from it. Every
// assertion below now states the corrected arithmetic; the protective half (unknown duration,
// unattributable line, ceiling, 11-minute threshold, exact/probable) is kept and re-asserted.

// ===== there is only ONE basis again: the whole driving time =====
test('a circulation of regular segments keeps the previous quota', () => {
  const s = one([{ line: '12', duration: 396 }]);
  assert.equal(s.drivingMinutes, 396);
  assert.equal(s.requiredMinutes, 66, 'ceil(396/6)');
  assert.equal(s.status, 'PASS');
});
test('SUPERSEDED BY PHASE 3I.15b: a line-18 segment counts towards the basis like any other', () => {
  const s = one([{ line: '18', duration: 396 }, { line: '5', duration: 396 }]);
  assert.equal(s.drivingMinutes, 792, '396 + 396 — nothing is removed (was 396 before)');
  assert.equal(s.requiredMinutes, 132, 'ceil(792/6) = 132 (was 66 before)');
});
test('SUPERSEDED BY PHASE 3I.15b: several line-18 segments all count', () => {
  const s = one([{ line: '18', duration: 300 }, { line: '12', duration: 396 }, { line: '18', duration: 300 }]);
  assert.equal(s.drivingMinutes, 996);
  assert.equal(s.requiredMinutes, 166, 'ceil(996/6)');
});
test('SUPERSEDED BY PHASE 3I.15b: a pure line-18 circulation is ASSESSED, not dismissed', () => {
  const r = run([{ line: '18', duration: 396 }]);
  assert.notEqual(r.status, 'NOT_APPLICABLE', 'line 18 admits the duty');
  assert.equal(r.services.length, 1, 'a quota was computed');
  assert.equal(r.services[0].drivingMinutes, 396, 'its whole driving time');
  assert.equal(r.services[0].requiredMinutes, 66);
});
test('SUPERSEDED BY PHASE 3I.15b: no excepted-time bookkeeping remains', () => {
  const s = one([{ line: '18', duration: 396 }, { line: '5', duration: 396 }]);
  for (const removed of ['exceptedDrivingMinutes', 'exceptedSegmentCount', 'exceptedSegmentIndexes']) {
    assert.ok(!(removed in s), `${removed} must not reduce a quota any more`);
  }
});

// ===== unknown durations: unchanged =====
test('an unknown duration in a line-18 segment now DOES block the evaluation', () => {
  // SUPERSEDED BY PHASE 3I.15b: the segment is part of the basis, so its unknown duration matters.
  const s = one([{ line: '18', duration: null }, { line: '12', duration: 396 }]);
  assert.equal(s.status, 'INCONCLUSIVE');
  assert.equal(s.drivingMinutes, null, 'never substituted by a partial sum');
  assert.equal(s.requiredMinutes, null);
});
test('an unknown duration in a regular segment is still inconclusive', () => {
  const s = one([{ line: '12', duration: null }, { line: '5', duration: 396 }]);
  assert.equal(s.status, 'INCONCLUSIVE');
  assert.equal(s.drivingMinutes, null);
});
test('a genuinely known 0 stays assessable', () => {
  const s = one([{ line: '12', duration: 0 }]);
  assert.equal(s.drivingMinutes, 0);
  assert.equal(s.requiredMinutes, 0);
  assert.notEqual(s.status, 'INCONCLUSIVE');
});

// ===== the protective half of the line attribution =====
test('a partly unknown line attribution is inconclusive on a weekday', () => {
  const weekday = evaluateOneSixthRule({
    drivingProjection: { ...projection([{ line: '18', duration: 396 }, { line: null, duration: 396 }]),
      metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 } },
    turnaroundDetection: detection([]), ruleConfig: CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: 5 * 60, serviceStarts: {} }
  });
  assert.equal(weekday.status, 'INCONCLUSIVE', 'purity may not be assumed');
  assert.deepEqual(weekday.violations, []);
});

// ===== turnarounds are ordinary turnarounds again =====
test('SUPERSEDED BY PHASE 3I.15b: an 18 to 18 turnaround is credited normally', () => {
  const s = one([{ line: '18', duration: 396 }], [candidate({ from: '18', to: '18', credited: 66 })]);
  assert.equal(s.creditedMinutes, 66, 'no longer discarded');
  assert.equal(s.status, 'PASS');
});
test('SUPERSEDED BY PHASE 3I.15b: a mixed 18/12 turnaround is credited normally', () => {
  const s = one([{ line: '18', duration: 396 }, { line: '12', duration: 396 }], [candidate({ from: '18', to: '12', credited: 132 })]);
  assert.equal(s.creditedMinutes, 132, 'no longer ambiguous');
  assert.equal(s.status, 'PASS');
});
test('the 11-minute threshold and the confidence filter are unchanged', () => {
  const below = one([{ line: '12', duration: 396 }], [{ ...candidate({ from: '12', to: '12', credited: 10 }), eligibility: 'below_minimum' }]);
  assert.equal(below.creditedMinutes, 0);
  const ambiguous = one([{ line: '12', duration: 396 }], [{ ...candidate({ from: '12', to: '12', credited: 66 }), confidence: 'ambiguous' }]);
  assert.equal(ambiguous.creditedMinutes, 0);
});
test('the ceiling rounding is unchanged', () => {
  assert.equal(one([{ line: '12', duration: 1 }]).requiredMinutes, 1);
  assert.equal(one([{ line: '12', duration: 6 }]).requiredMinutes, 1);
  assert.equal(one([{ line: '12', duration: 7 }]).requiredMinutes, 2);
});
test('without an eligibility input the behaviour is identical', () => {
  const withEligibility = one([{ line: '18', duration: 396 }, { line: '5', duration: 396 }], [candidate({ from: '12', to: '12' })], { dutyStartMinutes: null, serviceStarts: {} });
  const without = one([{ line: '18', duration: 396 }, { line: '5', duration: 396 }]);
  assert.equal(withEligibility.drivingMinutes, without.drivingMinutes, 'one basis, whatever the input');
  assert.equal(withEligibility.requiredMinutes, without.requiredMinutes);
});
