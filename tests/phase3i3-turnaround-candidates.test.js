import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.3 – technical turnaround CANDIDATE detection only. It finds trip-to-trip transitions
// and projects the agreed 11-minute crediting contract onto them. It evaluates no rule: no
// one-sixth sum, no verdict, no violation.
import {
  detectTurnaroundCandidates,
  TURNAROUND_STATUSES,
  TURNAROUND_SOURCES,
  TURNAROUND_CONFIDENCE,
  TURNAROUND_ELIGIBILITY
} from '../js/v2/rules/one-sixth-turnaround-candidates.js';
import { createUmlauftafelDocument, createValidity, createCirculation, createSegment, createStopEvent, createNormalizedTime } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const src = readFileSync(new URL('../js/v2/rules/one-sixth-turnaround-candidates.js', import.meta.url), 'utf8');

const at = (minutes, { rollover = false } = {}) => createNormalizedTime({
  raw: '—', hour: Math.floor((minutes % 1440) / 60), minute: minutes % 60,
  dayOffset: Math.floor(minutes / 1440), role: 'event', confidence: rollover ? 'inferred_rollover' : 'exact'
});
const stop = (name, minutes, role, opts) => createStopEvent({ sequence: 1, name, role, time: minutes == null ? null : at(minutes, opts) });
// a trip from `from`@dep to `to`@arr
const trip = (seq, { from, dep, to, arr, line = '12', type = 'service_trip', rollover = false }) => createSegment({
  type, sequence: seq, line,
  stops: [stop(from, dep, 'departure'), stop(to, arr, 'arrival', { rollover })]
});
const doc = (circulations, mode = 'bus') => createUmlauftafelDocument({
  mode, validity: createValidity({ serviceRegime: 'holidays', dayType: 'mo_fr' }), circulations
});
const circ = (code, segments) => createCirculation({ code, mode: 'bus', segments });
// two consecutive trips with a controllable gap at the same endpoint
const pairDoc = (gapMinutes, over = {}) => doc([circ(over.code ?? '11100', [
  trip(1, { from: 'Hof', dep: 300, to: over.endStop ?? 'Zentrum', arr: 360, rollover: over.rollover }),
  trip(2, { from: over.nextStart ?? 'Zentrum', dep: 360 + gapMinutes, to: 'Hof', arr: 360 + gapMinutes + 50, line: over.line ?? '12' })
])]);
const run = (input) => detectTurnaroundCandidates(input);
const first = (input) => run(input).candidates[0];

test('the module contains no rule evaluation and no verdict vocabulary', () => {
  assert.doesNotMatch(src, /\bPASS\b|\bFAIL\b|VIOLATION|requiredCreditable|\/\s*6\b|oneSixthSum|localStorage|fetch\s*\(|Math\.random/);
});
test('the closed vocabularies match the contract', () => {
  assert.deepEqual([...TURNAROUND_STATUSES].sort(), ['complete', 'inconclusive', 'not_applicable', 'partial']);
  assert.deepEqual([...TURNAROUND_SOURCES].sort(), ['schedule_fallback', 'schedule_structured', 'umlauftafel']);
  assert.deepEqual([...TURNAROUND_CONFIDENCE].sort(), ['ambiguous', 'exact', 'probable']);
  assert.deepEqual([...TURNAROUND_ELIGIBILITY].sort(), ['below_minimum', 'qualified', 'unresolved']);
});
test('the result shape is {status, candidates, warnings, statistics}', () => {
  const r = run({ umlauftafelDocument: pairDoc(15) });
  assert.deepEqual(Object.keys(r).sort(), ['candidates', 'statistics', 'status', 'warnings']);
});

// ===== the 11-minute crediting contract =====
test('a 10-minute transition is below the minimum and credits nothing', () => {
  const c = first({ umlauftafelDocument: pairDoc(10) });
  assert.equal(c.observedSpanMinutes, 10);
  assert.equal(c.eligibility, 'below_minimum');
  assert.equal(c.creditedMinutes, 0);
});
test('an 11-minute transition qualifies and credits the full span', () => {
  const c = first({ umlauftafelDocument: pairDoc(11) });
  assert.equal(c.observedSpanMinutes, 11);
  assert.equal(c.eligibility, 'qualified');
  assert.equal(c.creditedMinutes, 11);
});
test('a 15-minute transition credits 15 minutes (no technical minute deducted)', () => {
  const c = first({ umlauftafelDocument: pairDoc(15) });
  assert.equal(c.creditedMinutes, 15);
  assert.notEqual(c.creditedMinutes, 14);
  assert.notEqual(c.creditedMinutes, 10);
});

// ===== transition rules =====
test('the candidate carries the circulation code, both segment refs and the time window', () => {
  const c = first({ umlauftafelDocument: pairDoc(12) });
  assert.equal(c.circulationCode, '11100');
  assert.equal(c.startMinutes, 360);
  assert.equal(c.endMinutes, 372);
  assert.ok(c.previousSegmentRef && c.nextSegmentRef);
  assert.equal(c.source, 'umlauftafel');
});
test('leading zeros in the circulation code are preserved', () => {
  const c = first({ umlauftafelDocument: pairDoc(12, { code: '01100' }) });
  assert.equal(c.circulationCode, '01100');
});
test('the line may change while the circulation stays the same', () => {
  const c = first({ umlauftafelDocument: pairDoc(12, { line: '18' }) });
  assert.equal(c.eligibility, 'qualified');
  assert.equal(c.circulationCode, '11100');
});
test('a transition across midnight is measured in absolute minutes', () => {
  const d = doc([circ('11100', [
    trip(1, { from: 'Hof', dep: 1400, to: 'Zentrum', arr: 1435 }),
    trip(2, { from: 'Zentrum', dep: 1450, to: 'Hof', arr: 1500 })
  ])]);
  const c = first({ umlauftafelDocument: d });
  assert.equal(c.observedSpanMinutes, 15);
  assert.equal(c.eligibility, 'qualified');
});
test('an inferred day rollover lowers the confidence to probable', () => {
  const c = first({ umlauftafelDocument: pairDoc(15, { rollover: true }) });
  assert.equal(c.confidence, 'probable');
});

// ===== location rule =====
test('an identical endpoint and next start point yields exact confidence', () => {
  assert.equal(first({ umlauftafelDocument: pairDoc(15) }).confidence, 'exact');
});
test('a differing endpoint yields probable and a location warning, never exact', () => {
  const r = run({ umlauftafelDocument: pairDoc(15, { nextStart: 'Nordplatz' }) });
  assert.equal(r.candidates[0].confidence, 'probable');
  assert.ok(r.candidates[0].warnings.includes('LOCATION_MISMATCH') || r.warnings.some(w => w.code === 'LOCATION_MISMATCH'));
});

// ===== non-turnaround transitions =====
test('a deadhead between two trips prevents a direct turnaround candidate', () => {
  const d = doc([circ('11100', [
    trip(1, { from: 'Hof', dep: 300, to: 'Zentrum', arr: 360 }),
    trip(2, { from: 'Zentrum', dep: 365, to: 'Depot', arr: 375, type: 'deadhead' }),
    trip(3, { from: 'Depot', dep: 400, to: 'Hof', arr: 450 })
  ])]);
  const r = run({ umlauftafelDocument: d });
  assert.equal(r.candidates.length, 0, 'no candidate spans the deadhead');
  assert.ok(r.warnings.some(w => w.code === 'DEADHEAD_BETWEEN_TRIPS'));
});
test('a depot transition is not automatically creditable', () => {
  const d = doc([circ('11100', [
    trip(1, { from: 'Hof', dep: 300, to: 'Depot', arr: 360, type: 'deadhead' }),
    trip(2, { from: 'Depot', dep: 380, to: 'Zentrum', arr: 430 })
  ])]);
  const r = run({ umlauftafelDocument: d });
  assert.equal(r.candidates.length, 0);
  assert.ok(r.warnings.some(w => ['DEPOT_TRANSITION_NOT_CREDITABLE', 'DEADHEAD_BETWEEN_TRIPS'].includes(w.code)));
});
test('an unknown segment between two trips produces no candidate', () => {
  const d = doc([circ('11100', [
    trip(1, { from: 'Hof', dep: 300, to: 'Zentrum', arr: 360 }),
    createSegment({ type: 'unknown', sequence: 2 }),
    trip(3, { from: 'Zentrum', dep: 400, to: 'Hof', arr: 450 })
  ])]);
  assert.equal(run({ umlauftafelDocument: d }).candidates.length, 0);
});

// ===== defects =====
test('overlapping trips produce a warning and no candidate', () => {
  const d = doc([circ('11100', [
    trip(1, { from: 'Hof', dep: 300, to: 'Zentrum', arr: 400 }),
    trip(2, { from: 'Zentrum', dep: 380, to: 'Hof', arr: 450 })
  ])]);
  const r = run({ umlauftafelDocument: d });
  assert.equal(r.candidates.length, 0);
  assert.ok(r.warnings.some(w => w.code === 'OVERLAPPING_TRIPS'));
});
test('a missing time yields inconclusive and no invented candidate', () => {
  const d = doc([circ('11100', [
    trip(1, { from: 'Hof', dep: 300, to: 'Zentrum', arr: null }),
    trip(2, { from: 'Zentrum', dep: 380, to: 'Hof', arr: 450 })
  ])]);
  const r = run({ umlauftafelDocument: d });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.status, 'inconclusive');
  assert.ok(r.warnings.some(w => w.code === 'MISSING_SEGMENT_TIME'));
});
test('no usable source yields not_applicable without throwing', () => {
  let r;
  assert.doesNotThrow(() => { r = run({}); });
  assert.equal(r.status, 'not_applicable');
  assert.deepEqual(r.candidates, []);
  assert.ok(r.warnings.some(w => w.code === 'INVALID_TURNAROUND_INPUT'));
});

// ===== double counting =====
test('each trip transition appears at most once, with a deterministic id', () => {
  const r = run({ umlauftafelDocument: pairDoc(15) });
  assert.equal(r.candidates.length, 1);
  const ids = r.candidates.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(r.candidates.map(c => c.id), detectTurnaroundCandidates({ umlauftafelDocument: pairDoc(15) }).candidates.map(c => c.id));
});
test('the Umlauftafel wins over the schedule: no parallel counting', () => {
  const scheduleView = { services: [{ serviceNumber: '2101', activities: [] }] };
  const r = run({ umlauftafelDocument: pairDoc(15), scheduleView });
  assert.equal(r.candidates.length, 1);
  assert.ok(r.candidates.every(c => c.source === 'umlauftafel'));
});

// ===== purity =====
test('detection is deterministic and does not mutate its input', () => {
  const input = { umlauftafelDocument: pairDoc(15) };
  const snapshot = JSON.stringify(input);
  const a = detectTurnaroundCandidates(input);
  const b = detectTurnaroundCandidates(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot);
});
test('statistics are neutral counts without any rule outcome', () => {
  const r = run({ umlauftafelDocument: pairDoc(15) });
  assert.equal(typeof r.statistics.candidateCount, 'number');
  assert.equal(typeof r.statistics.qualifiedCount, 'number');
  assert.equal(typeof r.statistics.belowMinimumCount, 'number');
  assert.doesNotMatch(JSON.stringify(r.statistics), /pass|fail|violation|required/i);
});
