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
