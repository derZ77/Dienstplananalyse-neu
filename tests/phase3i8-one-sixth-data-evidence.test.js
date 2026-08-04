import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.8 – the DATA side of the parameter closure: the fields each closed parameter relies on
// exist in the productive contracts, and the resulting rules are boundary-exact and computable
// without new product code. These are contract/evidence tests — they add no rule implementation.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';
import { CANDIDATE_STATUSES } from '../js/v2/rules/one-sixth-candidate-contract.js';
import { DEFAULT_TURNAROUND_CREDITING } from '../js/v2/rules/one-sixth-turnaround-candidates.js';

const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((node, key) => node?.[key], config.parameters);

// The night-shift rule expressed exactly as the closed contract defines it — duty start time,
// threshold 19:20, inclusive. Computed from the CONFIG, so a later contract change breaks this test.
const thresholdMinutes = (() => {
  const [h, m] = String(p('eligibility.nightShiftStart').value).split(':').map(Number);
  return h * 60 + m;
})();
const isNightShift = (dutyStartMinutes) => {
  if (!Number.isFinite(dutyStartMinutes)) return null;              // unknown → no yes/no
  return p('eligibility.nightShiftStartInclusive').value
    ? dutyStartMinutes >= thresholdMinutes
    : dutyStartMinutes > thresholdMinutes;
};

// ===== nightShiftStartBasis =====
test('the threshold resolves to 19:20 in minutes', () => {
  assert.equal(thresholdMinutes, 19 * 60 + 20);
  assert.equal(thresholdMinutes, 1160);
});
test('a duty starting at 19:19 is not a night shift', () => {
  assert.equal(isNightShift(19 * 60 + 19), false);
});
test('a duty starting exactly at 19:20 is a night shift', () => {
  assert.equal(isNightShift(19 * 60 + 20), true);
});
test('a duty starting at 19:21 is a night shift', () => {
  assert.equal(isNightShift(19 * 60 + 21), true);
});
test('a missing duty start is never automatically classified either way', () => {
  assert.equal(isNightShift(null), null);
  assert.equal(isNightShift(undefined), null);
  assert.equal(isNightShift(NaN), null);
});
test('a duty crossing midnight keeps a comparable start value via the existing day offset', () => {
  // the hardening contract carries dayOffset + relativeMinutes; a start after midnight is day 1
  const afterMidnight = 30;                                          // 00:30 on the following day
  assert.equal(isNightShift(afterMidnight), false, 'a 00:30 start is not >= 19:20 of the same day');
  assert.equal(isNightShift(afterMidnight + 1440), true, 'the day offset keeps it comparable');
});
test('the productive schedule contract really carries an integer duty start', () => {
  const builder = readFileSync(new URL('../js/v2/pdf/canonical-schedule-builder.js', import.meta.url), 'utf8');
  assert.match(builder, /begin:\s*normalizeClockTime\(service\.begin\)/, 'the duty start is normalized');
  assert.match(builder, /minutesSinceStartOfDay:\s*hours\s*\*\s*60\s*\+\s*minutes/, 'integer minutes, no rounding');
  const hardening = readFileSync(new URL('../js/v2/pdf/jnv-schedule-hardening.js', import.meta.url), 'utf8');
  assert.match(hardening, /begin:\s*\{\s*\.\.\.service\.begin,\s*dayOffset/, 'the hardened duty start keeps a day offset');
});

// ===== paidTimeComparisonTolerance =====
const tolerance = p('fallbackIndicators.paidTimeComparisonTolerance').value;
const paidEqualsDuty = (paidMinutes, dutySpanMinutes) => Math.abs(paidMinutes - dutySpanMinutes) <= tolerance;
test('the paid-time indicator fires only on exact equality', () => {
  assert.equal(tolerance, 0);
  assert.equal(paidEqualsDuty(480, 480), true);
  assert.equal(paidEqualsDuty(481, 480), false, 'one minute more is not equal');
  assert.equal(paidEqualsDuty(479, 480), false, 'one minute less is not equal');
  assert.equal(paidEqualsDuty(475, 480), false);
});
test('the productive contract really delivers integer paid minutes', () => {
  const builder = readFileSync(new URL('../js/v2/pdf/canonical-schedule-builder.js', import.meta.url), 'utf8');
  assert.match(builder, /paidTime:\s*normalizeDuration\(service\.paidTime\)/);
  assert.match(builder, /minutes:\s*hours\s*\*\s*60\s*\+\s*minutes/, 'integer minutes, no float, no rounding');
  // existing productive consumers already rely on the integer shape
  const core = readFileSync(new URL('../js/v2/analysis/analysis-core.js', import.meta.url), 'utf8');
  assert.match(core, /Number\.isInteger\(service\.paidTime\?\.minutes\)/);
});
test('the equality indicator is only relevant without a circulation document', () => {
  assert.equal(p('blockBreakRelationshipScopeCheck') ?? undefined, undefined, 'no extra scope parameter was invented');
  assert.equal(p('turnaround.blockBreakRelationship').value, 'candidate_evidence_only_without_umlauftafel');
  assert.deepEqual(p('dataStrategy.sourcePriority').value, ['umlauftafel', 'schedule_structured', 'schedule_fallback']);
});

// ===== blockBreakRelationship =====
test('an indicator can only ever produce a candidate status, never a verdict', () => {
  assert.equal(p('fallbackIndicators.indicatorMayProduceVerdict').value, false);
  assert.ok(CANDIDATE_STATUSES.includes(p('fallbackIndicators.candidateStatusOnIndicator').value));
  assert.ok(CANDIDATE_STATUSES.includes(p('fallbackIndicators.unprovableAbsenceResult').value));
  assert.ok(!CANDIDATE_STATUSES.includes('PASS') && !CANDIDATE_STATUSES.includes('FAIL'));
});
test('an unprovable block-break absence stays inconclusive', () => {
  assert.equal(p('fallbackIndicators.unprovableAbsenceResult').value, 'inconclusive');
  assert.equal(p('fallbackIndicators.indicatorMayInventTurnaround').value, false);
});
test('a present circulation document always wins and is never double counted', () => {
  assert.equal(p('dataStrategy.umlauftafelIsPrimary').value, true);
  assert.equal(p('dataStrategy.scheduleMayNotOverrideUmlauftafel').value, true);
  assert.equal(p('dataStrategy.doubleCountingForbidden').value, true);
  // the existing detector still consults the circulation document first
  const detector = readFileSync(new URL('../js/v2/rules/one-sixth-turnaround-candidates.js', import.meta.url), 'utf8');
  assert.match(detector, /if \(umlauftafelUsable\) return detectFromUmlauftafel/);
  assert.match(detector, /FALLBACK_DATA_INSUFFICIENT/, 'the schedule fallback still refuses to guess');
});
test('the crediting minimum the detector defaults to still matches the contract', () => {
  assert.equal(DEFAULT_TURNAROUND_CREDITING.minimumObservedSpanMinutes, p('turnaround.minimumObservedSpanMinutes').value);
  assert.equal(DEFAULT_TURNAROUND_CREDITING.belowMinimumCreditedMinutes, p('turnaround.belowMinimumCreditedMinutes').value);
});

// ===== mixedModeHandling — verified against the REAL, unchanged rule module =====
const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false
};
const projection = () => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: [{ serviceNumber: '2101', kind: 'service', startMinutes: 0, endMinutes: 396, durationMinutes: 396, source: { serviceNumber: '2101', activityIndex: 0, sourceType: 'pdf' } }],
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
const evaluate = (mode) => evaluateOneSixthRule({
  drivingProjection: projection(), turnaroundDetection: detection(), ruleConfig: CONFIG,
  context: { organization: 'JNV', mode }
});

test('a bus duty is evaluated under the rule', () => {
  assert.equal(evaluate('bus').status, 'PASS');
});
test('a tram duty is evaluated under the very same rule, with the same result', () => {
  const bus = evaluate('bus');
  const tram = evaluate('tram');
  assert.equal(tram.status, 'PASS');
  assert.equal(tram.services[0].requiredMinutes, bus.services[0].requiredMinutes, 'identical formula');
  assert.equal(tram.services[0].creditedMinutes, bus.services[0].creditedMinutes, 'identical crediting');
  assert.deepEqual(tram.statistics, bus.statistics, 'no mode-specific behaviour');
});
test('an unknown or missing mode is never guessed by a heuristic', () => {
  for (const mode of [null, undefined, '', 'unknown', 'train']) {
    const result = evaluate(mode);
    assert.equal(result.status, 'NOT_APPLICABLE', `mode ${String(mode)} must not be classified`);
    assert.ok(result.warnings.some(w => w.code === 'UNSUPPORTED_MODE' || w.code === 'NOT_JNV'));
    assert.deepEqual(result.violations, []);
  }
});
test('no combined-driver evidence is required for either mode', () => {
  assert.equal(p('scope.combinedDriverRequirement').value, 'not_required');
  assert.equal(p('scope.combinedDriverEvidence') ?? undefined, undefined);
  const rule = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');
  assert.doesNotMatch(rule, /combinedDriver|kombifahrer/i, 'the rule needs no such attribute');
});

// ===== the open parameters must not be silently implemented =====
// SUPERSEDED BY PHASE 3I.9: the decided scope is now implemented in the rule module. What must
// still hold is that the line number itself never appears as a literal (it comes from the
// configuration) and that neither the detector nor the orchestrator carries scope logic.
test('the line-18 scope lives only in the rule module, driven by configuration', () => {
  const rule = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');
  assert.match(rule, /admissionLines/, 'implemented since Phase 3I.9, renamed in Phase 3I.15b');
  assert.doesNotMatch(rule, /'18'|"18"/, 'the exception line is never hard-coded');
  // SUPERSEDED BY PHASE 3I.10b: the orchestrator mirrors the productive exception-line PARAMETERS
  // (values only). Scope LOGIC must still live solely in the rule module.
  const detector = readFileSync(new URL('../js/v2/rules/one-sixth-turnaround-candidates.js', import.meta.url), 'utf8');
  assert.doesNotMatch(detector, /admissionLine|exceptionLine|'18'|"18"/, 'the detector stays free of admission logic');
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  assert.doesNotMatch(orchestrator, /exceptedSegment|classifyTurnaround|evaluateOneSixthEligibility/, 'the orchestrator applies no scope logic');
});
