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
  ['', '', '1103', 'Dienst', '5/11', '06:00', 'A', '', '', '07:00', 'B', '', '', '', '03:00', '12:00', '08:00'],
  ['', '', '1104', 'Dienst', '5/11', '04:00', 'C', '', '', '05:00', 'D', '', '', '', '03:00', '12:00', '08:00'],
  ['', '', '', 'Dienst', '7/2', '05:00', 'D', '', '', '06:00', 'E', '', '', '', '', '', ''],
  ['', '', '1105', 'Dienst', '7/2', '05:00', 'E', '', '', '06:00', 'F', '', '', '', '03:00', '12:00', '08:00']
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

test('Phase 6.13: Block 9 gruppiert nach Linie/Kurs und bewahrt Zeit- und Ortsdetails in Startzeitreihenfolge', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });

  assert.equal(createOriginalBlockViewModel(schedule).routeText, [
    'Dienste nach Linie/Kurs:',
    '5/11:',
    '  ID 1104 04:00 C — 05:00 D | 05:00 D 7/2',
    '  ID 1103 06:00 A — 07:00 B',
    '',
    '7/2:',
    '  ID 1104 05:00 D — 06:00 E',
    '  ID 1105 05:00 E — 06:00 F'
  ].join('\n'));
});

test('Phase 6.13: Block 9 behält den Legacy-Leerfall ohne erfundene Warnung', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule([rows[0], ['', '', '1103', 'Dienst', '7511', '04:00', 'A', '', '', '05:00', 'B', '', '', '', '03:00', '12:00', '08:00']], { layout: 'legacy-tabular-17-column' });

  assert.equal(createOriginalBlockViewModel(schedule).routeText, 'Dienste nach Linie/Kurs:');
});

test('Phase 6.13: JES-Excel und JES-PDF liefern denselben Block 9', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(pdf).routeText, createOriginalBlockViewModel(excel).routeText);
  assert.match(createOriginalBlockViewModel(pdf).routeText, /^Dienste nach Linie\/Kurs:/);
});

test('Phase 6.13: JNV-PDF zeigt vorhandene Linie/Kurs-Daten ohne automatische Bewertung', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const output = createOriginalBlockViewModel((await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule).routeText;

  assert.match(output, /^Dienste nach Linie\/Kurs:/);
  assert.match(output, /ID \d+ \d{2}:\d{2}/);
  assert.doesNotMatch(output, /Verstoß|BV-Bewertung|Ergebnis:/);
});
