import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.9 – the night-shift filter. Basis is the DUTY START TIME, the 19:20 threshold is
// INCLUSIVE, and nothing may be inferred from a first trip, a line, a vehicle or a file name.
import { evaluateOneSixthEligibility, ELIGIBILITY_STATUS } from '../js/v2/analysis/one-sixth-rule.js';

const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((n, k) => n?.[k], config.parameters);

// The productive rule config shape (as the orchestrator builds it), extended with the eligibility
// parameters the closed contract defines.
const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: p('eligibility.allowedDayTypes').value,
  nightShiftIsException: p('eligibility.nightShiftIsException').value,
  nightShiftStart: p('eligibility.nightShiftStart').value,
  nightShiftStartInclusive: p('eligibility.nightShiftStartInclusive').value,
  nightShiftStartBasis: p('eligibility.nightShiftStartBasis').value,
  admissionLines: p('eligibility.admissionLines').value,
  admissionLineRequiresPureDuty: p('eligibility.admissionLineRequiresPureDuty').value
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

// SUPERSEDED BY PHASE 3I.15b: a line trip without a line is undecidable, so the fixture states one.
const projection = (dayType, segments = [{ durationMinutes: 396, line: '12' }]) => ({
  metadata: { serviceRegime: 'school', dayType, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: segments.map((s, i) => ({ serviceNumber: '2101', kind: 'service', startMinutes: i * 10, endMinutes: i * 10 + (s.durationMinutes ?? 10), durationMinutes: s.durationMinutes ?? 10, line: s.line, source: { serviceNumber: '2101', activityIndex: i, sourceType: 'pdf' } })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 396, nonDrivingMinutes: 0, knownTotalMinutes: 396 }, warnings: []
  }],
  warnings: []
});
const check = (dayType, eligibility) => evaluateOneSixthEligibility({
  drivingProjection: projection(dayType), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility
});
// a weekday duty is only eligible through the night-shift exception
const onWeekday = (dutyStartMinutes) => check('mo_fr', { dutyStartMinutes });

test('the eligibility vocabulary is exactly PASS, NOT_APPLICABLE and INCONCLUSIVE', () => {
  assert.deepEqual(Object.values(ELIGIBILITY_STATUS).sort(), ['INCONCLUSIVE', 'NOT_APPLICABLE', 'PASS']);
});

// ===== the inclusive boundary =====
test('a duty starting at 19:19 does not reach the night shift', () => {
  const r = onWeekday(19 * 60 + 19);
  assert.equal(r.nightShift, false);
  assert.equal(r.status, ELIGIBILITY_STATUS.NOT_APPLICABLE, 'weekday without the exception');
});
test('a duty starting exactly at 19:20 is a night shift', () => {
  const r = onWeekday(19 * 60 + 20);
  assert.equal(r.nightShift, true);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS, 'the exception makes the weekday duty eligible');
});
test('a duty starting at 19:21 is a night shift', () => {
  const r = onWeekday(19 * 60 + 21);
  assert.equal(r.nightShift, true);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS);
});
test('a duty starting after midnight is compared through its day offset, not wrapped', () => {
  assert.equal(onWeekday(30).nightShift, false, '00:30 of the same day is before 19:20');
  assert.equal(onWeekday(1440 + 30).nightShift, true, '00:30 of the next day is after 19:20');
});
test('the threshold comes from the configuration, not from a literal in the code', () => {
  const shifted = { ...RULE_CONFIG, nightShiftStart: '20:00' };
  const r = evaluateOneSixthEligibility({ drivingProjection: projection('mo_fr'), ruleConfig: shifted, context: CONTEXT, eligibility: { dutyStartMinutes: 19 * 60 + 30 } });
  assert.equal(r.nightShift, false, '19:30 is before a configured 20:00 threshold');
});
test('an exclusive configuration would put 19:20 outside the night shift', () => {
  const exclusive = { ...RULE_CONFIG, nightShiftStartInclusive: false };
  const r = evaluateOneSixthEligibility({ drivingProjection: projection('mo_fr'), ruleConfig: exclusive, context: CONTEXT, eligibility: { dutyStartMinutes: 19 * 60 + 20 } });
  assert.equal(r.nightShift, false, 'the inclusive flag is honoured, not hard-coded');
});

// ===== unknown duty start =====
test('an unknown duty start on a non-eligible day type is inconclusive, never a verdict', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, '19:20']) {
    const r = check('mo_fr', { dutyStartMinutes: value });
    assert.equal(r.status, ELIGIBILITY_STATUS.INCONCLUSIVE, `duty start ${String(value)}`);
    assert.equal(r.nightShift, null, 'the night shift stays undecided');
  }
});
test('an unknown duty start on an eligible day type does not matter', () => {
  const r = check('saturday', { dutyStartMinutes: null });
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS, 'Saturday is eligible on its own');
});

// ===== no heuristics =====
test('the night shift is never derived from the first trip, a line or a vehicle', () => {
  // the driving segments start at 00:00 in this fixture; that must not become a duty start
  const r = check('mo_fr', {});
  assert.equal(r.nightShift, null, 'no duty start supplied means no night-shift claim');
  assert.equal(r.status, ELIGIBILITY_STATUS.INCONCLUSIVE);
});
test('the rule module contains no first-trip, file-name or vehicle heuristic', () => {
  const src = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /firstTrip|first_trip|fileName|sourceName|vehicleType|\.vehicle\b/);
  assert.doesNotMatch(src, /19:20|1160/, 'the threshold is configuration, never a literal');
});
test('the night-shift exception can be switched off by configuration', () => {
  const off = { ...RULE_CONFIG, nightShiftIsException: false };
  const r = evaluateOneSixthEligibility({ drivingProjection: projection('mo_fr'), ruleConfig: off, context: CONTEXT, eligibility: { dutyStartMinutes: 20 * 60 } });
  assert.equal(r.status, ELIGIBILITY_STATUS.NOT_APPLICABLE, 'without the exception a weekday stays out of scope');
});
