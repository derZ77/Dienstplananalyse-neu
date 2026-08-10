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
  ['', '', '1140', 'Dienst', '5/11', '04:00', 'A', '', '', '16:00', 'B', '', '', '', '04:00', '16:00', '09:00'],
  ['', '', '2140', 'Dienst', '6/12', '05:00', 'C', '', '', '18:01', 'D', '', '', '', '05:00', '18:01', '09:00']
];

function fileLike(path, type) {
  return {
    name: path.split('/').at(-1),
    type,
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

function duration(begin, end) {
  const toMinutes = value => {
    const [hours, minutes] = String(value).split(':').map(Number);
    return (hours * 60) + minutes;
  };
  let value = toMinutes(end) - toMinutes(begin);
  if (value < 0) value += 24 * 60;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

test('Phase 6.6: Block 2 stellt die tabellarische Legacy-Schichtdauer und 12-Stunden-Warnung wieder her', async () => {
  const legacy = await loadLegacyTabularParser();
  const legacyOutput = legacy(rows, {}).sharedText;
  const canonical = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const output = createOriginalBlockViewModel(canonical).sharedText;

  assert.match(legacyOutput, /Anzahl geteilte Dienste: 2/);
  assert.match(legacyOutput, /IDs: 1140, 2140/);
  assert.match(legacyOutput, /Schichtdauer je geteilter Dienst \(erste Zeit in Spalte O bis letzte Zeit in Spalte P\):/);
  assert.match(legacyOutput, /ID 1140: Schichtdauer 12:00 \(Spalte O → P\)/);
  assert.match(legacyOutput, /ID 2140: Schichtdauer 13:01 \(Spalte O → P\)/);
  assert.match(legacyOutput, /Achtung: folgende geteilte Dienste überschreiten 12:00h Schichtdauer:/);
  assert.match(legacyOutput, /ID 2140 \(13:01\)/);

  assert.match(output, /Schichtdauer je geteilter Dienst \(erste Zeit in Spalte O bis letzte Zeit in Spalte P\):/);
  assert.match(output, /ID 1140: Schichtdauer 12:00 \(Spalte O → P\)/);
  assert.match(output, /ID 2140: Schichtdauer 13:01 \(Spalte O → P\)/);
  assert.match(output, /Achtung: folgende geteilte Dienste überschreiten 12:00h Schichtdauer:/);
  assert.match(output, /ID 2140 \(13:01\)/);
});

test('Phase 6.6: echte JES-Excel- und PDF-Referenz verwenden denselben Block-2-Pfad', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf, 'application/pdf'))).canonicalSchedule;

  assert.equal(createOriginalBlockViewModel(excel).sharedText, createOriginalBlockViewModel(pdf).sharedText);
  assert.match(createOriginalBlockViewModel(pdf).sharedText, /Anzahl geteilte Dienste: 0/);
});

test('Phase 6.6: echtes JNV-PDF zeigt jede geteilte Canonical-Dienstgrenze mit unverändertem Wert', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf, 'application/pdf'))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).sharedText;
  const shared = schedule.services.filter(service => {
    const id = Number(service.serviceNumber);
    return (id >= 40 && id <= 59) || (id >= 140 && id <= 159) ||
      (id >= 1140 && id <= 1159) || (id >= 1240 && id <= 1259) ||
      (id >= 2140 && id <= 2159) || (id >= 2240 && id <= 2259);
  });

  assert.ok(shared.length > 0, 'die JNV-Referenz enthält geteilte Dienste');
  assert.match(output, new RegExp(`Anzahl geteilte Dienste: ${shared.length}`));
  assert.match(output, /Schichtdauer je geteilter Dienst \(erste Zeit in Spalte O bis letzte Zeit in Spalte P\):/);
  shared.forEach(service => {
    const expected = duration(service.begin.value, service.end.value);
    assert.match(output, new RegExp(`ID ${service.serviceNumber}: Schichtdauer ${expected} \\(Spalte O → P\\)`));
  });
  assert.match(output, /Alle geteilten Dienste liegen bei maximal 12:00h Schichtdauer\./);
});
