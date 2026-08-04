import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.2 – controlled correction of the EXISTING jnv.v1.json: the 8-minute tariff reduction
// was factually wrong for JNV. The correction is safe because no productive code reads this file.
import { validateRuleConfig } from '../js/v2/rules/config/rule-config-validator.js';

const raw = readFileSync(new URL('../js/v2/rules/config/organizations/jnv.v1.json', import.meta.url), 'utf8');
const config = JSON.parse(raw);
const turnaround = config.parameters.turnaround;

test('the corrected jnv.v1.json still validates against the existing validator', () => {
  const result = validateRuleConfig(config);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('the 8-minute tariff reduction is removed as an active value', () => {
  assert.equal(turnaround.tariffReducedMinutes.value, null);
  assert.notEqual(turnaround.tariffReducedMinutes.value, 8);
  assert.doesNotMatch(JSON.stringify(turnaround), /"value":\s*8\b/);
});

test('the tariff reduction is explicitly marked as not applicable and never auto-activated', () => {
  assert.equal(turnaround.tariffReducedApplicable.value, false);
  assert.equal(turnaround.tariffReducedApplicable.status, 'confirmed');
  assert.equal(turnaround.tariffReducedAutoActivate.value, false);
});

test('the binding JNV turnaround minimums are unchanged', () => {
  assert.equal(turnaround.minimumCreditableMinutes.value, 10);
  assert.equal(turnaround.technicalMinutes.value, 1);
  assert.equal(turnaround.minimumActualMinutes.value, 11);
});

test('the remaining jnv.v1.json contract is untouched (1/6 still disabled, open questions kept)', () => {
  assert.equal(config.organization, 'JNV');
  assert.equal(config.status, 'draft');
  assert.equal(config.parameters.oneSixth.enabled.value, false);
  assert.equal(config.parameters.oneSixth.line18Scope.status, 'open');
  assert.equal(config.parameters.oneSixth.averageStopDistanceMaxMetersExclusive.value, 3000);
  assert.equal(config.parameters.nightShift.startTime.value, '19:20');
});

test('no productive module reads jnv.v1.json, so the correction cannot change behaviour', async () => {
  // guard the audited fact: only tests consume this configuration file
  const { readdirSync, statSync } = await import('node:fs');
  const root = new URL('../js/', import.meta.url);
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = new URL(entry, dir);
      if (statSync(path).isDirectory()) walk(new URL(`${entry}/`, dir));
      else if (entry.endsWith('.js') && readFileSync(path, 'utf8').includes('organizations/jnv.v1.json')) hits.push(entry);
    }
  };
  walk(root);
  assert.deepEqual(hits, [], `unexpected productive consumer(s): ${hits.join(', ')}`);
});
