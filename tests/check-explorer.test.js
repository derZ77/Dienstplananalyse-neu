import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCheckStatistics,
  createCheckExplorerModel,
  filterCheckResults,
  groupCheckResults,
  sortCheckResults
} from '../js/v2/ui/check-explorer.js';

const results = [
  result('BV003', 'BV', 'WARNING', 'FAIL', 'Dienstzeit überschreitet die Grenze', ['service:1103']),
  result('BV005', 'BV', 'INFO', 'PASS', 'Planmetadaten sind vorhanden', ['service:42']),
  result('ARBZG001', 'ARBZG', 'ERROR', 'FAIL', 'Arbeitszeit ist unzulässig', ['service:7']),
  result('CUSTOM099', 'CUSTOM', 'VIOLATION', 'FAIL', 'Kritische Abweichung in Jena', ['service:1201'])
];

test('Check Explorer filtert Kategorie, Severity, Status, Dienstnummer und Check-ID', () => {
  assert.deepEqual(filterCheckResults(results, { category: 'BV' }).map(row => row.id), ['BV003', 'BV005']);
  assert.deepEqual(filterCheckResults(results, { severity: 'ERROR', status: 'FAIL' }).map(row => row.id), ['ARBZG001']);
  assert.deepEqual(filterCheckResults(results, { serviceNumber: '1103' }).map(row => row.id), ['BV003']);
  assert.deepEqual(filterCheckResults(results, { checkId: '005' }).map(row => row.id), ['BV005']);
});

test('Check Explorer durchsucht ID, Namen, Nachricht und Dienstbezug', () => {
  assert.deepEqual(filterCheckResults(results, { search: 'Jena' }).map(row => row.id), ['CUSTOM099']);
  assert.deepEqual(filterCheckResults(results, { search: '1103' }).map(row => row.id), ['BV003']);
  assert.deepEqual(filterCheckResults(results, { search: 'arbeitszeit' }).map(row => row.id), ['ARBZG001']);
});

test('Check Explorer sortiert nach Severity, Dienstnummer, Check-ID und Kategorie', () => {
  assert.deepEqual(sortCheckResults(results, 'severity').map(row => row.id), ['CUSTOM099', 'ARBZG001', 'BV003', 'BV005']);
  assert.deepEqual(sortCheckResults(results, 'serviceNumber').map(row => row.id), ['ARBZG001', 'BV005', 'BV003', 'CUSTOM099']);
  assert.deepEqual(sortCheckResults(results, 'checkId').map(row => row.id), ['ARBZG001', 'BV003', 'BV005', 'CUSTOM099']);
  assert.deepEqual(sortCheckResults(results, 'category').map(row => row.id), ['BV003', 'BV005', 'ARBZG001', 'CUSTOM099']);
});

test('Check Explorer berechnet Statistik und gruppiert nach Kategorie oder Dienst', () => {
  assert.deepEqual(calculateCheckStatistics(results), { total: 4, pass: 1, warning: 1, error: 1, violation: 1 });
  assert.deepEqual(groupCheckResults(results, 'category').map(group => group.key), ['BV', 'ARBZG', 'CUSTOM']);
  assert.deepEqual(groupCheckResults(results, 'service').map(group => group.key), ['1103', '42', '7', '1201']);
});

test('Check Explorer resolves affected canonical service ids and never displays them as duty numbers', () => {
  const canonicalSchedule = {
    type: 'CanonicalSchedule',
    services: [{ id: 'activity:1;2', serviceNumber: '4711' }]
  };
  const model = createCheckExplorerModel({ type: 'CheckReport', results: [
    result('BV003', 'BV', 'WARNING', 'FAIL', 'Orte weichen ab', ['activity:1;2'])
  ] }, { canonicalSchedule });

  assert.deepEqual(model.rows[0].serviceNumbers, ['4711']);
  assert.equal(model.rows[0].serviceLabel, '4711');
  assert.doesNotMatch(model.rows[0].serviceLabel, /activity|;/i);
});

function result(id, category, severity, status, message, affectedServices) {
  return { id, name: `${id} Name`, category, severity, status, message, affectedServices };
}
