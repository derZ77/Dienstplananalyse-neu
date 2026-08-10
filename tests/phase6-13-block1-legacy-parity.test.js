import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { FIXTURES } from './fixtures/paths.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const duplicateServiceRows = [
  ['Kopf'],
  ['', '', '1103', 'Dienst', '', '03:00', 'A', '', '', '08:00', 'B', '', '', '', '03:00', '08:00', '05:00'],
  ['', '', '1103', 'Dienst', '', '08:10', 'B', '', '', '13:00', 'C', '', '', '', '08:10', '13:00', '04:50'],
  ['', '', '1104', 'Dienst', '', '04:00', 'D', '', '', '09:00', 'E', '', '', '', '04:00', '09:00', '05:00']
];

function fileLike(path) {
  return {
    name: path.split('/').at(-1),
    type: 'application/pdf',
    arrayBuffer: async () => {
      const bytes = new Uint8Array(await readFile(path));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function installXlsx() {
  if (globalThis.XLSX?.read) return;
  const sandbox = { global: null, globalThis: null, window: null, self: null, process, Buffer, console };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  globalThis.XLSX = sandbox.XLSX;
}

test('Phase 6.13: Block 1 zählt mehrfach dargestellte positive Dienstnummern nur einmal', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(duplicateServiceRows, { layout: 'legacy-tabular-17-column' });
  const output = createOriginalBlockViewModel(schedule).countText;

  assert.equal(schedule.services.length, 3);
  assert.equal(output, 'Anzahl eindeutiger Dienst-IDs: 2');
  assert.doesNotMatch(output, /BV|Arbeitszeit|Verstoß/);
});

test('Phase 6.13: JES-Excel und JES-PDF erzeugen dieselbe Legacy-Dienstanzahl', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(excel).countText, 'Anzahl eindeutiger Dienst-IDs: 18');
  assert.equal(createOriginalBlockViewModel(pdf).countText, 'Anzahl eindeutiger Dienst-IDs: 18');
});

test('Phase 6.13: JNV-PDF stellt die eindeutige Dienstanzahl als reine Information dar', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).countText;

  assert.equal(output, 'Anzahl eindeutiger Dienst-IDs: 62');
  assert.doesNotMatch(output, /BV|Arbeitszeit|Verstoß/);
});
