import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { validateRuleConfig } = await import('../js/v2/rules/config/rule-config-validator.js');
const configBase = new URL('../js/v2/rules/config/', import.meta.url);
const load = async rel => JSON.parse(await readFile(new URL(rel, configBase), 'utf8'));

const SHIPPED = [
  'shared/arbeitszeit.v1.json', 'shared/lenkzeit.v1.json', 'shared/blockpause.v1.json',
  'organizations/jnv.v1.json', 'organizations/jes.v1.json'
];

function draft(parameters) {
  return { schemaVersion: '1.0', ruleSetId: 'test', organization: 'JNV', status: 'draft', validFrom: null, sourceReferences: [], approvedBy: null, parameters };
}

test('all shipped rule configs validate; no BEU organization config exists', async () => {
  for (const file of SHIPPED) {
    const report = validateRuleConfig(await load(file));
    assert.equal(report.valid, true, `${file}: ${JSON.stringify(report.errors)}`);
  }
  await assert.rejects(load('organizations/beu.v1.json')); // deleted
});

test('JNV org config carries the technical profile id beu-stadtbus-v1', async () => {
  const jnv = await load('organizations/jnv.v1.json');
  assert.equal(jnv.organization, 'JNV');
  assert.deepEqual(jnv.profileIds, ['beu-stadtbus-v1']);
});

test('JNV 1/6 config is draft and not enabled; open params marked', async () => {
  const jnv = await load('organizations/jnv.v1.json');
  assert.equal(jnv.status, 'draft');
  assert.equal(jnv.parameters.oneSixth.enabled.value, false);
  assert.equal(jnv.parameters.oneSixth.line18Scope.status, 'open');
  assert.equal(jnv.parameters.oneSixth.line18Scope.value, null);
  assert.equal(jnv.parameters.oneSixth.distanceComputation.value, null);
  assert.equal(jnv.parameters.turnaround.tariffReducedAutoActivate.value, false);
});

test('BEU is no longer a valid organization', () => {
  const cfg = draft({}); cfg.organization = 'BEU';
  assert.ok(validateRuleConfig(cfg).errors.some(e => e.code === 'UNKNOWN_ORGANIZATION'));
});

test('invalid time format rejected', () => {
  const r = validateRuleConfig(draft({ nightShift: { startTime: { value: '25:99', status: 'confirmed', format: 'time' } } }));
  assert.ok(!r.valid);
  assert.ok(r.errors.some(e => e.code === 'INVALID_TIME_FORMAT'));
});

test('negative numeric bound rejected', () => {
  const r = validateRuleConfig(draft({ x: { value: -5, status: 'confirmed', unit: 'minutes' } }));
  assert.ok(r.errors.some(e => e.code === 'INVALID_NUMERIC_BOUND'));
});

test('unknown ruleSet status rejected', () => {
  const cfg = draft({}); cfg.status = 'live';
  assert.ok(validateRuleConfig(cfg).errors.some(e => e.code === 'INVALID_STATUS'));
});

test('approved without source or approver rejected', () => {
  const cfg = draft({}); cfg.status = 'approved';
  const r = validateRuleConfig(cfg);
  assert.ok(!r.valid);
  assert.ok(r.errors.some(e => e.code === 'APPROVED_WITHOUT_SOURCE'));
  assert.ok(r.errors.some(e => e.code === 'APPROVED_WITHOUT_APPROVER'));
});

test('executable code in configuration is forbidden', () => {
  assert.ok(validateRuleConfig(draft({ a: { value: '() => 1', status: 'confirmed' } })).errors.some(e => e.code === 'EXECUTABLE_CODE_FORBIDDEN'));
  assert.ok(validateRuleConfig(draft({ b: { value: 'eval(x)', status: 'confirmed' } })).errors.some(e => e.code === 'EXECUTABLE_CODE_FORBIDDEN'));
});

test('open parameter must be null', () => {
  assert.ok(validateRuleConfig(draft({ o: { value: 3, status: 'open' } })).errors.some(e => e.code === 'OPEN_PARAMETER_NOT_NULL'));
});
