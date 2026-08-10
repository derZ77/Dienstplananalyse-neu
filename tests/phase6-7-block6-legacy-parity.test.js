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
  ['', '', '1150', 'Dienst', '5/11', '03:00', 'A', '', '', '07:40', 'B', '', '', '', '03:00', '10:30', '07:30'],
  ['', '', '', 'Dienst', '6/12', '07:50', 'B', '', '', '10:30', 'C', '', '', '', '', '', '']
];

function fileLike(path, type = 'application/pdf') {
  return {
    name: path.split('/').at(-1), type,
    arrayBuffer: async () => {
      const bytes = new Uint8Array(await readFile(path));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

async function loadLegacyTabularParser() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('\t\tfunction isSharedService');
  const end = html.indexOf("\n\n\n\n\n\t\tdocument.getElementById('file-input')");
  const context = vm.createContext({ console });
  vm.runInContext(html.slice(start, end), context);
  return context.parseTabular;
}

function installXlsx() {
  if (globalThis.XLSX?.read) return;
  const sandbox = { global: null, globalThis: null, window: null, self: null, process, Buffer, console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  globalThis.XLSX = sandbox.XLSX;
}

test('Phase 6.7: Block 6 stellt Einzelteil, kombinierten Teil und 1/6-Hinweis wie Legacy dar', async () => {
  const legacy = await loadLegacyTabularParser();
  const legacyOutput = legacy(rows, {}).segmentText;
  const canonical = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const output = createOriginalBlockViewModel(canonical).segmentText;

  assert.match(legacyOutput, /Dienstteilstücke >04:30h \(ohne Reserve-Dienste, inkl\. kombinierter Teile mit Pause <30 Min\): 1/);
  assert.match(legacyOutput, /ID 1150:/);
  assert.match(legacyOutput, /Einzelsegment 03:00–07:40 \(5\/11\) \| Dauer 04:40/);
  assert.match(legacyOutput, /Kombiniert: 03:00–07:40 und 07:50–10:30 \(5\/11 \/ 6\/12\) \| Pause 10 Min, Gesamtdauer 07:30/);
  assert.match(legacyOutput, /Hinweis: Bitte Fahrtafel prüfen ob 1\/6 Dienst und Standzeiten ausreichen\./);

  assert.match(output, /Dienstteilstücke >04:30h \(ohne Reserve-Dienste, inkl\. kombinierter Teile mit Pause <30 Min\): 1/);
  assert.match(output, /ID 1150:/);
  assert.match(output, /Einzelsegment 03:00–07:40 \(5\/11\) \| Dauer 04:40/);
  assert.match(output, /Kombiniert: 03:00–07:40 und 07:50–10:30 \(5\/11 \/ 6\/12\) \| Pause 10 Min, Gesamtdauer 07:30/);
  assert.match(output, /Hinweis: Bitte Fahrtafel prüfen ob 1\/6 Dienst und Standzeiten ausreichen\./);
});

test('Phase 6.7: echte JES-Excel- und PDF-Referenz erzeugen denselben Block-6-Text', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(excel).segmentText, createOriginalBlockViewModel(pdf).segmentText);
  assert.match(createOriginalBlockViewModel(pdf).segmentText, /Dienstteilstücke >04:30h/);
});

test('Phase 6.7: echtes JNV-PDF bewahrt Segment, Kurs und Dauer in Block 6', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).segmentText;

  assert.match(output, /Dienstteilstücke >04:30h \(ohne Reserve-Dienste, inkl\. kombinierter Teile mit Pause <30 Min\):/);
  assert.match(output, /ID 2150:/);
  assert.match(output, /Einzelsegment 13:48–18:26 \(11200\) \| Dauer 04:38/);
});
