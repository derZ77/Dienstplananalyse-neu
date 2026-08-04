import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.12 – the night-shift reading is settled: a night shift falls ADDITIONALLY under the
// 1/6 rule (decision A), and a weekend night shift is judged like any other weekend duty
// (decision B). Both were open in Phase 3I.11; here they become binding contract statements.
import { evaluateOneSixthEligibility } from '../js/v2/analysis/one-sixth-rule.js';
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

const CONFIG = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const leaf = (node) => node?.value;

const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: leaf(CONFIG.parameters.eligibility.allowedDayTypes),
  nightShiftIsException: leaf(CONFIG.parameters.eligibility.nightShiftIsException),
  nightShiftStart: leaf(CONFIG.parameters.eligibility.nightShiftStart),
  nightShiftStartInclusive: leaf(CONFIG.parameters.eligibility.nightShiftStartInclusive),
  exceptionLines: leaf(CONFIG.parameters.eligibility.exceptionLines),
  exceptionLineScope: leaf(CONFIG.parameters.eligibility.exceptionLineScope),
  mixedLineHandling: leaf(CONFIG.parameters.eligibility.mixedLineHandling)
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const projection = (dayType) => ({
  metadata: { serviceRegime: 'school', dayType, dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: [{ serviceNumber: '2101', kind: 'service', line: '12', startMinutes: 0, endMinutes: 396, durationMinutes: 396, source: { sourceType: 'pdf' } }],
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 396, nonDrivingMinutes: 0, knownTotalMinutes: 0 }, warnings: []
  }],
  warnings: []
});
const eligibility = (dayType, startMinutes) => evaluateOneSixthEligibility({
  drivingProjection: projection(dayType), ruleConfig: RULE_CONFIG, context: CONTEXT,
  eligibility: { dutyStartMinutes: null, serviceStarts: { 2101: startMinutes } }
});
const NIGHT = 19 * 60 + 20;
const DAY = 5 * 60;

// ===== decision A: a weekday night shift is covered by the rule =====
test('a Monday night shift falls under the 1/6 rule', () => {
  // The projection carries the day type of the plan, not a calendar date; `mo_fr` is the weekday
  // regime that covers Monday through Friday.
  const r = eligibility('mo_fr', NIGHT);
  assert.equal(r.status, 'PASS', 'a night shift is assessed, not excluded');
  assert.equal(r.nightShift, true);
});
test('a Friday night shift falls under the 1/6 rule', () => {
  const r = eligibility('friday', NIGHT);
  assert.equal(r.status, 'PASS');
  assert.equal(r.nightShift, true);
});
test('an ordinary weekday duty stays outside the rule', () => {
  const r = eligibility('mo_fr', DAY);
  assert.equal(r.status, 'NOT_APPLICABLE', 'weekend-only remains the base rule');
  assert.equal(r.nightShift, false);
});
test('the night-shift boundary stays inclusive at 19:20', () => {
  assert.equal(eligibility('mo_fr', NIGHT - 1).status, 'NOT_APPLICABLE', '19:19 is not a night shift');
  assert.equal(eligibility('mo_fr', NIGHT).status, 'PASS', '19:20 is a night shift');
  assert.equal(eligibility('mo_fr', NIGHT + 1).status, 'PASS');
});
test('an unknown duty start is never turned into a yes or a no', () => {
  const r = evaluateOneSixthEligibility({
    drivingProjection: projection('mo_fr'), ruleConfig: RULE_CONFIG, context: CONTEXT,
    eligibility: { dutyStartMinutes: null, serviceStarts: {} }
  });
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.equal(r.nightShift, null);
});

// ===== decision B: a weekend night shift is an ordinary weekend duty =====
test('a Saturday night shift is assessed exactly like any Saturday duty', () => {
  const night = eligibility('saturday', NIGHT);
  const day = eligibility('saturday', DAY);
  assert.equal(night.status, 'PASS');
  assert.equal(day.status, 'PASS');
  assert.equal(night.status, day.status, 'no special treatment on the weekend');
});
test('a Sunday night shift is assessed exactly like any Sunday duty', () => {
  assert.equal(eligibility('sunday', NIGHT).status, 'PASS');
  assert.equal(eligibility('sunday', DAY).status, 'PASS');
});
test('a holiday night shift follows the Sunday treatment', () => {
  assert.equal(eligibility('holidays', NIGHT).status, 'PASS');
  assert.equal(eligibility('holidays', DAY).status, 'PASS');
});
test('the night shift never removes a weekend duty from the rule', () => {
  for (const dayType of ['saturday', 'sunday', 'holidays']) {
    assert.notEqual(eligibility(dayType, NIGHT).status, 'NOT_APPLICABLE', `${dayType} night shift must stay in scope`);
  }
});

// ===== the contract itself =====
test('the night-shift parameters are confirmed in the versioned rule set', () => {
  const e = CONFIG.parameters.eligibility;
  for (const key of ['nightShiftIsException', 'nightShiftStart', 'nightShiftStartInclusive', 'nightShiftStartBasis']) {
    assert.equal(e[key].status, 'confirmed', `${key} must be confirmed`);
  }
  assert.equal(leaf(e.nightShiftIsException), true);
  assert.equal(leaf(e.nightShiftStart), '19:20');
  assert.equal(leaf(e.nightShiftStartInclusive), true);
});
test('the rule set records where the night-shift decision comes from', () => {
  assert.ok(CONFIG.sourceReferences.some(ref => /3I\.12/.test(ref)), 'the Phase 3I.12 decision is cited');
});
test('the productive default mirrors the confirmed night-shift values', () => {
  const e = CONFIG.parameters.eligibility;
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.nightShiftIsException, leaf(e.nightShiftIsException));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.nightShiftStart, leaf(e.nightShiftStart));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.nightShiftStartInclusive, leaf(e.nightShiftStartInclusive));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false, 'still not activated');
});
