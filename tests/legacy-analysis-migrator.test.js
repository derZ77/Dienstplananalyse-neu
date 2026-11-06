import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { analyzeMigratedLegacyChecks, toMigratedLegacyAnalysisDebugJson } from '../js/v2/analysis/legacy-analysis-migrator.js';
import { analyzeCanonicalScheduleWithMigratedLegacyChecks } from '../js/v2/analysis/analysis-core.js';

const indexPath = new URL('../index.html', import.meta.url);

async function loadLegacyParsers() {
  const html = await readFile(indexPath, 'utf8');
  const start = html.indexOf('\t\tfunction isSharedService');
  const end = html.indexOf("\n\n\n\n\n\t\tdocument.getElementById('file-input')");
  const context = vm.createContext({ console });
  vm.runInContext(html.slice(start, end), context);
  return context;
}

const rows = [
  ['Kopfzeile'],
  ['', '', '1140', 'Dienst', '5/11', '04:00', 'A', '', '', '17:00', 'B', '', '', '', '04:00', '17:00', '09:00'],
  ['', '', '1101', 'Dienst', '6/12', '03:00', 'BBU', '', '', '12:00', 'BUP', '', '', '', '03:00', '12:00', '09:00']
];

test('migrierte Blöcke 1–8 liefern dieselben fachlichen Ergebnisse wie die tabellarische Legacy-Analyse', async () => {
  const legacy = await loadLegacyParsers();
  const legacyResult = legacy.parseTabular(rows, {});
  const canonical = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column', sheetName: 'Altbestand' });
  const migrated = analyzeMigratedLegacyChecks(canonical);

  assert.match(legacyResult.planTypeText, /Straßenbahn – Mo–Fr Schule/);
  assert.equal(migrated.plan.label, 'Straßenbahn – Mo–Fr Schule');
  assert.match(legacyResult.countText, /2/);
  assert.equal(migrated.serviceCount, 2);
  assert.match(legacyResult.sharedText, /ID 1140: Schichtdauer 13:00/);
  assert.deepEqual(migrated.sharedServices.map(service => [service.serviceNumber, service.shiftDuration.value, service.exceedsTwelveHours]), [['1140', '13:00', true]]);
  assert.match(legacyResult.reserveText, /1101/);
  assert.deepEqual(migrated.reserveServices, ['1101']);
  assert.match(legacyResult.longText, /1101, 1140/);
  assert.deepEqual(migrated.longPaidServices, ['1101', '1140']);
  assert.match(legacyResult.locText, /1140/);
  assert.deepEqual(migrated.differentLocationServices, [{ serviceNumber: '1140', startLocation: 'A', endLocation: 'B' }]);
  assert.match(legacyResult.segmentText, /ID 1140/);
  assert.equal(migrated.longServiceParts[0].serviceNumber, '1140');
  assert.equal(migrated.shifts.assignments.find(entry => entry.serviceNumber === '1140').shift, 'GF1');
  assert.ok(legacyResult.routeText.includes('5/11'));
  assert.ok(migrated.routes['5/11']);
  assert.equal(analyzeCanonicalScheduleWithMigratedLegacyChecks(canonical).legacyAnalyses.type, 'MigratedLegacyAnalysisResult');
  assert.doesNotThrow(() => JSON.parse(toMigratedLegacyAnalysisDebugJson(migrated)));
});

test('migrator akzeptiert nur CanonicalSchedule', () => {
  assert.throws(() => analyzeMigratedLegacyChecks({ type: 'ExcelWorkbook' }), /CanonicalSchedule/);
});

test('dreistellige Stadtbusdienste verwenden die belegte Samstag-Gültigkeit für Wochenendschichten', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule([
    ['Kopf'],
    ['', '', '311', 'Dienst', '10100', '04:00', 'Burgau', '', '', '12:00', 'Burgau', '', '', '', '03:39', '12:00', '07:51']
  ], { layout: 'legacy-tabular-17-column' });
  schedule.validity = { dayType: 'saturday', dayTypeSource: 'HEADER', serviceRegime: 'unknown', rawLabel: 'Dienste Stadtbus, Samstag, ab 19.12.2026' };
  const result = analyzeMigratedLegacyChecks(schedule);
  assert.equal(result.shifts.weekend, true);
  assert.equal(result.shifts.assignments[0].shift, 'WE-F1');
  assert.equal(result.plan.vehicle, 'Bus');
  assert.equal(result.plan.timeframe, 'Samstag');
});

function numberedSchedule(numbers, title = '') {
  const schedule = adaptExcelRowsToCanonicalSchedule([
    ['Kopf'],
    ...numbers.map(number => ['', '', String(number), 'Dienst', '10100', '04:00', 'A', '', '', '12:00', 'A', '', '', '', '04:00', '12:00', '09:00'])
  ], { layout: 'legacy-tabular-17-column' });
  if (title) schedule.validity = { dayType: 'mo_fr', dayTypeSource: 'HEADER', serviceRegime: 'holidays', rawLabel: title };
  return schedule;
}

test('neue Stadtbusnummern erhalten Reserve- und Teilungsregeln ohne Umnummerierung', () => {
  const result = analyzeMigratedLegacyChecks(numberedSchedule(
    [101, 102, 140, 159, 201, 202, 240, 259, 301, 302, 401, 402],
    'Dienste Stadtbus, Montag - Freitag Ferien, ab 19.12.2026'
  ));
  assert.deepEqual(result.reserveServices, ['101', '102', '201', '202', '301', '302', '401', '402']);
  assert.deepEqual(result.sharedServices.map(s => s.serviceNumber), ['140', '159', '240', '259']);
  assert.equal(result.serviceCount, 12);
  assert.ok(!result.longServiceParts.some(s => ['101', '201', '301', '401'].includes(s.serviceNumber)));
});

test('dreistelliges Busnummernschema wird auch ohne Titel erkannt', () => {
  const result = analyzeMigratedLegacyChecks(numberedSchedule([201, 211, 240]));
  assert.equal(result.plan.vehicle, 'Bus');
  assert.equal(result.plan.timeframe, 'Mo–Fr Ferien');
  assert.deepEqual(result.reserveServices, ['201']);
  assert.deepEqual(result.sharedServices.map(s => s.serviceNumber), ['240']);
});

test('Regionalbus und Straßenbahn erhalten keine dreistelligen Stadtbusregeln', () => {
  for (const family of ['Regionalbus', 'Straßenbahn']) {
    const result = analyzeMigratedLegacyChecks(numberedSchedule([201, 240], `Dienste ${family} Montag bis Freitag, ab 19.12.2026`));
    assert.deepEqual(result.reserveServices, []);
    assert.deepEqual(result.sharedServices, []);
  }
  const tram = analyzeMigratedLegacyChecks(numberedSchedule([1201, 1202, 1240]));
  assert.equal(tram.plan.vehicle, 'Straßenbahn');
  assert.deepEqual(tram.reserveServices, ['1201', '1202']);
  assert.deepEqual(tram.sharedServices.map(s => s.serviceNumber), ['1240']);
});

test('neuer Stadtbusdienst 190 wird wie 2190 behandelt und erhält keine alte Kurznummern-Sonderregel', () => {
  const result = analyzeMigratedLegacyChecks(numberedSchedule([190, 201], 'Dienste Stadtbus, Montag - Freitag Ferien, ab 19.12.2026'));
  assert.deepEqual(result.reserveServices, ['201']);
});
