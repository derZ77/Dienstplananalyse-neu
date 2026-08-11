/** Phase 7.8 — visual contract of the Dienstübersicht renderer. */
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

const loadXlsx = () => {
  const sandbox = { console, process, Buffer }; sandbox.global = sandbox; sandbox.globalThis = sandbox;
  sandbox.window = sandbox; sandbox.self = sandbox; createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.XLSX;
};
const XLSX = loadXlsx(); globalThis.XLSX = XLSX;
const fileOf = async (path, type) => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type, arrayBuffer: async () => bytes.slice().buffer };
};

test('Phase 7.8: title, header, service rows and print layout follow the reference palette', async () => {
  const imported = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf, 'application/pdf'));
  const model = buildDienstuebersichtExportModel(imported.canonicalSchedule);
  const workbook = createDienstuebersichtWorkbook(model, { xlsx: XLSX });
  const sheet = workbook.Sheets.Dienstübersicht;

  assert.equal(sheet.A1.s.font.sz, 14);
  assert.equal(sheet.A1.s.font.bold, true);
  assert.equal(sheet.A2.s.fill.fgColor.rgb, '1F4E78');
  assert.equal(sheet.A2.s.font.color.rgb, 'FFFFFF');
  assert.equal(sheet.A2.s.alignment.wrapText, true);
  assert.equal(sheet.A3.s.fill.fgColor.rgb, 'D9E1F2');
  assert.equal(sheet.A3.s.font.bold, true);
  assert.equal(sheet.E4.s.fill.fgColor.rgb, 'FFFFFF');
  assert.equal(sheet['!rows'][0].hpt, 20);
  assert.equal(sheet['!rows'][1].hpt, 24);
  assert.equal(sheet['!rows'][2].hpt, 16);
  assert.equal(sheet['!rows'][3].hpt, 15);
  assert.equal(sheet.E4.s.alignment.horizontal, 'left');
  assert.equal(sheet.F4.s.alignment.horizontal, 'center');
  assert.equal(sheet['!pageSetup'].paperSize, 9);
  assert.equal(sheet['!pageSetup'].fitToWidth, 1);
  assert.equal(sheet['!printArea'], `A1:L${model.rows.length + 2}`);
  assert.deepEqual(sheet['!pageMargins'], { left: 0.75, right: 0.75, top: 1, bottom: 1, header: 0.5, footer: 0.5 });

  const output = writeDienstuebersichtXlsx(model, { xlsx: XLSX });
  const archive = XLSX.CFB.read(Array.from(output.bytes), { type: 'array' });
  const styles = new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(archive, '/xl/styles.xml').content));
  const worksheet = new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(archive, '/xl/worksheets/sheet1.xml').content));
  const workbookXml = new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(archive, '/xl/workbook.xml').content));
  assert.match(styles, /001F4E78/, 'header fill survives the produced XLSX');
  assert.match(styles, /00D9E1F2/, 'service-row fill survives the produced XLSX');
  assert.match(styles, /00FFF2CC/, 'pause fill survives the produced XLSX');
  const pauseIndex = model.rows.findIndex(row => /^pause(?:\s|\(|$)/i.test(row[4]));
  assert.ok(pauseIndex >= 0, 'the JES reference contains a pause row');
  const pauseRow = pauseIndex + 3;
  assert.equal(sheet[`E${pauseRow}`].s.fill.fgColor.rgb, 'FFF2CC', 'pause activity uses the reference yellow');
  assert.match(worksheet, new RegExp(`<c r="E${pauseRow}"[^>]* s="8"`), 'pause activity uses the left-aligned pause style');
  assert.match(worksheet, /<c r="A2"[^>]* s="2"/, 'header cells reference the header style');
  assert.match(worksheet, /<c r="A3"[^>]* s="5"/, 'service cells reference the service style');
  assert.match(worksheet, /<pageSetup[^>]*paperSize="9"[^>]*orientation="landscape"/, 'A4 landscape survives the produced XLSX');
  assert.ok(worksheet.indexOf('<pageSetup') < worksheet.indexOf('<ignoredErrors'), 'page settings precede ignored errors in schema order');
  assert.match(workbookXml, /_xlnm\.Print_Area/, 'print area survives the produced XLSX');
  assert.match(workbookXml, /_xlnm\.Print_Titles/, 'repeated header survives the produced XLSX');
});

test('Phase 7.8: JES Excel, JES PDF and JNV PDF receive the same renderer styling', async () => {
  const excel = await analyzeExcelImport(await fileOf(FIXTURES.jesTenColumnScheduleXlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const jes = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf, 'application/pdf'));
  const jnv = await analyzePdfImport(await fileOf(FIXTURES.jnvSchedulePdf, 'application/pdf'));
  for (const schedule of [excel.importResult.data, jes.canonicalSchedule, jnv.canonicalSchedule]) {
    const sheet = createDienstuebersichtWorkbook(buildDienstuebersichtExportModel(schedule), { xlsx: XLSX }).Sheets.Dienstübersicht;
    assert.equal(sheet.A2.s.fill.fgColor.rgb, '1F4E78');
    assert.equal(sheet.A3.s.fill.fgColor.rgb, 'D9E1F2');
    assert.equal(sheet['!pageSetup'].orientation, 'landscape');
  }
});

test('Phase 7.8: paid and unpaid pause activities receive the reference yellow band', () => {
  const model = buildDienstuebersichtExportModel({
    type: 'CanonicalSchedule',
    services: [{ serviceNumber: 'P-1', activities: [{ rawActivity: 'Dienst' }, { rawActivity: 'Pause (bezahlt)' }] }]
  });
  const sheet = createDienstuebersichtWorkbook(model, { xlsx: XLSX }).Sheets.Dienstübersicht;
  assert.equal(sheet.E4.v, 'Pause (bezahlt)');
  assert.equal(sheet.E4.s.fill.fgColor.rgb, 'FFF2CC');
});
