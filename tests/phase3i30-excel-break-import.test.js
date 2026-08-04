/**
 * Phase 3I.30 — break and interruption data from the legacy Excel import.
 *
 * Import only. No rule is touched: BV010, BV012, the JNV block-break module and the 1/6 rule
 * are unchanged; this file asserts that the DATA they were missing now arrives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDeclaredBreakMinutes,
  buildDeclaredBreakIndex,
  deriveServiceInterruptions,
  attachExcelBreakData
} from '../js/v2/excel/excel-break-import.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createBv010Check } from '../js/v2/checks/bv/bv010.js';
import { createBv012Check } from '../js/v2/checks/bv/bv012.js';

// ---------------------------------------------------------------------------
// Fixtures in the REAL shape of the JNV plan: the "Diensterklärung" sheet uses the
// 17-column layout, the "DUe" sheet is the operator's own Dienstübersicht.
// ---------------------------------------------------------------------------
const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];

/** One Diensterklärung row: a duty leg from `ab`@`abOrt` to `an`@`anOrt`. */
const leg = ({ nr = '', line = '10', uml = '10/1', ab, abOrt, an, anOrt, begin = '', end = '', paid = '' }) =>
  ['', '', nr, line, uml, ab, abOrt, '', '', an, anOrt, '', '', '', begin, end, paid, ''];

/** A duty with a gap between two legs — TGR 07:15, back out at TGR 07:57 = 42 minutes. */
const gapPlanRows = () => [
  HEADER,
  leg({ nr: '2211', ab: '03:46', abOrt: 'BBU', an: '07:15', anOrt: 'TGR', begin: '03:46', end: '11:20', paid: '07:34' }),
  leg({ ab: '07:57', abOrt: 'TGR', an: '11:20', anOrt: 'BBU' })
];

/** The DUe sheet: Dienst-Nr. | Dienst-art | … | P.-regel | Block-pause | Ab-zug | … */
const dueRows = (breakValue = '0:36') => [
  ['', 'Dienst-Nr.', 'Dienst-art', 'Umlauf-linie', 'Umlauf-Nr.', 'Wagen-Nr.', 'Beg.', 'Ende', 'P.-regel', 'Block-pause', 'Ab-zug', 'Dauer', 'Lenk-zeit'],
  ['', '2211', 'OPT_Z', '12', '1', '', '3:46', '11:20', '1x33_43', breakValue, '30', '7:34', '5:12']
];

const build = (rows, options) => attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(rows), options);
const breaks = (schedule) => schedule.activities.filter(a => a.activityType === 'unpaidBreak');

// =====================================================================================
// A — an Excel plan with a declared break produces an unpaidBreak
// =====================================================================================
test('A: a duty with a declared Block-pause yields exactly one unpaidBreak activity', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  const found = breaks(schedule);
  assert.equal(found.length, 1);
  assert.equal(found[0].activityType, 'unpaidBreak');
  assert.equal(found[0].serviceNumber, '2211');
});

test('A: the unpaidBreak carries the DECLARED length, not the gross gap', () => {
  // The gross gap is 42 minutes; the plan declares 36. The difference is walking time and
  // belongs to the JNV block-break rule, NOT to the break itself.
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  const [pause] = breaks(schedule);
  assert.equal(pause.declaredMinutes, 36);
  assert.equal(pause.arrivalTime.minutesSinceStartOfDay - pause.departureTime.minutesSinceStartOfDay, 36);
});

test('A: the break sits inside its interruption window and keeps its location', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  const [pause] = breaks(schedule);
  assert.equal(pause.departureTime.value, '07:15', 'it begins when the driver comes in');
  assert.equal(pause.departureLocation, 'TGR');
  assert.equal(pause.arrivalLocation, 'TGR');
});

test('A: a service interruption is derived from the gap itself, gross and honest', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  assert.equal(schedule.interruptions.length, 1);
  const [gap] = schedule.interruptions;
  assert.equal(gap.durationMinutes, 42, 'the driver is interrupted for the full gap');
  assert.equal(gap.start.value, '07:15');
  assert.equal(gap.end.value, '07:57');
  assert.equal(gap.startLocation, 'TGR');
  assert.equal(gap.endLocation, 'TGR');
  assert.equal(gap.serviceNumber, '2211');
  assert.equal(schedule.metadata.interruptionCount, 1);
});

test('A: parsing the declared column accepts the real "H:MM" form', () => {
  assert.equal(parseDeclaredBreakMinutes('0:36'), 36);
  assert.equal(parseDeclaredBreakMinutes('1:52'), 112);
  assert.equal(parseDeclaredBreakMinutes(''), null, 'an empty cell declares nothing');
  assert.equal(parseDeclaredBreakMinutes('0:00'), null, 'and neither does a zero');
  assert.equal(parseDeclaredBreakMinutes('Pause'), null, 'free text is never a duration');
  assert.equal(parseDeclaredBreakMinutes(null), null);
});

test('A: the declared index reads the column by its header, not by a fixed position', () => {
  const index = buildDeclaredBreakIndex(dueRows('0:36'));
  assert.equal(index.get('2211').breakMinutes, 36);
  assert.equal(index.get('2211').pauseRule, '1x33_43');
  assert.equal(index.get('2211').deductionMinutes, 30);
});

// =====================================================================================
// B — no declaration, no break. Nothing is invented.
// =====================================================================================
test('B: without a Dienstübersicht no break is invented, even where a gap exists', () => {
  const schedule = build(gapPlanRows(), {});
  assert.deepEqual(breaks(schedule), [], 'a gap alone is not a declared break');
  assert.equal(schedule.interruptions.length, 1, 'but the interruption is still reported');
});

test('B: a duty absent from the Dienstübersicht gets no break', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36').slice(0, 1) });
  assert.deepEqual(breaks(schedule), []);
});

test('B: an empty Block-pause cell yields no break and no error', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('') });
  assert.deepEqual(breaks(schedule), []);
});

test('B: a duty without any gap gets neither interruption nor break', () => {
  const rows = [HEADER, leg({ nr: '2201', line: 'Reserve', uml: '', ab: '03:15', abOrt: 'BBU', an: '12:15', anOrt: 'BBU', begin: '03:15', end: '12:15', paid: '09:00' })];
  const schedule = build(rows, { dienstuebersichtRows: [dueRows()[0], ['', '2201', 'OPT_Z', 'Reserve', '', '', '3:15', '12:15', '', '', '', '9:00']] });
  assert.deepEqual(schedule.interruptions, []);
  assert.deepEqual(breaks(schedule), []);
});

test('B: a declared break longer than the gap is reported, never silently trimmed', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('1:00') });
  const [pause] = breaks(schedule);
  assert.equal(pause.declaredMinutes, 60);
  assert.ok(schedule.warnings.some(w => w.code === 'EXCEL_BREAK_EXCEEDS_INTERRUPTION'),
    'the contradiction is named rather than hidden');
});

// =====================================================================================
// C — a turnaround stays a turnaround
// =====================================================================================
test('C: a short gap between two legs is an interruption, never a break', () => {
  const rows = [
    HEADER,
    leg({ nr: '2299', ab: '05:00', abOrt: 'HLZ', an: '05:40', anOrt: 'HLZ', begin: '05:00', end: '06:30', paid: '01:30' }),
    leg({ ab: '05:52', abOrt: 'HLZ', an: '06:30', anOrt: 'HLZ' })
  ];
  const schedule = build(rows, {});
  assert.equal(schedule.interruptions[0].durationMinutes, 12, 'a twelve-minute turnaround');
  assert.deepEqual(breaks(schedule), [], 'and it is not reclassified as a break');
});

test('C: turnaround time is not consumed — the driving legs keep their own times', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  const legs = schedule.activities.filter(a => a.activityType !== 'unpaidBreak');
  assert.equal(legs.length, 2);
  assert.equal(legs[0].arrivalTime.value, '07:15');
  assert.equal(legs[1].departureTime.value, '07:57');
});

// =====================================================================================
// D — driving time is untouched
// =====================================================================================
test('D: the driving legs are unchanged in number, order and times', () => {
  const plain = adaptExcelRowsToCanonicalSchedule(gapPlanRows());
  const enriched = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  const legsOf = (s) => s.activities.filter(a => a.activityType !== 'unpaidBreak')
    .map(a => [a.departureTime.value, a.arrivalTime.value, a.circuitNumber, a.departureLocation, a.arrivalLocation]);
  assert.deepEqual(legsOf(enriched), legsOf(plain), 'the driving data survives the enrichment untouched');
});

test('D: the break is additive — the original schedule object is not mutated', () => {
  const original = adaptExcelRowsToCanonicalSchedule(gapPlanRows());
  const before = original.activities.length;
  attachExcelBreakData(original, { dienstuebersichtRows: dueRows('0:36') });
  assert.equal(original.activities.length, before, 'the input keeps its own activity list');
  assert.deepEqual(original.interruptions, []);
});

// =====================================================================================
// E — existing import types are unaffected
// =====================================================================================
test('E: the CanonicalSchedule contract is preserved', () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  assert.equal(schedule.type, 'CanonicalSchedule');
  assert.equal(schedule.document.sourceType, 'excel');
  assert.equal(schedule.metadata.schemaVersion, '1.0');
  assert.equal(schedule.services.length, 1);
  assert.equal(schedule.metadata.activityCount, schedule.activities.length);
});

test('E: an unenriched import is byte-for-byte what it always was', () => {
  const plain = adaptExcelRowsToCanonicalSchedule(gapPlanRows());
  assert.deepEqual(plain.interruptions, [], 'the adapter itself still declares no interruptions');
  assert.equal(plain.metadata.interruptionCount, 0);
  assert.ok(plain.activities.every(a => a.activityType === undefined), 'and classifies no activity');
});

test('E: enrichment without any options is a safe no-op', () => {
  const schedule = attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(gapPlanRows()));
  assert.equal(schedule.type, 'CanonicalSchedule');
  assert.deepEqual(breaks(schedule), []);
});

test('E: a non-schedule input is rejected instead of being half-processed', () => {
  assert.throws(() => attachExcelBreakData(null), TypeError);
  assert.throws(() => attachExcelBreakData({ type: 'Something' }), TypeError);
});

test('E: deriving interruptions from a service is pure', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(gapPlanRows());
  const [service] = schedule.services;
  const first = deriveServiceInterruptions(service);
  const second = deriveServiceInterruptions(service);
  assert.deepEqual(first, second);
  assert.equal(service.interruptions.length, 0, 'the service is not written to');
});

// =====================================================================================
// F — BV010/BV012 receive real input for the first time
// =====================================================================================
const analysisResult = { type: 'AnalysisResult' };

test('F: BV010 leaves NOT_APPLICABLE and assesses the declared break', async () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') });
  const before = await createBv010Check({ canonicalSchedule: adaptExcelRowsToCanonicalSchedule(gapPlanRows()) }).run(analysisResult);
  const after = await createBv010Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(before.status, 'NOT_APPLICABLE', 'before: the Excel path was blind');
  assert.equal(after.status, 'PASS', 'after: 36 minutes clear the 30-minute minimum');
});

test('F: BV010 reports a genuine violation when the declared break is too short', async () => {
  const schedule = build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:28') });
  const check = await createBv010Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(check.status, 'FAIL');
  assert.equal(check.severity, 'VIOLATION');
  assert.deepEqual(check.affectedServices, ['excel-service:1']);
});

test('F: BV012 measures the same declared break against its own 33-minute buffer', async () => {
  const passing = await createBv012Check({ canonicalSchedule: build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:36') }) }).run(analysisResult);
  const failing = await createBv012Check({ canonicalSchedule: build(gapPlanRows(), { dienstuebersichtRows: dueRows('0:31') }) }).run(analysisResult);
  assert.equal(passing.status, 'PASS');
  assert.equal(failing.status, 'FAIL', '31 minutes clear BV010 but miss the BV012 buffer');
});

test('F: no rule module was changed to make this work', async () => {
  // BV010 still recognises ONLY explicitly classified unpaid breaks — an interruption alone
  // must leave it not applicable.
  const schedule = build(gapPlanRows(), {});
  const check = await createBv010Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(check.status, 'NOT_APPLICABLE', 'an interruption is not a break, and BV010 still says so');
});
