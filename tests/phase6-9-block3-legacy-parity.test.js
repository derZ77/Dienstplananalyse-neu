import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const LEGACY_RESERVE_TEXT = 'Anzahl Reserve-Dienste: 2\nIDs: 2101, 2102';

function fileLike(path) {
  return {
    name: path.split('/').at(-1), type: 'application/pdf',
    arrayBuffer: async () => {
      const bytes = new Uint8Array(await readFile(path));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function installXlsx() {
  if (globalThis.XLSX?.read) return;
  const sandbox = { global: null, globalThis: null, window: null, self: null, process, Buffer, console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  globalThis.XLSX = sandbox.XLSX;
}

test('Phase 6.9: JES-Excel und JES-PDF behalten den vollständigen Legacy-Leerfall von Block 3', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(excel).reserveText, 'Anzahl Reserve-Dienste: 0\nIDs: ');
  assert.equal(createOriginalBlockViewModel(pdf).reserveText, createOriginalBlockViewModel(excel).reserveText);
});

test('Phase 6.9: JNV-PDF projiziert Reserve-Dienste in Legacy-Reihenfolge und ohne Zusatzbewertung', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(schedule).reserveText, LEGACY_RESERVE_TEXT);
});
