/** Phase 7.8.2 — source-specific document title and compact layout contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { FIXTURES } from './fixtures/paths.js';

globalThis.DOMMatrix ||= class DOMMatrix {};
const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { createDienstuebersichtWorkbook } = await import('../js/v2/export/dienstuebersicht-xlsx-export.js');
const { resolveDienstuebersichtExportState } = await import('../js/v2/export/dienstuebersicht-export-ui.js');

const loadXlsx = () => {
  const sandbox = { console, process, Buffer }; sandbox.global = sandbox; sandbox.globalThis = sandbox;
  sandbox.window = sandbox; sandbox.self = sandbox; createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.XLSX;
};
const XLSX = loadXlsx();
const fileOf = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type: 'application/pdf', arrayBuffer: async () => bytes.slice().buffer };
};

test('Phase 7.8.2: JES and JNV keep their own imported document title', async () => {
  const jes = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf));
  const jnv = await analyzePdfImport(await fileOf(FIXTURES.jnvSchedulePdf));
  const jesExport = resolveDienstuebersichtExportState({ primaryImport: jes });
  const jnvExport = resolveDienstuebersichtExportState({ primaryImport: jnv });

  assert.equal(jesExport.model.title, jes.detection.title);
  assert.equal(jnvExport.model.title, jnv.detection.title);
  assert.notEqual(jesExport.model.title, jnvExport.model.title);
});

test('Phase 7.8.2: compact layout preserves readable header and activity rows', async () => {
  const imported = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf));
  const model = resolveDienstuebersichtExportState({ primaryImport: imported }).model;
  const sheet = createDienstuebersichtWorkbook(model, { xlsx: XLSX }).Sheets.Dienstübersicht;

  assert.equal(sheet['!rows'][0].hpt, 20);
  assert.equal(sheet['!rows'][1].hpt, 24);
  assert.equal(sheet['!rows'][2].hpt, 16);
  assert.equal(sheet['!rows'][3].hpt, 15);
  assert.equal(sheet['!rows'][7].hpt, 6);
  assert.equal(sheet['!cols'][4].wch, 23);
});
