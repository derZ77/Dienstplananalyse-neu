import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const EXCEL = FIXTURES.jesTenColumnScheduleXlsx;
const PDF = FIXTURES.jesSchedulePdf;

function installXlsx() {
  if (globalThis.XLSX?.read) return;
  const sandbox = { global: null, globalThis: null, window: null, self: null, process, Buffer, console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  globalThis.XLSX = sandbox.XLSX;
}

test('Phase 5.3: Original-JES-Excel und zugehöriges PDF erzeugen identische Blöcke 1–10', async () => {
  await access(EXCEL);
  await access(PDF);
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};

  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(EXCEL)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, {
    fileName: EXCEL.split('/').at(-1), sheetName: workbook.sheets[0].name
  });
  const pdfResult = await analyzePdfImport({ name: PDF.split('/').at(-1), arrayBuffer: () => readFile(PDF) });
  const pdf = pdfResult.canonicalSchedule;
  const excelBlocks = createOriginalBlockViewModel(excel);
  const pdfBlocks = createOriginalBlockViewModel(pdf);

  assert.equal(pdfResult.detection.status, 'supported');
  assert.equal(pdf.document.pageCount, 3);
  assert.equal(excel.services.length, 19);
  assert.equal(pdf.services.length, 19);
  assert.ok(pdf.activities.length >= excel.activities.length, 'PDF-Tabellenblöcke enthalten mindestens die Excel-Aktivitäten');
  const visibleBlocks = [
    'planTypeText', 'countText', 'sharedText', 'reserveText', 'longText', 'locText',
    'segmentText', 'realDrivingTimeText', 'shiftText', 'routeText', 'pauseHtml'
  ];
  assert.ok(visibleBlocks.every(field => String(pdfBlocks[field]).trim() !== ''), 'kein Original-Block bleibt leer');
  assert.deepEqual(pdfBlocks, excelBlocks);
});
