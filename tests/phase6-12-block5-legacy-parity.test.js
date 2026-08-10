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
  ['', '', '1104', 'Dienst', '', '03:00', 'A', '', '', '08:00', 'B', '', '', '', '03:00', '08:00', '05:00'],
  ['', '', '1103', 'Dienst', '', '03:00', 'C', '', '', '08:00', 'C', '', '', '', '03:00', '08:00', '05:00']
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

test('Phase 6.12: Block 5 bewahrt die Legacy-ID-Liste und trennt vorhandene Ortsdetails als Information', () => {
  const blocks = createOriginalBlockViewModel(adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' }));

  assert.equal(blocks.locText, [
    'Unterschiedliche Orte: 1104',
    '',
    'Zusätzliche Dienstort-Informationen:',
    'ID 1104: A → B'
  ].join('\n'));
  assert.doesNotMatch(blocks.locText, /Verstoß|BV-Bewertung|Wegezeit|Entgelt/);
});

test('Phase 6.12: gleiche Anfangs- und Endorte bleiben im Legacy-Leerfall unauffällig', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule([rows[0], rows[2]], { layout: 'legacy-tabular-17-column' });

  assert.equal(createOriginalBlockViewModel(schedule).locText, 'Unterschiedliche Orte: ');
});

test('Phase 6.12: JES-Excel und JES-PDF liefern dieselben Dienstort-Informationen', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(pdf).locText, createOriginalBlockViewModel(excel).locText);
});

test('Phase 6.12: JNV-PDF zeigt unterschiedliche Dienstorte rein informativ', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).locText;

  assert.match(output, /^Unterschiedliche Orte:/);
  assert.doesNotMatch(output, /Verstoß|BV-Bewertung|Wegezeit|Entgelt/);
});
