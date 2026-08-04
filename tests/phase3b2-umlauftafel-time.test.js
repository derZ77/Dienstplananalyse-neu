import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3B.2 – pure Umlauftafel time-sequence normalization (synthetic values only).
const { normalizeUmlauftafelTimeSequence, ROLLOVER_THRESHOLD_MINUTES } = await import('../js/v2/umlauftafel/umlauftafel-time.js');

// === C: time normalization =================================================
test('C: a regular ascending sequence stays on day 0', () => {
  const { times, warnings } = normalizeUmlauftafelTimeSequence([
    { raw: '06:00', role: 'begin' }, { raw: '06:15', role: 'departure' }, { raw: '07:30', role: 'arrival' }
  ]);
  assert.deepEqual(times.map(t => t.dayOffset), [0, 0, 0]);
  assert.deepEqual(times.map(t => t.normalizedMinutes), [360, 375, 450]);
  assert.equal(warnings.length, 0);
});

test('C: a midnight crossing advances dayOffset (23:45 → 00:12)', () => {
  const { times } = normalizeUmlauftafelTimeSequence([
    { raw: '23:45', role: 'departure' }, { raw: '00:12', role: 'arrival' }
  ]);
  assert.equal(times[0].dayOffset, 0);
  assert.equal(times[1].dayOffset, 1);
  assert.deepEqual(times.map(t => t.normalizedMinutes), [1425, 1452]);
  assert.equal(times[1].confidence, 'inferred_rollover');
});

test('C: multiple midnight crossings are supported', () => {
  const { times } = normalizeUmlauftafelTimeSequence([
    { raw: '23:00' }, { raw: '01:00' }, { raw: '23:00' }, { raw: '01:00' }
  ]);
  assert.deepEqual(times.map(t => t.dayOffset), [0, 1, 1, 2]);
});

test('C: identical times stay in the same dayOffset', () => {
  const { times } = normalizeUmlauftafelTimeSequence([{ raw: '10:00' }, { raw: '10:00' }]);
  assert.deepEqual(times.map(t => t.dayOffset), [0, 0]);
});

test('C: a small backward step is NOT blindly rolled; it is flagged', () => {
  const { times, warnings } = normalizeUmlauftafelTimeSequence([{ raw: '08:00' }, { raw: '07:59' }]);
  assert.deepEqual(times.map(t => t.dayOffset), [0, 0]);
  assert.ok(warnings.some(w => w.code === 'IMPLAUSIBLE_TIME_SEQUENCE'));
  assert.ok(ROLLOVER_THRESHOLD_MINUTES > 60, 'threshold is a documented, non-trivial value');
});

test('C: invalid times do not abort normalization and are flagged', () => {
  let result;
  assert.doesNotThrow(() => { result = normalizeUmlauftafelTimeSequence([{ raw: '08:00' }, { raw: '25:99' }, { raw: '09:00' }]); });
  assert.equal(result.times[1].confidence, 'unknown');
  assert.equal(result.times[1].normalizedMinutes, null);
  assert.ok(result.warnings.some(w => w.code === 'INVALID_TIME'));
  assert.equal(result.times[2].dayOffset, 0, 'a later valid time still normalizes');
});

test('C: normalizedMinutes is consistent with dayOffset/hour/minute', () => {
  const { times } = normalizeUmlauftafelTimeSequence([{ raw: '23:50' }, { raw: '00:30' }]);
  for (const t of times) {
    if (t.normalizedMinutes !== null) assert.equal(t.normalizedMinutes, t.dayOffset * 1440 + t.hour * 60 + t.minute);
  }
});

test('C: the input array and its entries are not mutated', () => {
  const input = [{ raw: '23:45', role: 'departure' }, { raw: '00:12', role: 'arrival' }];
  const snapshot = JSON.stringify(input);
  normalizeUmlauftafelTimeSequence(input);
  assert.equal(JSON.stringify(input), snapshot);
});
