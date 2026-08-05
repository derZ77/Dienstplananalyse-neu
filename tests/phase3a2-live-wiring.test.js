import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

// Phase 3A.2 – controlled live wiring of the JNV hardening. The base pipeline and
// buildCanonicalSchedule stay untouched; hardening is attached at an import seam,
// only for the JNV profile, and never throws into the caller.
const {
  isJnvHardeningTarget,
  attachJnvHardening,
  buildHardenedCanonicalSchedule
} = await import('../js/v2/pdf/hardened-schedule.js');
const { buildCanonicalSchedule } = await import('../js/v2/pdf/canonical-schedule-builder.js');
const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');

// --- synthetic canonical (minimal, with one split-shift interruption row) ----
const clock = (v) => v == null || v === '' ? { raw: '', value: null, minutesSinceStartOfDay: null }
  : { raw: v, value: v, minutesSinceStartOfDay: Number(v.split(':')[0]) * 60 + Number(v.split(':')[1]) };
const canonical = () => ({
  type: 'CanonicalSchedule',
  document: { sourceType: 'pdf', pageCount: 1, source: {} },
  services: [{
    id: 'service:1:0', serviceNumber: '2141',
    begin: clock('04:53'), end: clock('12:40'), paidTime: { raw: '06:43', value: '06:43', minutes: 403 },
    activities: [
      { id: 'a1', serviceId: 'service:1:0', serviceNumber: '2141', circuitNumber: '14400', rawActivity: 'Dienst', departureTime: clock('05:03'), arrivalTime: clock('08:12'), departureLocation: 'Bth. Burgau', arrivalLocation: 'Bth. Burgau', originalText: 'Dienst', boundingBox: {}, source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 2 } },
      { id: 'a2', serviceId: 'service:1:0', serviceNumber: '', circuitNumber: '', rawActivity: '', departureTime: clock(null), arrivalTime: clock(null), departureLocation: '', arrivalLocation: '', originalText: 'Dienstunterbrechung von 08:22 Uhr bis 13:26 Uhr', boundingBox: {}, source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 3 } }
    ],
    interruptions: [], originalText: '', boundingBox: {}, source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineRange: { start: 1, end: 3 } }
  }],
  activities: [], interruptions: [], warnings: [],
  metadata: { schemaVersion: '1.0', serviceCount: 1, activityCount: 2, interruptionCount: 0 }
});

// A minimal ScheduleDocument accepted by buildCanonicalSchedule (mapper output shape).
const scheduleDocument = () => ({
  type: 'ScheduleDocument', pageCount: 1,
  source: { byteLength: 0, documentModelType: 'PdfDocumentModel' },
  services: [{
    id: 'page-1-table-0', serviceNumber: '2141', begin: '04:53', end: '12:40', paidTime: '06:43',
    rows: [],
    activities: [{ index: 0, serviceNumber: '2141', circuitNumber: '14400', rawActivity: 'Dienst', departureTime: '05:03', departureLocation: 'Bth. Burgau', arrivalTime: '08:12', arrivalLocation: 'Bth. Burgau', originalText: 'Dienst', boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }, source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 2, columnIndex: 1 } }],
    originalText: '', boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineRange: { start: 1, end: 2 }, boundingBox: {}, originalText: '' }
  }]
});

// === Activation ============================================================
test('JNV activates hardening (by profileId and by documentType)', () => {
  assert.equal(isJnvHardeningTarget({ profileId: 'beu-stadtbus-v1' }), true);
  assert.equal(isJnvHardeningTarget({ documentType: 'jnv_schedule_pdf' }), true);
  assert.ok('hardened' in attachJnvHardening(canonical(), { profileId: 'beu-stadtbus-v1' }));
  assert.ok('hardened' in attachJnvHardening(canonical(), { documentType: 'jnv_schedule_pdf' }));
});

test('JES and Legacy do NOT activate hardening', () => {
  assert.equal(isJnvHardeningTarget({ profileId: 'jes-regionalbus-v1' }), false);
  assert.equal(isJnvHardeningTarget({ documentType: 'legacy_excel_schedule' }), false);
  assert.equal(isJnvHardeningTarget({}), false);
  const jes = attachJnvHardening(canonical(), { profileId: 'jes-regionalbus-v1' });
  assert.ok(!('hardened' in jes));
  const legacy = attachJnvHardening(canonical(), { documentType: 'legacy_excel_schedule' });
  assert.ok(!('hardened' in legacy));
});

test('non-JNV attach returns the identical schedule reference (untouched)', () => {
  const base = canonical();
  const result = attachJnvHardening(base, { profileId: 'jes-regionalbus-v1' });
  assert.equal(result, base);
});

// === Output contract =======================================================
test('hardened field carries the agreed contract for JNV', () => {
  const result = attachJnvHardening(canonical(), { profileId: 'beu-stadtbus-v1' });
  const h = result.hardened;
  assert.equal(h.applied, true);
  for (const key of ['services', 'interruptions', 'dayQualifiers', 'warnings', 'timeline']) assert.ok(key in h, `hardened.${key}`);
  assert.equal(h.timeline.normalized, true);
  assert.equal(h.interruptions.length, 1, 'the split-shift interruption is surfaced');
});

test('existing canonical keys are unchanged; only `hardened` is added; base not mutated', () => {
  const base = canonical();
  const baseKeys = Object.keys(base).sort();
  const result = attachJnvHardening(base, { profileId: 'beu-stadtbus-v1' });
  assert.deepEqual(Object.keys(result).sort(), [...baseKeys, 'hardened'].sort());
  assert.ok(!('hardened' in base), 'the input schedule is not mutated');
  for (const key of baseKeys) assert.equal(result[key], base[key], `existing key ${key} is preserved by reference`);
});

// === Error isolation =======================================================
test('a failure inside hardening does not break the import; canonical stays complete', () => {
  const base = canonical();
  let result;
  assert.doesNotThrow(() => {
    result = attachJnvHardening(base, { profileId: 'beu-stadtbus-v1' }, { enrich: () => { throw new Error('boom'); } });
  });
  assert.equal(result.hardened.applied, false);
  assert.ok(result.hardened.warnings.some(w => w.code === 'HARDENING_FAILED'));
  assert.equal(result.type, 'CanonicalSchedule');
  assert.equal(result.services, base.services, 'the canonical schedule is left intact');
  assert.ok(result.hardened.warnings.every(w => !/boom/.test(JSON.stringify(w.sourceText || ''))));
});

// === Composition + "identical without hardening" ===========================
test('buildHardenedCanonicalSchedule is identical to buildCanonicalSchedule for non-JNV', () => {
  const plain = buildCanonicalSchedule(scheduleDocument());
  const composed = buildHardenedCanonicalSchedule(scheduleDocument(), { profileId: 'jes-regionalbus-v1' });
  assert.deepEqual(composed, plain);
});

test('buildHardenedCanonicalSchedule adds a valid canonical + hardened for JNV', () => {
  const result = buildHardenedCanonicalSchedule(scheduleDocument(), { documentType: 'jnv_schedule_pdf' });
  assert.equal(result.type, 'CanonicalSchedule');
  assert.ok(Array.isArray(result.services) && result.services.length === 1);
  assert.equal(result.hardened.applied, true);
  assert.equal(result.hardened.timeline.normalized, true);
});

// === Live import orchestrator (real reference PDFs, skipped if absent) ======
const BEU_PDF = FIXTURES.jnvSchedulePdf;
const JES_PDF = FIXTURES.jesSchedulePdf;
const fileLike = async (path) => { const bytes = new Uint8Array(await readFile(path)); return { name: path.split('/').pop(), type: 'application/pdf', arrayBuffer: async () => bytes.buffer.slice(0) }; };
const present = async (path) => { try { await access(path); return true; } catch { return false; } };

test('analyzePdfImport produces hardened for a real JNV PDF', async (t) => {
  if (!(await present(BEU_PDF))) return t.skip('reference PDF not present');
  const { detection, canonicalSchedule } = await analyzePdfImport(await fileLike(BEU_PDF));
  assert.equal(detection.status, 'supported');
  assert.equal(detection.profile.id, 'beu-stadtbus-v1');
  assert.equal(canonicalSchedule.hardened.applied, true);
  assert.ok(canonicalSchedule.hardened.interruptions.length >= 1);
});

test('analyzePdfImport never JNV-hardens a real JES PDF', async (t) => {
  if (!(await present(JES_PDF))) return t.skip('reference PDF not present');
  const { detection, canonicalSchedule } = await analyzePdfImport(await fileLike(JES_PDF));
  // JES is never the JNV profile; regardless of the current detector outcome for
  // this file (its title regex is a pre-existing detector limitation, out of scope
  // here), the JES document must never receive the JNV `hardened` field.
  assert.notEqual(detection.profile?.id, 'beu-stadtbus-v1');
  assert.ok(canonicalSchedule === null || !('hardened' in canonicalSchedule));
});
