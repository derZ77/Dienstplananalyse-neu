import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3G.3 – real productive end-to-end (no Scheingrün):
// real JNV PDF → analyzePdfImport, real bus Umlauftafel XLSX → analyzeExcelImport,
// → createBundleFromImports → runJnvStructuralMatching → controlled structural result.
globalThis.DOMMatrix ||= class DOMMatrix {};
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
const { createBundleFromImports } = await import('../js/v2/import/analysis-bundle-controller.js');
const { runJnvStructuralMatching } = await import('../js/v2/matching/jnv-matching-controller.js');
const { MATCH_STATUSES } = await import('../js/v2/matching/match-contract.js');

const PDF = FIXTURES.jnvSchedulePdf;
const XLSX_PATH = FIXTURES.busUmlauftafelXlsx;
const present = async (p) => { try { await access(p); return true; } catch { return false; } };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileOf = (p, type) => ({ name: p.split('/').pop(), type, arrayBuffer: async () => new Uint8Array(readFileSync(p)).buffer.slice(0) });

test('real JNV PDF + real bus Umlauftafel run the full productive matching pipeline (no throw)', async (t) => {
  if (!(xlsxReady && (await present(PDF)) && (await present(XLSX_PATH)))) return t.skip('real references / XLSX not available');

  const primaryImport = await analyzePdfImport(fileOf(PDF, 'application/pdf'));
  const companionImport = await analyzeExcelImport(fileOf(XLSX_PATH, XLSX_MIME));
  assert.equal(primaryImport.detection.status, 'supported');
  assert.equal(companionImport.classification.type, 'umlaufkarte');

  const bundle = createBundleFromImports({ id: 'real', createdAt: '2026-08-01T00:00:00Z', primaryImport, companionImport });
  assert.equal(bundle.compatibility.status, 'exact', 'JNV schedule + Umlaufkarte is an exact bundle');

  let result;
  await assert.doesNotReject(async () => {
    result = runJnvStructuralMatching({ bundle, primaryImport, companionImport, metadata: { sourceName: 'B_20260817_MoFr_Schule.pdf' } });
  });

  // The productive title yields exact validity, so the matcher is actually reached.
  assert.equal(result.validity.confidence, 'exact', 'the schedule title resolves validity to exact');
  assert.equal(result.attempted, true);
  assert.equal(result.status, 'completed');
  assert.ok(result.matchResult && Object.values(MATCH_STATUSES).includes(result.matchResult.status));
  assert.equal(typeof result.matchResult.statistics.umlauftafelCirculationCount, 'number');
});
