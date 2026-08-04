import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3G.2 – deterministic JNV schedule validity resolver. Signals only from proven
// sources (structured dayQualifier, title/metadata, supporting filename). No time, no
// random, no rule evaluation, no interpretation beyond the closed contract.
import { resolveJnvScheduleValidity } from '../js/v2/matching/jnv-schedule-validity.js';

const source = readFileSync(new URL('../js/v2/matching/jnv-schedule-validity.js', import.meta.url), 'utf8');
const CONFIDENCE = ['exact', 'probable', 'ambiguous', 'unknown'];
const REGIMES = ['school', 'holidays', 'regular', 'special', 'unknown'];
const DAYTYPES = ['mo_fr', 'mo_do', 'friday', 'saturday', 'sunday', 'weekend', 'school_days', 'holidays', 'unknown'];

test('no time / random / storage / network', () => {
  assert.doesNotMatch(source, /Date\.now|Math\.random|new Date\(|localStorage|fetch\s*\(/);
});

test('a structured title "(Schule)" resolves the service regime to school', () => {
  const v = resolveJnvScheduleValidity({ metadata: { title: 'Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026' } });
  assert.equal(v.serviceRegime, 'school');
  assert.equal(v.dayType, 'mo_fr');
  assert.equal(v.confidence, 'exact');
});

test('a structured title "(Ferien)" resolves the service regime to holidays', () => {
  const v = resolveJnvScheduleValidity({ metadata: { title: 'Dienste Stadtbus Montag bis Freitag (Ferien)' } });
  assert.equal(v.serviceRegime, 'holidays');
});

test('a MON_THU day qualifier resolves the day type to mo_do', () => {
  const v = resolveJnvScheduleValidity({ hardened: { dayQualifiers: [{ code: 'MON_THU' }] } });
  assert.equal(v.dayType, 'mo_do');
  assert.ok(v.evidence.some(e => e.code === 'DAY_QUALIFIER_SIGNAL'));
});

test('a FRIDAY day qualifier resolves the day type to friday', () => {
  const v = resolveJnvScheduleValidity({ hardened: { dayQualifiers: [{ code: 'FRIDAY' }] } });
  assert.equal(v.dayType, 'friday');
});

test('contradictory Schule + Ferien signals → ambiguous with a conflict', () => {
  const v = resolveJnvScheduleValidity({ metadata: { title: 'Stadtbus (Schule)' }, sourceName: 'X_Ferien.pdf' });
  assert.equal(v.confidence, 'ambiguous');
  assert.ok(v.conflicts.includes('CONFLICTING_SERVICE_REGIME'));
});

test('MON_THU + FRIDAY qualifiers alone → ambiguous day type (no silent mo_fr fallback)', () => {
  const v = resolveJnvScheduleValidity({ hardened: { dayQualifiers: [{ code: 'MON_THU' }, { code: 'FRIDAY' }] } });
  assert.equal(v.dayType, 'unknown');
  assert.ok(v.conflicts.includes('CONFLICTING_DAY_TYPE') || v.warnings.some(w => w.code === 'AMBIGUOUS_SCHEDULE_VALIDITY'));
});

test('no signals → unknown', () => {
  const v = resolveJnvScheduleValidity({});
  assert.equal(v.serviceRegime, 'unknown');
  assert.equal(v.dayType, 'unknown');
  assert.equal(v.confidence, 'unknown');
  assert.ok(v.warnings.some(w => w.code === 'UNKNOWN_SCHEDULE_VALIDITY' || w.code === 'MISSING_VALIDITY_EVIDENCE'));
});

test('the filename alone is only a supporting signal — never exact', () => {
  const v = resolveJnvScheduleValidity({ sourceName: 'B_20260817_MoFr_Schule.pdf' });
  assert.equal(v.serviceRegime, 'school');
  assert.equal(v.dayType, 'mo_fr');
  assert.notEqual(v.confidence, 'exact');
  assert.ok(v.evidence.some(e => e.source === 'filename'));
});

test('output uses only the closed vocabulary and is JSON-compatible', () => {
  const v = resolveJnvScheduleValidity({ metadata: { title: 'Stadtbus Montag bis Freitag (Schule)' } });
  assert.ok(REGIMES.includes(v.serviceRegime) && DAYTYPES.includes(v.dayType) && CONFIDENCE.includes(v.confidence));
  assert.equal(JSON.stringify(v), JSON.stringify(JSON.parse(JSON.stringify(v))));
});

test('the resolver is deterministic and does not mutate its input', () => {
  const input = { metadata: { title: 'Stadtbus Montag bis Freitag (Schule)' }, hardened: { dayQualifiers: [{ code: 'MON_FRI' }] } };
  const snapshot = JSON.stringify(input);
  assert.deepEqual(resolveJnvScheduleValidity(input), resolveJnvScheduleValidity(input));
  assert.equal(JSON.stringify(input), snapshot);
});
