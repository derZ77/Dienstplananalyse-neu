import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

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

test('Phase 5.3: zugehöriges JES-PDF und XLSX bewahren dieselben vier geteilten Dienste in Block 2', async () => {
  await access(EXCEL);
  await access(PDF);
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};

  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const bytes = new Uint8Array(await readFile(EXCEL));
  const excelResult = await analyzeExcelImport({
    name: EXCEL.split('/').at(-1), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  const excel = excelResult.importResult.data;
  const pdfResult = await analyzePdfImport({ name: PDF.split('/').at(-1), arrayBuffer: () => readFile(PDF) });
  const pdf = pdfResult.canonicalSchedule;
  const excelBlocks = createOriginalBlockViewModel(excel);
  const pdfBlocks = createOriginalBlockViewModel(pdf);

  assert.equal(pdfResult.detection.status, 'supported');
  assert.equal(pdf.document.pageCount, 3);
  assert.equal(excelResult.importResult.ok, true);
  assert.equal(excel.services.length, 19);
  assert.equal(pdf.services.length, 19);
  assert.ok(pdf.activities.length >= excel.activities.length, 'PDF-Tabellenblöcke enthalten mindestens die Excel-Aktivitäten');
  const visibleBlocks = [
    'planTypeText', 'countText', 'sharedText', 'reserveText', 'longText', 'locText',
    'segmentText', 'realDrivingTimeText', 'shiftText', 'routeText', 'pauseHtml'
  ];
  assert.ok(visibleBlocks.every(field => String(pdfBlocks[field]).trim() !== ''), 'kein Original-Block bleibt leer');
  assert.equal(pdfBlocks.countText, excelBlocks.countText);
  assert.match(pdfBlocks.sharedText, /Anzahl geteilte Dienste: 4/);
  assert.match(pdfBlocks.sharedText, /IDs: 756, 758, 759, 760/);
  assert.deepEqual(
    excel.interruptions
      .filter(entry => ['756', '758', '759', '760'].includes(entry.serviceNumber))
      .map(entry => [entry.serviceNumber, entry.start.value, entry.end.value, entry.durationMinutes])
      .sort((left, right) => left[0].localeCompare(right[0])),
    [['756', '09:09', '13:07', 238], ['758', '10:20', '14:07', 227], ['759', '09:39', '13:37', 238], ['760', '09:50', '13:50', 240]]
  );
  assert.match(excelBlocks.sharedText, /Anzahl geteilte Dienste: 4/);
  assert.match(excelBlocks.sharedText, /IDs: 756, 758, 759, 760/);
});
