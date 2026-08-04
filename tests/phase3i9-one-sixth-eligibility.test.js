import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.9 – the eligibility chain in front of the quota evaluation: organisation → mode →
// day type → night shift → line-18 exception → segment-based exceptions → only then the quota.
// The chain yields PASS, NOT_APPLICABLE or INCONCLUSIVE and never changes the quota arithmetic.
import { evaluateOneSixthEligibility, evaluateOneSixthRule, ELIGIBILITY_STATUS } from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthEligibility } from '../js/v2/analysis/one-sixth-validation.js';

const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((n, k) => n?.[k], config.parameters);
const src = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');

const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: p('eligibility.allowedDayTypes').value,
  nightShiftIsException: p('eligibility.nightShiftIsException').value,
  nightShiftStart: p('eligibility.nightShiftStart').value,
  nightShiftStartInclusive: p('eligibility.nightShiftStartInclusive').value,
  admissionLines: p('eligibility.admissionLines').value,
  admissionLineRequiresPureDuty: p('eligibility.admissionLineRequiresPureDuty').value
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

// NB: `dayType` is spread in explicitly (no default) so a test can pass an absent or empty value.
const projection = (dayType, lines = ['12']) => ({
  metadata: { serviceRegime: 'school', dayType, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: lines.map((line, i) => {
      const s = { serviceNumber: '2101', kind: 'service', startMinutes: i * 60, endMinutes: i * 60 + 396, durationMinutes: 396, source: { serviceNumber: '2101', activityIndex: i, sourceType: 'pdf' } };
      if (line !== undefined) s.line = line;
      return s;
    }),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 396, nonDrivingMinutes: 0, knownTotalMinutes: 396 }, warnings: []
  }],
  warnings: []
});
const detection = () => ({ status: 'complete', candidates: [{
  id: 'c#1', circulationCode: '11100', previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip' }, startMinutes: 360, endMinutes: 426,
  observedSpanMinutes: 66, creditedMinutes: 66, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
}], warnings: [], statistics: { candidateCount: 1, qualifiedCount: 1, belowMinimumCount: 0, unresolvedCount: 0 } });
const eligibilityOf = (over = {}) => evaluateOneSixthEligibility({
  drivingProjection: over.drivingProjection ?? projection('saturday'), ruleConfig: over.ruleConfig ?? RULE_CONFIG,
  context: over.context ?? CONTEXT, eligibility: over.eligibility ?? {}
});

// ===== result vocabulary =====
test('the eligibility result carries only the three permitted statuses', () => {
  assert.deepEqual(Object.values(ELIGIBILITY_STATUS).sort(), ['INCONCLUSIVE', 'NOT_APPLICABLE', 'PASS']);
  for (const r of [eligibilityOf(), eligibilityOf({ context: { organization: 'JES', mode: 'bus' } }), eligibilityOf({ drivingProjection: projection('unknown') })]) {
    assert.ok(Object.values(ELIGIBILITY_STATUS).includes(r.status));
    assert.ok(!['FAIL', 'DISABLED'].includes(r.status), 'the chain never produces a compliance verdict');
  }
});

// ===== step 1: organisation =====
test('a non-JNV organisation is not applicable and stops the chain', () => {
  const r = eligibilityOf({ context: { organization: 'JES', mode: 'bus' } });
  assert.equal(r.status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
  assert.equal(r.reason, 'NOT_JNV');
  assert.equal(r.dayType, null, 'no later step ran');
});
test('a missing organisation is not applicable', () => {
  assert.equal(eligibilityOf({ context: { mode: 'bus' } }).reason, 'NOT_JNV');
});

// ===== step 2: mode =====
test('an unsupported mode is not applicable and stops before the day type', () => {
  const r = eligibilityOf({ context: { organization: 'JNV', mode: 'train' } });
  assert.equal(r.status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
  assert.equal(r.reason, 'UNSUPPORTED_MODE');
  assert.equal(r.dayType, null);
});
test('bus and tram both pass the mode step identically', () => {
  for (const mode of ['bus', 'tram']) {
    const r = eligibilityOf({ context: { organization: 'JNV', mode } });
    assert.equal(r.status, ELIGIBILITY_STATUS.PASS, mode);
    assert.equal(r.mode, mode);
  }
  const bus = eligibilityOf({ context: { organization: 'JNV', mode: 'bus' } });
  const tram = eligibilityOf({ context: { organization: 'JNV', mode: 'tram' } });
  assert.deepEqual({ ...bus, mode: null }, { ...tram, mode: null }, 'no mode-specific behaviour');
});

// ===== step 3: day type =====
test('an allowed weekend day type passes', () => {
  for (const dayType of ['saturday', 'sunday', 'holidays']) {
    const r = eligibilityOf({ drivingProjection: projection(dayType) });
    assert.equal(r.status, ELIGIBILITY_STATUS.PASS, dayType);
  }
});
test('a weekday without the night-shift exception is not applicable', () => {
  const r = eligibilityOf({ drivingProjection: projection('mo_fr'), eligibility: { dutyStartMinutes: 8 * 60 } });
  assert.equal(r.status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
  assert.equal(r.reason, 'NOT_ELIGIBLE');   // SUPERSEDED BY PHASE 3I.15b: admission-ground vocabulary
});
test('an unknown day type is inconclusive, never assumed', () => {
  for (const dayType of ['unknown', undefined, '']) {
    const r = eligibilityOf({ drivingProjection: projection(dayType) });
    assert.equal(r.status, ELIGIBILITY_STATUS.INCONCLUSIVE, String(dayType));
    assert.equal(r.reason, 'DAY_TYPE_UNKNOWN');
  }
});
test('the day type comes from the existing metadata only', () => {
  assert.doesNotMatch(src, /getDay\(|toISOString|Date\.parse|new Date|fileName|calendar/i,
    'no calendar, no date and no file name is consulted');
});
test('the allowed day types come from the configuration', () => {
  const widened = { ...RULE_CONFIG, allowedDayTypes: ['MON_FRI', 'SATURDAY', 'SUNDAY_HOLIDAY'] };
  const r = eligibilityOf({ drivingProjection: projection('mo_fr'), ruleConfig: widened });
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS, 'a widened configuration admits weekdays');
});

// ===== step order =====
test('the chain stops at the first decisive step, in the mandated order', () => {
  // organisation beats mode, mode beats day type, day type beats the segment inspection
  assert.equal(eligibilityOf({ context: { organization: 'JES', mode: 'train' } }).reason, 'NOT_JNV');
  assert.equal(eligibilityOf({ context: { organization: 'JNV', mode: 'train' }, drivingProjection: projection('unknown') }).reason, 'UNSUPPORTED_MODE');
  const dayTypeFirst = eligibilityOf({ drivingProjection: projection('unknown', ['18', undefined]) });
  assert.equal(dayTypeFirst.reason, 'DAY_TYPE_UNKNOWN', 'the day type is decided before the segments');
  assert.deepEqual(dayTypeFirst.circulations, [], 'no segment inspection happened');
});
test('the documented step order is recorded on the result', () => {
  // SUPERSEDED BY PHASE 3I.27: `blockBreak` is the first UNIT step — a duty with a block break is
  // decided before any other question about it is asked.
  assert.deepEqual(eligibilityOf().steps, ['organization', 'mode', 'blockBreak', 'dayType', 'nightShift', 'admissionLine', 'segments']);
});

// ===== the chain never touches the quota =====
test('the eligibility chain performs no quota arithmetic', () => {
  const r = eligibilityOf();
  for (const key of ['requiredMinutes', 'creditedMinutes', 'deficitMinutes', 'violations']) {
    assert.equal(r[key], undefined, `${key} is not part of the eligibility result`);
  }
});
test('the quota rule behaves exactly as before when no eligibility input is supplied', () => {
  const withoutEligibility = evaluateOneSixthRule({ drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: RULE_CONFIG, context: CONTEXT });
  assert.equal(withoutEligibility.status, 'PASS', 'no eligibility input means the previous behaviour is preserved');
  assert.equal(withoutEligibility.services[0].requiredMinutes, 66);
});
test('an ineligible duty short-circuits before the quota is computed', () => {
  const r = evaluateOneSixthRule({ drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: 8 * 60 } });
  // SUPERSEDED BY PHASE 3I.24: the unit keeps its own NOT_APPLICABLE instead of vanishing.
  // What still must hold: no quota is computed for it and no violation is raised.
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.equal(r.services.length, 1);
  assert.equal(r.services[0].status, 'NOT_APPLICABLE');
  assert.equal(r.services[0].requiredMinutes, null, 'no quota evaluation happened');
  assert.deepEqual(r.violations, []);
  assert.ok(r.warnings.some(w => w.code === 'DAY_TYPE_NOT_ELIGIBLE'));
});
test('an inconclusive eligibility short-circuits without a verdict', () => {
  const r = evaluateOneSixthRule({ drivingProjection: projection('unknown'), turnaroundDetection: detection(), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: {} });
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.services, []);
});
test('an eligible duty still runs the unchanged quota evaluation', () => {
  const r = evaluateOneSixthRule({ drivingProjection: projection('saturday'), turnaroundDetection: detection(), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: {} });
  assert.equal(r.status, 'PASS');
  assert.equal(r.services[0].requiredMinutes, 66, 'ceil(396/6) unchanged');
  assert.equal(r.services[0].creditedMinutes, 66);
});
test('a night-shift weekday duty reaches the quota evaluation through the exception', () => {
  const r = evaluateOneSixthRule({ drivingProjection: projection('mo_fr'), turnaroundDetection: detection(), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: 19 * 60 + 20 } });
  assert.equal(r.status, 'PASS');
  assert.equal(r.services[0].requiredMinutes, 66);
});

// ===== purity and determinism =====
test('the eligibility evaluation is deterministic and mutates nothing', () => {
  const input = { drivingProjection: projection('saturday', ['18', '12']), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: 400 } };
  const snapshot = JSON.stringify(input);
  const a = evaluateOneSixthEligibility(input);
  const b = evaluateOneSixthEligibility(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot);
});

// ===== validator =====
test('the validator accepts a well-formed eligibility result', () => {
  for (const r of [eligibilityOf(), eligibilityOf({ drivingProjection: projection('unknown') }), eligibilityOf({ context: { organization: 'JES', mode: 'bus' } })]) {
    const v = validateOneSixthEligibility(r);
    assert.equal(v.valid, true, JSON.stringify(v.errors));
  }
});
test('the validator rejects a verdict status', () => {
  for (const status of ['PASS_WITH_VIOLATION', 'FAIL', 'DISABLED']) {
    assert.equal(validateOneSixthEligibility({ ...eligibilityOf(), status }).valid, false, status);
  }
});
test('the validator rejects an excepted count that exceeds the segment count', () => {
  const base = eligibilityOf({ drivingProjection: projection('saturday', ['18', '12']) });
  const broken = { ...base, circulations: [{ ...base.circulations[0], exceptedSegmentCount: 99 }] };
  assert.equal(validateOneSixthEligibility(broken).valid, false);
});
// SUPERSEDED BY PHASE 3I.15b: a pure line-18 duty must be ADMITTED — dismissing it is the error
// the real end-to-end test exposed. The guard became stricter, not weaker.
test('the validator rejects a not-applicable verdict on a pure line-18 duty', () => {
  const base = eligibilityOf({ drivingProjection: projection('saturday', ['18']) });
  const broken = { ...base, circulations: [{ ...base.circulations[0], status: 'NOT_APPLICABLE' }] };
  assert.equal(validateOneSixthEligibility(broken).valid, false, 'a pure line-18 duty may never be dismissed');
});
test('the validator rejects a missing reason on a non-passing result', () => {
  const base = eligibilityOf({ context: { organization: 'JES', mode: 'bus' } });
  assert.equal(validateOneSixthEligibility({ ...base, reason: null }).valid, false);
});

// ===== no activation, no configuration change =====
test('this phase activates nothing', () => {
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false);
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  assert.equal([...orchestrator.matchAll(/enabled:\s*true/g)].length, 1, 'still only BV008');
});
test('the rule module still owns no storage, network or document access', () => {
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest|WebSocket|FileReader|arrayBuffer|\/Users\/|\/Volumes\//);
});
