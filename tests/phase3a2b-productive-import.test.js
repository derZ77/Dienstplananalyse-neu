import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

// Phase 3A.2b – the productive PDF import caller must use the central analysis
// orchestrator (analyzePdfImport), not inspectPdfImport, as its endpoint.
const controllerSource = await readFile(new URL('../js/v2/import/pdf-import-controller.js', import.meta.url), 'utf8');
const { handlePdfImport, inspectPdfImport } = await import('../js/v2/import/pdf-import-controller.js');
const { buildHardenedCanonicalSchedule } = await import('../js/v2/pdf/hardened-schedule.js');

const BEU_PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
const JES_PDF = '/Users/joergziegler/Downloads/20260713_Dienstübersicht_FDA.pdf';
const present = async (p) => { try { await access(p); return true; } catch { return false; } };
const statusEl = () => ({ hidden: false, textContent: '' });

const scheduleDocument = () => ({
  type: 'ScheduleDocument', pageCount: 1, source: { byteLength: 0, documentModelType: 'PdfDocumentModel' },
  services: [{
    id: 'page-1-table-0', serviceNumber: '2141', begin: '04:53', end: '12:40', paidTime: '06:43', rows: [],
    activities: [{ index: 0, serviceNumber: '2141', circuitNumber: '14400', rawActivity: 'Dienst', departureTime: '05:03', departureLocation: 'Bth. Burgau', arrivalTime: '08:12', arrivalLocation: 'Bth. Burgau', originalText: 'Dienst', boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }, source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 2, columnIndex: 1 } }],
    originalText: '', boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }, source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineRange: { start: 1, end: 2 }, boundingBox: {}, originalText: '' }
  }]
});

// === G: single productive endpoint, no direct JNV logic in the UI ===========
test('G: the controller wires the productive handler to analyzePdfImport only', () => {
  assert.match(controllerSource, /analyzePdfImport/);
  assert.doesNotMatch(controllerSource, /jnv-schedule-hardening/);
  assert.doesNotMatch(controllerSource, /attachJnvHardening|isJnvHardeningTarget/);
  // no second, parallel full pipeline inside the UI handler
  assert.doesNotMatch(controllerSource, /buildCanonicalSchedule|buildHardenedCanonicalSchedule|extractPdfLayoutDocument/);
  // no storage / network in the UI controller
  assert.doesNotMatch(controllerSource, /localStorage|sessionStorage|indexedDB|fetch\s*\(/);
});

test('legacy detection endpoint stays available for internal reuse', () => {
  assert.equal(typeof inspectPdfImport, 'function');
});

// === A + §11: real composition for JNV, PDF read exactly once ================
test('A: handlePdfImport runs the real composition for a JNV PDF and reads it once', async (t) => {
  if (!(await present(BEU_PDF))) return t.skip('reference PDF not present');
  const bytes = new Uint8Array(await readFile(BEU_PDF));
  let reads = 0;
  const file = { name: 'beu.pdf', type: 'application/pdf', arrayBuffer: async () => { reads += 1; return bytes.buffer.slice(0); } };
  const status = statusEl();
  const analysis = await handlePdfImport(file, status);
  assert.equal(analysis.detection.status, 'supported');
  assert.equal(analysis.detection.profile.id, 'beu-stadtbus-v1');
  assert.equal(analysis.canonicalSchedule.hardened.applied, true);
  assert.ok(analysis.canonicalSchedule.hardened.interruptions.length >= 1);
  assert.match(status.textContent, /erkannt/, 'status is not regressed');
  assert.equal(reads, 1, 'the PDF is read exactly once through the productive path');
});

// === C/D: a JES document keeps its status and is never JNV-hardened ==========
// SUPERSEDED BY PHASE 4.2: this test stated its JES expectation only NEGATIVELY ("is not
// beu-stadtbus-v1"), which a wrongly REFUSED document satisfies exactly as well as a correctly
// detected one — which is why it stayed green while the JES plan was in fact rejected before it
// reached the pipeline. Every previous assertion is kept; the missing positive one is added.
test('C/D: a JES document is detected as JES and is not JNV-hardened', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('reference PDF not present');
  const bytes = new Uint8Array(await readFile(JES_PDF));
  const file = { name: 'jes.pdf', type: 'application/pdf', arrayBuffer: async () => bytes.buffer.slice(0) };
  const status = statusEl();
  const analysis = await handlePdfImport(file, status);
  assert.equal(analysis.detection.status, 'supported', 'the JES plan reaches the pipeline');
  assert.equal(analysis.detection.profile.id, 'jes-regionalbus-v1');
  assert.notEqual(analysis.detection.profile?.id, 'beu-stadtbus-v1');
  assert.ok(analysis.canonicalSchedule !== null && !('hardened' in analysis.canonicalSchedule),
    'a schedule is produced, and JNV hardening is not attached to it');
  const warnings = analysis.canonicalSchedule?.hardened?.warnings ?? [];
  assert.ok(!warnings.some(w => w.code === 'HARDENING_FAILED'), 'no hardening-failure masquerade for non-JNV');
  assert.ok(status.textContent.length > 0);
});

// === E: hardening failure isolated (real build + injected failing enricher) ==
test('E: a hardening failure keeps the canonical usable and never throws', () => {
  let result;
  assert.doesNotThrow(() => {
    result = buildHardenedCanonicalSchedule(scheduleDocument(), { documentType: 'jnv_schedule_pdf' }, { enrich: () => { throw new Error('boom'); } });
  });
  assert.equal(result.type, 'CanonicalSchedule');
  assert.ok(Array.isArray(result.services) && result.services.length === 1);
  assert.equal(result.hardened.applied, false);
  assert.ok(result.hardened.warnings.some(w => w.code === 'HARDENING_FAILED'));
});

// === F: non-PDF selection hides status, no analysis, no storage/network ======
test('F: a non-PDF selection hides the status and does not analyze', async () => {
  const status = statusEl();
  const analysis = await handlePdfImport({ name: 'notes.txt', type: 'text/plain' }, status);
  assert.equal(analysis, null);
  assert.equal(status.hidden, true);
});
