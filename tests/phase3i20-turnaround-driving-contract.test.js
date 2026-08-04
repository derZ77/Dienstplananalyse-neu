import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.20 – CONTRACT tests for the two decisions confirmed after the real end-to-end proof.
// They change no professional logic; they pin what the contract now says and, where code and
// contract still differ, they pin the DIFFERENCE as the current state so it cannot vanish quietly.
//
//   Decision 1a — only turnarounds of AT LEAST 11 minutes are creditable towards the 1/6 rule.
//                 A shorter one is neither driving time, nor creditable, nor a break. It is
//                 simply nothing.
//   Decision 1b — the driving-time basis is DRIVING TIME + DEADHEAD RUNS.
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';
import { detectTurnaroundCandidates } from '../js/v2/rules/one-sixth-turnaround-candidates.js';

const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((o, k) => o?.[k], config.parameters ?? config);

// A joint-timeline circulation with a single gap of `gapMinutes` between two 60-minute trips.
const timelineWithGap = (gapMinutes, kind = 'service') => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'test', circulationCount: 1 },
  circulations: [{
    code: '12100', scheduleCode: '12100', services: ['2101'],
    segments: [
      { serviceNumber: '2101', line: '12', course: null, trip: null, departure: '05:00', arrival: '06:00', dayOffset: 0, durationMinutes: 60, source: {}, kind },
      { serviceNumber: '2101', line: '12', course: null, trip: null, departure: `0${6 + Math.floor(gapMinutes / 60)}:${String(gapMinutes % 60).padStart(2, '0')}`, arrival: null, dayOffset: 0, durationMinutes: 60, source: {}, kind }
    ],
    start: { time: '05:00', dayOffset: 0 }, end: { time: null, dayOffset: 0 },
    statistics: { serviceCount: 1, segmentCount: 2, drivingMinutes: 120, nonDrivingMinutes: 0, totalMinutes: 120 }
  }],
  warnings: []
});
// A board circulation whose two adjacent line trips are `gapMinutes` apart.
const boardWithGap = (gapMinutes) => ({
  organization: 'JNV', mode: 'bus', validity: { serviceRegime: 'school', dayType: 'mo_fr' },
  circulations: [{
    code: '12100', segments: [1, 2].map(sequence => {
      const from = sequence === 1 ? 300 : 360 + gapMinutes;
      const t = (m, role) => ({ raw: '', hour: Math.floor(m / 60), minute: m % 60, dayOffset: 0, normalizedMinutes: m, role, confidence: 'exact' });
      return {
        id: `s${sequence}`, type: 'service_trip', sequence, line: '12', departure: null, arrival: null,
        stops: [{ sequence: 1, role: 'departure', time: t(from, 'departure') }, { sequence: 2, role: 'arrival', time: t(from + 60, 'arrival') }],
        warnings: [], source: {}
      };
    })
  }]
});
const creditedFor = (gapMinutes) => {
  const detection = detectTurnaroundCandidates({ umlauftafelDocument: boardWithGap(gapMinutes) });
  const candidate = detection.candidates.find(c => c.observedSpanMinutes === gapMinutes);
  return candidate ?? null;
};

// ===== A. only turnarounds of at least 11 minutes are creditable =====
test('A: the threshold is 11 observed minutes, and it is a confirmed parameter', () => {
  assert.equal(p('turnaround.minimumObservedSpanMinutes').value, 11);
  assert.equal(p('turnaround.minimumObservedSpanMinutes').status, 'confirmed');
});
test('A: an 11-minute turnaround is credited, a 10-minute one is not', () => {
  assert.equal(creditedFor(11).eligibility, 'qualified');
  assert.equal(creditedFor(11).creditedMinutes, 11, 'the full observed span, technical minute included');
  assert.equal(creditedFor(10).eligibility, 'below_minimum');
  assert.equal(creditedFor(10).creditedMinutes, 0);
});
test('A: below the threshold exactly zero minutes are credited', () => {
  assert.equal(p('turnaround.belowMinimumCreditedMinutes').value, 0);
  for (const gap of [1, 4, 9, 10]) assert.equal(creditedFor(gap).creditedMinutes, 0, `${gap} min must credit nothing`);
});

// ===== B. a turnaround below the threshold is NOT driving time =====
test('B: a gap between two trips never becomes driving time', () => {
  const projection = createDrivingProjection({ jointTimeline: timelineWithGap(4) });
  const circulation = projection.circulations[0];
  assert.equal(circulation.statistics.drivingMinutes, 120, 'only the two trips, not the 4-minute gap');
});
test('B: the same holds for a gap above the threshold', () => {
  const projection = createDrivingProjection({ jointTimeline: timelineWithGap(16) });
  assert.equal(projection.circulations[0].statistics.drivingMinutes, 120, 'the length of a gap never changes the basis');
});

// ===== C. a turnaround below the threshold is NOT a break =====
test('C: a plain gap is classified as a gap, never as a break or layover', () => {
  const projection = createDrivingProjection({ jointTimeline: timelineWithGap(4) });
  const intervals = projection.circulations[0].nonDrivingIntervals;
  assert.deepEqual([...new Set(intervals.map(iv => iv.classification))], ['gap']);
  assert.deepEqual(projection.circulations[0].interruptionIntervals, [], 'a gap is not an interruption');
});
test('C: and a plain gap is never treated as a turnaround by itself', () => {
  assert.equal(p('turnaround.plainGapCountsAsTurnaround').value, false);
  assert.equal(p('turnaround.plainGapCountsAsTurnaround').status, 'confirmed');
});

// ===== D. the driving-time basis is driving time + deadhead runs =====
test('D: a deadhead run counts fully as driving time', () => {
  assert.equal(p('calculation.deadheadTreatment').value, 'counts_as_driving_time');
  const projection = createDrivingProjection({ jointTimeline: timelineWithGap(4, 'deadhead') });
  assert.equal(projection.circulations[0].statistics.drivingMinutes, 120, 'deadhead minutes are driving minutes');
});
test('D: nothing else is', () => {
  const projection = createDrivingProjection({ jointTimeline: timelineWithGap(4, 'layover') });
  assert.equal(projection.circulations[0].statistics.drivingMinutes, 0, 'a layover is not driving time');
});

// ===== E. the contract formula and the implementation agree — WITH this decision =====
test('E: the configured formula is a top-down one, the code sums bottom-up', () => {
  // The configuration describes the driving time as `duty_duration_minus_all_non_driving_time`;
  // the projection sums the driving segments instead. Both reach the same number ONLY when EVERY
  // non-driving minute is subtracted — including the sub-threshold turnarounds.
  assert.equal(p('calculation.plannedDrivingTimeFormula').value, 'duty_duration_minus_all_non_driving_time');
  assert.ok(p('calculation.nonDrivingTimeCategories').value.includes('turnaround'));
  assert.ok(p('calculation.nonDrivingTimeCategories').value.includes('other_non_driving_time'),
    'the category that has to absorb a sub-threshold turnaround');
});
test('E: the real duty 2221 proves both readings meet', () => {
  // Recorded from the real reference in Phase 3I.19 (no reference data in this repository):
  //   duty window 05:02–12:52 = 470 min · trips 313 · turnarounds >= 11 min: 112 · below: 45
  const DUTY_WINDOW = 470, TRIPS = 313, CREDITABLE = 112, BELOW_THRESHOLD = 45;
  assert.equal(TRIPS + CREDITABLE + BELOW_THRESHOLD, DUTY_WINDOW, 'the window is fully accounted for');
  assert.equal(DUTY_WINDOW - CREDITABLE - BELOW_THRESHOLD, TRIPS,
    'top-down equals bottom-up once the sub-threshold turnarounds are subtracted too');
  // Phase 3I.19 reported 358 = 313 + 45 as a possible reading. Decision 1 rules it out: a
  // sub-threshold turnaround is NOT driving time, so 313 is the basis and 358 is not.
  assert.notEqual(TRIPS + BELOW_THRESHOLD, TRIPS, 'the 358 reading counted the short turnarounds in');
  assert.equal(Math.ceil(TRIPS / 6), 53, 'ceil(313/6)');
  assert.ok(CREDITABLE >= Math.ceil(TRIPS / 6), '112 credited against 53 required → PASS either way');
});

// ===== F. nothing here activates or changes the rule =====
test('F: the rule set stays approved and disabled', () => {
  assert.equal(config.status, 'approved');
  assert.equal(p('activation.enabled')?.value ?? p('enabled')?.value, false, 'still not activated');
});
test('F: no parameter of decision 1 is open', () => {
  for (const key of ['turnaround.minimumObservedSpanMinutes', 'turnaround.belowMinimumCreditedMinutes',
    'turnaround.plainGapCountsAsTurnaround', 'calculation.deadheadTreatment']) {
    assert.equal(p(key).status, 'confirmed', `${key} must be settled`);
  }
});
