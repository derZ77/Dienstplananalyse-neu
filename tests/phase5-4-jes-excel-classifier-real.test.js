import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const EXCEL = FIXTURES.jesTenColumnScheduleXlsx;

function installXlsx() {
  if (globalThis.XLSX?.read) return;
  const sandbox = { global: null, globalThis: null, window: null, self: null, process, Buffer, console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  globalThis.XLSX = sandbox.XLSX;
}

test('Phase 5.4: die echte JES-Zehnspaltenmappe wird exakt geroutet und erzeugt Original-Blöcke', async () => {
  await access(EXCEL);
  installXlsx();
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const { createOriginalBlockViewModel } = await import('../js/v2/blocks/block-orchestrator.js');
  const file = {
    name: EXCEL.split('/').at(-1),
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    arrayBuffer: () => readFile(EXCEL)
  };

  const result = await analyzeExcelImport(file);

  assert.equal(result.classification.type, 'legacy_excel_schedule');
  assert.equal(result.classification.subtype, 'jes_schedule_excel');
  assert.equal(result.classification.confidence, 'exact');
  assert.equal(result.importResult.ok, true);
  assert.equal(result.importResult.data.type, 'CanonicalSchedule');
  assert.equal(result.importResult.data.services.length, 19);
  const blocks = createOriginalBlockViewModel(result.importResult.data);
  assert.ok(['planTypeText', 'countText', 'sharedText', 'reserveText', 'longText', 'locText', 'segmentText', 'realDrivingTimeText', 'shiftText', 'routeText', 'pauseHtml']
    .every(field => String(blocks[field]).trim() !== ''));
});
