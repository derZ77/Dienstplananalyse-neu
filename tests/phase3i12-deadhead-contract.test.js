import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.12 – decision C: deadhead runs count IN FULL as driving time of the 1/6 basis. No
// weighting, no removal. This file pins the contract AND the behaviour the rule already shows,
// including the consequence a deadhead segment has for the line-18 exception.
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';
import { evaluateOneSixthRule, evaluateOneSixthEligibility } from '../js/v2/analysis/one-sixth-rule.js';

const CONFIG = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const leaf = (node) => node?.value;

const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const segment = (kind, line, duration, index) => ({
  serviceNumber: '2101', kind, line,
  startMinutes: index * 600, endMinutes: index * 600 + duration, durationMinutes: duration,
  source: { sourceType: 'pdf' }
});
const projection = (segments) => ({
  metadata: { serviceRegime: 'school', dayType: 'saturday', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100', drivingSegments: segments,
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: segments.reduce((t, s) => t + s.durationMinutes, 0), nonDrivingMinutes: 0, knownTotalMinutes: 0 },
    warnings: []
  }],
  warnings: []
});
const detection = { status: 'complete', candidates: [], warnings: [], statistics: { candidateCount: 0 } };
const run = (segments, eligibility) => evaluateOneSixthRule({
  drivingProjection: projection(segments), turnaroundDetection: detection,
  ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility
});
const ELIGIBILITY = { dutyStartMinutes: null, serviceStarts: {} };

// ===== the projection treats a deadhead run as driving time =====
test('the driving projection classifies a deadhead run as a driving segment', () => {
  const timeline = {
    metadata: { serviceRegime: 'school', dayType: 'saturday' },
    circulations: [{
      code: '11100', segments: [
        { serviceNumber: '2101', kind: 'deadhead', line: null, departure: '05:00', arrival: '05:30', dayOffset: 0, durationMinutes: 30, source: { sourceType: 'pdf' } },
        { serviceNumber: '2101', kind: 'service', line: '12', departure: '05:30', arrival: '12:06', dayOffset: 0, durationMinutes: 396, source: { sourceType: 'pdf' } }
      ]
    }]
  };
  const projected = createDrivingProjection({ jointTimeline: timeline });
  const kinds = projected.circulations[0].drivingSegments.map(s => s.kind);
  assert.deepEqual(kinds, ['deadhead', 'service'], 'the deadhead run is not dropped');
  assert.equal(projected.circulations[0].statistics.drivingMinutes, 426, '30 + 396 — in full');
});

// ===== the quota basis contains the deadhead minutes in full =====
test('a deadhead run counts in full towards the driving minutes', () => {
  const s = run([segment('deadhead', '12', 30, 0), segment('service', '12', 396, 1)], ELIGIBILITY).services[0];
  assert.equal(s.drivingMinutes, 426, '30 + 396, no weighting');
  assert.equal(s.requiredMinutes, 71, 'ceil(426/6) = 71 — the deadhead run raises the requirement');
});
test('the same holds without an eligibility input', () => {
  const s = run([segment('deadhead', '12', 30, 0), segment('service', '12', 396, 1)]).services[0];
  assert.equal(s.drivingMinutes, 426);
  assert.equal(s.requiredMinutes, 71);
});
test('deadhead minutes are never removed or discounted', () => {
  const withDeadhead = run([segment('deadhead', '12', 60, 0), segment('service', '12', 396, 1)]).services[0];
  const withoutDeadhead = run([segment('service', '12', 396, 0)]).services[0];
  assert.equal(withDeadhead.drivingMinutes - withoutDeadhead.drivingMinutes, 60, 'the full duration, not a fraction');
});
test('several deadhead runs all count', () => {
  const s = run([segment('deadhead', '12', 30, 0), segment('service', '12', 396, 1), segment('deadhead', '12', 24, 2)]).services[0];
  assert.equal(s.drivingMinutes, 450);
  assert.equal(s.requiredMinutes, 75, 'ceil(450/6)');
});
test('an unknown deadhead duration still makes the basis unknown', () => {
  const s = run([{ ...segment('deadhead', '12', 0, 0), durationMinutes: null, endMinutes: null }, segment('service', '12', 396, 1)]).services[0];
  assert.equal(s.status, 'INCONCLUSIVE', 'a driving segment without a duration is never assumed to be 0');
  assert.equal(s.drivingMinutes, null);
});
// SUPERSEDED BY PHASE 3I.15b: line 18 ADMITS a duty; it removes nothing from the calculation.
test('a deadhead run on line 18 counts like any other driving segment', () => {
  const s = run([segment('deadhead', '18', 30, 0), segment('service', '12', 396, 1)], ELIGIBILITY).services[0];
  assert.equal(s.drivingMinutes, 426, '30 + 396 — no line reduces the basis');
  assert.ok(!('exceptedDrivingMinutes' in s));
});

// ===== the contract =====
test('the deadhead treatment is confirmed in the versioned rule set', () => {
  const parameter = CONFIG.parameters.calculation.deadheadTreatment;
  assert.equal(leaf(parameter), 'counts_as_driving_time');
  assert.equal(parameter.status, 'confirmed', 'no longer provisional after Phase 3I.12');
});
test('no parameter of the rule set is provisional any more', () => {
  const provisional = [];
  for (const [group, entries] of Object.entries(CONFIG.parameters)) {
    if (group === 'openParameters') continue;
    for (const [name, node] of Object.entries(entries)) {
      if (node && typeof node === 'object' && 'status' in node && node.status !== 'confirmed') provisional.push(`${group}.${name}`);
    }
  }
  assert.deepEqual(provisional, []);
  assert.deepEqual(leaf(CONFIG.parameters.openParameters), []);
});

// ===== the consequence this decision makes visible =====
// SUPERSEDED BY PHASE 3I.13: the consequence recorded here was resolved by the user's decision —
// a deadhead run without a line is REGULAR, not undecidable. What must stay protected is that a
// real line trip without a line is still undecidable; that half is asserted below.
test('CLOSED BY PHASE 3I.13: a deadhead run without a line no longer blocks the decision', () => {
  const verdict = evaluateOneSixthEligibility({
    drivingProjection: projection([segment('deadhead', null, 30, 0), segment('service', '12', 396, 1)]),
    ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: ELIGIBILITY
  });
  assert.equal(verdict.status, 'PASS', 'the missing line of a deadhead run is not a gap');
  assert.deepEqual(verdict.warnings, []);
  const r = run([segment('deadhead', null, 30, 0), segment('service', '12', 396, 1)], ELIGIBILITY);
  assert.equal(r.services[0].drivingMinutes, 426, 'the deadhead run counts in full');
  assert.deepEqual(r.violations.length > 0 ? r.violations.map(v => v.circulationCode) : [], ['11100']);

  // The protected half: a SERVICE trip without a line stays undecidable WHERE THE LINE DECIDES —
  // that is Monday to Friday, where only a night shift or a pure line-18 duty is admitted. On a
  // weekend the day type admits every duty, so an unknown line changes nothing any more
  // (SUPERSEDED BY PHASE 3I.15b: the line no longer removes anything from the calculation).
  const weekday = { ...projection([segment('service', null, 30, 0), segment('service', '12', 396, 1)]) };
  weekday.metadata = { ...weekday.metadata, dayType: 'mo_fr' };
  const unlinedService = evaluateOneSixthEligibility({
    drivingProjection: weekday, ruleConfig: RULE_CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: 5 * 60, serviceStarts: {} }
  });
  assert.equal(unlinedService.status, 'INCONCLUSIVE');
  assert.ok(unlinedService.warnings.some(w => w.code === 'SEGMENT_LINE_AMBIGUOUS'));
});
test('the duty-kind classification confirms a deadhead run can never carry a line', () => {
  const hardening = readFileSync(new URL('../js/v2/pdf/jnv-schedule-hardening.js', import.meta.url), 'utf8');
  // A circuit code or a known route identity always wins and yields a service drive; only their
  // absence can produce a depot duty.
  assert.match(hardening, /if \(circuit \|\| routeKnown\)/);
  assert.match(hardening, /DUTY_KINDS\.DEPOT_DUTY/);
});
