import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3C.3 – productive routing: file → handleImport → single read → workbook →
// classifier → correct handler. Import controller pulls in pdf.mjs (needs DOMMatrix).
globalThis.DOMMatrix ||= class DOMMatrix {};
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

const controllerSource = readFileSync(new URL('../js/v2/import/excel-import-controller.js', import.meta.url), 'utf8');
const classifierSource = readFileSync(new URL('../js/v2/import/excel-document-classifier.js', import.meta.url), 'utf8');
const { handleImport } = await import('../js/v2/import/pdf-import-controller.js');
const { handleExcelImport } = await import('../js/v2/import/excel-import-controller.js');

const BUS = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
const TRAM = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FS_20260629_MoFr.xlsx';
const BEU_PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
const present = async (p) => { try { await access(p); return true; } catch { return false; } };
const ready = async (p) => xlsxReady && (await present(p));
const statusEl = () => ({ hidden: false, textContent: '' });
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileLike = (bytes, name, type = XLSX_MIME, onRead) => ({ name, type, arrayBuffer: async () => { if (onRead) onRead(); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } });
const realFile = (p, onRead) => fileLike(new Uint8Array(readFileSync(p)), p.split('/').pop(), XLSX_MIME, onRead);
const buildXlsx = (specs) => {
  const wb = globalThis.XLSX.utils.book_new();
  for (const s of specs) globalThis.XLSX.utils.book_append_sheet(wb, globalThis.XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  return new Uint8Array(globalThis.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
};

test('static: excel controller uses no SheetJS and no storage/network', () => {
  assert.doesNotMatch(controllerSource, /XLSX\.read|XLSX\.utils|sheet_to_json/);
  assert.doesNotMatch(controllerSource, /localStorage|sessionStorage|indexedDB|fetch\s*\(/);
  assert.doesNotMatch(classifierSource, /XLSX\.read|XLSX\.utils|sheet_to_json|localStorage|fetch\s*\(/);
});

test('bus xlsx → routed to the Umlauftafel loader; read exactly once', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference / XLSX not available');
  let reads = 0;
  const analysis = await handleImport(realFile(BUS, () => { reads += 1; }), statusEl());
  assert.equal(analysis.classification.type, 'umlaufkarte');
  assert.equal(analysis.document.subtype, 'jnv_umlauftafel');
  assert.equal(analysis.document.mode, 'bus');
  assert.equal(reads, 1, 'the file is read exactly once');
});

test('tram xlsx → routed to the Umlauftafel loader', async (t) => {
  if (!(await ready(TRAM))) return t.skip('tram reference / XLSX not available');
  const analysis = await handleImport(realFile(TRAM), statusEl());
  assert.equal(analysis.document.mode, 'tram');
});

test('wagenkarte xlsx → recognized but NOT sent to the Umlauftafel loader', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const bytes = buildXlsx([{ name: 'Karte1', aoa: [['', 'Dienst-Nr.:', ''], ['Dienst', '123']] }]);
  const analysis = await handleImport(fileLike(bytes, 'wagen.xlsx'), statusEl());
  assert.equal(analysis.classification.type, 'wagenkarte');
  assert.equal(analysis.document, null, 'no Umlauftafel document produced');
  assert.ok(!analysis.warnings.some(w => w.code === 'UNKNOWN_EXCEL_DOCUMENT'));
});

test('legacy Excel schedule → recognized but NOT sent to the Umlauftafel loader', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const bytes = buildXlsx([{ name: 'Dienste', aoa: [['Dienst', 'Umlauf', 'Tätigkeit', 'Beginn', 'Ende'], ['1140', '', 'Dienst', '05:00', '13:00']] }]);
  const analysis = await handleImport(fileLike(bytes, 'legacy.xlsx'), statusEl());
  assert.equal(analysis.classification.type, 'legacy_excel_schedule');
  assert.equal(analysis.document, null);
});

test('unknown / ambiguous Excel → no professional parser is invoked', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const unknownBytes = buildXlsx([{ name: 'Notes', aoa: [['hello', 'world']] }]);
  const u = await handleImport(fileLike(unknownBytes, 'notes.xlsx'), statusEl());
  assert.equal(u.classification.confidence, 'unknown');
  assert.equal(u.document, null);
  assert.ok(u.warnings.some(w => w.code === 'UNKNOWN_EXCEL_DOCUMENT'));

  const ambBytes = buildXlsx([
    { name: '12100', aoa: [['Umlauf:', '12100'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00'], ['Linie: 10   Route: 1'], ['Dienst-Nr.:']] },
    { name: '12200', aoa: [['Umlauf:', '12200'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00'], ['Linie: 10']] }
  ]);
  const a = await handleImport(fileLike(ambBytes, 'amb.xlsx'), statusEl());
  assert.equal(a.classification.confidence, 'ambiguous');
  assert.equal(a.document, null);
});

test('broken workbook is handled controlled (no throw, no parser)', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  let analysis;
  await assert.doesNotReject(async () => { analysis = await handleExcelImport(fileLike(new Uint8Array([1, 2, 3, 4, 5]), 'broken.xlsx'), statusEl()); });
  assert.equal(analysis.document, null);
});

test('PDF path is unchanged (routed to the PDF handler, still JNV-hardened)', async (t) => {
  if (!(xlsxReady && (await present(BEU_PDF)))) return t.skip('PDF reference not available');
  const pdf = { name: 'beu.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array(readFileSync(BEU_PDF)).buffer.slice(0) };
  const analysis = await handleImport(pdf, statusEl());
  assert.equal(analysis.canonicalSchedule.hardened.applied, true);
});

test('a non-pdf non-xlsx file hides the status and is not analyzed', async () => {
  const status = statusEl();
  const r = await handleImport({ name: 'notes.txt', type: 'text/plain' }, status);
  assert.equal(r, null);
  assert.equal(status.hidden, true);
});
