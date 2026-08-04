import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.8b – the last two mandatory parameters are now decided by the user:
//   * the 19:20 night-shift threshold is INCLUSIVE,
//   * the line-18 exception covers ONLY the affected line-18 segments,
//   * mixed-line duties are handled per segment,
//   * an unreliable segment assignment yields INCONCLUSIVE — never a blanket exception.
// Contract and configuration only: this phase implements no eligibility filter and no algorithm.
import { validateRuleConfig } from '../js/v2/rules/config/rule-config-validator.js';
import { ONE_SIXTH_STATUSES } from '../js/v2/analysis/one-sixth-validation.js';
import { evaluateOneSixthEligibility } from '../js/v2/analysis/one-sixth-rule.js';

const CONFIG_URL = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const raw = readFileSync(CONFIG_URL, 'utf8');
const config = JSON.parse(raw);
const p = (path) => path.split('.').reduce((node, key) => node?.[key], config.parameters);

// ===== line-18 scope =====
// SUPERSEDED BY PHASE 3I.15b: the real end-to-end test proved the opposite reading correct —
// line 18 is an ADMISSION GROUND for duties the day type would exclude, never a segment exception.
test('the line-18 ground admits a duty and changes no calculation', () => {
  assert.equal(p('eligibility.admissionLineEffect').value, 'admission_ground');
  assert.equal(p('eligibility.admissionLineEffect').status, 'confirmed');
  assert.equal(p('eligibility.admissionLineEffect').unit, 'text');
});
test('no blanket duty, circulation or pure-line interpretation was recorded', () => {
  const serialized = JSON.stringify(p('eligibility'));
  for (const rejected of ['entire_duty_if_line_present', 'pure_line_18_duties_only', 'entire_circulation', 'whole_duty', 'entire_service']) {
    assert.doesNotMatch(serialized, new RegExp(rejected), `${rejected} is explicitly not the decision`);
  }
});
test('the admission line itself is unchanged', () => {   // SUPERSEDED BY PHASE 3I.15b (renamed)
  assert.deepEqual(p('eligibility.admissionLines').value, ['18']);
  assert.equal(p('eligibility.admissionLines').status, 'confirmed');
});

// ===== mixed lines =====
// SUPERSEDED BY PHASE 3I.15b: the real end-to-end test proved the opposite reading correct —
// line 18 is an ADMISSION GROUND for duties the day type would exclude, never a segment exception.
test('a mixed-line duty gets no line-18 admission at all', () => {
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').value, true);
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').status, 'confirmed');
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').unit, 'flag');
});
// SUPERSEDED BY PHASE 3I.15b: the real end-to-end test proved the opposite reading correct —
// line 18 is an ADMISSION GROUND for duties the day type would exclude, never a segment exception.
test('the two admission parameters are semantically consistent with each other', () => {
  assert.equal(p('eligibility.admissionLineEffect').value, 'admission_ground');
  assert.equal(p('eligibility.admissionLineRequiresPureDuty').value, true);
  // an admission ground must not coexist with any remaining exemption wording
  assert.doesNotMatch(JSON.stringify(config.parameters), /duty_wide_exception|circulation_wide_exception|affected_segments_only|segment_based/);
});
// SUPERSEDED BY PHASE 3I.15b: the real end-to-end test proved the opposite reading correct —
// line 18 is an ADMISSION GROUND for duties the day type would exclude, never a segment exception.
test('a mixed duty is assessed in full when its day type admits it', () => {
  // Nothing is ever exempted, so a mixed duty either is admitted whole or not at all.
  assert.equal(p('eligibility.admissionLineEffect').value, 'admission_ground');
  assert.equal(p('scope.serviceType').value, 'line_service');
  assert.deepEqual(p('scope.organizations').value, ['JNV']);
});

// ===== ambiguity =====
// SUPERSEDED BY PHASE 3I.15c: `ambiguousSegmentAssignmentOutcome` described the segment-exception
// assignment that Phase 3I.15b removed, so the parameter was dropped. The protected statement is
// unchanged and now asserted where it actually lives — in the rule's behaviour.
test('an unreliable line attribution still yields INCONCLUSIVE, never a verdict', () => {
  assert.ok(!('ambiguousSegmentAssignmentOutcome' in p('eligibility')), 'the parameter has no addressee any more');
  assert.ok(ONE_SIXTH_STATUSES.includes('INCONCLUSIVE'), 'the outcome uses the existing determination vocabulary');
  const undecidable = evaluateOneSixthEligibility({
    drivingProjection: {
      metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
      circulations: [{
        code: 'A',
        drivingSegments: [
          { serviceNumber: '2221', kind: 'service', line: '18', startMinutes: 0, endMinutes: 200, durationMinutes: 200, source: { sourceType: 'pdf' } },
          { serviceNumber: '2221', kind: 'service', line: null, startMinutes: 200, endMinutes: 358, durationMinutes: 158, source: { sourceType: 'pdf' } }
        ],
        drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
        statistics: { drivingMinutes: 358, nonDrivingMinutes: 0, knownTotalMinutes: 0 }, warnings: []
      }], warnings: []
    },
    ruleConfig: {
      ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
      requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
      minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
      acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
      allowedDayTypes: p('eligibility.allowedDayTypes').value, nightShiftIsException: true,
      nightShiftStart: p('eligibility.nightShiftStart').value, nightShiftStartInclusive: true,
      admissionLines: p('eligibility.admissionLines').value, admissionLineRequiresPureDuty: true
    },
    context: { organization: 'JNV', mode: 'bus' },
    eligibility: { dutyStartMinutes: 5 * 60, serviceStarts: {} }
  });
  assert.equal(undecidable.status, 'INCONCLUSIVE', 'no automatic pass or fail');
});
test('the ambiguity outcome is declarative only — no executable logic', () => {
  assert.doesNotMatch(raw, /=>|\bfunction\b|\beval\b|\brequire\b|\bimport\b|\$\{|`/);
});

// ===== night shift, now user-confirmed =====
test('the night shift threshold is 19:20 on the duty start, inclusive', () => {
  assert.equal(p('eligibility.nightShiftStart').value, '19:20');
  assert.equal(p('eligibility.nightShiftStart').status, 'confirmed');
  assert.equal(p('eligibility.nightShiftStartBasis').value, 'duty_start_time');
  assert.equal(p('eligibility.nightShiftStartBasis').status, 'confirmed');
  assert.equal(p('eligibility.nightShiftStartInclusive').value, true);
  assert.equal(p('eligibility.nightShiftStartInclusive').status, 'confirmed');
  assert.equal(p('eligibility.nightShiftStartInclusive').unit, 'flag', 'boolean via the existing flag unit');
});
test('the inclusive threshold puts 19:20 itself inside the night shift', () => {
  const [h, m] = String(p('eligibility.nightShiftStart').value).split(':').map(Number);
  const threshold = h * 60 + m;
  const isNight = (start) => (p('eligibility.nightShiftStartInclusive').value ? start >= threshold : start > threshold);
  assert.equal(isNight(19 * 60 + 19), false);
  assert.equal(isNight(19 * 60 + 20), true, '19:20 exactly is a night shift');
  assert.equal(isNight(19 * 60 + 21), true);
});

// ===== open count and activation gate =====
test('no mandatory parameter remains open', () => {
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
  assert.deepEqual(openPaths, [], 'open count is zero');
  assert.deepEqual(p('openParameters').value, []);
});
test('no null placeholder remains for the two decided parameters', () => {   // SUPERSEDED BY PHASE 3I.15b
  assert.notEqual(p('eligibility.admissionLineEffect').value, null);
  assert.notEqual(p('eligibility.admissionLineRequiresPureDuty').value, null);
});
test('the rule set is still NOT activated or approved in this phase', () => {
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false);
});
test('the configuration remains structurally valid', () => {
  const result = validateRuleConfig(config);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
// SUPERSEDED BY PHASE 3I.9: the filters are implemented there. What still must hold is that the
// implementation reads the decided values from the configuration instead of hard-coding them.
test('the eligibility filters are implemented and driven by the closed contract', () => {
  const rule = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');
  assert.match(rule, /admissionLines/, 'the admission line comes from the configuration');
  assert.match(rule, /nightShiftStartInclusive/, 'the inclusive boundary comes from the configuration');
  assert.match(rule, /allowedDayTypes/, 'the day types come from the configuration');
  assert.doesNotMatch(rule, /'affected_segments_only'|'segment_based'/, 'the discarded semantics leaves no literal behind');
  assert.doesNotMatch(rule, /'18'|"18"|19:20/, 'neither the line nor the threshold is hard-coded');
});
test('no productive activation happened anywhere', () => {
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  assert.equal([...orchestrator.matchAll(/enabled:\s*true/g)].length, 1, 'still only BV008 is enabled');
  assert.match(orchestrator, /enabled:\s*false/);
});

// ===== the settled core contract stays untouched =====
test('the previously settled core parameters are unchanged', () => {
  assert.deepEqual(p('scope.organizations').value, ['JNV']);
  assert.deepEqual(p('scope.excludedOrganizations').value, ['JES']);
  assert.deepEqual(p('scope.modes').value, ['bus', 'tram']);
  assert.equal(p('turnaround.minimumCreditableMinutes').value, 10);
  assert.equal(p('turnaround.technicalMinutes').value, 1);
  assert.equal(p('turnaround.minimumObservedSpanMinutes').value, 11);
  assert.equal(p('turnaround.creditingMethod').value, 'full_observed_span');
  assert.equal(p('turnaround.tariffReductionApplicable').value, false);
  assert.equal(p('turnaround.tariffReductionMinutes').value, null);
  assert.deepEqual(p('turnaround.acceptedTurnaroundConfidence').value, ['exact', 'probable']);
  assert.equal(p('calculation.requiredRatioNumerator').value, 1);
  assert.equal(p('calculation.requiredRatioDenominator').value, 6);
  assert.equal(p('calculation.roundingRule').value, 'ceil_to_full_minute');
});
