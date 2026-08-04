import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3C.2 – productive XLSX Umlauftafel import (single analysis).
// The import controller pulls in pdf.mjs (PDF path) which needs a DOMMatrix global.
globalThis.DOMMatrix ||= class DOMMatrix {};
// Bootstrap globalThis.XLSX for Node (browser provides it via a <script> tag).
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

const controllerSource = readFileSync(new URL('../js/v2/import/pdf-import-controller.js', import.meta.url), 'utf8');
const { handleUmlauftafelXlsxImport, analyzeUmlauftafelXlsx, isUmlauftafelXlsxFile } = await import('../js/v2/import/xlsx-umlauftafel-controller.js');
const { handleImport, handlePdfImport } = await import('../js/v2/import/pdf-import-controller.js');

const BUS = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
const TRAM = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FS_20260629_MoFr.xlsx';
const BEU_PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
const present = async (p) => { try { await access(p); return true; } catch { return false; } };
const ready = async (p) => xlsxReady && (await present(p));
const statusEl = () => ({ hidden: false, textContent: '' });
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileLike = (bytes, name, type = XLSX_MIME, onRead) => ({ name, type, arrayBuffer: async () => { if (onRead) onRead(); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } });
const realFile = (p, onRead) => fileLike(new Uint8Array(readFileSync(p)), p.split('/').pop(), XLSX_MIME, onRead);

test('routing: xlsx files are recognized, non-xlsx are not', () => {
  assert.equal(isUmlauftafelXlsxFile({ name: 'x.xlsx', type: XLSX_MIME }), true);
  assert.equal(isUmlauftafelXlsxFile({ name: 'x.pdf', type: 'application/pdf' }), false);
  assert.equal(isUmlauftafelXlsxFile(null), false);
});

// === A: valid bus xlsx ======================================================
test('A: a valid bus Umlauftafel is analyzed and reported', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference / XLSX not available');
  const status = statusEl();
  const result = await handleUmlauftafelXlsxImport(realFile(BUS), status);
  assert.equal(result.ok, true);
  assert.equal(result.document.mode, 'bus');
  assert.equal(result.document.subtype, 'jnv_umlauftafel');
  assert.match(status.textContent, /Umlauftafel erkannt|Bus/);
});

// === B: valid tram xlsx =====================================================
test('B: a valid tram Umlauftafel is analyzed and reported', async (t) => {
  if (!(await ready(TRAM))) return t.skip('tram reference / XLSX not available');
  const status = statusEl();
  const result = await handleUmlauftafelXlsxImport(realFile(TRAM), status);
  assert.equal(result.ok, true);
  assert.equal(result.document.mode, 'tram');
  assert.match(status.textContent, /Umlauftafel erkannt|Straßenbahn/);
});

// === C: invalid xlsx ========================================================
test('C: invalid XLSX yields UNSUPPORTED_LAYOUT, a clean status and no exception', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const status = statusEl();
  let result;
  await assert.doesNotReject(async () => { result = await handleUmlauftafelXlsxImport(fileLike(new Uint8Array([1, 2, 3, 4, 5]), 'broken.xlsx'), status); });
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some(w => w.code === 'UNSUPPORTED_LAYOUT'));
  assert.match(status.textContent, /nicht unterstützt/);
});

// === D: empty workbook ======================================================
test('D: an XLSX without Umlauf sheets is UNSUPPORTED_LAYOUT', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const wb = globalThis.XLSX.utils.book_new();
  globalThis.XLSX.utils.book_append_sheet(wb, globalThis.XLSX.utils.aoa_to_sheet([['just', 'a', 'note']]), 'Blatt1');
  const bytes = new Uint8Array(globalThis.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const result = await handleUmlauftafelXlsxImport(fileLike(bytes, 'empty.xlsx'), statusEl());
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some(w => w.code === 'UNSUPPORTED_LAYOUT'));
});

// === E: single file read ====================================================
test('E: the xlsx is read exactly once', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference / XLSX not available');
  let reads = 0;
  await handleUmlauftafelXlsxImport(realFile(BUS, () => { reads += 1; }), statusEl());
  assert.equal(reads, 1);
});

// === F: existing PDF import unchanged (routing) =============================
test('F: routing sends xlsx to the Umlauftafel loader and pdf to the PDF path', async (t) => {
  // structural: the PDF handler is unchanged and still the productive PDF endpoint
  assert.equal(typeof handlePdfImport, 'function');
  assert.match(controllerSource, /analyzePdfImport/);
  assert.doesNotMatch(controllerSource, /XLSX\.read|sheet_to_json/); // no SheetJS in the controller
  if (await ready(BUS)) {
    const r = await handleImport(realFile(BUS), statusEl());
    assert.equal(r.document.subtype, 'jnv_umlauftafel');
  }
  if (xlsxReady && (await present(BEU_PDF))) {
    const pdf = { name: 'beu.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array(readFileSync(BEU_PDF)).buffer.slice(0) };
    const r = await handleImport(pdf, statusEl());
    assert.equal(r.canonicalSchedule.hardened.applied, true, 'PDF path still hardens JNV');
  }
});

test('a non-pdf non-xlsx selection hides the status', async () => {
  const status = statusEl();
  const r = await handleImport({ name: 'notes.txt', type: 'text/plain' }, status);
  assert.equal(r, null);
  assert.equal(status.hidden, true);
});
