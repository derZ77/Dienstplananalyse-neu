import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.22 – the operational-day layer of Phase 3I.21, CONNECTED.
//
//     Umlauftafel raw data → Operational Circuit Identity → Matcher → Joint Timeline → 1/6 rule
//
// Nothing is normalised anew here and no heuristic is added: the matcher and the joint timeline
// simply ask the layer that Phase 3I.21 already proved. The raw data stays untouched.
//
// The matcher keeps its order: the exact raw string first (`EXACT_UMLAUF_CODE`, unchanged), the
// operational circuit only afterwards. Where a unique operational circuit exists, it no longer
// reports `MULTIPLE_CIRCULATIONS_FOR_CODE` — and where the sheets really are two circuits (the
// reinforcement duties), it still does.
import { matchJnvBundle } from '../js/v2/matching/jnv-bundle-matcher.js';
import { createJointTimeline } from '../js/v2/analysis/joint-timeline.js';
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';
import { resolveOperationalCircuits } from '../js/v2/identity/operational-circuit-identity.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const at = (h, m, day = 0) => day * 1440 + h * 60 + m;
const time = (m, role) => ({ raw: '', hour: Math.floor((m % 1440) / 60), minute: m % 60, dayOffset: Math.floor(m / 1440), normalizedMinutes: m, role, confidence: 'exact' });

// A board sheet as the loader produces it: times live in the stop events.
const sheet = (code, from, to, parts = 2, line = null) => {
  const step = Math.floor((to - from) / parts);
  return {
    code, id: code,
    segments: Array.from({ length: parts }, (_, i) => ({
      id: `${code}-${i + 1}`, type: 'service_trip', sequence: i + 1, line, departure: null, arrival: null,
      stops: [
        { sequence: 1, role: 'departure', time: time(from + i * step, 'departure') },
        { sequence: 2, role: 'arrival', time: time(i === parts - 1 ? to : from + (i + 1) * step, 'arrival') }
      ],
      warnings: [], source: {}
    }))
  };
};
// The real night pair: the continuation carries NO day offset, exactly as the loader delivers it.
const NIGHT_SHEETS = () => [sheet('10901', at(21, 46), at(3, 13, 1), 4, '10'), sheet('10902', at(3, 14), at(4, 23), 2, '10')];
const REINFORCEMENT = (a, b, fromA, toA, fromB, toB) => [sheet(a, fromA, toA, 3, '11'), sheet(b, fromB, toB, 3, '11')];

const BUNDLE = { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } };
const board = (circulations) => ({ organization: 'JNV', mode: 'bus', validity: { serviceRegime: 'school', dayType: 'mo_fr' }, circulations });
const run = (planCodes, circulations) => matchJnvBundle({
  bundle: BUNDLE,
  schedule: { serviceRegime: 'school', dayType: 'mo_fr', umlaeufe: planCodes.map(code => ({ code })) },
  umlauftafel: board(circulations)
});
const matchFor = (result, code) => result.matches.find(m => (m.primaryRefs || []).includes(code));

// ===== A. the real night circulation becomes ONE match =====
test('A: 10/9 now matches the merged operational circuit', () => {
  const result = run(['10/9'], NIGHT_SHEETS());
  assert.equal(matchFor(result, '10/9').status, 'exact', 'no longer an ambiguity');
  assert.equal(result.statistics.exact, 1);
  assert.equal(result.statistics.ambiguous, 0);
});
test('A: MULTIPLE_CIRCULATIONS_FOR_CODE is gone for this pair', () => {
  const result = run(['10/9'], NIGHT_SHEETS());
  assert.deepEqual([...matchFor(result, '10/9').conflicts], []);
});
test('A: the match names BOTH sheets of the circuit', () => {
  const match = matchFor(run(['10/9'], NIGHT_SHEETS()), '10/9');
  assert.deepEqual([...match.companionRefs], ['10901', '10902'], 'the downstream needs both sheets');
  assert.deepEqual([...match.reasons], ['NORMALIZED_UMLAUF_CODE']);
});
test('A: the merge is stated on the result', () => {
  const result = run(['10/9'], NIGHT_SHEETS());
  assert.ok(result.warnings.some(w => w.code === 'OPERATIONAL_CIRCUIT_MERGED' && w.sheetCodes.join() === '10901,10902'));
});
test('A: neither sheet is counted as missing in the schedule', () => {
  const result = run(['10/9'], NIGHT_SHEETS());
  assert.equal(result.statistics.missingInSchedule, 0, 'both sheets are referenced through the circuit');
});

// ===== B. 11301 / 11302 stay two circuits =====
test('B: a reinforcement pair remains ambiguous', () => {
  const result = run(['11/3'], REINFORCEMENT('11301', '11302', at(5, 7), at(10, 2), at(14, 59), at(18, 56)));
  assert.equal(matchFor(result, '11/3').status, 'ambiguous', 'two real circuits stay two');
  assert.deepEqual([...matchFor(result, '11/3').conflicts], ['MULTIPLE_CIRCULATIONS_FOR_CODE']);
});
test('B: both sheets are named, none is chosen', () => {
  const result = run(['11/3'], REINFORCEMENT('11301', '11302', at(5, 7), at(10, 2), at(14, 59), at(18, 56)));
  assert.deepEqual([...matchFor(result, '11/3').companionRefs], ['11301', '11302']);
  assert.equal(result.statistics.exact, 0);
});

// ===== C. 11401 / 11402 behave the same =====
test('C: the second reinforcement pair also stays ambiguous', () => {
  const result = run(['11/4'], REINFORCEMENT('11401', '11402', at(6, 22), at(10, 22), at(15, 19), at(18, 42)));
  assert.equal(matchFor(result, '11/4').status, 'ambiguous');
});
test('C: and the third one too', () => {
  const result = run(['11/5'], REINFORCEMENT('11501', '11502', at(6, 27), at(10, 21), at(15, 2), at(19, 2)));
  assert.equal(matchFor(result, '11/5').status, 'ambiguous');
  assert.ok(!result.warnings.some(w => w.code === 'OPERATIONAL_CIRCUIT_MERGED'), 'nothing was merged here');
});

// ===== D. the real night duty reaches the chain =====
test('D: the joint timeline builds ONE circulation for the night duty', () => {
  const sheets = NIGHT_SHEETS();
  const match = run(['10/9'], sheets);
  const timeline = createJointTimeline({
    bundle: BUNDLE,
    canonicalSchedule: {
      type: 'CanonicalSchedule',
      services: [{
        serviceNumber: '2299', begin: { value: '21:36', minutesSinceStartOfDay: 1296, dayOffset: 0 },
        activities: [{
          circuitNumber: '10/9', dutyKind: 'serviceDrive', source: { sourceType: 'excel' },
          departureTime: { value: '21:46', minutesSinceStartOfDay: at(21, 46), dayOffset: 0 },
          arrivalTime: { value: '04:23', minutesSinceStartOfDay: at(4, 23), dayOffset: 1 }
        }]
      }]
    },
    umlauftafelDocument: board(sheets),
    matchResult: match
  });
  assert.equal(timeline.circulations.length, 1, 'one operational circuit, not two sheet entries');
  assert.deepEqual(timeline.circulations[0].boardCodes, ['10901', '10902']);
  assert.equal(timeline.circulations[0].scheduleCode, '10/9');
});
test('D: the circulation carries the segments of BOTH sheets, in time order', () => {
  const sheets = NIGHT_SHEETS();
  const timeline = createJointTimeline({
    bundle: BUNDLE,
    canonicalSchedule: { type: 'CanonicalSchedule', services: [{ serviceNumber: '2299', activities: [{ circuitNumber: '10/9', dutyKind: 'serviceDrive', source: {}, departureTime: { value: '21:46', minutesSinceStartOfDay: at(21, 46), dayOffset: 0 }, arrivalTime: { value: '04:23', minutesSinceStartOfDay: at(4, 23), dayOffset: 1 } }] }] },
    umlauftafelDocument: board(sheets), matchResult: run(['10/9'], sheets)
  });
  const segments = timeline.circulations[0].segments;
  assert.equal(segments.length, 6, '4 from 10901 + 2 from 10902');
  const starts = segments.map(s => s.dayOffset * 1440 + Number(s.departure.slice(0, 2)) * 60 + Number(s.departure.slice(3)));
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'strictly ordered across the sheet boundary');
  assert.equal(starts[0], at(21, 46));
  assert.ok(starts[starts.length - 1] > at(3, 0, 1), 'the continuation is placed on the next calendar day');
});
test('D: the driving projection sees one continuous night circulation', () => {
  const sheets = NIGHT_SHEETS();
  const timeline = createJointTimeline({
    bundle: BUNDLE,
    canonicalSchedule: { type: 'CanonicalSchedule', services: [{ serviceNumber: '2299', activities: [{ circuitNumber: '10/9', dutyKind: 'serviceDrive', source: {}, departureTime: { value: '21:46', minutesSinceStartOfDay: at(21, 46), dayOffset: 0 }, arrivalTime: { value: '04:23', minutesSinceStartOfDay: at(4, 23), dayOffset: 1 } }] }] },
    umlauftafelDocument: board(sheets), matchResult: run(['10/9'], sheets)
  });
  const projection = createDrivingProjection({ jointTimeline: timeline });
  assert.equal(projection.circulations.length, 1);
  assert.equal(projection.circulations[0].drivingSegments.length, 6);
  assert.ok(projection.circulations[0].statistics.drivingMinutes > 0);
});

// ===== E. no regression for ordinary circulations =====
test('E: an exact raw match is untouched', () => {
  const result = run(['12100'], [sheet('12100', at(3, 46), at(21, 11))]);
  assert.equal(matchFor(result, '12100').status, 'exact');
  assert.deepEqual([...matchFor(result, '12100').reasons], ['EXACT_UMLAUF_CODE'], 'the raw path keeps precedence');
});
test('E: the Phase 3I.17 pairing still resolves', () => {
  const result = run(['18/1'], [sheet('18100', at(5, 2), at(20, 57))]);
  assert.equal(matchFor(result, '18/1').status, 'exact');
  assert.deepEqual([...matchFor(result, '18/1').reasons], ['NORMALIZED_UMLAUF_CODE']);
  assert.deepEqual([...matchFor(result, '18/1').companionRefs], ['18100']);
});
test('E: an unknown code is still unmatched', () => {
  const result = run(['99/9'], [sheet('12100', at(3, 46), at(21, 11))]);
  assert.equal(matchFor(result, '99/9').status, 'unmatched');
});
test('E: a single-sheet circulation produces one timeline entry as before', () => {
  const sheets = [sheet('18100', at(5, 2), at(20, 57), 3, '18')];
  const timeline = createJointTimeline({
    bundle: BUNDLE,
    canonicalSchedule: { type: 'CanonicalSchedule', services: [{ serviceNumber: '2221', activities: [{ circuitNumber: '18/1', dutyKind: 'serviceDrive', source: {}, departureTime: { value: '05:02', minutesSinceStartOfDay: at(5, 2), dayOffset: 0 }, arrivalTime: { value: '20:57', minutesSinceStartOfDay: at(20, 57), dayOffset: 0 } }] }] },
    umlauftafelDocument: board(sheets), matchResult: run(['18/1'], sheets)
  });
  assert.equal(timeline.circulations.length, 1);
  assert.equal(timeline.circulations[0].code, '18100', 'unchanged for a single-sheet circuit');
  assert.deepEqual(timeline.circulations[0].boardCodes, ['18100']);
  assert.equal(timeline.circulations[0].segments.length, 3);
});
test('E: the validity gate still decides first', () => {
  const result = matchJnvBundle({
    bundle: BUNDLE,
    schedule: { serviceRegime: 'school', dayType: 'saturday', umlaeufe: [{ code: '10/9' }] },
    umlauftafel: board(NIGHT_SHEETS())
  });
  assert.equal(result.status, 'conflicting', 'a proven validity contradiction is still decided before Level 2');
});

// ===== F. the raw data stays untouched =====
test('F: the matcher mutates no circulation', () => {
  const sheets = NIGHT_SHEETS();
  const before = JSON.stringify(sheets);
  run(['10/9'], sheets);
  assert.equal(JSON.stringify(sheets), before);
});
test('F: the joint timeline mutates no circulation either', () => {
  const sheets = NIGHT_SHEETS();
  const match = run(['10/9'], sheets);
  const before = JSON.stringify(sheets);
  createJointTimeline({
    bundle: BUNDLE,
    canonicalSchedule: { type: 'CanonicalSchedule', services: [{ serviceNumber: '2299', activities: [{ circuitNumber: '10/9', dutyKind: 'serviceDrive', source: {}, departureTime: { value: '21:46', minutesSinceStartOfDay: at(21, 46), dayOffset: 0 }, arrivalTime: { value: '04:23', minutesSinceStartOfDay: at(4, 23), dayOffset: 1 } }] }] },
    umlauftafelDocument: board(sheets), matchResult: match
  });
  assert.equal(JSON.stringify(sheets), before, 'the day offset lives in the layer, never in the document');
});
test('F: the layer itself still returns the same circuits it did in Phase 3I.21', () => {
  const result = resolveOperationalCircuits(NIGHT_SHEETS());
  assert.equal(result.circuits.length, 1);
  assert.deepEqual(result.circuits[0].sheetCodes, ['10901', '10902']);
});

// ===== G. nothing professional was changed =====
test('G: rule, validator and configuration carry no Phase 3I.22 change', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js']) {
    assert.doesNotMatch(src(path), /3I\.22|resolveOperationalCircuits/, `${path} must be untouched`);
  }
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false, 'still not activated');
});
test('G: the matcher invents no normalisation of its own', () => {
  const matcher = src('../js/v2/matching/jnv-bundle-matcher.js');
  assert.match(matcher, /resolveOperationalCircuits/, 'it uses the existing layer');
  assert.doesNotMatch(matcher, /replace\(\s*\/|padStart|slice\(-?\d/, 'and adds no notation handling');
});
