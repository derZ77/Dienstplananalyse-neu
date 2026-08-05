import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3H.1 – deterministic joint timeline (DATA ONLY). No Lenkzeit, no 1/6, no BV/ArbZG,
// no rules, no scores, no recommendations. Structural join by exact Umlauf code.
import { createJointTimeline } from '../js/v2/analysis/joint-timeline.js';
import { validateJointTimeline } from '../js/v2/analysis/joint-timeline-validation.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const src = readFileSync(new URL('../js/v2/analysis/joint-timeline.js', import.meta.url), 'utf8');
const KIND_VALUES = ['service', 'deadhead', 'layover', 'break', 'unknown'];

const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: o.line, course: o.course ?? null, trip: o.trip ?? null, kind: o.trip ? 'LINE_TRIP' : 'LINE_COURSE' },
  departureTime: { value: o.dep ?? null, minutesSinceStartOfDay: o.depMin ?? null, dayOffset: o.depOff ?? 0 },
  arrivalTime: { value: o.arr ?? null, minutesSinceStartOfDay: o.arrMin ?? null, dayOffset: o.arrOff ?? 0 },
  departureLocation: o.from ?? null, arrivalLocation: o.to ?? null,
  dutyKind: o.dutyKind ?? 'serviceDrive', source: { sourceType: 'pdf' }
});
const schedule = (services) => ({ hardened: { applied: true, services }, document: { sourceType: 'pdf' } });
const umlDoc = (codes, regime = 'school', dayType = 'mo_fr') => createUmlauftafelDocument({
  mode: 'bus', validity: createValidity({ serviceRegime: regime, dayType }),
  circulations: codes.map(c => createCirculation({ code: c, mode: 'bus' }))
});
const matchResult = (codes, status = 'exact') => ({
  status, warnings: [], statistics: { umlauftafelCirculationCount: codes.length, exact: codes.length },
  matches: codes.map(c => ({ type: 'MatchResult', status: 'exact', score: null, reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: [c], companionRefs: [c] }))
});
const bundle = (compat = 'exact', p = 'jnv_schedule_pdf', c = 'umlaufkarte') => ({ compatibility: { status: compat }, primary: { documentType: p }, companion: { documentType: c } });

const SCHEDULE = schedule([{ serviceNumber: '2101', dutyActivities: [
  dutyAct({ svc: '2101', code: '12100', line: '12', course: '1', dep: '05:00', depMin: 300, arr: '06:00', arrMin: 360, from: 'Hof', to: 'Zentrum', dutyKind: 'serviceDrive' }),
  dutyAct({ svc: '2101', code: '12100', line: '12', course: '1', dep: '06:00', depMin: 360, arr: '06:20', arrMin: 380, from: 'Zentrum', to: 'Hof', dutyKind: 'depotDuty' })
] }]);
const build = (over = {}) => createJointTimeline({
  bundle: over.bundle !== undefined ? over.bundle : bundle(),
  canonicalSchedule: over.canonicalSchedule !== undefined ? over.canonicalSchedule : SCHEDULE,
  umlauftafelDocument: over.umlauftafelDocument !== undefined ? over.umlauftafelDocument : umlDoc(['12100']),
  matchResult: over.matchResult !== undefined ? over.matchResult : matchResult(['12100'])
});

test('no rules / scoring / AI / heuristics in the joint timeline module', () => {
  assert.doesNotMatch(src, /Lenkzeit|1\/6|BV0|ArbZG|Fahrpersonal|Pausenregel|Blockpause|\bscore\b|weight|fuzzy|similarity|OCR|Math\.random|localStorage|fetch\s*\(/i);
});

// ===== gate =====
test('a non-exact bundle is not applicable (no throw, reason, empty circulations)', () => {
  const r = build({ bundle: bundle('conflicting') });
  assert.equal(r.metadata, null);
  assert.deepEqual(r.circulations, []);
  assert.ok(r.warnings.some(w => w.code === 'JOINT_TIMELINE_NOT_APPLICABLE' || w.code === 'BUNDLE_NOT_EXACT'));
});
// SUPERSEDED BY PHASE 3I.19 — a document-level non-exact match no longer voids the whole
// timeline. The per-circulation filter is the gate: an `unmatched` circulation still contributes
// nothing, but the aggregate says so instead of discarding every other circulation with it.
test('a non-exact AGGREGATE no longer voids the individually exact circulations', () => {
  // The helper's individual match stays `exact`; only the document-level aggregate is weaker.
  const r = build({ matchResult: matchResult(['12100'], 'unmatched') });
  assert.equal(r.circulations.length, 1, 'one weak circulation must not silence a good one');
  assert.ok(r.warnings.some(w => w.code === 'MATCH_NOT_FULLY_EXACT'), 'but the aggregate is stated');
});
test('an individually non-exact match still contributes nothing', () => {
  const r = build({ matchResult: { status: 'ambiguous', warnings: [], statistics: {}, matches: [{ status: 'ambiguous', primaryRefs: ['12100'], companionRefs: ['12100'] }] } });
  assert.deepEqual(r.circulations, [], 'only an individually exact match may produce data');
});
test('a conflicting match is still not applicable at all', () => {
  const r = build({ matchResult: matchResult(['12100'], 'conflicting') });
  assert.equal(r.metadata, null);
  assert.ok(r.warnings.some(w => w.code === 'MATCH_CONFLICTING'));
});
test('missing schedule or Umlauftafel is handled controlled', () => {
  let r;
  assert.doesNotThrow(() => { r = build({ canonicalSchedule: null }); });
  assert.equal(r.metadata, null);
  assert.deepEqual(r.circulations, []);
});

// ===== output shape =====
test('a successful joint timeline has exactly metadata, circulations, warnings', () => {
  const r = build();
  assert.deepEqual(Object.keys(r).sort(), ['circulations', 'metadata', 'warnings']);
  assert.deepEqual(Object.keys(r.metadata).sort(), ['circulationCount', 'dayType', 'generatedFrom', 'serviceRegime']);
  assert.equal(r.metadata.serviceRegime, 'school');
  assert.equal(r.metadata.dayType, 'mo_fr');
  assert.equal(r.metadata.circulationCount, 1);
});

// ===== circulation + segment model =====
test('a circulation carries code, services, segments, start, end, statistics', () => {
  const c = build().circulations[0];
  // SUPERSEDED BY PHASE 3I.19: `scheduleCode` was added so the roster notation stays visible when
  // `code` carries the BOARD notation of a normalised match.
  // SUPERSEDED BY PHASE 3I.22: `boardCodes` lists every sheet of the operational circuit — one for
  // an ordinary circulation, two for a night circulation broken at the 03:00 boundary.
  assert.deepEqual(Object.keys(c).sort(), ['boardCodes', 'code', 'end', 'scheduleCode', 'segments', 'services', 'start', 'statistics']);
  assert.equal(c.scheduleCode, '12100');
  assert.deepEqual(c.boardCodes, ['12100'], 'a single-sheet circuit lists exactly its own sheet');
  assert.equal(c.code, '12100');
  assert.deepEqual(c.services, ['2101']);
  assert.equal(c.segments.length, 2);
});
test('a segment exposes only the closed structural fields and a closed kind', () => {
  const seg = build().circulations[0].segments[0];
  assert.deepEqual(Object.keys(seg).sort(), ['arrival', 'course', 'dayOffset', 'departure', 'durationMinutes', 'kind', 'line', 'serviceNumber', 'source', 'trip']);
  assert.ok(KIND_VALUES.includes(seg.kind));
  assert.equal(seg.serviceNumber, '2101');
  assert.equal(seg.line, '12');
  assert.equal(seg.durationMinutes, 60);
  assert.ok(!('originalText' in seg.source) && !('rawCells' in seg.source));
});
test('kind is a closed projection of the frozen dutyKind (serviceDrive→service, depotDuty→deadhead)', () => {
  const segs = build().circulations[0].segments;
  assert.equal(segs[0].kind, 'service');
  assert.equal(segs[1].kind, 'deadhead');
});
test('leading zeros in the Umlauf code are preserved', () => {
  const r = createJointTimeline({ bundle: bundle(), canonicalSchedule: schedule([{ serviceNumber: '9', dutyActivities: [dutyAct({ svc: '9', code: '0412', line: '4', course: '12', dep: '05:00', depMin: 300, arr: '05:30', arrMin: 330 })] }]), umlauftafelDocument: umlDoc(['0412']), matchResult: matchResult(['0412']) });
  assert.equal(r.circulations[0].code, '0412');
});

// ===== statistics =====
test('statistics are neutral counts and minutes only (no thresholds)', () => {
  const s = build().circulations[0].statistics;
  assert.deepEqual(Object.keys(s).sort(), ['drivingMinutes', 'nonDrivingMinutes', 'segmentCount', 'serviceCount', 'totalMinutes']);
  assert.equal(s.serviceCount, 1);
  assert.equal(s.segmentCount, 2);
  assert.equal(s.drivingMinutes, 60); // the service segment
  assert.equal(s.nonDrivingMinutes, 20); // the deadhead segment
  assert.equal(s.totalMinutes, 80);
});

// ===== validator =====
test('validateJointTimeline accepts a well-formed timeline and rejects a malformed one', () => {
  assert.deepEqual(validateJointTimeline(build()), { valid: true, errors: [] });
  const bad = validateJointTimeline({ metadata: { serviceRegime: 'x', dayType: 'y', generatedFrom: 1, circulationCount: 'n' }, circulations: [{ code: 5, services: 'no', segments: [{ kind: 'nope' }], start: null, end: null, statistics: null }], warnings: 'no' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string'));
  assert.ok(bad.errors.some(e => /kind/.test(e.path)) && bad.errors.some(e => e.path === 'warnings'));
});

// ===== purity =====
test('the joint timeline is deterministic, JSON-compatible, and does not mutate inputs', () => {
  const input = { bundle: bundle(), canonicalSchedule: SCHEDULE, umlauftafelDocument: umlDoc(['12100']), matchResult: matchResult(['12100']) };
  const snap = JSON.stringify(input);
  const a = createJointTimeline(input);
  const b = createJointTimeline(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snap);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
});

// ===== real end-to-end (no skip: falls back to a realistic synthetic build) =====
test('real JNV PDF + real Umlauftafel + real exact match → a valid joint timeline', async () => {
  const PDF = FIXTURES.jnvSchedulePdf;
  const XLSX_PATH = FIXTURES.busUmlauftafelXlsx;
  const present = async (p) => { try { await access(p); return true; } catch { return false; } };

  let result = build(); // realistic synthetic fallback
  if (await present(PDF) && await present(XLSX_PATH)) {
    globalThis.DOMMatrix ||= class DOMMatrix {};
    const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
    createContext(sb); runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb); globalThis.XLSX = sb.XLSX;
    const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
    const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
    const { createBundleFromImports } = await import('../js/v2/import/analysis-bundle-controller.js');
    const { runJnvStructuralMatching } = await import('../js/v2/matching/jnv-matching-controller.js');
    const fileOf = (p, type) => ({ name: p.split('/').pop(), type, arrayBuffer: async () => new Uint8Array(readFileSync(p)).buffer.slice(0) });
    const primaryImport = await analyzePdfImport(fileOf(PDF, 'application/pdf'));
    const companionImport = await analyzeExcelImport(fileOf(XLSX_PATH, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    const b = createBundleFromImports({ id: 'r', createdAt: '2026-08-01T00:00:00Z', primaryImport, companionImport });
    const matching = runJnvStructuralMatching({ bundle: b, primaryImport, companionImport, metadata: { sourceName: 'B_20260817_MoFr_Schule.pdf' } });
    if (matching.status === 'completed' && matching.matchResult?.status === 'exact') {
      result = createJointTimeline({ bundle: b, canonicalSchedule: primaryImport.canonicalSchedule, umlauftafelDocument: companionImport.document, matchResult: matching.matchResult });
    }
  }
  const validation = validateJointTimeline(result);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  if (result.metadata) assert.ok(Array.isArray(result.circulations));
});
