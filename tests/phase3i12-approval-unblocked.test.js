import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.12 – the approval audit after the contract was closed. The Phase 3I.11 blockers are
// gone; the rule set is READY_FOR_APPROVAL and still draft, disabled and unapproved.
import { DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthRuleConfig } from '../js/v2/analysis/one-sixth-validation.js';

const configUrl = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const CONFIG = JSON.parse(readFileSync(configUrl, 'utf8'));
const doc = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const leaf = (node) => node?.value;

// ===== the Phase 3I.11 blockers are resolved =====
test('the contract settles the night-shift reading', () => {
  const audit = doc('PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md');
  assert.match(audit, /zus[äa]tzlich/i, 'decision A is written down');
  assert.match(audit, /Leerfahrt/i, 'decision C is written down');
  assert.match(audit, /READY_FOR_APPROVAL/);
});
test('the Phase 3I.11 document no longer claims an open night-shift or deadhead question', () => {
  const previous = doc('PHASE-3I.11-LINIE18-STATUSKORREKTUR-FREIGABEAUDIT.md');
  assert.match(previous, /3I\.12/, 'it points at the phase that closed the questions');
  assert.doesNotMatch(previous, /Freigabeaudit-Ergebnis: `BLOCKED`/, 'the stale verdict is corrected');
});
test('no rule-set parameter is provisional and none is open', () => {
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
test('the rule set cites the Phase 3I.12 decisions as its source', () => {
  assert.ok(CONFIG.sourceReferences.some(ref => /3I\.12/.test(ref)));
});

// ===== nothing was approved or activated =====
test('the rule set is approved (Phase 3I.14) and still disabled', () => {
  // SUPERSEDED BY PHASE 3I.14: formally approved — the activation guard below is unchanged.
  assert.equal(CONFIG.status, 'approved');
  assert.equal(leaf(CONFIG.parameters.activation.enabled), false);
  assert.equal(CONFIG.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
});
test('the raw configuration carries the approval but no activation', () => {
  const raw = readFileSync(configUrl, 'utf8');
  assert.doesNotMatch(raw, /"status"\s*:\s*"active"/);   // SUPERSEDED BY PHASE 3I.14
  assert.match(raw, /"approvedBy"\s*:\s*"JNV_RULE_APPROVAL_2026_PHASE3I15C"/);   // SUPERSEDED BY PHASE 3I.14
  assert.doesNotMatch(raw, /"enabled"\s*:\s*\{\s*"value"\s*:\s*true/);
});
test('the productive default is still disabled and produces no verdict', () => {
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false);
  const r = evaluateOneSixthRule({
    drivingProjection: { metadata: { dayType: 'saturday' }, circulations: [{ code: '1', drivingSegments: [] }] },
    turnaroundDetection: { status: 'complete', candidates: [] },
    ruleConfig: DEFAULT_ONE_SIXTH_RULE_CONFIG, context: { organization: 'JNV', mode: 'bus' }
  });
  assert.equal(r.status, 'DISABLED');
  assert.deepEqual(r.violations, []);
});
test('an activated rule set would validate — the release is a decision, not a technical gap', () => {
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

// ===== the remaining condition before an activation is stated, not hidden =====
test('the audit records the open implementation point that the deadhead decision makes visible', () => {
  const audit = doc('PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md');
  assert.match(audit, /SEGMENT_LINE_AMBIGUOUS|Linienzuordnung/, 'the deadhead/line-18 interaction is named');
  assert.match(audit, /Aktivierung/, 'the activation precondition is stated');
});
test('no engine, rule, validator, interface or explorer file was changed for this contract', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/analysis/one-sixth-check.js', '../js/v2/checks/check-runner.js',
    '../js/v2/ui/check-explorer.js', '../js/v2/analysis/driving-projection.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /3I\.12|PHASE-3I\.12/, `${path} must carry no Phase 3I.12 change`);
  }
});
test('the configuration holds no executable logic and no personal data', () => {
  const raw = readFileSync(configUrl, 'utf8');
  assert.doesNotMatch(raw, /function|=>|require\(|import |localStorage|fetch\(/);
  assert.doesNotMatch(raw, /\/Users\/|\/Volumes\/|C:\\\\/);
});
