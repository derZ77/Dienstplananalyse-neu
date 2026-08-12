import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWagenkarteWorkbook } from '../js/v2/import/wagenkarte-import-adapter.js';
import { analyzeVehicleCardDrivingTime } from '../js/v2/blocks/wagenkarte-block7.js';

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

function multiRegionVehicleCardSheet() {
  const row = (...entries) => {
    const cells = Array(23).fill('');
    for (const [column, value] of entries) cells[column] = value;
    return cells;
  };
  return sheet('602', [
    row([0, 'Dienst-Nr.:'], [2, '602'], [8, 'Montag - Freitag, Schule']),
    [],
    row([0, 'Gültig ab:'], [2, '26.05.2026'], [8, 'Schichtdauer:'], [10, '07:16']),
    row([0, 'Dienstbeginn:'], [2, '04:19'], [8, 'Bezahlte Zeit:'], [10, '06:46']),
    row([0, 'Dienstende:'], [2, '11:35'], [8, 'Lenkzeit'], [10, '04:55']),
    row([0, 'Vorbereiten 04:19 - 04:34'], [8, 'unbezahlte Pause 07:49 - 08:19'], [16, 'Nachbereiten 11:20 - 11:35']),
    row([0, 'Leerfahrt'], [8, 'Linie / Fahrt-Nr.'], [16, 'Leerfahrt']),
    row([0, 'Betriebshof Eisenberg'], [2, 'ab'], [4, '04:34'], [8, '410 / 17'], [16, 'Eisenberg, Busbahnhof'], [18, 'ab'], [20, '11:15']),
    row([0, 'Eisenberg, Busbahnhof'], [2, 'an'], [4, '04:39'], [8, 'Eisenberg, Busbahnhof'], [10, 'ab'], [12, '08:25'], [16, 'Betriebshof Eisenberg'], [18, 'an'], [20, '11:20']),
    row([0, 'Linie / Fahrt-Nr.'], [8, 'Jena, Westbahnhof'], [10, 'an'], [12, '09:24']),
    row([0, '460 / 1']),
    row([0, 'Eisenberg, Busbahnhof'], [2, 'ab'], [4, '04:42']),
    row([0, 'Jena, Westbahnhof'], [2, 'an'], [4, '05:10']),
    row([0, 'Wendezeit 05:10 - 05:23']),
    row([0, 'Linie / Fahrt-Nr.']),
    row([0, '470 / 1']),
    row([0, 'Jena, Westbahnhof'], [2, 'ab'], [4, '05:23']),
    row([0, 'Hermsdorf, Bahnhof'], [2, 'an'], [4, '05:57']),
    row([0, 'Bereitstellungszeit 05:57 - 06:09'])
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

test('Phase 9.7D: Mehrregionen-Wagenkarte behält parallele Fahrten, Pausen und Zusatzzeiten getrennt', () => {
  const result = analyzeWagenkarteWorkbook({ sheetNames: ['602'], sheets: [multiRegionVehicleCardSheet()] }, {
    sourceName: '20260526_Eisenberg_Schule.xlsx', organization: 'JES'
  });

  assert.equal(result.ok, true);
  const service = result.data.services[0];
  assert.equal(service.serviceNumber, '602');
  assert.equal(service.officialDrivingTime.minutes, 295);
  assert.equal(service.segments.filter(item => item.type === 'LINE_SERVICE').length, 3);
  assert.equal(service.segments.filter(item => item.type === 'DEADHEAD').length, 2);
  assert.deepEqual(service.breaks.map(item => [item.type, item.start.value, item.end.value]), [['UNPAID_BREAK', '07:49', '08:19']]);
  assert.equal(service.additionalTimes.preparation[0].duration.minutes, 15);
  assert.equal(service.additionalTimes.turnaround[0].duration.minutes, 13);
  assert.equal(service.additionalTimes.provisioning[0].duration.minutes, 12);
  assert.equal(service.additionalTimes.postprocessing[0].duration.minutes, 15);
  assert.equal(analyzeVehicleCardDrivingTime(service).blocks.length, 2, 'die regionale Pause trennt die Fahr-/Leerfahrzeit in der bestehenden Block-7-Logik');
});

test('Phase 9.7D: Mehrregionen-Projektion erhält Dienstunterbrechung und mehrere Pausen als getrennte Block-7-Grenzen', () => {
  const interrupted = multiRegionVehicleCardSheet();
  interrupted.rows[0][2] = '605';
  interrupted.rows[5][8] = 'Dienstunterbrechung 08:00 - 11:57';
  interrupted.rows[8][12] = '12:02';
  interrupted.rows[9][12] = '12:29';
  const interruptedService = analyzeWagenkarteWorkbook({ sheetNames: ['605'], sheets: [interrupted] }).data.services[0];
  assert.deepEqual(interruptedService.interruptions.map(item => [item.start.value, item.end.value]), [['08:00', '11:57']]);
  assert.equal(analyzeVehicleCardDrivingTime(interruptedService).blocks.length, 2);

  const multiplePauses = multiRegionVehicleCardSheet();
  multiplePauses.rows[0][2] = '613';
  multiplePauses.rows[5][8] = 'unbezahlte Pause 08:18 - 08:33';
  multiplePauses.rows[5][16] = 'unbezahlte Pause 11:43 - 12:13';
  multiplePauses.rows[7][20] = '12:18';
  multiplePauses.rows[8][20] = '12:23';
  const multiPauseService = analyzeWagenkarteWorkbook({ sheetNames: ['613'], sheets: [multiplePauses] }).data.services[0];
  assert.deepEqual(multiPauseService.breaks.map(item => [item.start.value, item.end.value]), [['08:18', '08:33'], ['11:43', '12:13']]);
  assert.equal(analyzeVehicleCardDrivingTime(multiPauseService).blocks.length, 3);
});
