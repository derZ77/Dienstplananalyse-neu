import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.21 – the OPERATIONAL DAY as a pure normalisation layer.
//
// The JNV operational day begins at 03:00. A night circulation may run across that boundary, and
// the timetable documentation then breaks it onto two sheets:
//
//     10901   21:46 → 03:13 (+1)          10902   03:14 (+1) → 04:23 (+1)
//
// Both sheets describe ONE operational circuit. This layer says so — it does not touch the raw
// data, and it merges only when all FOUR conditions hold at once:
//
//   1. the same normalised line/course identity (from the existing central normalisation),
//   2. sheet A's end connects to sheet B's start,
//   3. the gap is at most one minute,
//   4. the pair crosses an operational-day boundary.
//
// No heuristic: the same line and course with no connection, a reinforcement duty, or several
// sheets inside ONE operational day are never merged.
import {
  OPERATIONAL_DAY_START_MINUTES, OPERATIONAL_DAY_LENGTH_MINUTES, MAX_CONNECTION_GAP_MINUTES,
  operationalDayIndexOf, operationalMinuteOf, resolveOperationalCircuits
} from '../js/v2/identity/operational-circuit-identity.js';
import { matchJnvBundle } from '../js/v2/matching/jnv-bundle-matcher.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const time = (m, role) => ({ raw: '', hour: Math.floor((m % 1440) / 60), minute: m % 60, dayOffset: Math.floor(m / 1440), normalizedMinutes: m, role, confidence: 'exact' });
// One board sheet spanning `from`..`to` in absolute minutes, with `parts` consecutive trips.
const sheet = (code, from, to, parts = 2) => {
  const step = Math.floor((to - from) / parts);
  return {
    code, id: code,
    segments: Array.from({ length: parts }, (_, i) => ({
      id: `${code}-${i + 1}`, type: 'service_trip', sequence: i + 1, line: null, departure: null, arrival: null,
      stops: [
        { sequence: 1, role: 'departure', time: time(from + i * step, 'departure') },
        { sequence: 2, role: 'arrival', time: time(i === parts - 1 ? to : from + (i + 1) * step, 'arrival') }
      ],
      warnings: [], source: {}
    }))
  };
};
const at = (h, m, day = 0) => day * 1440 + h * 60 + m;
const circuitFor = (result, code) => result.circuits.find(c => c.sheetCodes.includes(code));

// ===== A. the real night circulation is merged =====
test('A: 10901 and 10902 become ONE operational circuit', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 14, 1), at(4, 23, 1))
  ]);
  assert.equal(result.circuits.length, 1, 'two sheets, one circuit');
  assert.deepEqual(result.circuits[0].sheetCodes, ['10901', '10902']);
});
test('A: the merged circuit spans the whole night', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 14, 1), at(4, 23, 1))
  ]);
  const circuit = result.circuits[0];
  assert.equal(circuit.startMinutes, at(21, 46));
  assert.equal(circuit.endMinutes, at(4, 23, 1));
  assert.equal(circuit.endMinutes - circuit.startMinutes, 397, 'the 6h37 the two sheets describe together');
});
test('A: the circuit carries the identity both sheets already shared', () => {
  const circuit = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 14, 1), at(4, 23, 1))
  ]).circuits[0];
  assert.equal(circuit.routeIdentity.line, '10');
  assert.equal(circuit.routeIdentity.course, '9');
  assert.equal(circuit.routeIdentity.normalizedKey, 'LC:10|9', 'from the existing central normalisation');
  assert.match(circuit.key, /^OD:\d+\|LC:10\|9$/, 'operational day + route identity');
});
test('A: the raw sheets are handed through untouched', () => {
  const a = sheet('10901', at(21, 46), at(3, 13, 1));
  const b = sheet('10902', at(3, 14, 1), at(4, 23, 1));
  const before = JSON.stringify([a, b]);
  const circuit = resolveOperationalCircuits([a, b]).circuits[0];
  assert.equal(JSON.stringify([a, b]), before, 'nothing is mutated');
  assert.equal(circuit.sheets[0], a, 'the very same objects are referenced');
  assert.equal(circuit.sheets[1], b);
});
test('A: the merge is reported, never silent', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 14, 1), at(4, 23, 1))
  ]);
  assert.ok(result.warnings.some(w => w.code === 'OPERATIONAL_DAY_MERGE' && w.sheetCodes.join() === '10901,10902'));
});

// ===== B. the reinforcement pairs stay separate =====
test('B: 11301 and 11302 remain two circuits', () => {
  // Morning 05:07–10:02, afternoon 14:59–18:56 — same course, hours apart, one operational day.
  const result = resolveOperationalCircuits([
    sheet('11301', at(5, 7), at(10, 2)),
    sheet('11302', at(14, 59), at(18, 56))
  ]);
  assert.equal(result.circuits.length, 2, 'a reinforcement duty is not a night circulation');
  assert.deepEqual(result.circuits.map(c => c.sheetCodes), [['11301'], ['11302']]);
});
test('B: the other two real pairs behave the same', () => {
  for (const [a, b, fromA, toA, fromB, toB] of [
    ['11401', '11402', at(6, 22), at(10, 22), at(15, 19), at(18, 42)],
    ['11501', '11502', at(6, 27), at(10, 21), at(15, 2), at(19, 2)]
  ]) {
    const result = resolveOperationalCircuits([sheet(a, fromA, toA), sheet(b, fromB, toB)]);
    assert.equal(result.circuits.length, 2, `${a}/${b} must stay separate`);
  }
});
test('B: no merge warning is raised for them', () => {
  const result = resolveOperationalCircuits([sheet('11301', at(5, 7), at(10, 2)), sheet('11302', at(14, 59), at(18, 56))]);
  assert.deepEqual(result.warnings.filter(w => w.code === 'OPERATIONAL_DAY_MERGE'), []);
});

// ===== C. no connection means no merge =====
test('C: a two-minute gap is already too much', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 15, 1), at(4, 23, 1))
  ]);
  assert.equal(result.circuits.length, 2, 'the connection has to be seamless');
});
test('C: an overlap is not a connection either', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 10, 1), at(4, 23, 1))
  ]);
  assert.equal(result.circuits.length, 2, 'a sheet that starts before the other ends is not its continuation');
});
test('C: a different course is never merged, however well it connects', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('11001', at(3, 14, 1), at(4, 23, 1))
  ]);
  assert.equal(result.circuits.length, 2, 'line 10 course 9 is not line 11 course 0');
});
test('C: an unattributable code is never merged', () => {
  const result = resolveOperationalCircuits([
    sheet('ABC-XYZ', at(21, 46), at(3, 13, 1)),
    sheet('DEF-UVW', at(3, 14, 1), at(4, 23, 1))
  ]);
  assert.equal(result.circuits.length, 2, 'without a key there is nothing to compare');
});
test('C: a sheet without usable times is never merged', () => {
  const blind = { code: '10902', id: '10902', segments: [{ id: 'x', type: 'service_trip', sequence: 1, line: null, departure: null, arrival: null, stops: [], warnings: [], source: {} }] };
  const result = resolveOperationalCircuits([sheet('10901', at(21, 46), at(3, 13, 1)), blind]);
  assert.equal(result.circuits.length, 2);
  assert.ok(result.warnings.some(w => w.code === 'OPERATIONAL_DAY_TIMES_UNAVAILABLE' && w.sheetCode === '10902'));
});
test('C: two connecting sheets INSIDE one operational day stay separate', () => {
  // Conditions 1-3 hold, condition 4 does not: no boundary is crossed. This is the guard against
  // merging anything that merely happens to follow on.
  const result = resolveOperationalCircuits([
    sheet('11301', at(8, 0), at(10, 0)),
    sheet('11302', at(10, 1), at(12, 0))
  ]);
  assert.equal(result.circuits.length, 2, 'a seamless follow-on is not an operational-day break');
});

// ===== D. the 03:00 boundary, exactly =====
test('D: the boundary constants are the operational day', () => {
  assert.equal(OPERATIONAL_DAY_START_MINUTES, 180);
  assert.equal(OPERATIONAL_DAY_LENGTH_MINUTES, 1440);
  assert.equal(MAX_CONNECTION_GAP_MINUTES, 1);
});
test('D: 02:59 is the previous operational day, 03:00 opens the next', () => {
  assert.equal(operationalDayIndexOf(at(2, 59)), -1, 'before 03:00 on calendar day 0 → the day before');
  assert.equal(operationalDayIndexOf(at(3, 0)), 0);
  assert.equal(operationalDayIndexOf(at(23, 59)), 0);
  assert.equal(operationalDayIndexOf(at(2, 59, 1)), 0, '02:59 of the next calendar day still belongs to it');
  assert.equal(operationalDayIndexOf(at(3, 0, 1)), 1);
});
test('D: the minute inside the operational day runs 0..1439', () => {
  assert.equal(operationalMinuteOf(at(3, 0)), 0);
  assert.equal(operationalMinuteOf(at(2, 59, 1)), 1439, 'the last minute of the operational day');
  assert.equal(operationalMinuteOf(at(3, 0, 1)), 0, 'and then it starts over');
});
test('D: a junction exactly ON the boundary merges', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(2, 59, 1)),
    sheet('10902', at(3, 0, 1), at(4, 23, 1))
  ]);
  assert.equal(result.circuits.length, 1, '02:59 → 03:00 is the boundary itself');
});
test('D: a pair fully after the boundary does not merge', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(3, 10, 1), at(3, 40, 1)),
    sheet('10902', at(3, 41, 1), at(4, 23, 1))
  ]);
  assert.equal(result.circuits.length, 2, 'both lie in the same operational day — nothing was cut');
});
test('D: a pair fully before the boundary does not merge either', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(22, 46)),
    sheet('10902', at(22, 47), at(23, 47))
  ]);
  assert.equal(result.circuits.length, 2);
});
test('D: the operational day of the merged circuit is the one it STARTED in', () => {
  const circuit = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 14, 1), at(4, 23, 1))
  ]).circuits[0];
  assert.equal(circuit.operationalDay, 0, 'a night duty belongs to the day it began on');
  assert.equal(circuit.key, 'OD:0|LC:10|9');
});

// ===== E. no effect on existing match results =====
// SUPERSEDED BY PHASE 3I.22 — Phase 3I.21 deliberately built the layer WITHOUT wiring it in, and
// this test pinned that. Phase 3I.22 connected it. Inverted rather than dropped, so the connection
// cannot silently disappear again.
test('E (wired in 3I.22): the matcher now uses the layer', () => {
  assert.match(src('../js/v2/matching/jnv-bundle-matcher.js'), /resolveOperationalCircuits/,
    'the matcher asks the operational-day layer — see tests/phase3i22-*.test.js');
});
test('E: two sheets WITHOUT usable times are still an ambiguity', () => {
  // No times means no circuit can be formed, so nothing may be merged — the honest fallback.
  const result = matchJnvBundle({
    bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
    schedule: { serviceRegime: 'school', dayType: 'mo_fr', umlaeufe: [{ code: '10/9' }] },
    umlauftafel: { validity: { serviceRegime: 'school', dayType: 'mo_fr' }, circulations: [{ code: '10901', id: '10901', segments: [] }, { code: '10902', id: '10902', segments: [] }] }
  });
  assert.equal(result.matches[0].status, 'ambiguous');
  assert.deepEqual([...result.matches[0].conflicts], ['MULTIPLE_CIRCULATIONS_FOR_CODE']);
});
test('E: an ordinary single-sheet document is unchanged by the layer', () => {
  const result = resolveOperationalCircuits([sheet('12100', at(3, 46), at(21, 11)), sheet('18100', at(5, 2), at(20, 57))]);
  assert.equal(result.circuits.length, 2);
  assert.deepEqual(result.circuits.map(c => c.sheetCodes), [['12100'], ['18100']]);
  assert.deepEqual(result.warnings.filter(w => w.code === 'OPERATIONAL_DAY_MERGE'), []);
});
test('E: no rule, config, validator or orchestrator module is touched', () => {
  // SUPERSEDED BY PHASE 3I.22 for the joint timeline: it is the module the layer was wired into.
  // Rule, validator and orchestrator stay out of it, and that is what still has to hold.
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/analysis/jnv-rule-analysis-controller.js']) {
    assert.doesNotMatch(src(path), /operationalDayIndexOf|resolveOperationalCircuits/, `${path} must not carry the layer`);
  }
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.parameters.activation.enabled.value, false);
});

// ===== F. the day offset the loader cannot know =====
// Every sheet is normalised ON ITS OWN, so a continuation that begins at 03:14 looks like an early
// morning of the SAME calendar day and appears to come BEFORE its predecessor. This is exactly how
// the real Umlauftafel arrives, and the layer has to reconstruct the missing day.
test('F: the real sheet shape — a continuation without any day offset — is still merged', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 14), at(4, 23))            // no +1: this is what the loader really produces
  ]);
  assert.equal(result.circuits.length, 1, 'the missing day offset is reconstructed');
  assert.deepEqual(result.circuits[0].sheetCodes, ['10901', '10902']);
  assert.equal(result.circuits[0].endMinutes, at(4, 23, 1), 'the continuation is lifted by one calendar day');
});
test('F: the reconstruction is reported with its reason', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 14), at(4, 23))
  ]);
  const shift = result.warnings.find(w => w.code === 'OPERATIONAL_DAY_SHEET_SHIFTED');
  assert.equal(shift.sheetCode, '10902');
  assert.equal(shift.continuationOf, '10901');
  assert.equal(shift.shiftMinutes, 1440, 'exactly one calendar day, never anything else');
});
test('F: a sheet is lifted ONLY when that creates a seamless connection', () => {
  const result = resolveOperationalCircuits([
    sheet('10901', at(21, 46), at(3, 13, 1)),
    sheet('10902', at(3, 20), at(4, 23))            // three minutes short of a connection
  ]);
  assert.equal(result.circuits.length, 2, 'no connection, no shift');
  assert.deepEqual(result.warnings.filter(w => w.code === 'OPERATIONAL_DAY_SHEET_SHIFTED'), []);
});
test('F: a morning sheet is never lifted onto an ordinary daytime circulation', () => {
  // 11301 stays inside its operational day, so nothing of the same identity may be lifted onto it.
  const result = resolveOperationalCircuits([
    sheet('11301', at(5, 7), at(10, 2)),
    sheet('11302', at(14, 59), at(18, 56))
  ]);
  assert.deepEqual(result.warnings.filter(w => w.code === 'OPERATIONAL_DAY_SHEET_SHIFTED'), []);
  assert.equal(result.circuits.length, 2);
});
