import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzeCanonicalSchedule, toAnalysisResultDebugJson } = await import('../js/v2/analysis/analysis-core.js');
const { adaptExcelRowsToCanonicalSchedule } = await import('../js/v2/excel/excel-canonical-adapter.js');
const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule } = await import('../js/v2/pdf/schedule-mapper.js');
const { buildCanonicalSchedule } = await import('../js/v2/pdf/canonical-schedule-builder.js');
const { applyRuleGroups } = await import('../js/v2/rules/rule-engine.js');

const JES_PDF = FIXTURES.jesSchedulePdf;
const BEU_PDF = FIXTURES.jnvSchedulePdf;
const excelRows = [
  ['Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026'],
  ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
  ['751', '', 'Vorbereitungszeit JES', '03:53', 'Betriebshof Jena-Burgau', '04:08', 'Betriebshof Jena-Burgau', '03:53', '12:28', '08:05'],
  ['', '7511', 'Dienst', '04:08', 'Betriebshof Jena-Burgau', '07:03', 'Jena, Busbahnhof Endhst.', '', '', ''],
  ['', '7511', 'Pause', '07:03', 'Busbahnhof', '07:33', 'Busbahnhof', '', '', ''],
  ['', '7511', 'Dienst', '07:33', 'Busbahnhof', '12:13', 'Betriebshof Jena-Burgau', '', '', ''],
  ['', '', 'Nachbereitungszeit JES', '12:13', 'Betriebshof Jena-Burgau', '12:28', 'Betriebshof Jena-Burgau', '', '', '']
];

async function loadRules(profile) {
  const directory = new URL(`../js/v2/rules/${profile}/v1/`, import.meta.url);
  return Promise.all(['activities.json', 'interruptions.json', 'warnings.json'].map(async file =>
    JSON.parse(await readFile(new URL(file, directory), 'utf8'))
  ));
}

async function buildPdfSchedule(path, rules) {
  const bytes = new Uint8Array(await readFile(path));
  const canonical = buildCanonicalSchedule(mapPdfDocumentToSchedule(normalizePdfLayoutDocument(await extractPdfLayoutDocument(bytes))));
  return applyRuleGroups(canonical, rules);
}

test('Analysis-Core erzeugt ausschließlich allgemeine Kennzahlen und übernimmt Warnungen', () => {
  const canonical = adaptExcelRowsToCanonicalSchedule(excelRows, { sheetName: 'Dienstübersicht' });
  const classified = applyRuleGroups(canonical, [{
    id: 'test-types',
    rules: [
      { id: 'preparation', priority: 4, target: 'activities', match: { field: 'rawActivity', operator: 'contains', value: 'Vorbereitungszeit' }, action: { type: 'set', path: 'activityType', value: 'preparation' } },
      { id: 'drive', priority: 3, target: 'activities', match: { field: 'rawActivity', operator: 'exact', value: 'Dienst' }, action: { type: 'set', path: 'activityType', value: 'serviceDrive' } },
      { id: 'break', priority: 2, target: 'activities', match: { field: 'rawActivity', operator: 'exact', value: 'Pause' }, action: { type: 'set', path: 'activityType', value: 'unpaidBreak' } },
      { id: 'postprocessing', priority: 1, target: 'activities', match: { field: 'rawActivity', operator: 'contains', value: 'Nachbereitungszeit' }, action: { type: 'set', path: 'activityType', value: 'postprocessing' } }
    ]
  }]);
  classified.warnings.push({ id: 'existing-warning', message: 'bereits vorhanden' });

  const result = analyzeCanonicalSchedule(classified);

  assert.equal(result.type, 'AnalysisResult');
  assert.equal(result.statistics.serviceCount, 1);
  assert.equal(result.statistics.activityCount, 5);
  assert.equal(result.statistics.pauseCount, 1);
  assert.equal(result.statistics.workingTime.value, '08:05');
  assert.equal(result.statistics.paidTime.value, '08:05');
  assert.equal(result.statistics.unpaidTime.value, '00:30');
  assert.equal(result.statistics.preparation.duration.value, '00:15');
  assert.equal(result.statistics.postprocessing.duration.value, '00:15');
  assert.equal(result.statistics.trips.count, 2);
  assert.equal(result.statistics.trips.duration.value, '07:35');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, classified.warnings);
  assert.doesNotThrow(() => JSON.parse(toAnalysisResultDebugJson(result)));
});

test('JES und BEU liefern aus der bestehenden PDF-Pipeline generische AnalysisResults', async () => {
  const [jes, beu] = await Promise.all([
    buildPdfSchedule(JES_PDF, await loadRules('jes')),
    buildPdfSchedule(BEU_PDF, await loadRules('beu'))
  ]);
  const jesResult = analyzeCanonicalSchedule(jes);
  const beuResult = analyzeCanonicalSchedule(beu);

  for (const result of [jesResult, beuResult]) {
    assert.equal(result.type, 'AnalysisResult');
    assert.ok(result.statistics.serviceCount > 0);
    assert.ok(result.statistics.activityCount > 0);
    assert.ok(result.statistics.paidTime.minutes > 0);
    assert.ok(result.statistics.activityTypes.serviceDrive.count > 0);
    assert.ok(result.statistics.trips.duration.minutes > 0);
    assert.deepEqual(result.issues, []);
    assert.ok(result.metadata.analysisDurationMs >= 0);
  }
});

test('Excel und PDF ergeben für den identischen JES-Dienst dieselben allgemeinen Kennzahlen', async () => {
  const rules = await loadRules('jes');
  const excel = applyRuleGroups(adaptExcelRowsToCanonicalSchedule(excelRows, { sheetName: 'Dienstübersicht' }), rules);
  const pdf = await buildPdfSchedule(JES_PDF, rules);
  const pdfService = pdf.services.find(service => service.serviceNumber === '751');
  const pdf751 = { ...pdf, services: [pdfService], activities: pdfService.activities };

  const excelResult = analyzeCanonicalSchedule(excel);
  const pdfResult = analyzeCanonicalSchedule(pdf751);
  const comparable = result => ({
    serviceCount: result.statistics.serviceCount,
    activityCount: result.statistics.activityCount,
    pauseCount: result.statistics.pauseCount,
    workingTime: result.statistics.workingTime,
    paidTime: result.statistics.paidTime,
    unpaidTime: result.statistics.unpaidTime,
    preparation: result.statistics.preparation,
    postprocessing: result.statistics.postprocessing,
    walkingTime: result.statistics.walkingTime,
    rideAlong: result.statistics.rideAlong,
    trips: result.statistics.trips,
    activityTypes: result.statistics.activityTypes
  });

  assert.deepEqual(comparable(excelResult), comparable(pdfResult));
});
