import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3H.2 – neutral driving/interruption projection over a joint timeline. DATA ONLY:
// no 4:30 rule, no 1/6, no BV/ArbZG, no thresholds, no violations, no recommendations.
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';
import { validateDrivingProjection } from '../js/v2/analysis/driving-projection-validation.js';

const src = readFileSync(new URL('../js/v2/analysis/driving-projection.js', import.meta.url), 'utf8');

const seg = (o) => ({
  serviceNumber: o.svc ?? '2101', line: o.line ?? '12', course: o.course ?? '1', trip: o.trip ?? null,
  departure: o.dep ?? null, arrival: o.arr ?? null, dayOffset: o.off ?? 0, durationMinutes: o.dur ?? null,
  source: { serviceNumber: o.svc ?? '2101', activityIndex: o.idx ?? 0, sourceType: 'pdf' }, kind: o.kind ?? 'service'
});
const circ = (code, segments, services = ['2101']) => ({ code, services, segments, start: { time: null, dayOffset: 0 }, end: { time: null, dayOffset: 0 }, statistics: {} });
const jt = (circulations) => ({ metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'jnv-structural-exact-match', circulationCount: circulations.length }, circulations, warnings: [] });
const project = (circulations, interruptions) => createDrivingProjection({ jointTimeline: jt(circulations), interruptions });
const one = (circulations, interruptions) => project(circulations, interruptions).circulations[0];

test('no rule / threshold / scoring in the projection module', () => {
  assert.doesNotMatch(src, /4:30|45 Minuten|15 Minuten|30 Minuten|Lenkzeit|1\/6|BV0|ArbZG|Fahrpersonal|Verstoß|Empfehlung|\bscore\b|weight|fuzzy|OCR|Math\.random|localStorage|fetch\s*\(/i);
});

test('a not-applicable joint timeline yields a controlled result (no throw)', () => {
  let r;
  assert.doesNotThrow(() => { r = createDrivingProjection({ jointTimeline: { metadata: null, circulations: [], warnings: [] } }); });
  assert.equal(r.metadata, null);
  assert.deepEqual(r.circulations, []);
  assert.ok(r.warnings.some(w => w.code === 'INVALID_JOINT_TIMELINE'));
});

// SUPERSEDED BY PHASE 3I.10: the metadata additionally forwards the already known `dutyStartTime`
// (null unless the caller supplies it). The top-level shape and every previous key are unchanged.
test('the output has exactly metadata, circulations, warnings; metadata mirrors the joint timeline', () => {
  const r = project([circ('12100', [seg({ dep: '05:00', dur: 60 })])]);
  assert.deepEqual(Object.keys(r).sort(), ['circulations', 'metadata', 'warnings']);
  assert.deepEqual(Object.keys(r.metadata).sort(), ['circulationCount', 'dayType', 'dutyStartTime', 'generatedFrom', 'serviceRegime']);
  assert.equal(r.metadata.serviceRegime, 'school');
  assert.equal(r.metadata.dutyStartTime, null, 'unknown unless the caller supplies it');
});

test('a circulation exposes the six projection collections', () => {
  const c = one([circ('12100', [seg({ dep: '05:00', dur: 60 })])]);
  assert.deepEqual(Object.keys(c).sort(), ['code', 'drivingBlocks', 'drivingSegments', 'interruptionIntervals', 'nonDrivingIntervals', 'statistics', 'warnings']);
  assert.equal(c.code, '12100');
});

test('only service and deadhead count as driving segments', () => {
  const c = one([circ('1', [seg({ dep: '05:00', dur: 60, kind: 'service' }), seg({ dep: '06:00', dur: 20, kind: 'deadhead', idx: 1 }), seg({ dep: '06:20', dur: 30, kind: 'unknown', idx: 2 })])]);
  assert.equal(c.drivingSegments.length, 2);
  assert.equal(c.statistics.drivingSegmentCount, 2);
});

test('contiguous driving segments form a single block; a pure time gap does NOT split it', () => {
  const c = one([circ('1', [seg({ dep: '05:00', dur: 60 }), seg({ dep: '07:00', dur: 60, idx: 1 })])]); // 06:00 → 07:00 gap
  assert.equal(c.drivingBlocks.length, 1);
  assert.equal(c.drivingBlocks[0].startMinutes, 300);
  assert.equal(c.drivingBlocks[0].endMinutes, 480);
  assert.equal(c.drivingBlocks[0].durationMinutes, 180);
  const gap = c.nonDrivingIntervals.find(i => i.classification === 'gap');
  assert.ok(gap && gap.durationMinutes === 60 && gap.explicit === false);
});

test('an explicit break/layover segment splits driving blocks and is an interruption', () => {
  const c = one([circ('1', [seg({ dep: '05:00', dur: 60 }), seg({ dep: '06:00', dur: 30, kind: 'break', idx: 1 }), seg({ dep: '06:30', dur: 60, idx: 2 })])]);
  assert.equal(c.drivingBlocks.length, 2);
  assert.ok(c.interruptionIntervals.some(i => i.sourceType === 'break' && i.explicit === true));
  assert.ok(c.nonDrivingIntervals.some(i => i.classification === 'break'));
});

test('a structured service interruption is an explicit interruption interval', () => {
  const c = project([circ('1', [seg({ dep: '05:00', dur: 60 }), seg({ dep: '08:00', dur: 60, idx: 1 })], ['2101'])], [{ serviceNumber: '2101', startMinutes: 360, endMinutes: 480, durationMinutes: 120 }]).circulations[0];
  assert.ok(c.interruptionIntervals.some(i => i.sourceType === 'service_interruption' && i.explicit === true && i.durationMinutes === 120));
  assert.ok(c.nonDrivingIntervals.some(i => i.classification === 'service_interruption'));
});

test('an unknown segment stays unknown (non-driving) and is not a driving block', () => {
  const c = one([circ('1', [seg({ dep: '05:00', dur: 60, kind: 'unknown' })])]);
  assert.equal(c.drivingSegments.length, 0);
  assert.equal(c.drivingBlocks.length, 0);
  assert.ok(c.nonDrivingIntervals.some(i => i.classification === 'unknown'));
  assert.ok(c.warnings.some(w => w.code === 'UNKNOWN_SEGMENT_KIND'));
});

test('a midnight crossing (dayOffset) is preserved in absolute minutes', () => {
  const c = one([circ('1', [seg({ dep: '23:30', dur: 60, off: 0 }), seg({ dep: '00:30', dur: 30, off: 1, idx: 1 })])]);
  assert.equal(c.drivingBlocks.length, 1);
  assert.equal(c.drivingBlocks[0].startMinutes, 1410); // 23:30
  assert.equal(c.drivingBlocks[0].endMinutes, 1470 + 30); // 00:30 (+1 day) + 30
});

test('overlapping segments and missing times raise controlled warnings', () => {
  const overlap = one([circ('1', [seg({ dep: '05:00', dur: 90 }), seg({ dep: '06:00', dur: 60, idx: 1 })])]); // 05:00-06:30 overlaps 06:00
  assert.ok(overlap.warnings.some(w => w.code === 'OVERLAPPING_SEGMENTS'));
  const missing = one([circ('1', [seg({ dep: null, dur: null })])]);
  assert.ok(missing.warnings.some(w => w.code === 'MISSING_SEGMENT_TIME'));
});

test('the projection is deterministic, JSON-compatible, and does not mutate inputs', () => {
  const input = { jointTimeline: jt([circ('12100', [seg({ dep: '05:00', dur: 60 }), seg({ dep: '06:30', dur: 30, kind: 'deadhead', idx: 1 })])]), interruptions: [{ serviceNumber: '2101', startMinutes: 360, endMinutes: 390, durationMinutes: 30 }] };
  const snap = JSON.stringify(input);
  const a = createDrivingProjection(input);
  const b = createDrivingProjection(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snap);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
});

test('block statistics are neutral counts and minutes only', () => {
  const c = one([circ('1', [seg({ dep: '05:00', dur: 60 }), seg({ dep: '06:00', dur: 20, kind: 'deadhead', idx: 1 })])]);
  assert.deepEqual(Object.keys(c.statistics).sort(), ['drivingBlockCount', 'drivingMinutes', 'drivingSegmentCount', 'interruptionCount', 'knownTotalMinutes', 'nonDrivingIntervalCount', 'nonDrivingMinutes']);
  assert.equal(c.statistics.drivingMinutes, 80);
  assert.equal(c.drivingBlocks[0].serviceNumbers.length >= 1, true);
  assert.equal(c.drivingBlocks[0].circulationCode, '1');
});
