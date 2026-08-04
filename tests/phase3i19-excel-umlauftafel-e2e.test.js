import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.19 – the DATA BRIDGE. Two things kept the real chain from ever reaching the 1/6 rule:
//
//   1. an Excel duty roster was refused at the joint-timeline gate, and the gate additionally
//      demanded a document-level `exact` match even though the per-circulation filter already
//      does that job;
//   2. the joint timeline built its segments from the SCHEDULE's activities and used the
//      Umlauftafel only to check that a code exists — so the 38 trips of a circulation sheet
//      never became a driving-time basis, and the turnaround credits (which the detector keys by
//      the BOARD code) could never meet a circulation keyed by the schedule code.
//
// This file pins the bridge. It adds NO professional logic: kinds are a closed projection of the
// existing segment vocabulary, and times are read from the values the loader already normalised.
import { createJointTimeline } from '../js/v2/analysis/joint-timeline.js';
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';

// `legacy_excel_schedule` is what the productive Excel import really produces for this roster —
// not a hypothetical `jnv_schedule_excel`.
const EXCEL_BUNDLE = { compatibility: { status: 'exact' }, primary: { documentType: 'legacy_excel_schedule' }, companion: { documentType: 'umlaufkarte' } };
const PDF_BUNDLE = { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } };

const time = (minutes, role) => ({ raw: '', hour: Math.floor((minutes % 1440) / 60), minute: minutes % 60, dayOffset: Math.floor(minutes / 1440), normalizedMinutes: minutes, role, confidence: 'exact' });
// A board segment as the Umlauftafel loader produces it: the times live in the STOP EVENTS.
const boardSegment = (sequence, type, line, from, to) => ({
  id: `segment-${sequence}`, type, sequence, line, departure: null, arrival: null,
  stops: [{ sequence: 1, role: 'departure', time: time(from, 'departure') }, { sequence: 2, role: 'arrival', time: time(to, 'arrival') }],
  warnings: [], source: {}
});
// Umlauf 18100 in miniature: depot run, two line-18 trips with a 16-minute turnaround, depot run.
const BOARD_18100 = {
  code: '18100', id: '18100',
  segments: [
    boardSegment(1, 'deadhead', null, 302, 308),
    boardSegment(2, 'service_trip', '18', 308, 328),
    boardSegment(3, 'service_trip', '18', 344, 364),
    boardSegment(4, 'deadhead', null, 364, 370)
  ]
};
const umlauftafel = (circulations = [BOARD_18100]) => ({ validity: { serviceRegime: 'holidays', dayType: 'mo_do' }, circulations });

// The Excel roster knows only the duty envelope 05:02–06:10 and the circuit code `18/1`.
const schedule = (circuitNumber = '18/1') => ({
  type: 'CanonicalSchedule',
  services: [{
    serviceNumber: '2221',
    // The Excel roster carries its duty begin on the plain service — there is no `hardened` block.
    begin: { value: '04:52', minutesSinceStartOfDay: 292, dayOffset: 0 },
    activities: [{
      circuitNumber,
      departureTime: { value: '05:02', minutesSinceStartOfDay: 302, dayOffset: 0 },
      arrivalTime: { value: '06:10', minutesSinceStartOfDay: 370, dayOffset: 0 },
      dutyKind: 'serviceDrive', source: { sourceType: 'excel' }
    }]
  }]
});
// The Phase 3I.17 shape: the schedule side says `18/1`, the board side says `18100`.
const normalizedMatch = (status = 'ambiguous') => ({
  status,
  matches: [{ status: 'exact', reasons: ['NORMALIZED_UMLAUF_CODE'], primaryRefs: ['18/1'], companionRefs: ['18100'] }]
});
const build = (over = {}) => createJointTimeline({
  bundle: EXCEL_BUNDLE, canonicalSchedule: schedule(), umlauftafelDocument: umlauftafel(), matchResult: normalizedMatch(), ...over
});

// ===== A. an Excel duty roster reaches the joint timeline =====
test('A: the joint timeline accepts an Excel duty roster bundle', () => {
  const timeline = build();
  assert.notEqual(timeline.metadata, null, 'an Excel roster is no longer refused');
  assert.ok(!timeline.warnings.some(w => w.code === 'JOINT_TIMELINE_NOT_APPLICABLE'));
});
test('A: a document-level non-exact match no longer blocks every circulation', () => {
  // The real pairing aggregates to `ambiguous` because OTHER circulations collide. The individual
  // match for this one is exact, and that is the gate that decides.
  const timeline = build({ matchResult: normalizedMatch('ambiguous') });
  assert.equal(timeline.circulations.length, 1);
  assert.ok(timeline.warnings.some(w => w.code === 'MATCH_NOT_FULLY_EXACT'), 'but the reader is told');
});
test('A: a proven contradiction still blocks everything', () => {
  const timeline = build({ matchResult: { status: 'conflicting', matches: [] } });
  assert.equal(timeline.metadata, null);
  assert.ok(timeline.warnings.some(w => w.code === 'MATCH_CONFLICTING'));
});
test('A: a non-exact INDIVIDUAL match still contributes nothing', () => {
  const timeline = build({ matchResult: { status: 'ambiguous', matches: [{ status: 'ambiguous', primaryRefs: ['18/1'], companionRefs: ['18100', '18101'] }] } });
  assert.deepEqual(timeline.circulations, [], 'only an exact circulation match may produce data');
});

// ===== B. the duty's circulation is found through the normalised match =====
test('B: the circulation is found via the companion reference, not the raw string', () => {
  const timeline = build();
  assert.equal(timeline.circulations.length, 1, '18/1 must reach board sheet 18100');
  assert.ok(!timeline.warnings.some(w => w.code === 'MATCHED_CODE_NOT_IN_UMLAUFTAFEL'));
});
test('B: it carries segments, and more than the roster ever had', () => {
  const circulation = build().circulations[0];
  assert.ok(circulation.segments.length > 0);
  assert.equal(circulation.segments.length, 4, 'all four board segments, not the single roster activity');
});
test('B: the entry is keyed by the BOARD code so the turnaround credits can land', () => {
  const circulation = build().circulations[0];
  assert.equal(circulation.code, '18100', 'the turnaround detector keys its candidates by this code');
  assert.equal(circulation.scheduleCode, '18/1', 'and the roster notation stays visible');
});
test('B: the duty that drives the circulation is kept', () => {
  const circulation = build().circulations[0];
  assert.deepEqual(circulation.services, ['2221']);
  assert.ok(circulation.segments.every(s => s.serviceNumber === '2221'), 'every segment is attributed to it');
});

// ===== C. the driving time comes from the Umlauftafel segments =====
test('C: the driving minutes are the board segments, not the roster envelope', () => {
  const projection = createDrivingProjection({ jointTimeline: build() });
  const circulation = projection.circulations[0];
  // 6 + 20 + 20 + 6 = 52 driven minutes; the 16-minute turnaround is NOT driving time.
  assert.equal(circulation.statistics.drivingMinutes, 52);
  assert.notEqual(circulation.statistics.drivingMinutes, 68, 'the roster envelope 05:02–06:10 is not the basis');
});
test('C: every board segment becomes a driving segment with a real duration', () => {
  const projection = createDrivingProjection({ jointTimeline: build() });
  const segments = projection.circulations[0].drivingSegments;
  assert.equal(segments.length, 4);
  assert.deepEqual(segments.map(s => s.durationMinutes), [6, 20, 20, 6]);
  assert.deepEqual(segments.map(s => s.kind), ['deadhead', 'service', 'service', 'deadhead']);
});
test('C: the line of a board segment is forwarded verbatim', () => {
  const projection = createDrivingProjection({ jointTimeline: build() });
  assert.deepEqual(projection.circulations[0].drivingSegments.map(s => s.line), [null, '18', '18', null]);
});
test('C: which source was used is stated, never silent', () => {
  const timeline = build();
  assert.ok(timeline.warnings.some(w => w.code === 'SEGMENTS_FROM_UMLAUFTAFEL' && w.umlaufCode === '18100'));
});

// ===== D. the turnarounds of the Umlauftafel are available =====
test('D: the 16-minute turnaround survives as a non-driving gap', () => {
  const projection = createDrivingProjection({ jointTimeline: build() });
  const gaps = projection.circulations[0].nonDrivingIntervals.filter(iv => iv.classification === 'gap');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].durationMinutes, 16);
  assert.equal(gaps[0].startMinutes, 328);
});
test('D: the board code is the join key the turnaround detector uses', () => {
  // The detector emits candidates with `circulationCode: '18100'`; the rule looks them up by the
  // projection's circulation code. Both sides must therefore speak the board notation.
  const projection = createDrivingProjection({ jointTimeline: build() });
  assert.equal(projection.circulations[0].code, '18100');
});
test('D: segments stay ordered by departure so gaps are computed correctly', () => {
  const shuffled = { ...BOARD_18100, segments: [BOARD_18100.segments[2], BOARD_18100.segments[0], BOARD_18100.segments[3], BOARD_18100.segments[1]] };
  const timeline = build({ umlauftafelDocument: umlauftafel([shuffled]) });
  const departures = timeline.circulations[0].segments.map(s => s.departure);
  assert.deepEqual(departures, ['05:02', '05:08', '05:44', '06:04']);
});

// ===== E. no regression of the PDF path =====
test('E: a PDF bundle with identical codes still works exactly as before', () => {
  const timeline = createJointTimeline({
    bundle: PDF_BUNDLE,
    canonicalSchedule: schedule('12100'),
    umlauftafelDocument: { validity: { serviceRegime: 'holidays', dayType: 'mo_do' }, circulations: [{ code: '12100', id: '12100', segments: [] }] },
    matchResult: { status: 'exact', matches: [{ status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], primaryRefs: ['12100'], companionRefs: ['12100'] }] }
  });
  assert.notEqual(timeline.metadata, null);
  assert.equal(timeline.circulations[0].code, '12100');
  assert.equal(timeline.circulations[0].segments.length, 1, 'a board sheet without segments falls back to the roster activity');
  assert.equal(timeline.circulations[0].segments[0].serviceNumber, '2221');
});
test('E: the fallback to the roster is stated as well', () => {
  const timeline = createJointTimeline({
    bundle: PDF_BUNDLE,
    canonicalSchedule: schedule('12100'),
    umlauftafelDocument: { validity: {}, circulations: [{ code: '12100', id: '12100', segments: [] }] },
    matchResult: { status: 'exact', matches: [{ status: 'exact', primaryRefs: ['12100'], companionRefs: ['12100'] }] }
  });
  assert.ok(timeline.warnings.some(w => w.code === 'SEGMENTS_FROM_SCHEDULE' && w.umlaufCode === '12100'));
});
test('E: an unmatched or missing code behaves unchanged', () => {
  const timeline = build({ matchResult: { status: 'exact', matches: [{ status: 'exact', primaryRefs: ['99/9'], companionRefs: ['99900'] }] } });
  assert.deepEqual(timeline.circulations, []);
  assert.ok(timeline.warnings.some(w => w.code === 'MATCHED_CODE_NOT_IN_UMLAUFTAFEL'));
});
test('E: the bundle and schedule gates are untouched', () => {
  assert.equal(createJointTimeline({ bundle: { compatibility: { status: 'partial' } }, canonicalSchedule: schedule(), umlauftafelDocument: umlauftafel(), matchResult: normalizedMatch('exact') }).metadata, null);
  assert.equal(createJointTimeline({ bundle: EXCEL_BUNDLE, canonicalSchedule: null, umlauftafelDocument: umlauftafel(), matchResult: normalizedMatch('exact') }).metadata, null);
  assert.equal(createJointTimeline({ bundle: { ...EXCEL_BUNDLE, companion: { documentType: 'wagenkarte' } }, canonicalSchedule: schedule(), umlauftafelDocument: umlauftafel(), matchResult: normalizedMatch('exact') }).metadata, null);
});
test('E: the board segments carry no invented professional classification', () => {
  const circulation = build().circulations[0];
  for (const segment of circulation.segments) {
    assert.ok(['service', 'deadhead', 'unknown'].includes(segment.kind), 'only a projection of the existing vocabulary');
    assert.equal(typeof segment.durationMinutes, 'number');
  }
});

// ===== F. the productive controller carries the same bridge =====
// It duplicated BOTH gates of the joint timeline and added two more of its own: the Excel roster's
// document type maps to the organization `LEGACY`, which the JNV eligibility chain rejected, and
// the duty starts were read only from a `hardened` block the Excel import does not produce.
import { runJnvRuleAnalysis, DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

const board = () => ({ organization: 'JNV', mode: 'bus', validity: { serviceRegime: 'holidays', dayType: 'mo_do' }, circulations: [BOARD_18100] });
const analysis = (over = {}) => runJnvRuleAnalysis({
  bundle: EXCEL_BUNDLE,
  primaryImport: { canonicalSchedule: schedule() },
  companionImport: { document: board() },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: normalizedMatch() },
  ...over
});

test('F: an Excel roster reaches the productive chain', async () => {
  const r = await analysis();
  assert.equal(r.status, 'completed', `got ${r.reason}`);
  assert.equal(r.jointTimeline.circulations.length, 1);
  assert.equal(r.drivingProjection.circulations[0].code, '18100');
});
test('F: the driving basis of the productive projection is the Umlauftafel', async () => {
  const r = await analysis();
  assert.equal(r.drivingProjection.circulations[0].statistics.drivingMinutes, 52);
});
test('F: a weaker aggregate is carried as a warning, not as a refusal', async () => {
  const r = await analysis();
  assert.ok(r.warnings.some(w => w.code === 'MATCH_NOT_FULLY_EXACT'));
});
test('F: a conflicting match is still refused productively', async () => {
  const r = await analysis({ matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'conflicting', matches: [] } } });
  assert.equal(r.status, 'not_applicable');
  assert.equal(r.reason, 'MATCH_CONFLICTING');
});
test('F: the Excel roster is treated as JNV because the Umlauftafel says so', async () => {
  // `legacy_excel_schedule` names a FILE FORMAT and maps to the organization `LEGACY`, which
  // claims no operator. The companion's explicit `JNV` therefore decides.
  const r = await analysis({ oneSixthConfig: { ...DEFAULT_ONE_SIXTH_RULE_CONFIG, enabled: true } });
  const one = r.checkReport.results.find(x => x.id === 'BV015_BV018');
  assert.ok(!(one.details.warnings || []).some(w => (w.code || w) === 'NOT_JNV'), 'the JNV rule no longer rejects its own duty roster');
});
test('F: two genuinely different organizations remain a contradiction', async () => {
  const r = await analysis({
    bundle: { ...EXCEL_BUNDLE, primary: { documentType: 'jnv_schedule_pdf' } },
    companionImport: { document: { ...board(), organization: 'JES' } },
    oneSixthConfig: { ...DEFAULT_ONE_SIXTH_RULE_CONFIG, enabled: true }
  });
  const one = r.checkReport.results.find(x => x.id === 'BV015_BV018');
  assert.ok((one.details.warnings || []).some(w => (w.code || w) === 'NOT_JNV'), 'JNV roster + JES board stays rejected');
});
test('F: the duty start is read from the plain services when there is no hardened block', async () => {
  const r = await analysis();
  assert.equal(r.drivingProjection.metadata.dutyStartTime, 292, 'read verbatim from the roster service, not derived from a trip');
});
test('F: a duty without a usable begin stays unknown — nothing is derived', async () => {
  const withoutBegin = { type: 'CanonicalSchedule', services: [{ serviceNumber: '2221', activities: schedule().services[0].activities }] };
  const r = await analysis({ primaryImport: { canonicalSchedule: withoutBegin } });
  assert.equal(r.drivingProjection.metadata.dutyStartTime, null, 'no begin, no guess');
});
