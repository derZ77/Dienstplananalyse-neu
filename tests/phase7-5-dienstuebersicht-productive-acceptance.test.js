/** Phase 7.5 — productive Dienstübersicht export and real-source acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { FIXTURES } from './fixtures/paths.js';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
const { buildDienstuebersichtExportModel, createDienstuebersichtWorkbook, writeDienstuebersichtXlsx } =
  await import('../js/v2/export/dienstuebersicht-xlsx-export.js');
const { resolveDienstuebersichtExportState, DIENSTUEBERSICHT_EXPORT_BUTTON_LABEL } =
  await import('../js/v2/export/dienstuebersicht-export-ui.js');

const loadXlsx = () => {
  const sandbox = { console, process, Buffer }; sandbox.global = sandbox; sandbox.globalThis = sandbox;
  sandbox.window = sandbox; sandbox.self = sandbox; createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.XLSX;
};
const XLSX = loadXlsx();
globalThis.XLSX = XLSX;
const fileOf = async (path, type) => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type, arrayBuffer: async () => bytes.slice().buffer };
};
const rowsOf = book => XLSX.utils.sheet_to_json(book.Sheets.Dienstübersicht, { header: 1, defval: '' });

test('Phase 7.5: JES Excel, JES PDF und JNV PDF use the same canonical export contract', async () => {
  const excel = await analyzeExcelImport(await fileOf(FIXTURES.jesTenColumnScheduleXlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const jesPdf = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf, 'application/pdf'));
  const jnvPdf = await analyzePdfImport(await fileOf(FIXTURES.jnvSchedulePdf, 'application/pdf'));
  for (const result of [excel.importResult.data, jesPdf.canonicalSchedule, jnvPdf.canonicalSchedule]) {
    const model = buildDienstuebersichtExportModel(result);
    assert.equal(model.sheetName, 'Dienstübersicht');
    assert.equal(model.columns.length, 12);
    assert.equal(model.rows.filter(row => row.some(Boolean)).length >= result.services.length, true);
  }
  assert.deepEqual(buildDienstuebersichtExportModel(excel.importResult.data).columns, buildDienstuebersichtExportModel(jesPdf.canonicalSchedule).columns);
});

test('Phase 7.5: the productive option accepts both Excel and PDF session results', async () => {
  const excel = await analyzeExcelImport(await fileOf(FIXTURES.jesTenColumnScheduleXlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const pdf = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf, 'application/pdf'));
  for (const primaryImport of [excel, pdf]) {
    const state = resolveDienstuebersichtExportState({ primaryImport });
    assert.equal(state.visible, true); assert.equal(state.enabled, true);
    assert.equal(state.label, DIENSTUEBERSICHT_EXPORT_BUTTON_LABEL);
  }
});

test('Phase 7.5: generated XLSX roundtrips data and carries the reference layout contract', async () => {
  const pdf = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf, 'application/pdf'));
  const model = buildDienstuebersichtExportModel(pdf.canonicalSchedule);
  const workbook = createDienstuebersichtWorkbook(model, { xlsx: XLSX });
  assert.deepEqual([...workbook.SheetNames], ['Dienstübersicht']);
  const sheet = workbook.Sheets.Dienstübersicht;
  assert.equal(sheet['!cols'].length, 12); assert.equal(sheet['!pageSetup'].orientation, 'landscape');
  assert.equal(sheet['!printTitles'], '2:2'); assert.equal(sheet['!merges'].length, 1);
  const output = writeDienstuebersichtXlsx(model, { xlsx: XLSX, now: new Date(Date.UTC(2026, 7, 10)) });
  assert.equal(output.status, 'ready'); assert.equal(output.format, 'xlsx');
  const rows = rowsOf(XLSX.read(output.bytes, { type: 'array' }));
  assert.deepEqual(Array.from(rows[1]), model.columns);
  assert.equal(JSON.stringify(rows.slice(2).map(row => Array.from(row))), JSON.stringify(model.rows));
});
