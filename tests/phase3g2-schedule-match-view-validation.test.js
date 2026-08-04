import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3G.2 – extended ScheduleMatchView validator. Dependency-free, structural,
// { valid, errors:[{code,path}] }; no mutation, no auto-repair.
import { validateExtendedScheduleMatchView } from '../js/v2/matching/jnv-schedule-match-view-validation.js';

const umlauf = (o = {}) => ({
  code: o.code ?? '12100', services: o.services ?? ['2101'], lines: o.lines ?? ['12'], courses: o.courses ?? ['1'], trips: o.trips ?? [],
  start: o.start ?? { time: null, location: null }, end: o.end ?? { time: null, location: null },
  timeWindow: o.timeWindow ?? { startMinutes: null, endMinutes: null, dayOffsetEnd: 0 },
  sourceRefs: o.sourceRefs ?? [], warnings: o.warnings ?? []
});
const goodView = (umlaeufe = [umlauf()]) => ({ serviceRegime: 'school', dayType: 'mo_fr', validityConfidence: 'exact', validityEvidence: [], umlaeufe, warnings: [] });

test('a well-formed extended view is valid', () => {
  assert.deepEqual(validateExtendedScheduleMatchView(goodView()), { valid: true, errors: [] });
});

test('a non-object is rejected controlled', () => {
  assert.equal(validateExtendedScheduleMatchView(null).valid, false);
});

test('duplicate Umlauf codes are rejected', () => {
  const r = validateExtendedScheduleMatchView(goodView([umlauf({ code: '12100' }), umlauf({ code: '12100' })]));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.code === 'DUPLICATE_UMLAUF_CODE'));
});

test('an out-of-vocabulary serviceRegime / dayType / confidence is rejected', () => {
  const r = validateExtendedScheduleMatchView({ ...goodView(), serviceRegime: 'nope', dayType: 'someday', validityConfidence: 'maybe' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.path === 'serviceRegime'));
  assert.ok(r.errors.some(e => e.path === 'dayType'));
  assert.ok(r.errors.some(e => e.path === 'validityConfidence'));
});

test('a non-string Umlauf code and non-string-array lines are rejected', () => {
  const r = validateExtendedScheduleMatchView(goodView([umlauf({ code: 12100, lines: [12] })]));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /code/.test(e.path)));
  assert.ok(r.errors.some(e => /lines/.test(e.path)));
});

test('an inconsistent time window is rejected', () => {
  const r = validateExtendedScheduleMatchView(goodView([umlauf({ timeWindow: { startMinutes: 'x', endMinutes: null, dayOffsetEnd: 0 } })]));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /timeWindow/.test(e.path)));
});

test('privacy-unsafe sourceRefs (raw content / paths) are rejected', () => {
  const r = validateExtendedScheduleMatchView(goodView([umlauf({ sourceRefs: [{ serviceNumber: '2101', originalText: 'a whole raw line' }] })]));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.code === 'UNSAFE_SOURCE_REF'));
});

test('errors carry a code and a path, and the validator does not mutate its input', () => {
  const v = goodView([umlauf({ code: 5 })]);
  const snap = JSON.stringify(v);
  const r = validateExtendedScheduleMatchView(v);
  assert.ok(r.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string'));
  assert.equal(JSON.stringify(v), snap);
});

test('the validation result is JSON-serializable', () => {
  const r = validateExtendedScheduleMatchView(goodView());
  assert.equal(JSON.stringify(r), JSON.stringify(JSON.parse(JSON.stringify(r))));
});
