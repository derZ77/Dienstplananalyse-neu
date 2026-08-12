/** Phase 9.5 – supported JNV roster / Umlauftafel document families. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { FIXTURES } from './fixtures/paths.js';

globalThis.DOMMatrix ||= class DOMMatrix {};
const sandbox = { global: null, globalThis: null, window: null, self: null, process, Buffer, console };
sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
createContext(sandbox);
runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
globalThis.XLSX = sandbox.XLSX;

// PDF.js evaluates DOMMatrix at module initialization, so imports that can reach
// the PDF pipeline must happen after the minimal Node test shim is installed.
const { classifyExcelDocument } = await import('../js/v2/import/excel-document-classifier.js');
const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { handlePdfImport } = await import('../js/v2/import/pdf-import-controller.js');
const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
const { detectPdfDocumentProfile } = await import('../js/v2/pdf/document-profile-detector.js');

const xlsxFile = path => {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path.split('/').pop(), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const pdfFile = path => {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path.split('/').pop(), type: 'application/pdf', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

test('Phase 9.5: JNV legacy Excel is distinguished by its schedule structure and enters CanonicalSchedule', async () => {
  const workbook = readWorkbookSheets(new Uint8Array(readFileSync(FIXTURES.legacyScheduleXlsx)));
  const classification = classifyExcelDocument(workbook);
  assert.deepEqual([classification.type, classification.subtype, classification.organization, classification.confidence], ['legacy_excel_schedule', 'jnv_legacy_schedule', 'JNV', 'exact']);

  const imported = await analyzeExcelImport(xlsxFile(FIXTURES.legacyScheduleXlsx));
  assert.equal(imported.importResult.ok, true);
  assert.equal(imported.importResult.data.type, 'CanonicalSchedule');
  assert.equal(imported.importResult.data.document.organization, 'JNV');
  assert.ok(imported.importResult.data.services.length > 0);
  assert.notEqual(imported.importResult.data.validity.dayType, undefined);
});

test('Phase 9.5: JNV Umlauftafel PDF is detected structurally and preserves circulation facts', async () => {
  const imported = await analyzePdfImport(pdfFile(FIXTURES.jnvUmlauftafelPdf));
  assert.equal(imported.detection.status, 'supported');
  assert.equal(imported.detection.profile.id, 'jnv-umlauftafel-pdf-v1');
  assert.equal(imported.documentType, 'umlaufkarte');
  assert.equal(imported.result.ok, true);
  assert.equal(imported.document.organization, 'JNV');
  assert.equal(imported.document.sourceFormat, 'pdf');
  assert.equal(imported.document.validity.dayType, 'mo_fr');
  assert.equal(imported.document.validity.serviceRegime, 'holidays');

  const circulation = imported.document.circulations.find(value => value.code === '11100');
  assert.ok(circulation, 'real circulation is preserved');
  assert.deepEqual(circulation.sourcePages, [3, 4], 'same Umlauf pages are merged by its stable code');
  assert.ok(circulation.segments.some(segment => segment.line === '11' && segment.route === '20'));
  assert.deepEqual(circulation.serviceRefs.sort(), ['2225', '2228', '2244', '2280', '2282']);

  const combined = imported.document.circulations.find(value => value.rawServiceLabels.includes('2247/2256'));
  assert.deepEqual(combined.serviceRefs.sort(), ['2247', '2256', '2282']);
});

test('Phase 9.5: Umlauftafel UI status is neutral and explicitly not a completed Block-7 analysis', async () => {
  const status = { hidden: false, textContent: '' };
  const imported = await handlePdfImport(pdfFile(FIXTURES.jnvUmlauftafelPdf), status);
  assert.equal(imported.documentType, 'umlaufkarte');
  assert.match(status.textContent, /^Dokument erkannt: JNV Umlauftafel/);
  assert.match(status.textContent, /Block-7-Auswertung folgt/);
  assert.doesNotMatch(status.textContent, /Fehler|nicht unterstützt/i);
});

test('Phase 9.5: JNV Umlauftafel XLSX remains an exact, JNV-specific structured import', async () => {
  const imported = await analyzeExcelImport(xlsxFile(FIXTURES.busUmlauftafelXlsx));
  assert.deepEqual([imported.classification.type, imported.classification.subtype, imported.classification.confidence], ['umlaufkarte', 'jnv_umlauftafel', 'exact']);
  assert.equal(imported.document.organization, 'JNV');
  assert.equal(imported.document.sourceFormat, 'xlsx');
  assert.ok(imported.document.circulations.length > 0);
  assert.notEqual(imported.document.validity.dayType, undefined);
});

test('Phase 9.5: Dienstübersicht PDFs retain their existing profiles; a simple filename cannot classify an Umlauftafel', () => {
  const schedule = detectPdfDocumentProfile({ text: 'Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026 Dienst Umlauf Tätigkeit Abfahrt Abfahrtsort Ankunft Ankunftsort Beginn Ende Bez. Zeit Aufrüsten', pageCount: 1 });
  assert.equal(schedule.profile.id, 'beu-stadtbus-v1');
  const insufficient = detectPdfDocumentProfile({ text: 'Umlauf: 11100 Beginn: 05:42 Ende: 20:58', pageCount: 1 });
  assert.equal(insufficient.status, 'unsupported');
});
