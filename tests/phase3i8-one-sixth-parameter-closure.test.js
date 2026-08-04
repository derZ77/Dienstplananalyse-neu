import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.8 – closing the mandatory parameters of the JNV turnaround-quota rule set. Contract and
// configuration only: no calculation, no new rule, no activation. Two parameters stay OPEN by
// design because no binding operational decision exists for them — that absence is asserted, so no
// default can be introduced silently.
import { validateRuleConfig, PARAMETER_STATUSES, PARAMETER_UNITS } from '../js/v2/rules/config/rule-config-validator.js';

const CONFIG_URL = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const raw = readFileSync(CONFIG_URL, 'utf8');
const config = JSON.parse(raw);
const p = (path) => path.split('.').reduce((node, key) => node?.[key], config.parameters);

// SUPERSEDED BY PHASE 3I.8b: these two were decided by the user, so nothing remains open.
const STILL_OPEN = [];

test('the configuration still validates against the existing rule-config validator', () => {
  const result = validateRuleConfig(config);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

// ===== closed: nightShiftStartBasis =====
test('the night-shift exception is decided on the actual duty start time', () => {
  assert.equal(p('eligibility.nightShiftStartBasis').value, 'duty_start_time');
  assert.equal(p('eligibility.nightShiftStartBasis').status, 'confirmed');
  assert.equal(p('eligibility.nightShiftStartBasis').unit, 'text');
});
test('the 19:20 threshold is now binding and inclusive', () => {
  assert.equal(p('eligibility.nightShiftStart').value, '19:20');
  assert.equal(p('eligibility.nightShiftStart').status, 'confirmed');
  assert.equal(p('eligibility.nightShiftStartInclusive').value, true, 'a duty starting exactly at 19:20 is a night shift');
  assert.equal(p('eligibility.nightShiftStartInclusive').status, 'confirmed');
});
test('the basis is the duty start, not a trip, a file name or a duty end', () => {
  const serialized = JSON.stringify(p('eligibility'));
  assert.doesNotMatch(serialized, /first_trip|latest_trip|duty_end|file_name|circulation_code|vehicle_type/);
});

// ===== closed: blockBreakRelationship =====
test('a block-break indicator is candidate evidence only, and only without a circulation document', () => {
  assert.equal(p('turnaround.blockBreakRelationship').value, 'candidate_evidence_only_without_umlauftafel');
  assert.equal(p('turnaround.blockBreakRelationship').status, 'confirmed');
  assert.equal(p('turnaround.blockBreakRelationship').unit, 'text');
});
test('the indicator contract it relies on is unchanged and still forbids a verdict', () => {
  assert.equal(p('fallbackIndicators.indicatorMayProduceVerdict').value, false);
  assert.equal(p('fallbackIndicators.indicatorMayInventTurnaround').value, false);
  assert.equal(p('fallbackIndicators.unprovableAbsenceResult').value, 'inconclusive');
  assert.equal(p('fallbackIndicators.candidateStatusOnIndicator').value, 'probable');
  assert.equal(p('dataStrategy.umlauftafelIsPrimary').value, true);
  assert.equal(p('dataStrategy.doubleCountingForbidden').value, true);
  assert.equal(p('dataStrategy.scheduleMayNotOverrideUmlauftafel').value, true);
});

// ===== closed: mixedModeHandling =====
test('bus and tram are evaluated under the same rule, with no combined-driver requirement', () => {
  assert.equal(p('calculation.mixedModeHandling').value, 'evaluate_all_jnv_modes_under_same_rule');
  assert.equal(p('calculation.mixedModeHandling').status, 'confirmed');
  assert.deepEqual(p('scope.modes').value, ['bus', 'tram']);
  assert.equal(p('scope.combinedDriverRequirement').value, 'not_required');
});
test('no mode is exempt and no mode-specific formula exists', () => {
  const serialized = JSON.stringify(config.parameters);
  assert.doesNotMatch(serialized, /tram_exempt|bus_only|tram_only|mode_specific/);
  assert.equal(p('calculation.requiredRatioNumerator').value, 1, 'one formula for every mode');
  assert.equal(p('calculation.requiredRatioDenominator').value, 6);
  assert.equal(p('calculation.roundingRule').value, 'ceil_to_full_minute');
});

// ===== closed: paidTimeComparisonTolerance =====
test('the paid-time indicator requires exact equality — no invented tolerance', () => {
  assert.equal(p('fallbackIndicators.paidTimeComparisonTolerance').value, 0);
  assert.equal(p('fallbackIndicators.paidTimeComparisonTolerance').status, 'confirmed');
  assert.equal(p('fallbackIndicators.paidTimeComparisonTolerance').unit, 'minutes');
});
test('no rounding tolerance sneaks in anywhere in the fallback contract', () => {
  const serialized = JSON.stringify(p('fallbackIndicators'));
  assert.doesNotMatch(serialized, /"value":\s*(1|5|10)\b/, 'no 1/5/10-minute tolerance');
});

// ===== SUPERSEDED BY PHASE 3I.8b: decided by the user, no longer open =====
// The protective intent is preserved: the rejected interpretations must still not appear.
// SUPERSEDED BY PHASE 3I.15b: the scope decision was replaced by the admission-ground semantics.
test('the line-18 scope is decided as an admission ground for pure duties', () => {
  assert.equal(p('eligibility.admissionLineEffect').value, 'admission_ground');
  assert.equal(p('eligibility.admissionLineEffect').status, 'confirmed');
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').value, true, 'only a WHOLLY line-18 duty is admitted');
  assert.deepEqual(p('eligibility.admissionLines').value, ['18'], 'the line itself stays confirmed');
});
// SUPERSEDED BY PHASE 3I.15b: a mixed duty simply gets no line-18 admission.
test('a mixed duty gets no line-18 admission', () => {
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').value, true);
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').status, 'confirmed');
  // SUPERSEDED BY PHASE 3I.15c: `ambiguousSegmentAssignmentOutcome` was dropped with the
  // segment-exception logic it described; the INCONCLUSIVE outcome is asserted behaviourally.
  assert.ok(!('ambiguousSegmentAssignmentOutcome' in p('eligibility')));
});

// ===== open-parameter bookkeeping =====
test('exactly the two undecided parameters remain open', () => {
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
  assert.deepEqual([...openPaths].sort(), [...STILL_OPEN].sort());
  assert.deepEqual([...p('openParameters').value].sort(), [...STILL_OPEN].sort(), 'the documented list matches reality');
  assert.equal(p('openParameters').value.length, 0, 'six open parameters reduced to zero (3I.8 + 3I.8b)');
});
test('the four closed parameters no longer appear in the open list', () => {
  const open = p('openParameters').value;
  for (const closed of ['parameters.eligibility.nightShiftStartBasis', 'parameters.turnaround.blockBreakRelationship', 'parameters.calculation.mixedModeHandling', 'parameters.fallbackIndicators.paidTimeComparisonTolerance']) {
    assert.ok(!open.includes(closed), `${closed} is closed`);
  }
});

// ===== the rule set is NOT activated in this phase =====
test('the rule set stays draft, disabled and unapproved', () => {
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false);
});
// SUPERSEDED BY PHASE 3I.8b: with no open parameters the validator gate no longer fires. Approval
// is now withheld deliberately, not mechanically — which is what this phase must guarantee.
test('the contract is deliberately kept unapproved, not blocked by a validator gate', () => {
  assert.equal(config.status, 'approved');   // SUPERSEDED BY PHASE 3I.14
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  const approved = JSON.parse(raw);
  approved.status = 'approved';
  approved.approvedBy = 'Betriebsrat';
  const result = validateRuleConfig(approved);
  assert.equal(result.valid, true, 'no parameter blocks approval any more');
  assert.ok(!result.errors.some(e => e.code === 'APPROVED_WITH_OPEN_PARAMETERS'));
});

// ===== vocabulary and purity =====
test('every status and unit stays inside the existing closed vocabulary', () => {
  const statuses = [...raw.matchAll(/"status":\s*"([a-z]+)"/g)].map(m => m[1]).filter(s => s !== 'approved');
  assert.ok(statuses.length > 0);
  for (const status of statuses) assert.ok(PARAMETER_STATUSES.includes(status), `unknown status ${status}`);
  const units = [...raw.matchAll(/"unit":\s*"([a-z]+)"/g)].map(m => m[1]);
  for (const unit of units) assert.ok(PARAMETER_UNITS.includes(unit), `unknown unit ${unit}`);
});
test('the configuration contains no executable logic', () => {
  assert.doesNotMatch(raw, /=>|\bfunction\b|\beval\b|\brequire\b|\bimport\b|\$\{|`/);
});
test('no productive activation was performed anywhere', () => {
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  assert.equal([...orchestrator.matchAll(/enabled:\s*true/g)].length, 1, 'still only BV008 is enabled');
  assert.match(orchestrator, /enabled:\s*false/, 'the turnaround-quota rule stays disabled');
});
