import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareCanonicalScheduleForAnalysis, compareCanonicalSchedules, toCanonicalComparisonDebugJson } from '../js/v2/analysis/analysis-adapter.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule } = await import('../js/v2/pdf/schedule-mapper.js');
const { buildCanonicalSchedule } = await import('../js/v2/pdf/canonical-schedule-builder.js');

const excelRows = [
  ['Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026'],
  ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
  ['751', '', 'Vorbereitungszeit JES', '03:53', 'Betriebshof Jena-Burgau', '04:08', 'Betriebshof Jena-Burgau', '03:53', '12:28', '08:05'],
  ['', '7511', 'Dienst', '04:08', 'Betriebshof Jena-Burgau', '07:03', 'Jena, Busbahnhof Endhst.', '', '', ''],
  ['', '7511', 'Pause', '07:03', 'Busbahnhof', '07:33', 'Busbahnhof', '', '', ''],
  ['', '7511', 'Dienst', '07:33', 'Busbahnhof', '12:13', 'Betriebshof Jena-Burgau', '', '', ''],
  ['', '', 'Nachbereitungszeit JES', '12:13', 'Betriebshof Jena-Burgau', '12:28', 'Betriebshof Jena-Burgau', '', '', '']
];

test('Analysis-Adapter akzeptiert ausschließlich CanonicalSchedule und ergänzt keine Fachlogik', () => {
  assert.throws(() => prepareCanonicalScheduleForAnalysis({ type: 'PdfDocumentModel' }), /CanonicalSchedule/);

  const canonical = adaptExcelRowsToCanonicalSchedule(excelRows, { sheetName: 'Dienstübersicht' });
  const prepared = prepareCanonicalScheduleForAnalysis(canonical);

  assert.equal(prepared.type, 'CanonicalSchedule');
  assert.equal(prepared.services[0].drivingTimeSource, 'UNKNOWN');
  assert.equal(prepared.warnings.length, 0);
  assert.equal(prepared.metadata.analysisContractVersion, '1.0');
  assert.equal(canonical.metadata.analysisContractVersion, undefined, 'Eingabe bleibt unverändert');
});

test('Debug-Vergleich ignoriert ausschließlich dokumenttypische Quelleninformationen', () => {
  const excel = adaptExcelRowsToCanonicalSchedule(excelRows, { sheetName: 'Dienstübersicht' });
  const pdfEquivalent = structuredClone(excel);
  pdfEquivalent.document.sourceType = 'pdf';
  pdfEquivalent.services[0].source.sourceType = 'pdf';
  pdfEquivalent.services[0].activities.forEach(activity => {
    activity.source = { sourceType: 'pdf', pageNumber: 1, tableIndex: 1, lineNumber: 1 };
  });
  pdfEquivalent.services[0].activities[0].rawActivity = ' Vorbereitungszeit JES ';

  const comparison = compareCanonicalSchedules(excel, pdfEquivalent);
  assert.equal(comparison.equivalent, true);
  assert.doesNotThrow(() => JSON.parse(toCanonicalComparisonDebugJson(excel, pdfEquivalent)));
});

test('JES-Excel und JES-PDF liefern für den identischen Dienst dieselbe Analyse-Eingabestruktur', async () => {
  const excel = adaptExcelRowsToCanonicalSchedule(excelRows, { sheetName: 'Dienstübersicht' });
  const bytes = new Uint8Array(await readFile(FIXTURES.jesSchedulePdf));
  const pdf = buildCanonicalSchedule(mapPdfDocumentToSchedule(normalizePdfLayoutDocument(await extractPdfLayoutDocument(bytes))));
  const pdfService751 = pdf.services.find(service => service.serviceNumber === '751');
  const pdf751 = {
    ...pdf,
    services: [pdfService751],
    activities: pdfService751.activities
  };

  const comparison = compareCanonicalSchedules(excel, pdf751);
  const preparedExcel = prepareCanonicalScheduleForAnalysis(excel);
  const preparedPdf = prepareCanonicalScheduleForAnalysis(pdf751);

  assert.equal(comparison.equivalent, true, JSON.stringify(comparison.differences));
  assert.deepEqual(Object.keys(preparedExcel).sort(), Object.keys(preparedPdf).sort());
  assert.deepEqual(Object.keys(preparedExcel.services[0]).sort(), Object.keys(preparedPdf.services[0]).sort());
  assert.deepEqual(Object.keys(preparedExcel.activities[0]).sort(), Object.keys(preparedPdf.activities[0]).sort());
});
