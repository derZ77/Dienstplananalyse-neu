import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3D – central Excel routing. Real module composition:
// file → handleImport → single read → workbook → classifier → correct fach-adapter.
// Importing the controller pulls in pdf.mjs (needs DOMMatrix).
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
const { handleImport } = await import('../js/v2/import/pdf-import-controller.js');

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
  const wbk = globalThis.XLSX.utils.book_new();
  for (const s of specs) globalThis.XLSX.utils.book_append_sheet(wbk, globalThis.XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  return new Uint8Array(globalThis.XLSX.write(wbk, { type: 'array', bookType: 'xlsx' }));
};

test('static: the central controller stays free of SheetJS, storage, network, matching, bundle', () => {
  assert.doesNotMatch(controllerSource, /XLSX\.read|XLSX\.utils|sheet_to_json/);
  assert.doesNotMatch(controllerSource, /localStorage|sessionStorage|indexedDB|fetch\s*\(/);
  assert.doesNotMatch(controllerSource, /createMatchResult|matchStatus|AnalysisBundle|createAnalysisBundle/);
});

test('exact Umlauftafel (bus) → only the Umlauftafel loader; file read exactly once', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference / XLSX not available');
  let reads = 0;
  const a = await handleImport(realFile(BUS, () => { reads += 1; }), statusEl());
  assert.equal(a.classification.type, 'umlaufkarte');
  assert.equal(a.document.mode, 'bus');
  assert.equal(a.importResult.documentType, 'umlaufkarte');
  assert.equal(reads, 1);
});

test('exact Umlauftafel (tram) → only the Umlauftafel loader', async (t) => {
  if (!(await ready(TRAM))) return t.skip('tram reference / XLSX not available');
  const a = await handleImport(realFile(TRAM), statusEl());
  assert.equal(a.document.mode, 'tram');
  assert.equal(a.importResult.documentType, 'umlaufkarte');
});

test('exact Wagenkarte → only the Wagenkarte adapter (no Umlauftafel, no Legacy)', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const bytes = buildXlsx([{ name: 'Dienst 100', aoa: [['', 'Dienst-Nr.:', '', '100'], ['', '', '', '']] }]);
  const a = await handleImport(fileLike(bytes, 'wagen.xlsx'), statusEl());
  assert.equal(a.classification.type, 'wagenkarte');
  assert.equal(a.document, null, 'no Umlauftafel document');
  assert.equal(a.importResult.documentType, 'wagenkarte');
  assert.equal(a.importResult.data.recognized, true);
  assert.ok(!('type' in a.importResult.data)); // not a CanonicalSchedule
});

test('exact Legacy-Excel → only the Legacy adapter (existing CanonicalSchedule contract)', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const bytes = buildXlsx([{ name: 'Dienste', aoa: [
    ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'ab Ort', 'Ankunft', 'an Ort', 'Beginn', 'Ende', 'Bezahlt'],
    ['1140', '12100', 'Fahrt', '05:00', 'Hof', '05:20', 'Zentrum', '05:00', '13:00', '08:00']
  ] }]);
  const a = await handleImport(fileLike(bytes, 'legacy.xlsx'), statusEl());
  assert.equal(a.classification.type, 'legacy_excel_schedule');
  assert.equal(a.document, null, 'no Umlauftafel document');
  assert.equal(a.importResult.documentType, 'legacy_excel_schedule');
  assert.equal(a.importResult.data.type, 'CanonicalSchedule');
  assert.equal(a.importResult.data.services.length, 1);
});

test('unknown / probable / ambiguous → no fach-adapter is invoked', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const unknown = await handleImport(fileLike(buildXlsx([{ name: 'Notes', aoa: [['hello', 'world']] }]), 'notes.xlsx'), statusEl());
  assert.equal(unknown.classification.confidence, 'unknown');
  assert.equal(unknown.importResult, null);
  assert.equal(unknown.document, null);

  const probable = await handleImport(fileLike(buildXlsx([{ name: 'X', aoa: [['Umlauf:'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00']] }]), 'prob.xlsx'), statusEl());
  assert.equal(probable.classification.confidence, 'probable');
  assert.equal(probable.importResult, null);

  const amb = await handleImport(fileLike(buildXlsx([
    { name: '12100', aoa: [['Umlauf:', '12100'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00'], ['Linie: 10   Route: 1'], ['Dienst-Nr.:']] },
    { name: '12200', aoa: [['Umlauf:', '12200'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00'], ['Linie: 10']] }
  ]), 'amb.xlsx'), statusEl());
  assert.equal(amb.classification.confidence, 'ambiguous');
  assert.equal(amb.importResult, null);
});

test('a broken workbook is handled controlled (no throw, no adapter)', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  let a;
  await assert.doesNotReject(async () => { a = await handleImport(fileLike(new Uint8Array([1, 2, 3, 4, 5]), 'broken.xlsx'), statusEl()); });
  assert.equal(a.importResult, null);
  assert.equal(a.document, null);
});

test('the PDF path is unchanged (routed to the PDF handler, still JNV-hardened)', async (t) => {
  if (!(xlsxReady && (await present(BEU_PDF)))) return t.skip('PDF reference not available');
  const pdf = { name: 'beu.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array(readFileSync(BEU_PDF)).buffer.slice(0) };
  const a = await handleImport(pdf, statusEl());
  assert.equal(a.canonicalSchedule.hardened.applied, true);
});
