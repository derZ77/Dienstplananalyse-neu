import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptExcelRowsToCanonicalSchedule, detectExcelLayout } from '../js/v2/excel/excel-canonical-adapter.js';
import { prepareCanonicalScheduleForAnalysis } from '../js/v2/analysis/analysis-adapter.js';

const rows = [
  ['Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026'],
  ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
  ['751', '', 'Vorbereitungszeit JES', '03:53', 'Betriebshof Jena-Burgau', '04:08', 'Betriebshof Jena-Burgau', '03:53', '12:28', '08:05'],
  ['', '7511', 'Dienst', '04:08', 'Betriebshof Jena-Burgau', '07:03', 'Jena, Busbahnhof Endhst.', '', '', ''],
  ['', '7511', 'Pause', '07:03', 'Busbahnhof', '07:33', 'Busbahnhof', '', '', ''],
  ['', '7511', 'Dienst', '07:33', 'Busbahnhof', '12:13', 'Betriebshof Jena-Burgau', '', '', ''],
  ['', '', 'Nachbereitungszeit JES', '12:13', 'Betriebshof Jena-Burgau', '12:28', 'Betriebshof Jena-Burgau', '', '', '']
];

test('Excel-Zeilen der bestehenden 10-Spalten-Dienstübersicht werden verlustfrei kanonisiert', () => {
  const canonical = adaptExcelRowsToCanonicalSchedule(rows, {
    fileName: '20260713_Dienstuebersicht_FDA_v2.xlsx',
    sheetName: 'Dienstübersicht'
  });
  const service = canonical.services[0];

  assert.equal(detectExcelLayout(rows), 'schedule-10-column');
  assert.equal(canonical.type, 'CanonicalSchedule');
  assert.equal(service.serviceNumber, '751');
  assert.equal(service.begin.value, '03:53');
  assert.equal(service.end.value, '12:28');
  assert.equal(service.paidTime.value, '08:05');
  assert.equal(service.activities.length, 5);
  assert.equal(service.activities[1].circuitNumber, '7511');
  assert.equal(service.activities[4].rawActivity, 'Nachbereitungszeit JES');
  assert.deepEqual(service.source.excelRows[0].rawCells, rows[2]);
  assert.deepEqual(service.activities[2].source.rawCells, rows[4]);
  assert.doesNotThrow(() => prepareCanonicalScheduleForAnalysis(canonical));
});

test('historische 17-Spalten-Zeilen bleiben als separater Excel-Layoutpfad abbildbar', () => {
  const legacyRows = [
    ['Kopf'],
    ['', '', '1103', 'Dienst', '5/11', '04:00', 'Start', '', '', '12:45', 'Ende', '', '', '', '04:00', '12:45', '08:45']
  ];
  const canonical = adaptExcelRowsToCanonicalSchedule(legacyRows, { sheetName: 'Historisch' });
  const service = canonical.services[0];

  assert.equal(canonical.metadata.excelLayout, 'legacy-tabular-17-column');
  assert.equal(service.serviceNumber, '1103');
  assert.equal(service.activities[0].circuitNumber, '5/11');
  assert.equal(service.activities[0].departureLocation, 'Start');
  assert.equal(service.activities[0].arrivalLocation, 'Ende');
  assert.deepEqual(service.activities[0].source.rawCells, legacyRows[1]);
});
