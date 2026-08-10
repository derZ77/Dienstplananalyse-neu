import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const header = ['Kopf'];
const serviceRow = (number, paidTime) =>
  ['', '', number, 'Dienst', '', '03:00', 'A', '', '', '12:00', 'B', '', '', '', '03:00', '12:00', paidTime];

function scheduleFor(rows) {
  return adaptExcelRowsToCanonicalSchedule([header, ...rows], { layout: 'legacy-tabular-17-column' });
}

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

test('Phase 6.11: Block 4 zählt im Montag-bis-Freitag-Plan nur normale Überschreitungen gegen die BV-Grenze', () => {
  const blocks = createOriginalBlockViewModel(scheduleFor([
    serviceRow('1151', '08:50'),
    serviceRow('1101', '09:00'),
    serviceRow('1150', '08:45')
  ]));

  assert.equal(blocks.longText, [
    'Dienste >08:30h: 1101, 1150, 1151',
    '',
    'BV-Bewertung (Mo–Fr):',
    'Gefunden: 3 Dienste über 08:30h',
    'davon Reserve: 1',
    'für BV relevant: 2',
    'Begründung: Reserve-Dienste zählen nicht gegen die Begrenzung.',
    'Dienstdetails:',
    'Dienst | Bezahlte Zeit | Typ',
    '1101 | 09:00 h | Reserve',
    '1150 | 08:45 h | normal',
    '1151 | 08:50 h | normal',
    'Ergebnis: BV-Verstoß / Prüfung erforderlich.'
  ].join('\n'));
});

test('Phase 6.11: ein normaler und ein Reserve-Dienst über 08:30h ergeben BV eingehalten', () => {
  const blocks = createOriginalBlockViewModel(scheduleFor([
    serviceRow('1101', '09:00'),
    serviceRow('1150', '08:45')
  ]));

  assert.match(blocks.longText, /Gefunden: 2 Dienste über 08:30h/);
  assert.match(blocks.longText, /davon Reserve: 1/);
  assert.match(blocks.longText, /für BV relevant: 1/);
  assert.match(blocks.longText, /Ergebnis: BV eingehalten\./);
});

test('Phase 6.11: JES-Excel und JES-PDF bewahren dieselbe Legacy-Liste und BV-Bewertung', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  const excelText = createOriginalBlockViewModel(excel).longText;
  const pdfText = createOriginalBlockViewModel(pdf).longText;
  assert.equal(pdfText, excelText);
  assert.match(pdfText, /^Dienste >08:30h:/);
  assert.match(pdfText, /BV-Bewertung:/);
  assert.match(pdfText, /nicht eindeutig als Montag bis Freitag erkannt/);
});

test('Phase 6.11: JNV-PDF zeigt bei vorhandener bezahlter Zeit die getrennte BV-Bewertung', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).longText;

  assert.match(output, /^Dienste >08:30h:/);
  assert.match(output, /BV-Bewertung \(Mo–Fr\):/);
  assert.match(output, /Gefunden: \d+ Dienste über 08:30h/);
});
