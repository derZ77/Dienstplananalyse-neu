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
  ['', '', '1150', 'Dienst', '5/11', '03:00', 'A', '', '', '08:00', 'B', '', '', '', '03:00', '08:00', '05:00'],
  ['', '', '1103', 'Dienst', '6/12', '04:00', 'C', '', '', '09:00', 'D', '', '', '', '04:00', '09:00', '05:00']
];

const oneSixthReport = {
  type: 'CheckReport',
  results: [{
    id: 'BV015_BV018',
    details: {
      services: [
        { serviceNumber: '1150', status: 'PASS' },
        { serviceNumber: '1103', status: 'NOT_APPLICABLE' }
      ]
    }
  }]
};

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

test('Phase 6.7b: Block 6 bewahrt die Überschreitung und zeigt vorhandene 1/6- sowie Teilungsinformationen getrennt', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const output = createOriginalBlockViewModel(schedule, { checkReport: oneSixthReport }).segmentText;

  assert.match(output, /ID 1150:\n  Einzelsegment 03:00–08:00 \(5\/11\) \| Dauer 05:00/);
  assert.match(output, /Bewertung:/);
  assert.match(output, /Ausnahmegrund: Geteilter Dienst erkannt/);
  assert.match(output, /1\/6-Prüfung: PASS/);
  assert.match(output, /Ergebnis: zulässiger 1\/6-Dienst/);

  assert.match(output, /ID 1103:\n  Einzelsegment 04:00–09:00 \(6\/12\) \| Dauer 05:00/);
  assert.match(output, /1\/6-Prüfung: NOT_APPLICABLE/);
  assert.match(output, /Keine vorhandene Ausnahmeinformation/);
});

test('Phase 6.7b: echte JES-Excel- und PDF-Referenz behalten ohne CheckReport denselben Legacy-Block 6', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(excel).segmentText, createOriginalBlockViewModel(pdf).segmentText);
  assert.doesNotMatch(createOriginalBlockViewModel(pdf).segmentText, /Bewertung:/);
});

test('Phase 6.7b: echtes JNV-PDF ergänzt einen geteilten Dienst ohne eine 1/6-Bewertung zu erfinden', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const output = createOriginalBlockViewModel((await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule).segmentText;

  assert.match(output, /ID 2150:/);
  assert.match(output, /Einzelsegment 13:48–18:26 \(11200\) \| Dauer 04:38/);
  assert.match(output, /Bewertung:/);
  assert.match(output, /Geteilter Dienst erkannt/);
  assert.match(output, /keine 1\/6-Bewertung vorhanden/);
  assert.doesNotMatch(output, /1\/6-Prüfung:/);
});
