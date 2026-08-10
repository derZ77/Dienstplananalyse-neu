import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';
import { renderOriginalBlocks } from '../js/v2/blocks/block-renderer.js';

const rows = [
  ['Kopf'],
  ['', '', '1103', 'Dienst', '5/11', '03:00', 'A', '', '', '10:00', 'B', '', '', '', '03:00', '10:00', '07:00'],
  ['', '', '1140', 'Dienst', '6/12', '04:00', 'A', '', '', '12:00', 'B', '', '', '', '04:00', '12:00', '08:00'],
  ['', '', '1104', 'Dienst', '7/13', '05:00', 'A', '', '', '12:00', 'B', '', '', '', '05:00', '12:00', '07:00'],
  ['', '', '1105', 'Dienst', '8/14', '02:00', 'A', '', '', '09:00', 'B', '', '', '', '02:00', '09:00', '07:00']
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

test('Phase 6.8: Block 8 trennt reguläre und geteilte Legacy-Schichtlagen und rendert Gruppen', async () => {
  const legacy = await loadLegacyTabularParser();
  const legacyResult = legacy(rows, {});
  const blocks = createOriginalBlockViewModel(adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' }));

  assert.match(legacyResult.shiftText, /Schichtzählung \(nicht geteilte Dienste nach F1, F2, F3, S1, S2, N\):/);
  assert.match(legacyResult.shiftText, /F1: 1/);
  assert.match(legacyResult.shiftText, /F2: 1/);
  assert.match(legacyResult.shiftText, /Unbekannte: 1/);
  assert.match(legacyResult.shiftText, /Geteilte Dienste mit separater Schichtlage \(GF1, GF2, \.\.\. bzw\. GWE-F1, \.\.\.\):/);
  assert.match(legacyResult.shiftText, /GF1: 1/);
  assert.match(legacyResult.shiftText, /ID 1140: GF1 \(geteilt\)/);

  assert.match(blocks.shiftText, /Schichtzählung \(nicht geteilte Dienste nach F1, F2, F3, S1, S2, N\):/);
  assert.match(blocks.shiftText, /F1: 1/);
  assert.match(blocks.shiftText, /F2: 1/);
  assert.match(blocks.shiftText, /Unbekannte: 1/);
  assert.match(blocks.shiftText, /GF1: 1/);
  assert.match(blocks.shiftText, /ID 1140: GF1 \(geteilt\)/);
  assert.match(blocks.shiftHtml, /shift-group-title shift-gf1/);
  assert.match(blocks.shiftHtml, /ID 1140: GF1 \(geteilt\)/);

  const target = {};
  renderOriginalBlocks(blocks, { document: { getElementById: id => id === 'shift-result' ? target : null } });
  assert.equal(target.innerHTML, blocks.shiftHtml);
});

test('Phase 6.8: echte JES-Excel- und PDF-Referenz erzeugen denselben Block-8-Text und dieselbe Gruppierung', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const workbook = readWorkbookSheets(new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx)));
  const excel = adaptExcelRowsToCanonicalSchedule(workbook.sheets[0].rows, { sheetName: workbook.sheets[0].name });
  const pdf = (await analyzePdfImport(fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;
  const excelBlocks = createOriginalBlockViewModel(excel);
  const pdfBlocks = createOriginalBlockViewModel(pdf);

  assert.equal(excelBlocks.shiftText, pdfBlocks.shiftText);
  assert.equal(excelBlocks.shiftHtml, pdfBlocks.shiftHtml);
  assert.match(pdfBlocks.shiftText, /Schichtzählung \(nicht geteilte Dienste/);
});

test('Phase 6.8: echtes JNV-PDF behält Legacy-Feststellungen getrennt von Bewertungen', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const blocks = createOriginalBlockViewModel((await analyzePdfImport(fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule);

  assert.match(blocks.shiftText, /Geteilte Dienste mit separater Schichtlage/);
  assert.match(blocks.shiftText, /GF2: 3/);
  assert.match(blocks.shiftText, /GF3: 8/);
  assert.match(blocks.shiftText, /ID 2141: GF2 \(geteilt\)/);
  assert.match(blocks.shiftText, /ID 2144: Unbekannte \(geteilt\)/);
  assert.doesNotMatch(blocks.shiftText, /Bewertung:/, 'ohne verknüpfte Bewertung bleibt die Legacy-Feststellung unverändert');
});
