import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDienstuebersichtExportModel, DIENSTUEBERSICHT_COLUMNS } from '../js/v2/export/dienstuebersicht-xlsx-export.js';

const time = value => ({ value });
const schedule = sourceType => ({ type: 'CanonicalSchedule', document: { sourceType }, services: [{ serviceNumber: '2101', begin: time('03:15'), end: time('12:15'), paidTime: { value: '09:00' }, activities: [{ circuitNumber: '12100', rawActivity: 'Dienst', departureTime: time('03:15'), departureLocation: 'Bth. Burgau', arrivalTime: time('12:15'), arrivalLocation: 'Bth. Burgau' }] }] });

test('Phase 7.3: Excel und PDF erhalten denselben Dienstübersicht-Vertrag', () => {
  const excel = buildDienstuebersichtExportModel(schedule('excel'));
  const pdf = buildDienstuebersichtExportModel(schedule('pdf'));
  assert.deepEqual(excel.columns, DIENSTUEBERSICHT_COLUMNS);
  assert.deepEqual(excel.rows, pdf.rows);
  assert.deepEqual(excel.rows[0], ['2101', '12100', '', '', 'Dienst', '03:15', 'Bth. Burgau', '12:15', 'Bth. Burgau', '03:15', '12:15', '09:00']);
  assert.deepEqual(excel.rows[1], Array(12).fill(''));
});
