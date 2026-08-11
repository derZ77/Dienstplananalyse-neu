/** Phase 8.4 — end-to-end acceptance seams before the GitHub test update. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { FIXTURES } from './fixtures/paths.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const fileOf = (path, type) => {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path.split('/').at(-1), type, arrayBuffer: async () => bytes.slice().buffer };
};

function installXlsx() {
  if (globalThis.XLSX?.read) return;
  const sandbox = { console, process, Buffer }; sandbox.global = sandbox; sandbox.globalThis = sandbox;
  sandbox.window = sandbox; sandbox.self = sandbox; createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  globalThis.XLSX = sandbox.XLSX;
}

test('Phase 8.4: Block 3 has no prefilled reserve ids before an import', () => {
  const html = source('../index.html');
  assert.doesNotMatch(html, /<h2>3\. Reserve Dienste<\/h2>\s*<p>IDs:/);
});

test('Phase 8.4: JES Excel completes the existing base-analysis session and exposes a CheckReport', async () => {
  installXlsx();
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const excel = await analyzeExcelImport(fileOf(FIXTURES.jesTenColumnScheduleXlsx,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const session = createMultiDocumentSession();
  session.setPrimaryResult(excel, { name: 'jes-ten-column-schedule.xlsx' });
  const state = await session.analyzeRules();

  assert.equal(state.primaryImport.documentType, 'legacy_excel_schedule');
  assert.equal(state.primaryImport.canonicalSchedule.type, 'CanonicalSchedule');
  assert.equal(state.ruleAnalysis.status, 'completed');
  assert.equal(state.checkReport.type, 'CheckReport');
});

test('Phase 8.4: JES Excel, JES PDF and JNV PDF populate the same block projection contract', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const excel = await analyzeExcelImport(fileOf(FIXTURES.jesTenColumnScheduleXlsx,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const jes = await analyzePdfImport(fileOf(FIXTURES.jesSchedulePdf, 'application/pdf'));
  const jnv = await analyzePdfImport(fileOf(FIXTURES.jnvSchedulePdf, 'application/pdf'));

  for (const schedule of [excel.importResult.data, jes.canonicalSchedule, jnv.canonicalSchedule]) {
    const blocks = createOriginalBlockViewModel(schedule);
    for (const key of ['countText', 'sharedText', 'reserveText', 'longText', 'locText', 'segmentText', 'realDrivingTimeText', 'shiftText', 'routeText', 'pauseHtml']) {
      assert.ok(String(blocks[key]).trim(), `${key} is populated`);
      assert.doesNotMatch(String(blocks[key]), /^Warte\.{3}$/);
    }
  }
});
