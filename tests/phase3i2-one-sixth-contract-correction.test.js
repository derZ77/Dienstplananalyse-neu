import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.2 – the CORRECTED JNV 1/6 contract: organisation-based distance category, no combined
// driver requirement, Mon-Fri default day type, no 8-minute tariff reduction, and the binding
// planned-driving-time formula. Still contract only: no algorithm, no verdict.
import { validateRuleConfig } from '../js/v2/rules/config/rule-config-validator.js';

const raw = readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8');
const config = JSON.parse(raw);
const p = (path) => path.split('.').reduce((node, key) => node?.[key], config.parameters);

test('the corrected contract still validates and stays draft/disabled', () => {
  const result = validateRuleConfig(config);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false);
});

// ===== 2.1 distance =====
test('the stop distance is decided per organisation: JNV below 3000 m, JES above', () => {
  assert.equal(p('eligibility.stopDistanceStrategy').value, 'organization_default');
  assert.equal(p('eligibility.stopDistanceCategoryJnv').value, 'below_3000m');
  assert.equal(p('eligibility.stopDistanceCategoryJes').value, 'above_3000m');
});
test('no distance computation is required and no geo/duration heuristic is configured', () => {
  assert.equal(p('eligibility.stopDistanceComputationRequired').value, false);
  assert.doesNotMatch(raw, /geo|coordinate|latitude|longitude|haversine|travel_?time|from_?duration/i);
});

// ===== 2.2 combined driver =====
test('a combined-driver proof is NOT required any more', () => {
  assert.equal(p('scope.combinedDriverRequirement').value, 'not_required');
  assert.equal(p('scope.assessmentBasis').value, 'fahrpersonalverordnung');
  assert.equal(p('scope.combinedDriverEvidence'), undefined, 'the evidence parameter is gone');
  assert.doesNotMatch(raw, /requiresCombinedDriver/);
});
test('bus and tram both remain in scope, JNV only, JES excluded', () => {
  assert.deepEqual(p('scope.modes').value, ['bus', 'tram']);
  assert.deepEqual(p('scope.organizations').value, ['JNV']);
  assert.deepEqual(p('scope.excludedOrganizations').value, ['JES']);
});

// ===== 2.3 day type =====
test('the default day type is Monday-Friday with explicit Saturday and Sunday/holiday overrides', () => {
  assert.equal(p('eligibility.defaultDayType').value, 'MON_FRI');
  assert.equal(p('eligibility.explicitSaturdayLabelDayType').value, 'SATURDAY');
  assert.equal(p('eligibility.explicitSundayOrHolidayLabelDayType').value, 'SUNDAY_HOLIDAY');
  assert.deepEqual(p('eligibility.allowedDayTypes').value, ['SATURDAY', 'SUNDAY_HOLIDAY']);
  assert.equal(p('eligibility.dayTypeEvidence'), undefined, 'the day-type evidence question is resolved');
});

// ===== 2.4 tariff reduction =====
test('the 8-minute tariff reduction is not applicable and carries no value', () => {
  assert.equal(p('turnaround.tariffReductionApplicable').value, false);
  assert.equal(p('turnaround.tariffReductionMinutes').value, null);
  assert.equal(p('turnaround.tariffReductionAutoActivate').value, false);
  assert.doesNotMatch(JSON.stringify(p('turnaround')), /"value":\s*8\b/);
});

// ===== 2.5 formula =====
test('the planned driving time is the duty duration minus all non-driving time', () => {
  assert.equal(p('calculation.plannedDrivingTimeFormula').value, 'duty_duration_minus_all_non_driving_time');
  const categories = p('calculation.nonDrivingTimeCategories').value;
  for (const category of ['turnaround', 'standing_time', 'preparation_time', 'closing_time', 'other_non_driving_time']) {
    assert.ok(categories.includes(category), `missing non-driving category ${category}`);
  }
});
test('the required creditable turnaround is the planned driving time divided by six', () => {
  assert.equal(p('calculation.requiredRatioNumerator').value, 1);
  assert.equal(p('calculation.requiredRatioDenominator').value, 6);
  assert.equal(p('calculation.requiredCreditableTurnaroundFormula').value, 'planned_driving_time_divided_by_6');
  assert.equal(p('calculation.comparisonFormula').value, 'sum_creditable_turnaround_minutes_at_least_required');
  assert.equal(p('calculation.aggregationScope').value, 'duty');
  assert.equal(p('calculation.referencePeriod').value, 'single_duty');
});
test('the rule stays independent of the continuous driving-time rule', () => {
  assert.equal(p('relations.independentOfContinuousDrivingRule').value, true);
});

// ===== 2.6 turnaround =====
test('a creditable turnaround needs an observed span of 11 minutes (10 + 1 technical)', () => {
  assert.equal(p('turnaround.minimumCreditableMinutes').value, 10);
  assert.equal(p('turnaround.technicalMinutes').value, 1);
  assert.equal(p('turnaround.minimumObservedSpanMinutes').value, 11);
  assert.equal(p('turnaround.minimumCreditableMinutes').value + p('turnaround.technicalMinutes').value, 11);
});
// PHASE 3I.2b: the crediting method is now decided — the FULL observed span is credited once the
// 11-minute minimum is reached, and the technical minute is part of it.
test('below the minimum span nothing is credited', () => {
  assert.equal(p('turnaround.belowMinimumCreditedMinutes').value, 0);
});
test('from the minimum span on, the full observed span is credited', () => {
  assert.equal(p('turnaround.creditingMethod').value, 'full_observed_span');
  assert.equal(p('turnaround.creditingMethod').status, 'confirmed');
  assert.equal(p('calculation.creditedTurnaroundFormula').value, 'observed_span_below_minimum_credits_zero_otherwise_full_observed_span');
});
test('the technical minute is included in the credited duration and never deducted', () => {
  assert.equal(p('turnaround.technicalMinuteIncludedInCreditedDuration').value, true);
  assert.equal(p('turnaround.technicalMinuteDeducted').value, false);
  assert.equal(p('turnaround.technicalMinutesCountAsRecovery'), undefined, 'the ambiguous recovery flag is gone');
});
test('there is no flat-rate crediting of only 10 minutes', () => {
  assert.equal(p('turnaround.flatRateCreditingMinutes').value, null);
  assert.notEqual(p('turnaround.flatRateCreditingMinutes').value, 10);
});
test('the crediting rule yields 10→0, 11→11, 15→15 and 20→20 minutes', () => {
  // contract-level evaluation of the confirmed parameters (no productive algorithm exists yet)
  const minimum = p('turnaround.minimumObservedSpanMinutes').value;
  const below = p('turnaround.belowMinimumCreditedMinutes').value;
  const credited = (observedSpanMinutes) => observedSpanMinutes >= minimum ? observedSpanMinutes : below;
  assert.equal(credited(10), 0);
  assert.equal(credited(11), 11);
  assert.equal(credited(15), 15);
  assert.equal(credited(20), 20);
  // the rejected readings must NOT follow from the contract
  assert.notEqual(credited(15), 14, 'no observed-span-minus-one semantics');
  assert.notEqual(credited(15), 10, 'no flat 10-minute crediting');
});
test('multiple turnarounds are summed and the crediting variant is no longer open', () => {
  assert.equal(p('turnaround.multipleTurnaroundHandling').value, 'sum_of_creditable_turnarounds');
  assert.equal(p('turnaround.creditedDurationVariant'), undefined, 'the A/B variant question is closed');
  assert.ok(!p('openParameters').value.includes('parameters.turnaround.creditedDurationVariant'));
});
// PHASE 3I.3: the turnaround evidence is now confirmed (adjacent service trips of the same
// circulation, arrival to next departure, taken from the Umlauftafel stop-event times).
test('a plain gap is still never a turnaround, and the evidence rule is now defined', () => {
  assert.equal(p('turnaround.plainGapCountsAsTurnaround').value, false);
  assert.equal(p('turnaround.turnaroundEvidence').status, 'confirmed');
  assert.equal(p('turnaround.turnaroundEvidence').value, 'adjacent_service_trips_same_circulation_arrival_to_next_departure');
  assert.equal(p('turnaround.turnaroundBridgingSegmentsAllowed').value, false);
});

// ===== source priority =====
test('the Umlauftafel is the primary source and may not be overridden by the schedule', () => {
  assert.deepEqual(p('dataStrategy.sourcePriority').value, ['umlauftafel', 'schedule_structured', 'schedule_fallback']);
  assert.equal(p('dataStrategy.umlauftafelIsPrimary').value, true);
  assert.equal(p('dataStrategy.scheduleMayNotOverrideUmlauftafel').value, true);
  assert.equal(p('dataStrategy.doubleCountingForbidden').value, true);
  assert.equal(p('dataStrategy.insufficientDataResult').value, 'INCONCLUSIVE');
});

// ===== fallback indicators =====
test('the fallback indicators may only mark a candidate, never a verdict', () => {
  assert.deepEqual(p('fallbackIndicators.indicators').value, ['noExplicitBlockPause', 'paidTimeEqualsDutyTime']);
  assert.equal(p('fallbackIndicators.candidateStatusOnIndicator').value, 'probable');
  assert.equal(p('fallbackIndicators.indicatorMayProduceVerdict').value, false);
  assert.equal(p('fallbackIndicators.indicatorMayInventTurnaround').value, false);
  assert.equal(p('fallbackIndicators.unprovableAbsenceResult').value, 'inconclusive');
});

// ===== approval gate =====
test('the remaining open parameters still block approval and match the documented list', () => {
  const openPaths = [];
  const walk = (node, path) => {
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (child && typeof child === 'object' && !Array.isArray(child) && 'value' in child) {
        if (child.status === 'open') openPaths.push(childPath);
      } else if (child && typeof child === 'object' && !Array.isArray(child)) walk(child, childPath);
    }
  };
  walk(config.parameters, 'parameters');
  assert.deepEqual([...openPaths].sort(), [...p('openParameters').value].sort());
  // SUPERSEDED BY PHASE 3I.8/3I.8b: all six parameters are closed (four in 3I.8, the two line-18
  // questions in 3I.8b). The protective part — documented list == reality, and the rule set is not
  // approved or activated — is unchanged.
  assert.equal(openPaths.length, 0, 'every mandatory parameter is decided after 3I.8b');
  assert.ok(!openPaths.includes('parameters.turnaround.turnaroundEvidence'), 'the turnaround evidence is closed in 3I.3');
  assert.ok(!openPaths.includes('parameters.calculation.roundingRule'), 'the rounding rule is closed in 3I.4');
  assert.ok(!openPaths.includes('parameters.calculation.mixedModeHandling'), 'mixed modes are closed in 3I.8');
  assert.ok(!openPaths.includes('parameters.eligibility.exceptionLineScope'), 'the line-18 scope is closed in 3I.8b');

  assert.equal(config.status, 'approved', 'approved in Phase 3I.14 — but still not activated');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false, 'and still not activated');
});

test('the resolved questions are no longer open', () => {
  const open = p('openParameters').value;
  for (const resolved of [
    'parameters.scope.combinedDriverEvidence',
    'parameters.eligibility.stopDistanceDataSource',
    'parameters.eligibility.stopDistanceAggregationScope',
    'parameters.eligibility.dayTypeEvidence',
    'parameters.eligibility.holidayTreatment',
    'parameters.calculation.formula',
    'parameters.calculation.drivingTimeBasis',
    'parameters.calculation.aggregationScope',
    'parameters.calculation.referencePeriod',
    'parameters.turnaround.tariffReductionMinutes',
    'parameters.turnaround.multipleTurnaroundHandling',
    'parameters.turnaround.creditedDurationVariant'
  ]) {
    assert.ok(!open.includes(resolved), `${resolved} should no longer be open`);
  }
});

// SUPERSEDED BY PHASE 3I.4/3I.5/3I.6: the rule module, its check adapter and the productive
// registration now exist. What this still protects is the CONFIGURATION: it stays free of
// executable logic, and the productive registration must not activate the draft rule set.
test('the configuration contains no executable logic and is not activated by the registration', () => {
  assert.doesNotMatch(raw, /=>|\bfunction\b|\beval\b|\brequire\b|\bimport\b|\$\{|`/);
  assert.equal(config.status, 'approved');   // SUPERSEDED BY PHASE 3I.14
  assert.equal(p('activation.enabled').value, false);
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  assert.match(orchestrator, /createOneSixthCheck/, 'productively registered since Phase 3I.6');
  assert.equal([...orchestrator.matchAll(/enabled:\s*true/g)].length, 1, 'only BV008 is enabled productively');
});
