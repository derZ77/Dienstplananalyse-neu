import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3F – real end-to-end: file → central import → ImportResult → session →
// createBundleFromImports → bundle. Importing the controllers pulls in pdf.mjs (DOMMatrix).
globalThis.DOMMatrix ||= class DOMMatrix {};
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

const { handleImport } = await import('../js/v2/import/pdf-import-controller.js');
const { createBundleFromImports } = await import('../js/v2/import/analysis-bundle-controller.js');
const { createMultiDocumentSession } = await import('../js/v2/import/multi-document-import-controller.js');

const JNV_PDF = FIXTURES.jnvSchedulePdf;
const BUS_XLSX = FIXTURES.busUmlauftafelXlsx;
const present = async (p) => { try { await access(p); return true; } catch { return false; } };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileFrom = (bytes, name, type, onRead) => ({ name, type, arrayBuffer: async () => { if (onRead) onRead(); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } });
const realFile = (p, type, onRead) => fileFrom(new Uint8Array(readFileSync(p)), p.split('/').pop(), type, onRead);
const buildXlsx = (aoa, name) => {
  const wb = globalThis.XLSX.utils.book_new();
  globalThis.XLSX.utils.book_append_sheet(wb, globalThis.XLSX.utils.aoa_to_sheet(aoa), name);
  return new Uint8Array(globalThis.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
};

function realSession() {
  let calls = 0;
  const session = createMultiDocumentSession({
    buildBundle: (args) => { calls += 1; return createBundleFromImports(args); },
    generateBundleId: () => 'bundle-int', generateTimestamp: () => '2026-07-31T00:00:00Z'
  });
  return { session, buildCalls: () => calls };
}

test('real JNV PDF + real bus Umlauftafel XLSX → exact bundle (files read once each)', async (t) => {
  if (!(xlsxReady && (await present(JNV_PDF)) && (await present(BUS_XLSX)))) return t.skip('references / XLSX not available');
  let pdfReads = 0, xlsxReads = 0;
  const { session, buildCalls } = realSession();

  const pdfFile = realFile(JNV_PDF, 'application/pdf', () => { pdfReads += 1; });
  const primaryResult = await handleImport(pdfFile, null); // central import, single read
  session.setPrimaryResult(primaryResult, pdfFile);        // no re-analysis

  const xlsxFile = realFile(BUS_XLSX, XLSX_MIME, () => { xlsxReads += 1; });
  const state = await session.setCompanionFile(xlsxFile);  // central Excel import, single read

  assert.equal(state.bundle.primary.documentType, 'jnv_schedule_pdf');
  assert.equal(state.bundle.companion.documentType, 'umlaufkarte');
  assert.equal(state.bundle.compatibility.status, 'exact');
  assert.equal(pdfReads, 1, 'PDF read exactly once');
  assert.equal(xlsxReads, 1, 'companion XLSX read exactly once');
  assert.equal(buildCalls(), 1, 'bundle built once for the complete combination');
});

test('supported JES-shaped primary + real Wagenkarte XLSX → exact bundle', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const { session } = realSession();
  // faithful supported-JES import-result shape (no real JES PDF needed here)
  session.setPrimaryResult({ detection: { status: 'supported', profile: { id: 'jes-regionalbus-v1' } }, canonicalSchedule: {} }, { name: 'jes.pdf' });

  const wagen = fileFrom(buildXlsx([['', 'Dienst-Nr.:', '', '100'], ['', '', '', '']], 'Dienst 100'), 'wagen.xlsx', XLSX_MIME);
  const state = await session.setCompanionFile(wagen);

  assert.equal(state.bundle.primary.documentType, 'jes_schedule_pdf');
  assert.equal(state.bundle.companion.documentType, 'wagenkarte');
  assert.equal(state.bundle.compatibility.status, 'exact');
});

test('a legacy Excel offered as a companion is rejected end-to-end (no bundle)', async (t) => {
  if (!xlsxReady) return t.skip('XLSX not available');
  const { session } = realSession();
  session.setPrimaryResult({ detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } }, canonicalSchedule: {} }, { name: 'jnv.pdf' });

  const legacy = fileFrom(buildXlsx([['Dienst', 'Umlauf', 'Tätigkeit'], ['1140', '12100', 'Fahrt']], 'D'), 'legacy.xlsx', XLSX_MIME);
  const state = await session.setCompanionFile(legacy);

  assert.equal(state.companionImport, null, 'legacy schedule is not accepted as a companion');
  assert.equal(state.bundle, null);
});
