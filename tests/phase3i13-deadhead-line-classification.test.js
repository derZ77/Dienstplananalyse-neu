import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.13 – the segment classification of the line-18 exception now reads BOTH existing fields,
// `kind` and `line`. A deadhead run has no line by construction, so its missing line is not an
// information gap — it is regular. A SERVICE trip without a line stays undecidable.
import { evaluateOneSixthEligibility, ELIGIBILITY_STATUS } from '../js/v2/analysis/one-sixth-rule.js';

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

const segment = (s, index) => ({
  serviceNumber: '2101', kind: s.kind, line: s.line,
  startMinutes: index * 600, endMinutes: index * 600 + (s.duration ?? 30), durationMinutes: s.duration ?? 30,
  source: { serviceNumber: '2101', activityIndex: index, sourceType: 'pdf' }
});
const projection = (segments) => ({
  metadata: { serviceRegime: 'school', dayType: 'saturday', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100', drivingSegments: segments.map(segment),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: segments.reduce((t, s) => t + (s.duration ?? 30), 0), nonDrivingMinutes: 0, knownTotalMinutes: 0 },
    warnings: []
  }],
  warnings: []
});
const inspect = (segments) => evaluateOneSixthEligibility({
  drivingProjection: projection(segments), ruleConfig: CONFIG, context: CONTEXT,
  eligibility: { dutyStartMinutes: null, serviceStarts: {} }
}).circulations[0];

const DEADHEAD = { kind: 'deadhead', line: null };
const SERVICE_18 = { kind: 'service', line: '18' };
const SERVICE_5 = { kind: 'service', line: '5' };
const SERVICE_UNLINED = { kind: 'service', line: null };

// SUPERSEDED BY PHASE 3I.15b: the classification no longer produces segment exceptions, it
// produces `line18Classification` + `lineAttributionComplete`. Every Phase 3I.13 statement about
// deadhead runs survives: a missing line is NOT a gap for a deadhead run and IS undecidable for a
// line trip; nothing is derived from a code, a depot, a stop, a service number or a vehicle.

// ===== A: a deadhead run without a line is neutral, never a gap =====
test('a deadhead run without a line raises no line warning at all', () => {
  const c = inspect([DEADHEAD, SERVICE_5]);
  assert.deepEqual(c.warnings, [], 'neither SEGMENT_LINE_UNAVAILABLE nor SEGMENT_LINE_AMBIGUOUS');
  assert.equal(c.lineAttributionComplete, true);
});
test('a deadhead run never carries segment-exception bookkeeping', () => {
  const c = inspect([DEADHEAD, SERVICE_5]);
  for (const removed of ['exceptedSegmentIndexes', 'exceptedSegmentCount', 'evaluableSegmentCount']) {
    assert.ok(!(removed in c), `${removed} no longer exists`);
  }
  assert.equal(c.segmentCount, 2, 'both segments stay part of the duty');
});
test('a circulation of deadhead runs only is complete but carries no line information', () => {
  const c = inspect([DEADHEAD, DEADHEAD]);
  assert.equal(c.status, ELIGIBILITY_STATUS.PASS, 'the Saturday day type admits it');
  assert.equal(c.line18Classification, 'NO_LINE_INFORMATION', 'no line performance to classify');
  assert.equal(c.lineAttributionComplete, true, 'a deadhead run is not a gap');
});
test('a deadhead run does not break the purity of a line-18 duty', () => {
  const c = inspect([DEADHEAD, SERVICE_18]);
  assert.equal(c.line18Classification, 'PURE_LINE_18_ONLY');
});

// ===== B/C: the line decides whenever it is known, whatever the kind =====
test('a duty mixing line 18 with another line is classified as mixed', () => {
  const c = inspect([SERVICE_18, SERVICE_5]);
  assert.equal(c.line18Classification, 'MIXED_WITH_OTHER_LINES');
  assert.equal(c.lineAttributionComplete, true);
});
test('a duty of other known lines is classified as mixed and admitted by its day type', () => {
  const c = inspect([SERVICE_5, { kind: 'service', line: '12' }]);
  assert.equal(c.line18Classification, 'MIXED_WITH_OTHER_LINES');
  assert.equal(c.status, ELIGIBILITY_STATUS.PASS);
  assert.equal(c.eligibilityReason, 'WEEKEND');
});
test('a deadhead run that DOES carry line 18 counts towards the purity', () => {
  // Unchanged since Phase 3I.12: a known line always decides — the kind only matters when absent.
  const c = inspect([{ kind: 'deadhead', line: '18' }, SERVICE_18]);
  assert.equal(c.line18Classification, 'PURE_LINE_18_ONLY');
});
test('a deadhead run on another known line breaks the purity', () => {
  const c = inspect([{ kind: 'deadhead', line: '5' }, SERVICE_18]);
  assert.equal(c.line18Classification, 'MIXED_WITH_OTHER_LINES');
});

// ===== D: a service trip without a line stays undecidable =====
test('a service trip without a line makes the attribution incomplete', () => {
  const c = inspect([SERVICE_UNLINED, SERVICE_5]);
  assert.equal(c.lineAttributionComplete, false, 'a real line trip must not be guessed');
  assert.ok(c.warnings.some(w => w.code === 'SEGMENT_LINE_AMBIGUOUS'));
});
test('a service trip without a line is never silently treated as line 18', () => {
  const c = inspect([SERVICE_UNLINED, SERVICE_18]);
  assert.notEqual(c.line18Classification, 'PURE_LINE_18_ONLY', 'purity may not be assumed');
});
test('a deadhead run does not rescue a service trip without a line', () => {
  const c = inspect([DEADHEAD, SERVICE_UNLINED, SERVICE_5]);
  assert.equal(c.lineAttributionComplete, false);
});
test('a circulation of unlined service trips only reports the gap', () => {
  const c = inspect([SERVICE_UNLINED, SERVICE_UNLINED]);
  assert.equal(c.line18Classification, 'NO_LINE_INFORMATION');
  assert.ok(c.warnings.some(w => w.code === 'SEGMENT_LINE_UNAVAILABLE'), 'unchanged since Phase 3I.9');
});

// ===== E: an unknown kind without a line stays conservative =====
test('an unknown segment kind without a line is not silently treated as a deadhead run', () => {
  const c = inspect([{ kind: 'unknown', line: null }, SERVICE_5]);
  assert.equal(c.lineAttributionComplete, false, 'no guessing');
  assert.ok(c.warnings.some(w => w.code === 'SEGMENT_LINE_AMBIGUOUS'));
});
test('a missing segment kind without a line stays conservative too', () => {
  const c = inspect([{ kind: undefined, line: null }, SERVICE_5]);
  assert.equal(c.lineAttributionComplete, false);
});

// ===== no heuristics =====
test('the classification reads nothing but the existing kind and line', () => {
  // Same circulation code, same service number, same times, same durations — only `kind` differs.
  const asService = inspect([SERVICE_UNLINED, SERVICE_18]);
  const asDeadhead = inspect([DEADHEAD, SERVICE_18]);
  assert.equal(asService.lineAttributionComplete, false);
  assert.equal(asDeadhead.line18Classification, 'PURE_LINE_18_ONLY');
});
test('the rule module derives no line from a code, a depot, a stop, a service number or a vehicle', () => {
  const c = inspect([{ kind: 'deadhead', line: null, duration: 30 }]);
  assert.equal(c.line18Classification, 'NO_LINE_INFORMATION', 'no line was invented');
  assert.equal(c.segmentCount, 1);
});
