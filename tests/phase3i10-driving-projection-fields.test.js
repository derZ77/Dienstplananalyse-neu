import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.10 – the Driving Projection forwards exactly two additional, already existing values:
// `metadata.dutyStartTime` and `drivingSegments[].line`. Nothing is computed, normalised or
// guessed, and no further field is added.
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';
import { validateDrivingProjection } from '../js/v2/analysis/driving-projection-validation.js';

const src = readFileSync(new URL('../js/v2/analysis/driving-projection.js', import.meta.url), 'utf8');

const segment = (over = {}) => ({
  serviceNumber: over.serviceNumber ?? '2101',
  line: 'line' in over ? over.line : '12',
  course: '1', trip: null,
  departure: '05:00', arrival: '06:00', dayOffset: 0,
  durationMinutes: over.durationMinutes ?? 60,
  source: { serviceNumber: over.serviceNumber ?? '2101', activityIndex: over.index ?? 0, sourceType: 'pdf' },
  kind: over.kind ?? 'service'
});
const jointTimeline = (segments, over = {}) => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'joint-timeline', ...over.metadata },
  circulations: [{ code: '11100', serviceNumbers: ['2101'], segments, warnings: [] }],
  warnings: []
});
const project = (segments, input = {}) => createDrivingProjection({ jointTimeline: jointTimeline(segments), ...input });

// ===== line is forwarded per driving segment =====
test('every driving segment carries the line from the joint timeline', () => {
  const p = project([segment({ line: '12' }), segment({ line: '18', index: 1 })]);
  assert.deepEqual(p.circulations[0].drivingSegments.map(s => s.line), ['12', '18']);
});
test('a missing line becomes null, never invented', () => {
  const p = project([segment({ line: null }), segment({ line: undefined, index: 1 })]);
  assert.deepEqual(p.circulations[0].drivingSegments.map(s => s.line), [null, null]);
});
test('the line is forwarded verbatim — not normalised, trimmed or reformatted', () => {
  const p = project([segment({ line: ' 18 ' }), segment({ line: 'A12', index: 1 })]);
  assert.deepEqual(p.circulations[0].drivingSegments.map(s => s.line), [' 18 ', 'A12']);
});
test('the projection computes no line of its own', () => {
  assert.doesNotMatch(src, /routeIdentity|normalizeLine|parseLine|lineOf\s*\(/,
    'the line is taken from the timeline segment, never derived');
});

// ===== dutyStartTime is forwarded on the metadata =====
test('a supplied duty start reaches the projection metadata', () => {
  const p = project([segment()], { dutyStartMinutes: 19 * 60 + 20 });
  assert.equal(p.metadata.dutyStartTime, 19 * 60 + 20);
});
test('an absent duty start is null, never derived from a segment', () => {
  const p = project([segment()]);
  assert.equal(p.metadata.dutyStartTime, null, 'no duty start supplied means null');
  const withFirstTrip = project([segment({ durationMinutes: 60 })]);
  assert.equal(withFirstTrip.metadata.dutyStartTime, null, 'the first trip is never used as a duty start');
});
test('an invalid duty start is rejected rather than coerced', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, -1, '19:20', {}]) {
    const p = project([segment()], { dutyStartMinutes: value });
    assert.equal(p.metadata.dutyStartTime, null, `duty start ${String(value)}`);
  }
});
test('a duty start of exactly 0 is a valid known value', () => {
  assert.equal(project([segment()], { dutyStartMinutes: 0 }).metadata.dutyStartTime, 0);
});
test('the projection derives no duty start from a file name, line or circulation code', () => {
  assert.doesNotMatch(src, /fileName|sourceName|circuitNumber|shiftNumber|firstTrip/i);
});

// ===== exactly these fields, nothing more =====
test('the metadata carries exactly the existing keys plus dutyStartTime', () => {
  const p = project([segment()], { dutyStartMinutes: 300 });
  assert.deepEqual(Object.keys(p.metadata).sort(), ['circulationCount', 'dayType', 'dutyStartTime', 'generatedFrom', 'serviceRegime']);
});
test('a driving segment carries exactly the existing keys plus line', () => {
  const p = project([segment()]);
  assert.deepEqual(Object.keys(p.circulations[0].drivingSegments[0]).sort(),
    ['durationMinutes', 'endMinutes', 'kind', 'line', 'serviceNumber', 'source', 'startMinutes']);
});
test('no document, trip list, original text or workbook payload is carried', () => {
  const serialized = JSON.stringify(project([segment()], { dutyStartMinutes: 300 }));
  assert.doesNotMatch(serialized, /originalText|rawText|boundingBox|stops|circulations"\s*:\s*\[\s*\{[^}]*"segments"|workbook|arrayBuffer|\/Users\/|\/Volumes\//i);
});

// ===== nothing else changed =====
test('the existing projection contract is unchanged', () => {
  const p = project([segment({ durationMinutes: 60 }), segment({ durationMinutes: 30, index: 1 })]);
  assert.equal(p.metadata.serviceRegime, 'school');
  assert.equal(p.metadata.dayType, 'mo_fr');
  assert.equal(p.metadata.generatedFrom, 'driving-projection');
  assert.equal(p.metadata.circulationCount, 1);
  assert.equal(p.circulations[0].statistics.drivingMinutes, 90, 'the driving time is unchanged');
  assert.equal(validateDrivingProjection(p).valid, true, JSON.stringify(validateDrivingProjection(p).errors));
});
test('a non-driving segment is still excluded from the driving segments', () => {
  const p = project([segment({ kind: 'service' }), segment({ kind: 'break', index: 1 })]);
  assert.equal(p.circulations[0].drivingSegments.length, 1);
});
test('an invalid joint timeline still yields the existing not-applicable shape', () => {
  const p = createDrivingProjection({ jointTimeline: null, dutyStartMinutes: 300 });
  assert.equal(p.metadata, null);
});
test('the projection stays free of storage, network and file access', () => {
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest|WebSocket|FileReader|arrayBuffer/);
});
