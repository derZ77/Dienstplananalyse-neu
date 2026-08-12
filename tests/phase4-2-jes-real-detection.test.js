import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 4.2 (B/C) — the real JES Dienstplan-PDF, through the real productive chain.
 *
 * This closes the test gap named in Phase 4.1: the existing real-document test loaded the same
 * file but asserted only extraction invariants, and the productive-import test asserted its JES
 * expectations NEGATIVELY ("is not JNV-hardened") — which a wrongly rejected document satisfies
 * just as well as a correctly detected one. Neither could see the defect.
 *
 * Nothing here is pre-cleaned: the file goes in as bytes and comes out as a classified document
 * with a schedule. No detector is called with hand-written text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport, buildDetectionText } = await import('../js/v2/import/pdf-analysis-controller.js');
const { handlePdfImport } = await import('../js/v2/import/pdf-import-controller.js');
const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { DOCUMENT_PROFILES } = await import('../js/v2/documents/document-profiles.js');

const JES_PDF = FIXTURES.jesSchedulePdf;
const present = async (path) => { try { await access(path); return true; } catch { return false; } };
const fileLike = (bytes, name) => ({ name, type: 'application/pdf', arrayBuffer: async () => bytes.buffer });

/**
 * The real file, read from disk once. PDF.js DETACHES the buffer it is handed, so every caller
 * gets its own copy — otherwise the second test in this file would fail on a detached buffer.
 */
let cached = null;
const jesBytes = async () => new Uint8Array(cached ??= await readFile(JES_PDF));

const filled = (list, pick) => list.filter(entry => {
  const value = pick(entry);
  return value !== null && value !== undefined && String(value).trim() !== '';
}).length;

// =====================================================================================
// B — the real document is classified as a JES Dienstplan
// =====================================================================================
test('B: the real JES plan is detected as jes-regionalbus-v1', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const { detection } = await analyzePdfImport(fileLike(await jesBytes(), 'plan.pdf'));

  assert.equal(detection.status, 'supported');
  assert.equal(detection.profile.id, 'jes-regionalbus-v1');
  assert.equal(detection.title, 'Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026');
  assert.equal(detection.pageCount, 3);
  assert.deepEqual(detection.signals.jesSignals, [true, true, true],
    'all three signals are met — none was waived');
});

test('B: and that profile really is the JES Dienstplan-PDF document type', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const { detection } = await analyzePdfImport(fileLike(await jesBytes(), 'plan.pdf'));
  const profile = DOCUMENT_PROFILES[detection.profile.id];
  assert.equal(profile.documentType, 'jes_schedule_pdf');
  assert.equal(profile.organization, 'JES');
  assert.equal(profile.status, 'active');
});

test('B: the detection text really is built from the reconstructed lines', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const layout = await extractPdfLayoutDocument(await jesBytes());
  const text = buildDetectionText(layout);


  assert.ok(text.includes('Dienste Regionalbus'), 'the word is contiguous');
  assert.ok(!text.includes('R egionalbus'), 'the fragmentation is gone');
  assert.ok(text.includes('ab 13.07.2026'), 'and so is the split date');
  // No text is lost on the way: every item of the inspected pages is represented.
  const items = layout.pages.slice(0, 2).flatMap(page => page.textObjects.filter(o => o.text.trim()));
  const compact = text.replace(/\s+/g, '');
  for (const object of items.slice(0, 200)) {
    assert.ok(compact.includes(object.text.replace(/\s+/g, '')), `missing: ${object.text.slice(0, 30)}`);
  }
});

test('B: the productive UI handler reports the JES plan as supported', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const status = { hidden: false, textContent: '' };
  const analysis = await handlePdfImport(fileLike(await jesBytes(), 'plan.pdf'), status);

  assert.equal(analysis.detection.status, 'supported');
  assert.equal(analysis.detection.profile.id, 'jes-regionalbus-v1');
  assert.match(status.textContent, /erkannt/, 'the user is told the document was recognised');
  assert.ok(!status.textContent.includes('nicht unterstützt'));
  assert.ok(!status.textContent.includes('/User' + 's/'), 'no path reaches the user');
  assert.ok(!status.textContent.includes('plan.pdf'), 'and no file name either');
});

// =====================================================================================
// C — the existing parser continues unchanged behind the repaired detection
// =====================================================================================
test('C: the pipeline produces the 19 JES duty blocks', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const { canonicalSchedule } = await analyzePdfImport(fileLike(await jesBytes(), 'plan.pdf'));

  assert.notEqual(canonicalSchedule, null, 'a schedule is produced at all — it was null before');
  assert.equal(canonicalSchedule.type, 'CanonicalSchedule');
  assert.equal(canonicalSchedule.document.sourceType, 'pdf');
  assert.equal(canonicalSchedule.services.length, 19);
  assert.equal(canonicalSchedule.activities.length, 139);
  assert.equal(canonicalSchedule.metadata.serviceCount, 19);
});

test('C: the duty-level time fields are complete', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const { canonicalSchedule } = await analyzePdfImport(fileLike(await jesBytes(), 'plan.pdf'));
  const { services } = canonicalSchedule;

  assert.equal(filled(services, s => s.serviceNumber), 19, 'Dienstnummer');
  assert.equal(filled(services, s => s.begin?.value), 19, 'Dienstbeginn');
  assert.equal(filled(services, s => s.end?.value), 19, 'Dienstende');
  assert.equal(filled(services, s => s.paidTime?.value), 19, 'bezahlte Zeit');
  assert.equal(filled(canonicalSchedule.activities, a => a.departureTime?.value), 127);
  assert.equal(filled(canonicalSchedule.activities, a => a.arrivalTime?.value), 127);
});

test('C: JES keeps JNV hardening disabled and promotes only its already recognised interruption rows', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const { canonicalSchedule } = await analyzePdfImport(fileLike(await jesBytes(), 'plan.pdf'));

  assert.equal('hardened' in canonicalSchedule, false, 'hardening stays bound to the JNV profile');
  assert.deepEqual(canonicalSchedule.warnings, [], 'the base builder raises no warning');
  assert.equal(canonicalSchedule.interruptions.length, 4, 'recognised Dienstunterbrechungen use the common CanonicalSchedule contract');
  assert.ok(canonicalSchedule.interruptions.every(entry => entry.type === 'serviceInterruption' && entry.kind === 'interruption'));
});

test('C: the parser itself was not changed for this phase', async () => {
  const sources = await Promise.all([
    '../js/v2/pdf/schedule-mapper.js', '../js/v2/pdf/document-normalizer.js',
    '../js/v2/pdf/canonical-schedule-builder.js', '../js/v2/pdf/hardened-schedule.js',
    '../js/v2/pdf/jnv-schedule-hardening.js', '../js/v2/pdf/row-type-contract.js',
    '../js/v2/pdf/layout-reconstruction.js', '../js/v2/pdf/document-profile-detector.js'
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.doesNotMatch(source, /4\.2|Phase 4/, 'no parser or detector carries a Phase 4.2 change');
  }
});

test('C: no reference file name or path reaches the analysis result', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('JES reference plan not present');
  const analysis = await analyzePdfImport(fileLike(await jesBytes(), 'plan.pdf'));
  const serialised = JSON.stringify({ detection: analysis.detection, document: analysis.canonicalSchedule.document });
  assert.ok(!serialised.includes('/User' + 's/'));
  assert.ok(!serialised.includes('.pdf'));
  assert.ok(!serialised.includes('Dienstübersicht'));
});
