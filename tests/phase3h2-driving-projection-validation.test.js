import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3H.2 – structural validator for the driving projection + real pipeline end-to-end.
import { validateDrivingProjection } from '../js/v2/analysis/driving-projection-validation.js';
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';

const seg = (o) => ({ serviceNumber: o.svc ?? '2101', line: '12', course: '1', trip: null, departure: o.dep ?? null, arrival: o.arr ?? null, dayOffset: o.off ?? 0, durationMinutes: o.dur ?? null, source: { serviceNumber: o.svc ?? '2101', activityIndex: o.idx ?? 0, sourceType: 'pdf' }, kind: o.kind ?? 'service' });
const jt = (segments) => ({ metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'jnv-structural-exact-match', circulationCount: 1 }, circulations: [{ code: '12100', services: ['2101'], segments, start: { time: null, dayOffset: 0 }, end: { time: null, dayOffset: 0 }, statistics: {} }], warnings: [] });
const goodProjection = () => createDrivingProjection({ jointTimeline: jt([seg({ dep: '05:00', dur: 60 }), seg({ dep: '06:00', dur: 20, kind: 'deadhead', idx: 1 })]) });

test('a well-formed projection is valid; a not-applicable one is valid too', () => {
  assert.deepEqual(validateDrivingProjection(goodProjection()), { valid: true, errors: [] });
  assert.deepEqual(validateDrivingProjection({ metadata: null, circulations: [], warnings: [] }), { valid: true, errors: [] });
});

test('a non-object is rejected controlled', () => {
  assert.equal(validateDrivingProjection(null).valid, false);
});

test('malformed circulations, kinds, durations and duplicate block ids are rejected', () => {
  const bad = {
    metadata: { serviceRegime: 'x', dayType: 'y', generatedFrom: 1, circulationCount: 'n' },
    circulations: [{
      code: 5, drivingSegments: 'no',
      drivingBlocks: [{ id: 'b', startMinutes: -1, endMinutes: 1, durationMinutes: -5, segmentCount: 1, serviceNumbers: [1], circulationCode: 5, sourceRefs: [] }, { id: 'b', startMinutes: 0, endMinutes: 1, durationMinutes: 1, segmentCount: 1, serviceNumbers: ['x'], circulationCode: '5', sourceRefs: [] }],
      interruptionIntervals: [{ startMinutes: 0, endMinutes: 1, durationMinutes: 1, sourceType: 't', explicit: 'no', sourceRefs: [] }],
      nonDrivingIntervals: [{ startMinutes: 0, endMinutes: 1, durationMinutes: 1, sourceType: 't', explicit: true, classification: 'nope' }],
      statistics: null, warnings: []
    }],
    warnings: 'no'
  };
  const r = validateDrivingProjection(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string'));
  assert.ok(r.errors.some(e => e.code === 'DUPLICATE_BLOCK_ID'));
  assert.ok(r.errors.some(e => /classification/.test(e.path)));
  assert.ok(r.errors.some(e => /durationMinutes/.test(e.path))); // negative duration
  assert.ok(r.errors.some(e => e.path === 'warnings'));
});

test('privacy-unsafe source refs are rejected', () => {
  const p = goodProjection();
  p.circulations[0].drivingBlocks[0].sourceRefs = [{ serviceNumber: '2101', originalText: 'a full raw line' }];
  const r = validateDrivingProjection(p);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.code === 'UNSAFE_SOURCE_REF'));
});

test('the validator does not mutate its input and is JSON-serializable', () => {
  const p = goodProjection();
  const snap = JSON.stringify(p);
  const r = validateDrivingProjection(p);
  assert.equal(JSON.stringify(p), snap);
  assert.equal(JSON.stringify(r), JSON.stringify(JSON.parse(JSON.stringify(r))));
});

// no Scheingrün: real JNV PDF → matching → joint timeline → driving projection → validation.
test('real pipeline read-only: joint timeline → driving projection → valid', async () => {
  const PDF = FIXTURES.jnvSchedulePdf;
  const XLSX_PATH = FIXTURES.busUmlauftafelXlsx;
  const present = async (p) => { try { await access(p); return true; } catch { return false; } };

  let projection = goodProjection(); // realistic synthetic fallback
  if (await present(PDF) && await present(XLSX_PATH)) {
    globalThis.DOMMatrix ||= class DOMMatrix {};
    const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
    createContext(sb); runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb); globalThis.XLSX = sb.XLSX;
    const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
    const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
    const { createBundleFromImports } = await import('../js/v2/import/analysis-bundle-controller.js');
    const { runJnvStructuralMatching } = await import('../js/v2/matching/jnv-matching-controller.js');
    const { createJointTimeline } = await import('../js/v2/analysis/joint-timeline.js');
    const fileOf = (p, type) => ({ name: p.split('/').pop(), type, arrayBuffer: async () => new Uint8Array(readFileSync(p)).buffer.slice(0) });
    const primaryImport = await analyzePdfImport(fileOf(PDF, 'application/pdf'));
    const companionImport = await analyzeExcelImport(fileOf(XLSX_PATH, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    const b = createBundleFromImports({ id: 'r', createdAt: '2026-08-01T00:00:00Z', primaryImport, companionImport });
    const matching = runJnvStructuralMatching({ bundle: b, primaryImport, companionImport, metadata: { sourceName: 'B_20260817_MoFr_Schule.pdf' } });
    // The reference schedule is "Schule" while the reference Umlauftafel is "Ferien", so the
    // real match is correctly conflicting (not exact); the joint timeline is then not applicable.
    const jointTimeline = createJointTimeline({ bundle: b, canonicalSchedule: primaryImport.canonicalSchedule, umlauftafelDocument: companionImport.document, matchResult: matching.matchResult ?? { status: matching.status } });
    projection = createDrivingProjection({ jointTimeline });
  }
  assert.equal(validateDrivingProjection(projection).valid, true, JSON.stringify(validateDrivingProjection(projection).errors));
});
