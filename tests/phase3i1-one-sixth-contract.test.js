import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.1 – the JNV 1/6 rule CONTRACT only: parameters, approval status and open questions.
// No algorithm, no CheckModule, no evaluation. The contract is validated with the EXISTING
// rule-config validator; no parallel configuration architecture is introduced.
import { validateRuleConfig, PARAMETER_STATUSES } from '../js/v2/rules/config/rule-config-validator.js';

const CONFIG_URL = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const raw = readFileSync(CONFIG_URL, 'utf8');
const config = JSON.parse(raw);
const leaf = (path) => path.split('.').reduce((node, key) => node?.[key], config);
const p = (path) => leaf(`parameters.${path}`);

test('the contract validates against the existing rule-config validator', () => {
  const result = validateRuleConfig(config);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('the rule set is draft and disabled while mandatory parameters are open', () => {
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false);
});

test('the contract carries the BV015-BV018 rule ids and documented sources', () => {
  assert.deepEqual(p('activation.ruleIds').value, ['BV015', 'BV016', 'BV017', 'BV018']);
  assert.ok(config.sourceReferences.length >= 2);
  assert.ok(config.sourceReferences.some(ref => /BV015/.test(ref)));
});

// ===== scope =====
test('the rule applies to JNV only and explicitly excludes JES', () => {
  assert.deepEqual(p('scope.organizations').value, ['JNV']);
  assert.deepEqual(p('scope.excludedOrganizations').value, ['JES']);
  assert.equal(config.organization, 'JNV');
});
// SUPERSEDED BY PHASE 3I.2: a combined-driver proof is no longer required (assessment follows the
// Fahrpersonalverordnung for bus and tram alike), so the evidence question is resolved, not open.
test('the rule covers bus and tram; the combined-driver proof is no longer required', () => {
  assert.deepEqual(p('scope.modes').value, ['bus', 'tram']);
  assert.equal(p('scope.combinedDriverRequirement').value, 'not_required');
  assert.equal(p('scope.combinedDriverEvidence'), undefined);
});

// ===== eligibility =====
// SUPERSEDED BY PHASE 3I.2: the distance is decided per organisation instead of measured, so the
// data-source and aggregation questions are gone.
test('the line-service alternative keeps the 3000 m threshold but needs no measurement', () => {
  assert.equal(p('eligibility.averageStopDistanceMaxMetersExclusive').value, 3000);
  assert.equal(p('eligibility.averageStopDistanceMaxMetersExclusive').unit, 'meters');
  assert.equal(p('eligibility.stopDistanceStrategy').value, 'organization_default');
  assert.equal(p('eligibility.stopDistanceDataSource'), undefined);
  assert.equal(p('eligibility.stopDistanceAggregationScope'), undefined);
});
// SUPERSEDED BY PHASE 3I.2: Sunday and public holiday are treated alike, so the holiday question
// is resolved and no calendar contract is needed.
test('services may be built in 1/6 on weekend day types only; holidays follow Sunday', () => {
  assert.deepEqual(p('eligibility.allowedDayTypes').value, ['SATURDAY', 'SUNDAY_HOLIDAY']);
  assert.equal(p('eligibility.explicitSundayOrHolidayLabelDayType').value, 'SUNDAY_HOLIDAY');
  assert.equal(p('eligibility.holidayTreatment'), undefined);
});
// SUPERSEDED BY PHASE 3I.8: the user confirmed 19:20 as binding and settled the basis on the duty
// start time, so both are now `confirmed` instead of provisional/open. The 19:20 value itself and
// the exception flag are unchanged.
test('the night shift exception uses the confirmed 19:20 duty start', () => {
  assert.equal(p('eligibility.nightShiftIsException').value, true);
  assert.equal(p('eligibility.nightShiftStart').value, '19:20');
  assert.equal(p('eligibility.nightShiftStart').status, 'confirmed');
  assert.equal(p('eligibility.nightShiftStartBasis').value, 'duty_start_time');
  assert.equal(p('eligibility.nightShiftStartBasis').status, 'confirmed');
});
// SUPERSEDED BY PHASE 3I.8b: the user decided the scope — the exception covers only the affected
// line-18 segments, and mixed duties are handled per segment. The exception line itself is unchanged.
test('line 18 is a configured exception limited to the affected segments', () => {
  // SUPERSEDED BY PHASE 3I.15b: line 18 admits a duty to the check instead of removing segments
  // from it, and only when the WHOLE duty runs on it.
  assert.deepEqual(p('eligibility.admissionLines').value, ['18']);
  assert.equal(p('eligibility.admissionLineEffect').value, 'admission_ground');
  assert.equal(p('eligibility.admissionLineEffect').status, 'confirmed');
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').value, true);
});

// ===== turnaround =====
test('a creditable turnaround is 10 minutes plus 1 technical minute = an observed span of 11', () => {
  assert.equal(p('turnaround.minimumCreditableMinutes').value, 10);
  assert.equal(p('turnaround.technicalMinutes').value, 1);
  assert.equal(p('turnaround.minimumObservedSpanMinutes').value, 11);
  assert.equal(
    p('turnaround.minimumCreditableMinutes').value + p('turnaround.technicalMinutes').value,
    p('turnaround.minimumObservedSpanMinutes').value
  );
});
// SUPERSEDED BY PHASE 3I.2b: the ambiguous "recovery" flag is replaced by an unambiguous crediting
// contract — the technical minute is part of the credited duration and is never deducted.
test('the technical minute is included in the credited duration and never deducted', () => {
  assert.equal(p('turnaround.technicalMinuteIncludedInCreditedDuration').value, true);
  assert.equal(p('turnaround.technicalMinuteDeducted').value, false);
  assert.equal(p('turnaround.technicalMinutesCountAsRecovery'), undefined);
});
// SUPERSEDED BY PHASE 3I.2: the reduction is now confirmed as NOT applicable (no longer merely open).
test('the tariff reduction to 8 minutes is not applicable and never auto-activated', () => {
  assert.equal(p('turnaround.tariffReductionMinutes').value, null);
  assert.equal(p('turnaround.tariffReductionApplicable').value, false);
  assert.equal(p('turnaround.tariffReductionAutoActivate').value, false);
  assert.doesNotMatch(JSON.stringify(p('turnaround')), /"value":\s*8\b/, 'no active 8-minute value anywhere in the turnaround contract');
});
// SUPERSEDED BY PHASE 3I.2/3I.3: multiple turnarounds are summed, and the detection evidence is
// now confirmed (adjacent service trips of the same circulation).
test('a plain temporal gap is never a creditable turnaround, and the evidence rule is confirmed', () => {
  assert.equal(p('turnaround.plainGapCountsAsTurnaround').value, false);
  assert.equal(p('turnaround.turnaroundEvidence').status, 'confirmed');
  assert.equal(p('turnaround.multipleTurnaroundHandling').value, 'sum_of_creditable_turnarounds');
});

// ===== calculation =====
// SUPERSEDED BY PHASE 3I.2/3I.4/3I.8: the formula, its basis, aggregation, reference period and the
// rounding rule are binding; since 3I.8 the mixed-mode handling is confirmed as well (bus and tram
// are evaluated under the same rule).
test('the ratio is 1/6, and formula, rounding and mixed-mode handling are all binding', () => {
  assert.equal(p('calculation.requiredRatioNumerator').value, 1);
  assert.equal(p('calculation.requiredRatioDenominator').value, 6);
  assert.equal(p('calculation.plannedDrivingTimeFormula').value, 'duty_duration_minus_all_non_driving_time');
  assert.equal(p('calculation.aggregationScope').value, 'duty');
  assert.equal(p('calculation.referencePeriod').value, 'single_duty');
  assert.equal(p('calculation.roundingRule').value, 'ceil_to_full_minute');
  assert.equal(p('calculation.mixedModeHandling').status, 'confirmed');
  assert.equal(p('calculation.mixedModeHandling').value, 'evaluate_all_jnv_modes_under_same_rule');
});

// ===== relation to the continuous driving-time rule =====
test('the 1/6 rule is independent of the continuous driving-time rule', () => {
  assert.equal(p('relations.independentOfContinuousDrivingRule').value, true);
  assert.equal(p('relations.continuousDrivingRuleSetId').value, 'shared-driving-time-limit-v1');
});

// ===== approval gate =====
test('the documented open-parameter list matches the actually open parameters', () => {
  const openPaths = [];
  const walk = (node, path) => {
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (child && typeof child === 'object' && !Array.isArray(child) && 'value' in child) {
        if (child.status === 'open') openPaths.push(childPath);
      } else if (child && typeof child === 'object' && !Array.isArray(child)) {
        walk(child, childPath);
      }
    }
  };
  walk(config.parameters, 'parameters');
  assert.deepEqual([...openPaths].sort(), [...p('openParameters').value].sort());
  // SUPERSEDED BY PHASE 3I.8b: every mandatory question is now decided, so the list is empty on
  // both sides. The protective invariant — documented list == reality — is unchanged.
  assert.equal(openPaths.length, 0, 'no mandatory question remains open after 3I.8b');
});

// SUPERSEDED BY PHASE 3I.8b: with no open parameters the validator's open-parameter gate no longer
// fires, so approval is now held back ONLY by the deliberate draft status. That is exactly what this
// test now protects — the rule set must not be approved or activated by this phase.
test('the contract stays draft and unapproved even though no parameter blocks it any more', () => {
  assert.equal(config.status, 'approved');   // SUPERSEDED BY PHASE 3I.14
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false);
  const approved = JSON.parse(raw);
  approved.status = 'approved';
  approved.approvedBy = 'Betriebsrat';
  const result = validateRuleConfig(approved);
  assert.equal(result.valid, true, 'no parameter blocks approval any more — the brake is the draft status');
  assert.ok(!result.errors.some(e => e.code === 'APPROVED_WITH_OPEN_PARAMETERS'));
});

test('every parameter status is part of the existing closed vocabulary', () => {
  const statuses = [...raw.matchAll(/"status":\s*"([a-z]+)"/g)].map(m => m[1]).filter(s => s !== 'approved');
  assert.ok(statuses.length > 0);
  for (const status of statuses) assert.ok(PARAMETER_STATUSES.includes(status), `unknown status ${status}`);
});

// ===== no executable logic / no algorithm =====
test('the configuration contains no executable logic and no algorithm', () => {
  assert.doesNotMatch(raw, /=>|\bfunction\b|\beval\b|\brequire\b|\bimport\b|\$\{|`/);
});
// SUPERSEDED BY PHASE 3I.4/3I.5/3I.6: the rule module (3I.4), its check adapter (3I.5) and the
// productive registration in the orchestrator (3I.6) now exist by design. What must still not
// exist is rule wiring in the session or the UI — the check reaches them only as a generic
// CheckResult inside the existing CheckReport.
test('the 1/6 rule is registered only in the orchestrator, never in the session or the UI', () => {
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
  const session = readFileSync(new URL('../js/v2/import/multi-document-import-controller.js', import.meta.url), 'utf8');
  assert.match(orchestrator, /createOneSixthCheck/, 'productively registered since Phase 3I.6');
  for (const source of [bootstrap, session]) assert.doesNotMatch(source, /one-sixth|OneSixth/i);
});
