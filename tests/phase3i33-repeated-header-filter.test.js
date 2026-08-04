/**
 * Phase 3I.33 (D/E) — repeated page headers must not become activities.
 *
 * The real plan prints its column header again at the top of every page. Those rows were being
 * absorbed into whichever duty was open at the time, which gave duties a phantom last activity
 * whose "location" was the word `Ort`.
 *
 * A row is only discarded when SEVERAL header markers coincide at their expected columns. A single
 * cell reading `Ort` or `Linie` never suffices — a genuine duty row must survive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';

// The two header rows exactly as the real plan prints them.
const HEADER_A = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const HEADER_B = ['', '', 'Nr.', '', '', '/Abl.', '', '', '', '/Abl.', '', '', 'Dienst', 'Dienst', 'beginn', 'ende', 'Zeit', ''];
const leg = ({ nr = '', line = '10', uml = '10/1', ab, abOrt = 'BBU', an, anOrt = 'BBU' }) =>
  ['', '', nr, line, uml, ab, abOrt, '', '', an, anOrt, '', '', '', '', '', '', ''];

const activitiesOf = (rows) => adaptExcelRowsToCanonicalSchedule(rows).services.flatMap(s => s.activities);

// =====================================================================================
// D — the filter
// =====================================================================================
test('D: a repeated header block in the middle of a duty produces no activity', () => {
  const rows = [
    HEADER_A, HEADER_B,
    leg({ nr: '2211', ab: '05:00', an: '08:00', anOrt: 'TGR' }),
    HEADER_A, HEADER_B,                                        // page break
    leg({ ab: '08:36', abOrt: 'TGR', an: '12:00' })
  ];
  const activities = activitiesOf(rows);
  assert.equal(activities.length, 2, 'exactly the two real legs');
  assert.deepEqual(activities.map(a => a.arrivalLocation), ['TGR', 'BBU']);
});

test('D: several repeated header blocks are all discarded', () => {
  const rows = [HEADER_A, HEADER_B, leg({ nr: '2211', ab: '05:00', an: '08:00' })];
  for (let page = 0; page < 3; page++) {
    rows.push(HEADER_A, HEADER_B, leg({ ab: '09:00', an: '10:00' }));
  }
  const activities = activitiesOf(rows);
  assert.equal(activities.length, 4, 'one leg plus three legs, no headers');
  assert.ok(activities.every(a => a.arrivalLocation !== 'Ort'), 'no activity ends at a column title');
});

test('D: the duty ends at its real last leg, not at a header', () => {
  const rows = [
    HEADER_A, HEADER_B,
    leg({ nr: '2231', ab: '05:00', an: '08:00', anOrt: 'LGR' }),
    HEADER_A, HEADER_B
  ];
  const [service] = adaptExcelRowsToCanonicalSchedule(rows).services;
  const last = service.activities[service.activities.length - 1];
  assert.equal(last.arrivalLocation, 'LGR');
  assert.equal(service.activities.length, 1);
});

test('D: a single cell reading "Ort" does NOT discard a genuine row', () => {
  // A real leg that happens to arrive at a stop abbreviated `Ort` keeps its place.
  const rows = [HEADER_A, HEADER_B, leg({ nr: '2211', ab: '05:00', an: '08:00', anOrt: 'Ort' })];
  const activities = activitiesOf(rows);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].arrivalLocation, 'Ort', 'a genuine row survives its unlucky name');
});

test('D: a single cell reading "Linie" does NOT discard a genuine row', () => {
  const rows = [HEADER_A, HEADER_B, leg({ nr: '2211', line: 'Linie', ab: '05:00', an: '08:00' })];
  assert.equal(activitiesOf(rows).length, 1);
});

test('D: a row with real times and a real circuit is never discarded', () => {
  const rows = [
    HEADER_A, HEADER_B,
    leg({ nr: '2211', line: '18', uml: '18/1', ab: '05:00', abOrt: 'Ort', an: '08:00', anOrt: 'Ort' })
  ];
  const [activity] = activitiesOf(rows);
  assert.equal(activity.circuitNumber, '18/1');
  assert.equal(activity.departureTime.value, '05:00');
});

test('D: a partial header — two markers only — is not enough to discard', () => {
  const partial = ['', '', '', 'Linie', '', '', 'Ort', '', '', '05:00', 'TGR', '', '', '', '', '', '', ''];
  const rows = [HEADER_A, HEADER_B, leg({ nr: '2211', ab: '05:00', an: '08:00' }), partial];
  assert.equal(activitiesOf(rows).length, 2, 'an ambiguous row is kept, not silently dropped');
});

test('D: the second header line alone is recognised too', () => {
  const rows = [HEADER_A, HEADER_B, leg({ nr: '2211', ab: '05:00', an: '08:00' }), HEADER_B];
  assert.equal(activitiesOf(rows).length, 1);
});

test('D: the ten-column layout is unaffected by the filter', () => {
  const rows = [
    ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
    ['7511', '10/1', 'Linie 10', '05:00', 'BBU', '06:00', 'TGR', '05:00', '06:00', '01:00']
  ];
  const activities = activitiesOf(rows);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].rawActivity, 'Linie 10');
});

// =====================================================================================
// E — the real plan
// =====================================================================================
const REAL_PLAN = '/Users/joergziegler/Downloads/Test/B_20260727_MoFrFerien.xlsx';
const available = (() => { try { readFileSync(REAL_PLAN); return true; } catch { return false; } })();

const realRows = () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  const book = sandbox.XLSX.read(readFileSync(REAL_PLAN), { type: 'buffer' });
  return sandbox.XLSX.utils.sheet_to_json(book.Sheets['Diensterklärung'], { header: 1, raw: false, defval: null })
    .map(row => row.map(cell => cell === null ? '' : String(cell).trim()));
};

const HEADER_WORDS = ['Ort', 'Linie', 'Umlauf', 'Dienst-', 'nächst.', 'vorher.', 'Ausf.', 'Einf.', 'Richtg.', 'Nr.', '/Abl.', 'beginn', 'ende', 'Zeit', 'bez.'];

test('E (real): no imported activity carries a column title as its location', { skip: !available && 'reference plan not present' }, () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(realRows());
  for (const activity of schedule.activities) {
    assert.ok(!HEADER_WORDS.includes(activity.departureLocation), `departure "${activity.departureLocation}"`);
    assert.ok(!HEADER_WORDS.includes(activity.arrivalLocation), `arrival "${activity.arrivalLocation}"`);
  }
});

test('E (real): duty 2231 no longer ends at "Ort"', { skip: !available && 'reference plan not present' }, () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(realRows());
  const service = schedule.services.find(s => s.serviceNumber === '2231');
  assert.ok(service, 'duty 2231 is present');
  const last = [...service.activities].reverse().find(a => a.arrivalLocation);
  assert.notEqual(last.arrivalLocation, 'Ort');
});

test('E (real): the duty count is unchanged — no real duty was filtered away', { skip: !available && 'reference plan not present' }, () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(realRows());
  assert.equal(schedule.services.length, 61);
});

test('E (real): every remaining activity has at least one usable clock time', { skip: !available && 'reference plan not present' }, () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(realRows());
  const timeless = schedule.activities.filter(a =>
    a.departureTime.minutesSinceStartOfDay === null && a.arrivalTime.minutesSinceStartOfDay === null);
  assert.equal(timeless.length, 0, 'a row without any time is not a duty leg');
});
