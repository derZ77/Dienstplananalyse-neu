import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.14 – what the EXISTING configuration validator does and does not guarantee about an
// approval. The validator is unchanged; this file only pins its behaviour, including the one
// guarantee it deliberately does not give.
import { validateRuleConfig, RULE_SET_STATUSES } from '../js/v2/rules/config/rule-config-validator.js';

const configUrl = new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url);
const CONFIG = JSON.parse(readFileSync(configUrl, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(CONFIG));
const codes = (config) => validateRuleConfig(config).errors.map(e => e.code);

// ===== the approval gate =====
test('the status vocabulary contains approved, and it is closed', () => {
  assert.deepEqual([...RULE_SET_STATUSES], ['draft', 'reviewed', 'approved', 'deprecated']);
  const invalid = { ...clone(), status: 'active' };
  assert.ok(codes(invalid).includes('INVALID_STATUS'), 'no invented status');
});
test('an approved rule set is accepted', () => {
  assert.deepEqual(codes(clone()), []);
});
test('an approved rule set without an approver is rejected', () => {
  const config = clone();
  config.approvedBy = null;
  assert.ok(codes(config).includes('APPROVED_WITHOUT_APPROVER'));
});
test('an approved rule set without a source reference is rejected', () => {
  const config = clone();
  config.sourceReferences = [];
  assert.ok(codes(config).includes('APPROVED_WITHOUT_SOURCE'));
});
test('an approved rule set with an open parameter is rejected', () => {
  const config = clone();
  config.parameters.calculation.deadheadTreatment = { value: null, status: 'open', unit: 'text' };
  assert.ok(codes(config).includes('APPROVED_WITH_OPEN_PARAMETERS'));
});
test('draft stays valid, with or without an approver', () => {
  const draft = { ...clone(), status: 'draft', approvedBy: null };
  assert.deepEqual(codes(draft), [], 'a draft needs no approver');
  const draftWithApprover = { ...clone(), status: 'draft' };
  assert.deepEqual(codes(draftWithApprover), []);
});
test('approvedBy must be a string or null — never anything else', () => {
  const config = clone();
  config.approvedBy = 42;
  assert.ok(codes(config).includes('INVALID_APPROVED_BY'));
});

// ===== enabled: what the validator does NOT guarantee =====
test('the approved rule set carries enabled false', () => {
  assert.equal(CONFIG.parameters.activation.enabled.value, false);
});
test('KNOWN LIMIT (Phase 3I.14): the validator does not block enabled:true — the activation guard lies elsewhere', () => {
  // `enabled` is an ordinary parameter leaf, so a flipped flag would validate. The productive
  // protection is that the productive path never reads this file: it uses the orchestrator default,
  // which is hard-wired to false. Approval therefore cannot activate anything by itself.
  const activated = clone();
  activated.parameters.activation.enabled = { value: true, status: 'confirmed', unit: 'flag' };
  assert.deepEqual(codes(activated), [], 'the validator raises no error — documented, not relied upon');

  const validator = readFileSync(new URL('../js/v2/rules/config/rule-config-validator.js', import.meta.url), 'utf8');
  assert.doesNotMatch(validator, /enabled/, 'the validator has no notion of activation at all');

  const controller = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  assert.match(controller, /enabled:\s*false/, 'the productive default is what keeps the rule off');
});
test('the productive path does not import the versioned rule set', () => {
  for (const path of ['../js/v2/analysis/jnv-rule-analysis-controller.js', '../js/v2/analysis/one-sixth-rule.js',
    '../js/v2/analysis/one-sixth-check.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /import[^\n]*jnv-one-sixth\.v1\.json|readFile[^\n]*jnv-one-sixth/,
      `${path} must not load the configuration file`);
  }
});

// ===== the validator itself is unchanged =====
test('the validator still forbids executable code in a parameter', () => {
  const config = clone();
  config.parameters.calculation.roundingRule = { value: '() => 1', status: 'confirmed', unit: 'text' };
  assert.ok(codes(config).includes('EXECUTABLE_CODE_FORBIDDEN'));
});
test('the validator still checks the parameter status vocabulary', () => {
  const config = clone();
  config.parameters.calculation.roundingRule = { value: 'ceil_to_full_minute', status: 'accepted', unit: 'text' };
  assert.ok(codes(config).includes('INVALID_PARAMETER_STATUS'));
});
test('the validator still checks the time format and numeric bounds', () => {
  const time = clone();
  time.parameters.eligibility.nightShiftStart = { value: '25:99', status: 'confirmed', format: 'time' };
  assert.ok(codes(time).includes('INVALID_TIME_FORMAT'));
  const minutes = clone();
  minutes.parameters.turnaround.minimumObservedSpanMinutes = { value: -1, status: 'confirmed', unit: 'minutes' };
  assert.ok(codes(minutes).includes('INVALID_NUMERIC_BOUND'));
});
