/**
 * Phase 3I.32 (A/B) — importing the handover chain from the legacy Excel plan.
 *
 * IMPORT ONLY. Nothing here evaluates a rule: BV003 is untouched, and no finding is suppressed.
 * Only values the plan actually prints are taken; an empty cell stays null and a broken cell
 * produces a warning instead of an invented relation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHandoverReference, attachExcelHandoverData } from '../js/v2/excel/excel-handover-chain.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';

// The real 17-column layout: [12] "vorher. Dienst", [13] "nächst. Dienst".
const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const leg = ({ nr = '', line = '10', uml = '10/1', ab, abOrt, an, anOrt, prev = '', next = '', begin = '', end = '', paid = '' }) =>
  ['', '', nr, line, uml, ab, abOrt, '', '', an, anOrt, '', prev, next, begin, end, paid, ''];

/** Duty 2211 as the plan really prints it: two legs, each carrying its OWN handover. */
const twoLegPlan = () => [
  HEADER,
  leg({ nr: '2211', uml: '12/1', ab: '03:46', abOrt: 'BBU', an: '07:56', anOrt: 'TGR', next: '2229', begin: '03:46' }),
  leg({ uml: '14/1', ab: '08:38', abOrt: 'HLZ', an: '12:03', anOrt: 'LGR', prev: '2217', next: '2273', end: '12:03', paid: '07:34' })
];
const build = (rows) => attachExcelHandoverData(adaptExcelRowsToCanonicalSchedule(rows));

// =====================================================================================
// A — the chain is imported
// =====================================================================================
test('A: each leg keeps its own handover references', () => {
  const [service] = build(twoLegPlan()).services;
  assert.equal(service.activities[0].handover.nextServiceNumber, '2229');
  assert.equal(service.activities[0].handover.previousServiceNumber, null);
  assert.equal(service.activities[1].handover.previousServiceNumber, '2217');
  assert.equal(service.activities[1].handover.nextServiceNumber, '2273');
});

test('A: the duty summary takes the FIRST takeover and the LAST handover', () => {
  const [service] = build(twoLegPlan()).services;
  assert.equal(service.handover.previousServiceNumber, '2217', 'the duty is taken over from 2217');
  assert.equal(service.handover.nextServiceNumber, '2273', 'and handed on to 2273 at its end');
});

test('A: the handover locations and times are preserved', () => {
  const [service] = build(twoLegPlan()).services;
  assert.equal(service.handover.takeoverLocation, 'HLZ');
  assert.equal(service.handover.takeoverTime, '08:38');
  assert.equal(service.handover.handoverLocation, 'LGR');
  assert.equal(service.handover.handoverTime, '12:03');
});

test('A: the circuit and line of the handover leg are carried along', () => {
  const [service] = build(twoLegPlan()).services;
  assert.equal(service.handover.takeoverCircuit, '14/1');
  assert.equal(service.handover.handoverCircuit, '14/1');
});

test('A: service numbers are strings, never numbers', () => {
  const [service] = build(twoLegPlan()).services;
  assert.equal(typeof service.handover.previousServiceNumber, 'string');
  assert.equal(typeof service.handover.nextServiceNumber, 'string');
  assert.equal(typeof service.activities[0].handover.nextServiceNumber, 'string');
});

test('A: no raw Excel row is embedded — only small references', () => {
  const [service] = build(twoLegPlan()).services;
  const serialised = JSON.stringify(service.handover);
  assert.ok(!serialised.includes('rawCells'), 'no raw cells');
  assert.ok(!serialised.includes('<kopf>'), 'no header artefacts');
  for (const ref of service.handover.sourceRefs) {
    assert.deepEqual(Object.keys(ref).sort(), ['activityId', 'role', 'rowNumber'],
      'a source reference names the row, not its contents');
  }
});

test('A: parsing accepts a plain duty number and nothing else', () => {
  assert.equal(parseHandoverReference('2229').value, '2229');
  assert.equal(parseHandoverReference(' 2229 ').value, '2229', 'surrounding space is trimmed');
  assert.equal(parseHandoverReference('2229').valid, true);
});

// =====================================================================================
// B — no invented chain
// =====================================================================================
test('B: an empty cell yields null, not a guess', () => {
  const parsed = parseHandoverReference('');
  assert.equal(parsed.value, null);
  assert.equal(parsed.valid, true, 'empty is not an error — it simply declares nothing');
  assert.equal(parseHandoverReference(null).value, null);
  assert.equal(parseHandoverReference(undefined).value, null);
});

test('B: a non-numeric value is rejected AND reported', () => {
  for (const raw of ['vorher.', 'Dienst', 'ab BBU', '22a9', '-1']) {
    const parsed = parseHandoverReference(raw);
    assert.equal(parsed.value, null, `${raw} must not become a reference`);
    assert.equal(parsed.valid, false, `${raw} must be flagged`);
  }
});

test('B: a broken cell produces a structured warning instead of a relation', () => {
  const rows = [HEADER, leg({ nr: '2211', ab: '03:46', abOrt: 'BBU', an: '07:56', anOrt: 'TGR', next: 'Dienst' })];
  const schedule = build(rows);
  assert.equal(schedule.services[0].handover.nextServiceNumber, null);
  const warning = schedule.warnings.find(w => w.code === 'EXCEL_HANDOVER_REFERENCE_INVALID');
  assert.ok(warning, 'the broken value is named');
  assert.equal(warning.scope, 'service');
  assert.ok(!JSON.stringify(warning).includes('Dienst'), 'and the warning carries no raw content');
});

test('B: a duty with no handover columns at all gets an empty, explicit summary', () => {
  const rows = [HEADER, leg({ nr: '2201', line: 'Reserve', uml: '', ab: '03:15', abOrt: 'BBU', an: '12:15', anOrt: 'BBU' })];
  const [service] = build(rows).services;
  assert.deepEqual(service.handover, {
    previousServiceNumber: null, nextServiceNumber: null,
    takeoverLocation: null, takeoverTime: null, takeoverCircuit: null,
    handoverLocation: null, handoverTime: null, handoverCircuit: null,
    sourceRefs: []
  });
});

test('B: nothing is derived from the neighbouring row or from the clock', () => {
  // Two duties printed one after the other, neither declaring a handover.
  const rows = [
    HEADER,
    leg({ nr: '2201', ab: '03:15', abOrt: 'BBU', an: '12:15', anOrt: 'BBU' }),
    leg({ nr: '2202', ab: '12:15', abOrt: 'BBU', an: '22:15', anOrt: 'BBU' })
  ];
  const { services } = build(rows);
  assert.equal(services[0].handover.nextServiceNumber, null, 'adjacency is not a handover');
  assert.equal(services[1].handover.previousServiceNumber, null, 'and neither is a matching time');
});

test('B: the ten-column layout has no handover columns and invents none', () => {
  const rows = [
    ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
    ['7511', '10/1', 'Linie 10', '05:00', 'BBU', '06:00', 'TGR', '05:00', '06:00', '01:00']
  ];
  const [service] = build(rows).services;
  assert.equal(service.handover.previousServiceNumber, null);
  assert.equal(service.handover.nextServiceNumber, null);
  assert.equal(service.activities[0].handover.previousServiceNumber, null);
});

test('B: the enrichment is additive and does not mutate its input', () => {
  const original = adaptExcelRowsToCanonicalSchedule(twoLegPlan());
  const before = JSON.stringify(original.services[0].activities.map(a => a.handover ?? null));
  attachExcelHandoverData(original);
  assert.equal(JSON.stringify(original.services[0].activities.map(a => a.handover ?? null)), before);
  assert.equal(original.services[0].handover, undefined, 'the input keeps no summary of its own');
});

test('B: the CanonicalSchedule contract survives unchanged', () => {
  const schedule = build(twoLegPlan());
  assert.equal(schedule.type, 'CanonicalSchedule');
  assert.equal(schedule.metadata.schemaVersion, '1.0');
  assert.equal(schedule.metadata.activityCount, schedule.activities.length);
  assert.equal(schedule.document.sourceType, 'excel');
});

test('B: a foreign input is refused rather than half-processed', () => {
  assert.throws(() => attachExcelHandoverData(null), TypeError);
  assert.throws(() => attachExcelHandoverData({ type: 'Something' }), TypeError);
});
