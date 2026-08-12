import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWagenkarteWorkbook } from '../js/v2/import/wagenkarte-import-adapter.js';

const sheet = (name, rows) => ({ name, rows });

function vehicleCardSheet(serviceNumber, { midnight = false } = {}) {
  return sheet(`Dienst ${serviceNumber}`, [
    ['', 'Dienst-Nr.:', '', String(serviceNumber), '', '', '', '', '', 'Montag bis Freitag (Schule)'],
    [],
    ['', '', '', '17.08.2026', '', '', '', '', '', '', '', '', '08:45'],
    ['', '', '', midnight ? '22:00' : '05:30', '', '', '', '', '', '', '', '09:15'],
    ['', '', '', midnight ? '01:10' : '14:45', '', '', '', '', '', '', '', '04:55'],
    ['', 'Umlauf 6021'],
    ['', 'Vorbereiten 05:30 - 05:45'],
    ['', 'Linie / Fahrt-Nr.'],
    ['', '460 / 1'],
    ['ab', '05:45', 'Betriebshof'],
    ['an', '06:15', 'Zentrum'],
    ['', 'Leerfahrt'],
    ['ab', midnight ? '23:50' : '06:30', 'Zentrum'],
    ['an', midnight ? '00:20' : '07:00', 'Betriebshof'],
    ['', 'Wendezeit 07:00 - 07:10'],
    ['', 'Bereitstellungszeit 07:10 - 07:15'],
    ['', 'Dienstbereitschaft 07:15 - 07:25'],
    ['', 'unbezahlte Pause 09:30 - 10:00'],
    ['', 'Pause 10:30 - 10:45'],
    ['', 'Dienstunterbrechung 12:00 - 12:20'],
    ['', 'Nachbereiten 14:35 - 14:45']
  ]);
}

test('Phase 9.7A: Wagenkartenadapter projektiert Kopf-, Fahr-, Pausen- und Zusatzzeitdaten in den gemeinsamen Vertrag', () => {
  const result = analyzeWagenkarteWorkbook({
    sheetNames: ['Dienst 602', 'Dienst 603'],
    sheets: [vehicleCardSheet(602), vehicleCardSheet(603)]
  }, { sourceName: '20260526_Eisenberg_Schule(1).xlsx', organization: 'JES' });

  assert.equal(result.ok, true);
  assert.equal(result.data.type, 'VehicleCardSchedule');
  assert.equal(result.data.organization, 'JES');
  assert.equal(result.data.validity.dayType, 'mo_fr');
  assert.equal(result.data.validity.serviceRegime, 'school');
  assert.equal(result.data.validity.validFrom, '2026-08-17');
  assert.equal(result.data.services.length, 2);

  const service = result.data.services[0];
  assert.equal(service.serviceId, 'wagenkarte-service:602:6021');
  assert.equal(service.shiftStart.value, '05:30');
  assert.equal(service.shiftEnd.value, '14:45');
  assert.equal(service.paidTime.minutes, 555);
  assert.equal(service.officialDrivingTime.minutes, 295);
  assert.equal(service.runId, '6021');
  assert.deepEqual(service.segments.filter(segment => segment.type === 'LINE_SERVICE').map(segment => segment.line), ['460']);
  assert.equal(service.segments.filter(segment => segment.type === 'DEADHEAD').length, 1);
  assert.equal(service.additionalTimes.turnaround.length, 1);
  assert.equal(service.additionalTimes.provisioning.length, 1);
  assert.equal(service.additionalTimes.preparation.length, 1);
  assert.equal(service.additionalTimes.postprocessing.length, 1);
  assert.equal(service.additionalTimes.standby.length, 1);
  assert.equal(service.breaks.length, 2, 'unbezahlte und reguläre Pause bleiben getrennt erhalten');
  assert.equal(service.interruptions.length, 1);
});

test('Phase 9.7A: Projektion normalisiert die Zeitachse über Mitternacht ohne negative Dauer', () => {
  const result = analyzeWagenkarteWorkbook({ sheetNames: ['Dienst 602'], sheets: [vehicleCardSheet(602, { midnight: true })] });
  const service = result.data.services[0];
  const deadhead = service.segments.find(segment => segment.type === 'DEADHEAD');

  assert.equal(deadhead.duration.minutes, 30);
  assert.ok(deadhead.end.timelineMinutes > deadhead.start.timelineMinutes);
  assert.ok(service.shiftEnd.timelineMinutes > service.shiftStart.timelineMinutes);
});
