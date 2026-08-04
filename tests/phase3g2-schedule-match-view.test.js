import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';

// Phase 3G.2 – extended structural ScheduleMatchView. Structural projection only:
// per-Umlauf services/lines/courses/trips/start/end/timeWindow from EXISTING fields
// (exact-string codes, existing RouteIdentity), no heuristics, no interpretation.
import { buildExtendedScheduleMatchView } from '../js/v2/matching/jnv-schedule-match-view.js';
import { buildScheduleMatchView } from '../js/v2/matching/jnv-bundle-matcher.js';
import { validateExtendedScheduleMatchView } from '../js/v2/matching/jnv-schedule-match-view-validation.js';
import { resolveJnvScheduleValidity } from '../js/v2/matching/jnv-schedule-validity.js';

const source = readFileSync(new URL('../js/v2/matching/jnv-schedule-match-view.js', import.meta.url), 'utf8');
const VALIDITY = { serviceRegime: 'school', dayType: 'mo_fr', confidence: 'exact', evidence: [{ code: 'TITLE_VALIDITY_SIGNAL', value: 'school', source: 'title' }], conflicts: [], warnings: [] };

const act = (o) => ({
  serviceNumber: o.serviceNumber, circuitNumber: o.circuitNumber,
  routeIdentity: o.routeIdentity ?? null,
  departureTime: { value: o.dep ?? null, minutesSinceStartOfDay: o.depMin ?? null, dayOffset: o.depOff ?? 0 },
  arrivalTime: { value: o.arr ?? null, minutesSinceStartOfDay: o.arrMin ?? null, dayOffset: o.arrOff ?? 0 },
  departureLocation: o.from ?? null, arrivalLocation: o.to ?? null
});
const schedule = (services) => ({ services });
const view = (services, validity = VALIDITY) => buildExtendedScheduleMatchView({ canonicalSchedule: schedule(services), validity });
const rid = (line, course, trip) => ({ line, course: course ?? null, trip: trip ?? null, kind: trip ? 'LINE_TRIP' : 'LINE_COURSE' });

test('no heuristic / scoring / storage / network in the view builder', () => {
  assert.doesNotMatch(source, /fuzzy|similarity|levenshtein|distance|Math\.random|localStorage|fetch\s*\(/);
});

test('one Umlauf with one service', () => {
  const v = view([{ serviceNumber: '2101', activities: [act({ serviceNumber: '2101', circuitNumber: '12100', routeIdentity: rid('12', '1'), dep: '05:00', depMin: 300, from: 'Hof', arr: '13:00', arrMin: 780, to: 'Zentrum' })] }]);
  assert.equal(v.umlaeufe.length, 1);
  const u = v.umlaeufe[0];
  assert.equal(u.code, '12100');
  assert.deepEqual(u.services, ['2101']);
  assert.deepEqual(u.lines, ['12']);
  assert.deepEqual(u.courses, ['1']);
  assert.deepEqual(u.trips, []);
  assert.deepEqual(u.start, { time: '05:00', location: 'Hof' });
  assert.deepEqual(u.end, { time: '13:00', location: 'Zentrum' });
  assert.equal(u.timeWindow.startMinutes, 300);
  assert.equal(u.timeWindow.endMinutes, 780);
});

test('one Umlauf spanning multiple services → distinct sorted services', () => {
  const v = view([
    { serviceNumber: '2102', activities: [act({ serviceNumber: '2102', circuitNumber: '12100', routeIdentity: rid('12', '1') })] },
    { serviceNumber: '2101', activities: [act({ serviceNumber: '2101', circuitNumber: '12100', routeIdentity: rid('12', '1') })] }
  ]);
  assert.deepEqual(v.umlaeufe[0].services, ['2101', '2102']);
});

test('leading zeros in the Umlauf code are preserved (no numeric interpretation)', () => {
  const v = view([{ serviceNumber: '9', activities: [act({ serviceNumber: '9', circuitNumber: '0412', routeIdentity: rid('4', '12') })] }]);
  assert.equal(v.umlaeufe[0].code, '0412');
});

test('a LINE_TRIP identity contributes trips, not courses', () => {
  const v = view([{ serviceNumber: '7', activities: [act({ serviceNumber: '7', circuitNumber: '412/16', routeIdentity: rid('412', null, '16') })] }]);
  assert.deepEqual(v.umlaeufe[0].lines, ['412']);
  assert.deepEqual(v.umlaeufe[0].trips, ['16']);
  assert.deepEqual(v.umlaeufe[0].courses, []);
});

test('activities without an Umlauf code are not silently grouped, but reported', () => {
  const v = view([{ serviceNumber: '5', activities: [act({ serviceNumber: '5', circuitNumber: '' })] }]);
  assert.equal(v.umlaeufe.length, 0);
  assert.ok(v.warnings.some(w => w.code === 'SERVICE_WITHOUT_UMLAUF_CODE'));
});

test('a day change is reflected in the time window (dayOffsetEnd)', () => {
  const v = view([{ serviceNumber: '3', activities: [act({ serviceNumber: '3', circuitNumber: '1100', routeIdentity: rid('1', '1'), dep: '22:00', depMin: 1320, depOff: 0, arr: '00:30', arrMin: 30, arrOff: 1 })] }]);
  assert.equal(v.umlaeufe[0].timeWindow.dayOffsetEnd, 1);
});

test('multiple Umläufe with a stable order and distinct lines', () => {
  const v = view([
    { serviceNumber: '1', activities: [act({ serviceNumber: '1', circuitNumber: '12100', routeIdentity: rid('12', '1') }), act({ serviceNumber: '1', circuitNumber: '13200', routeIdentity: rid('13', '2') })] }
  ]);
  assert.deepEqual(v.umlaeufe.map(u => u.code), ['12100', '13200']);
});

test('the view carries the validity but is not a full CanonicalSchedule copy', () => {
  const v = view([{ serviceNumber: '1', activities: [act({ serviceNumber: '1', circuitNumber: '12100', routeIdentity: rid('12', '1') })] }]);
  assert.deepEqual(Object.keys(v).sort(), ['dayType', 'serviceRegime', 'umlaeufe', 'validityConfidence', 'validityEvidence', 'warnings']);
  assert.equal(v.serviceRegime, 'school');
  assert.equal(v.validityConfidence, 'exact');
  for (const k of ['originalText', 'boundingBox', 'rawActivity']) assert.ok(!(k in v.umlaeufe[0]));
  assert.ok(v.umlaeufe[0].sourceRefs.every(r => !('originalText' in r) && !('rawCells' in r)));
});

test('the builder does not mutate the input schedule', () => {
  const s = schedule([{ serviceNumber: '1', activities: [act({ serviceNumber: '1', circuitNumber: '12100', routeIdentity: rid('12', '1') })] }]);
  const snap = JSON.stringify(s);
  buildExtendedScheduleMatchView({ canonicalSchedule: s, validity: VALIDITY });
  assert.equal(JSON.stringify(s), snap);
});

test('the 3G.1 buildScheduleMatchView export is unchanged and still available', () => {
  const legacy = buildScheduleMatchView(schedule([{ serviceNumber: '1', activities: [{ circuitNumber: '12100' }] }]), { serviceRegime: 'school', dayType: 'mo_fr' });
  assert.deepEqual(legacy.umlaeufe.map(u => u.code), ['12100']);
  assert.equal(legacy.serviceRegime, 'school');
});

// no Scheingrün: real JNV PDF → pipeline → validity → extended view → validation.
test('real JNV schedule end-to-end (skips only if the external PDF is absent)', async (t) => {
  const PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
  try { await access(PDF); } catch { return t.skip('real JNV PDF not available'); }
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const file = { name: 'B_20260817_MoFr_Schule.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array(readFileSync(PDF)).buffer.slice(0) };
  const analysis = await analyzePdfImport(file);
  if (analysis.detection.status !== 'supported' || !analysis.canonicalSchedule) return t.skip('real PDF not detected as supported JNV');

  const validity = resolveJnvScheduleValidity({ canonicalSchedule: analysis.canonicalSchedule, hardened: analysis.canonicalSchedule.hardened, detection: analysis.detection, sourceName: file.name });
  const extended = buildExtendedScheduleMatchView({ canonicalSchedule: analysis.canonicalSchedule, validity });
  const validation = validateExtendedScheduleMatchView(extended);

  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.ok(extended.umlaeufe.length >= 1, 'real Umlauf codes were extracted');
  assert.ok(extended.umlaeufe.every(u => typeof u.code === 'string' && u.code.length > 0));
});
