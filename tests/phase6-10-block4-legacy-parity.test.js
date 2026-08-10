import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const rows = [
  ['Kopf'],
  ['', '', '1204', 'Dienst', '', '03:00', 'A', '', '', '11:31', 'B', '', '', '', '03:00', '11:31', '08:31'],
  ['', '', '1103', 'Dienst', '', '03:00', 'A', '', '', '11:30', 'B', '', '', '', '03:00', '11:30', '08:30'],
  ['', '', '1102', 'Dienst', '', '03:00', 'A', '', '', '11:45', 'B', '', '', '', '03:00', '11:45', '08:45']
];

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

test('Phase 6.10: Block 4 bewahrt Legacy-Grenze, numerische Sortierung und den leeren Listenwert', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const blocks = createOriginalBlockViewModel(schedule);

  assert.equal(blocks.longText, 'Dienste >08:30h: 1102, 1204');

  const emptySchedule = adaptExcelRowsToCanonicalSchedule([rows[0], rows[2]], { layout: 'legacy-tabular-17-column' });
  assert.equal(createOriginalBlockViewModel(emptySchedule).longText, 'Dienste >08:30h: ');
});

test('Phase 6.10: JES-Excel und JES-PDF verwenden dieselbe Block-4-Feststellung', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(pdf).longText, createOriginalBlockViewModel(excel).longText);
});

test('Phase 6.10: JNV-PDF liefert nur die Legacy-Feststellung ohne Zusatzbewertung', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).longText;

  assert.match(output, /^Dienste >08:30h:/);
  assert.doesNotMatch(output, /Bewertung:|Ausnahmegrund:|Ergebnis:/);
});
