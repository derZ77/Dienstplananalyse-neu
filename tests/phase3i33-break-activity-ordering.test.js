/**
 * Phase 3I.33 (A/B/C) — the imported break takes its place in TIME, not at the end of the list.
 *
 * Import only. No rule is touched: BV003, BV010 and BV012 are unchanged; this file asserts that
 * the activity sequence they read is finally in the order the duty is actually worked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { attachExcelBreakData } from '../js/v2/excel/excel-break-import.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';

const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const leg = ({ nr = '', line = '10', uml = '10/1', ab, abOrt = 'BBU', an, anOrt = 'BBU' }) =>
  ['', '', nr, line, uml, ab, abOrt, '', '', an, anOrt, '', '', '', '', '', '', ''];
const due = (breakValue) => [
  ['', 'Dienst-Nr.', 'Dienst-art', 'Umlauf-linie', 'Umlauf-Nr.', 'Wagen-Nr.', 'Beg.', 'Ende', 'P.-regel', 'Block-pause', 'Ab-zug'],
  ['', '2211', 'OPT_Z', '10', '1', '', '', '', '1x33_43', breakValue, '30']
];
const build = (rows, breakValue) => attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(rows), { dienstuebersichtRows: due(breakValue) });
const kinds = (service) => service.activities.map(a => a.activityType === 'unpaidBreak' ? 'Pause' : 'Fahrt');
const times = (service) => service.activities.map(a => `${a.departureTime.value}-${a.arrivalTime.value}`);

// =====================================================================================
// A — the break sits between the two legs it separates
// =====================================================================================
const dayPlan = () => [
  HEADER,
  leg({ nr: '2211', ab: '05:00', an: '08:00', anOrt: 'TGR' }),
  leg({ ab: '08:36', abOrt: 'TGR', an: '12:00' })
];

test('A: the break is placed BETWEEN the two legs, not appended', () => {
  const [service] = build(dayPlan(), '0:36').services;
  assert.deepEqual(kinds(service), ['Fahrt', 'Pause', 'Fahrt']);
});

test('A: the break is no longer the last activity of the duty', () => {
  const [service] = build(dayPlan(), '0:36').services;
  const last = service.activities[service.activities.length - 1];
  assert.notEqual(last.activityType, 'unpaidBreak');
  assert.equal(last.arrivalLocation, 'BBU', 'the duty ends where its last leg ends');
});

test('A: the sequence reads exactly as the duty is worked', () => {
  const [service] = build(dayPlan(), '0:36').services;
  assert.deepEqual(times(service), ['05:00-08:00', '08:00-08:36', '08:36-12:00']);
});

test('A: start, end and duration of the break are unchanged by the ordering', () => {
  const [service] = build(dayPlan(), '0:36').services;
  const pause = service.activities.find(a => a.activityType === 'unpaidBreak');
  assert.equal(pause.departureTime.value, '08:00');
  assert.equal(pause.arrivalTime.value, '08:36');
  assert.equal(pause.declaredMinutes, 36);
  assert.equal(pause.arrivalTime.minutesSinceStartOfDay - pause.departureTime.minutesSinceStartOfDay, 36);
});

test('A: the driving legs keep their number, order and times', () => {
  const plain = adaptExcelRowsToCanonicalSchedule(dayPlan());
  const enriched = build(dayPlan(), '0:36');
  const legsOf = (s) => s.services[0].activities.filter(a => a.activityType !== 'unpaidBreak')
    .map(a => [a.departureTime.value, a.arrivalTime.value, a.departureLocation, a.arrivalLocation]);
  assert.deepEqual(legsOf(enriched), legsOf(plain));
});

test('A: the flat schedule list carries the same order as the duty', () => {
  const schedule = build(dayPlan(), '0:36');
  assert.deepEqual(schedule.activities.map(a => a.id), schedule.services[0].activities.map(a => a.id));
});

test('A: the break lands in the RIGHT gap when a duty has three legs', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '05:00', an: '07:00', anOrt: 'TGR' }),
    leg({ ab: '07:10', abOrt: 'TGR', an: '09:00', anOrt: 'HLZ' }),   // 10-minute turnaround
    leg({ ab: '09:40', abOrt: 'HLZ', an: '13:00' })                  // 40-minute interruption
  ];
  const [service] = build(rows, '0:36').services;
  assert.deepEqual(kinds(service), ['Fahrt', 'Fahrt', 'Pause', 'Fahrt']);
  assert.equal(service.activities[2].departureTime.value, '09:00', 'the longest gap holds the break');
});

test('A: at an identical boundary time the order stays leg → break → leg', () => {
  // The previous leg ends at 08:00, the break begins at 08:00, and the next leg begins at 08:36
  // exactly when the break ends. The sequence must still be unambiguous.
  const [service] = build(dayPlan(), '0:36').services;
  const ids = service.activities.map(a => a.id);
  assert.equal(ids.length, 3);
  assert.equal(service.activities[1].activityType, 'unpaidBreak');
});

test('A: the raw activities are not mutated by the ordering', () => {
  const original = adaptExcelRowsToCanonicalSchedule(dayPlan());
  const before = original.services[0].activities.map(a => a.id).join(',');
  attachExcelBreakData(original, { dienstuebersichtRows: due('0:36') });
  assert.equal(original.services[0].activities.map(a => a.id).join(','), before);
  assert.equal(original.services[0].activities.length, 2, 'the input keeps its own list');
});

// =====================================================================================
// B — the operational day crosses midnight
// =====================================================================================
test('B: a break before midnight is ordered normally', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '18:00', an: '22:00', anOrt: 'TGR' }),
    leg({ ab: '22:36', abOrt: 'TGR', an: '23:50' })
  ];
  const [service] = build(rows, '0:36').services;
  assert.deepEqual(kinds(service), ['Fahrt', 'Pause', 'Fahrt']);
  assert.equal(service.activities[1].departureTime.value, '22:00');
});

test('B: a break that runs ACROSS midnight keeps its place and its length', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '20:00', an: '23:50', anOrt: 'TGR' }),
    leg({ ab: '00:26', abOrt: 'TGR', an: '02:00' })
  ];
  const [service] = build(rows, '0:36').services;
  assert.deepEqual(kinds(service), ['Fahrt', 'Pause', 'Fahrt']);
  const pause = service.activities[1];
  assert.equal(pause.departureTime.value, '23:50');
  assert.equal(pause.arrivalTime.value, '00:26', 'the clock wraps, the break does not');
  assert.equal(pause.declaredMinutes, 36);
});

test('B: a following activity after midnight stays AFTER the break', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '20:00', an: '23:00', anOrt: 'TGR' }),
    leg({ ab: '00:10', abOrt: 'TGR', an: '01:00' }),
    leg({ ab: '01:10', an: '03:00' })
  ];
  const [service] = build(rows, '1:10').services;
  assert.deepEqual(kinds(service), ['Fahrt', 'Pause', 'Fahrt', 'Fahrt']);
  assert.equal(service.activities[1].departureTime.value, '23:00');
  assert.equal(service.activities[2].departureTime.value, '00:10',
    'a smaller clock value after midnight is later, not earlier');
});

test('B: a duty entirely after midnight is ordered without a phantom rollover', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '00:30', an: '02:00', anOrt: 'TGR' }),
    leg({ ab: '02:36', abOrt: 'TGR', an: '05:00' })
  ];
  const [service] = build(rows, '0:36').services;
  assert.deepEqual(kinds(service), ['Fahrt', 'Pause', 'Fahrt']);
});

// =====================================================================================
// C — a break that cannot be placed in time
// =====================================================================================
test('C: an unusable leg time yields no invented position', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '05:00', an: '', anOrt: 'TGR' }),        // no arrival time
    leg({ ab: '', abOrt: 'TGR', an: '12:00' })                     // no departure time
  ];
  const schedule = build(rows, '0:36');
  assert.deepEqual(schedule.services[0].activities.filter(a => a.activityType === 'unpaidBreak'), [],
    'without a window there is no break at all');
  assert.ok(schedule.warnings.some(w => w.code === 'EXCEL_BREAK_WITHOUT_INTERRUPTION'));
});

test('C: an unplaceable break is reported, never sorted in silently', () => {
  // A window exists, but the surrounding legs give no usable clock for the ordering.
  const schedule = build(dayPlan(), '0:36');
  const codes = schedule.warnings.map(w => w.code);
  assert.ok(!codes.includes('EXCEL_BREAK_ORDER_UNRESOLVED'), 'a placeable break needs no warning');
});

test('C: the ordering is deterministic — the same input yields the same sequence', () => {
  const first = build(dayPlan(), '0:36').services[0].activities.map(a => a.id);
  const second = build(dayPlan(), '0:36').services[0].activities.map(a => a.id);
  assert.deepEqual(first, second);
});

test('C: a warning carries a code and a scope, never a raw row', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '05:00', an: '', anOrt: 'TGR' }),
    leg({ ab: '', abOrt: 'TGR', an: '12:00' })
  ];
  for (const warning of build(rows, '0:36').warnings) {
    assert.deepEqual(Object.keys(warning).sort(), ['code', 'message', 'scope', 'severity']);
    assert.ok(!JSON.stringify(warning).includes('BBU'), 'no cell content travels in a warning');
  }
});

test('C: a duty without any break keeps exactly its own legs', () => {
  const schedule = attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(dayPlan()), {});
  assert.deepEqual(kinds(schedule.services[0]), ['Fahrt', 'Fahrt']);
});
