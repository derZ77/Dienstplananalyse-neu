import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Phase 3E – productive bundle controller. Derives metadata descriptors from existing
// ImportResults and assembles an AnalysisBundle ONLY when a companion is present. No
// analysis, no matching, no storage, no network. Single imports stay untouched.
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

const { describeImportResult, createBundleFromImports } = await import('../js/v2/import/analysis-bundle-controller.js');
const controllerSource = readFileSync(new URL('../js/v2/import/analysis-bundle-controller.js', import.meta.url), 'utf8');
const factorySource = readFileSync(new URL('../js/v2/import/import-analysis-bundle.js', import.meta.url), 'utf8');

const excelResult = (type) => ({ classification: { type, confidence: 'exact' }, document: null, result: null, importResult: null, warnings: [] });
const pdfResult = (id) => ({ detection: { status: id ? 'supported' : 'unsupported', profile: id ? { id } : null }, canonicalSchedule: null });

test('static: controller and factory use no storage, network, matching or bundle-analysis', () => {
  for (const src of [controllerSource, factorySource]) {
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\s*\(/);
    assert.doesNotMatch(src, /createMatchResult|matchStatus|analyzePdfImport|analyzeExcelImport|canonicalSchedule/);
  }
});

test('describeImportResult maps an Excel legacy result to a primary descriptor', () => {
  const d = describeImportResult(excelResult('legacy_excel_schedule'), 'primary', { id: 'x' });
  assert.equal(d.documentType, 'legacy_excel_schedule');
  assert.equal(d.role, 'primary');
});

test('describeImportResult maps an Excel wagenkarte result to a companion descriptor', () => {
  const d = describeImportResult(excelResult('wagenkarte'), 'companion', { id: 'x' });
  assert.equal(d.documentType, 'wagenkarte');
  assert.equal(d.role, 'companion');
});

test('describeImportResult maps supported PDF results to JES/JNV via the profile id', () => {
  assert.equal(describeImportResult(pdfResult('jes-regionalbus-v1'), 'primary', { id: 'a' }).documentType, 'jes_schedule_pdf');
  assert.equal(describeImportResult(pdfResult('beu-stadtbus-v1'), 'primary', { id: 'b' }).documentType, 'jnv_schedule_pdf');
});

test('describeImportResult maps an unsupported PDF result to unknown', () => {
  assert.equal(describeImportResult(pdfResult(null), 'primary', { id: 'c' }).documentType, 'unknown');
});

test('§8 no companion → no bundle', () => {
  const b = createBundleFromImports({ id: 'bundle-1', createdAt: '2026-07-31T00:00:00Z', primaryImport: pdfResult('beu-stadtbus-v1'), companionImport: null });
  assert.equal(b, null);
});

test('§8 companion present → a bundle is produced (exact JNV + Umlaufkarte)', () => {
  const b = createBundleFromImports({
    id: 'bundle-2', createdAt: '2026-07-31T00:00:00Z',
    primaryImport: pdfResult('beu-stadtbus-v1'),
    companionImport: excelResult('umlaufkarte')
  });
  assert.equal(b.id, 'bundle-2');
  assert.equal(b.primary.documentType, 'jnv_schedule_pdf');
  assert.equal(b.companion.documentType, 'umlaufkarte');
  assert.equal(b.compatibility.status, 'exact');
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(Object.keys(b).sort(), ['companion', 'compatibility', 'createdAt', 'id', 'primary', 'warnings']);
});

test('a conflicting pair still produces a bundle, but with warnings (no exception)', () => {
  let b;
  assert.doesNotThrow(() => {
    b = createBundleFromImports({ id: 'bundle-3', createdAt: '2026-07-31T00:00:00Z', primaryImport: pdfResult('jes-regionalbus-v1'), companionImport: excelResult('umlaufkarte') });
  });
  assert.equal(b.compatibility.status, 'conflicting');
  assert.ok(b.warnings.length >= 1);
});

test('the bundle never carries analysis results (metadata only)', () => {
  const b = createBundleFromImports({ id: 'bundle-4', createdAt: '2026-07-31T00:00:00Z', primaryImport: pdfResult('beu-stadtbus-v1'), companionImport: excelResult('umlaufkarte') });
  for (const key of ['canonicalSchedule', 'data', 'result', 'bytes', 'document']) {
    assert.ok(!(key in b.primary), `primary must not carry ${key}`);
    assert.ok(!(key in b.companion), `companion must not carry ${key}`);
  }
});

// no Scheingrün: run the REAL productive Excel importer, then compose a bundle.
test('real composition: analyzeExcelImport results flow into a bundle', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const build = (aoa, name) => {
    const wb = globalThis.XLSX.utils.book_new();
    globalThis.XLSX.utils.book_append_sheet(wb, globalThis.XLSX.utils.aoa_to_sheet(aoa), name);
    const bytes = new Uint8Array(globalThis.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    return { name: `${name}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arrayBuffer: async () => bytes.buffer.slice(0) };
  };
  const legacyImport = await analyzeExcelImport(build([['Dienst', 'Umlauf', 'Tätigkeit'], ['1140', '12100', 'Fahrt']], 'D'));
  const wagenImport = await analyzeExcelImport(build([['', 'Dienst-Nr.:', '', '100'], ['', '', '', '']], 'Dienst 100'));
  assert.equal(legacyImport.classification.type, 'legacy_excel_schedule');
  assert.equal(wagenImport.classification.type, 'wagenkarte');

  const bundle = createBundleFromImports({ id: 'real-1', createdAt: '2026-07-31T00:00:00Z', primaryImport: legacyImport, companionImport: wagenImport });
  assert.equal(bundle.primary.documentType, 'legacy_excel_schedule');
  assert.equal(bundle.companion.documentType, 'wagenkarte');
  // legacy takes no companion → structurally unsupported (surfaced as a warning, not a throw)
  assert.equal(bundle.compatibility.status, 'unsupported');
  assert.ok(bundle.warnings.length >= 1);
});
