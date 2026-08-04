import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.11 – the approval audit, pinned as executable statements. It records WHAT IS, not what
// should be: the rule set stays draft, disabled and unapproved, and the one open reading of the
// contract is documented rather than silently decided.
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { evaluateOneSixthRule, evaluateOneSixthEligibility } from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthRuleConfig } from '../js/v2/analysis/one-sixth-validation.js';

const configUrl = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const CONFIG = JSON.parse(readFileSync(configUrl, 'utf8'));
const leaf = (node) => node?.value;

// ===== configuration audit: complete, but explicitly not released =====
test('the versioned rule set is approved (Phase 3I.14) and still disabled', () => {
  // SUPERSEDED BY PHASE 3I.14: formally approved — still not activated.
  assert.equal(CONFIG.status, 'approved');
  assert.equal(leaf(CONFIG.parameters.activation.enabled), false);
  assert.equal(CONFIG.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
});
test('no mandatory parameter is open any more', () => {
  assert.deepEqual(leaf(CONFIG.parameters.openParameters), []);
});
// SUPERSEDED BY PHASE 3I.12: `deadheadTreatment` was confirmed together with the night-shift
// reading, so no parameter is provisional any more. The assertion became stricter, not weaker.
test('no parameter of the rule set is provisional (closed in Phase 3I.12)', () => {
  const provisional = [];
  for (const [group, entries] of Object.entries(CONFIG.parameters)) {
    if (group === 'openParameters') continue;
    for (const [name, node] of Object.entries(entries)) {
      if (node && typeof node === 'object' && 'status' in node && node.status !== 'confirmed') provisional.push(`${group}.${name}`);
    }
  }
  assert.deepEqual(provisional, [], 'a release must not rest on provisional values');
  assert.equal(CONFIG.parameters.calculation.deadheadTreatment.status, 'confirmed');
});
test('the productive default mirrors the confirmed values and stays disabled', () => {
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false, 'no activation through the back door');
  const e = CONFIG.parameters.eligibility;
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.allowedDayTypes], leaf(e.allowedDayTypes));
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.admissionLines], leaf(e.admissionLines));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.nightShiftStart, leaf(e.nightShiftStart));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.nightShiftIsException, leaf(e.nightShiftIsException));
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.admissionLineRequiresPureDuty, leaf(e.admissionLineRequiresPureDuty));
});
test('the disabled rule set produces no verdict productively', () => {
  const r = evaluateOneSixthRule({
    drivingProjection: { metadata: { dayType: 'saturday' }, circulations: [{ code: '1', drivingSegments: [] }] },
    turnaroundDetection: { status: 'complete', candidates: [] },
    ruleConfig: DEFAULT_ONE_SIXTH_RULE_CONFIG, context: { organization: 'JNV', mode: 'bus' }
  });
  assert.equal(r.status, 'DISABLED');
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.services, []);
});
test('the configuration validator would accept an approved rule set — the release is a decision, not a technical gap', () => {
  const activated = {
    ruleId: 'BV015_BV018', enabled: true,
    organizations: leaf(CONFIG.parameters.scope.organizations), modes: leaf(CONFIG.parameters.scope.modes),
    requiredRatioNumerator: leaf(CONFIG.parameters.calculation.requiredRatioNumerator),
    requiredRatioDenominator: leaf(CONFIG.parameters.calculation.requiredRatioDenominator),
    roundingRule: leaf(CONFIG.parameters.calculation.roundingRule),
    minimumObservedSpanMinutes: leaf(CONFIG.parameters.turnaround.minimumObservedSpanMinutes),
    creditingMethod: leaf(CONFIG.parameters.turnaround.creditingMethod),
    acceptedTurnaroundConfidence: leaf(CONFIG.parameters.turnaround.acceptedTurnaroundConfidence),
    locationMismatchBlocksCrediting: leaf(CONFIG.parameters.turnaround.locationMismatchBlocksCrediting)
  };
  assert.deepEqual(validateOneSixthRuleConfig(activated).errors, []);
});

// ===== the documented contract statements this phase relies on =====
test('the contract records the weekend-only scope and its two exceptions', () => {
  const audit = readFileSync(new URL('../PHASE-3I.1-JNV-1-6-FACHREGELVERTRAG-DATENREIFE-AUDIT.md', import.meta.url), 'utf8');
  assert.match(audit, /nur am Wochenende/, 'user rule 7');
  assert.match(audit, /Ausnahmen:\s*\*\*Nachtschichten\*\*/, 'user rule 8');
});
// SUPERSEDED BY PHASE 3I.15b: the real end-to-end test proved the opposite reading correct.
test('the line-18 ground ADMITS a pure duty — corrected in Phase 3I.15b', () => {
  assert.equal(leaf(CONFIG.parameters.eligibility.admissionLineEffect), 'admission_ground');
  assert.equal(leaf(CONFIG.parameters.eligibility.admissionLineRequiresPureDuty), true);
});

// ===== the open reading, pinned as behaviour so a later decision cannot pass unnoticed =====
const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true
};
const projectionOf = (dayType) => ({
  metadata: { serviceRegime: 'school', dayType, dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: [{ serviceNumber: '2101', kind: 'service', line: '12', startMinutes: 0, endMinutes: 396, durationMinutes: 396, source: { sourceType: 'pdf' } }],
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 396, nonDrivingMinutes: 0, knownTotalMinutes: 0 }, warnings: []
  }],
  warnings: []
});
const eligibilityAt = (dayType, startMinutes) => evaluateOneSixthEligibility({
  drivingProjection: projectionOf(dayType), ruleConfig: RULE_CONFIG,
  context: { organization: 'JNV', mode: 'bus' },
  eligibility: { dutyStartMinutes: null, serviceStarts: { 2101: startMinutes } }
});

// SUPERSEDED BY PHASE 3I.12: what was an OPEN READING is now the binding contract (decision A) —
// a night shift falls ADDITIONALLY under the rule. Same behaviour, no longer provisional.
test('CONFIRMED (Phase 3I.12): the night shift admits a weekday duty into the rule', () => {
  assert.equal(eligibilityAt('mo_fr', 19 * 60 + 20).status, 'PASS', 'night shift → assessed');
  assert.equal(eligibilityAt('mo_fr', 5 * 60).status, 'NOT_APPLICABLE', 'ordinary weekday → out of scope');
});
// SUPERSEDED BY PHASE 3I.12: decision B — a weekend night shift is an ordinary weekend duty.
test('CONFIRMED (Phase 3I.12): a weekend night shift is assessed like any weekend duty', () => {
  assert.equal(eligibilityAt('saturday', 19 * 60 + 20).status, 'PASS');
  assert.equal(eligibilityAt('saturday', 5 * 60).status, 'PASS', 'the night shift changes nothing on a Saturday');
});
// SUPERSEDED BY PHASE 3I.12: the reading is settled, so the audit no longer rests on an open
// question. The successor document carries the binding decision and the new audit result.
test('CONFIRMED (Phase 3I.12): the night-shift reading is settled in writing', () => {
  const closure = readFileSync(new URL('../PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md', import.meta.url), 'utf8');
  assert.match(closure, /READY_FOR_APPROVAL/, 'the new audit result is documented');
  assert.match(closure, /Nachtschicht/, 'the decision is named');
  const previous = readFileSync(new URL('../PHASE-3I.11-LINIE18-STATUSKORREKTUR-FREIGABEAUDIT.md', import.meta.url), 'utf8');
  assert.match(previous, /aufgehoben durch Phase 3I\.12/, 'the old verdict is placed in context');
});
// SUPERSEDED BY PHASE 3I.14: the approval happened there, deliberately. What this file must still
// guarantee is that nothing ACTIVATED the rule set — that half is unchanged and unweakened.
test('nothing activated the rule set', () => {
  const raw = readFileSync(configUrl, 'utf8');
  assert.doesNotMatch(raw, /"status"\s*:\s*"active"/);
  assert.doesNotMatch(raw, /"enabled"\s*:\s*\{\s*"value"\s*:\s*true/);
  assert.match(raw, /"approvedBy"\s*:\s*"JNV_RULE_APPROVAL_2026_PHASE3I15C"/);   // SUPERSEDED BY PHASE 3I.15c
});
test('no interface, explorer or session file learned about the rule', () => {
  for (const path of ['../js/v2/ui/check-explorer.js', '../js/v2/explorer/check-explorer-session-bridge.js',
    '../js/v2/import/multi-document-import-controller.js', '../js/v2/checks/check-runner.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /NO_EVALUABLE_SEGMENTS|notApplicableServices|one-?sixth/i, `${path} must stay generic`);
  }
});
