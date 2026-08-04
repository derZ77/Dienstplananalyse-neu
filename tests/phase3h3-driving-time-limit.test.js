import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3H.3 – 4:30 (270 min) continuous driving-time rule. ONLY this rule: no 1/6, no
// Wendezeit, no ArbZG, no block pauses, no other BV rule. Config-driven, deterministic.
import { evaluateDrivingTimeLimit, DRIVING_TIME_RULE_STATUS } from '../js/v2/analysis/driving-time-limit-rule.js';

const src = readFileSync(new URL('../js/v2/analysis/driving-time-limit-rule.js', import.meta.url), 'utf8');
const CONFIG = { ruleId: 'BV008', enabled: true, maxContinuousDrivingMinutes: 270, qualifyingInterruption: { singleMinimumMinutes: 45, splitSequence: [15, 30] } };

const dseg = (start, dur, svc = '2101') => ({ serviceNumber: svc, kind: 'service', startMinutes: start, endMinutes: dur == null ? null : start + dur, durationMinutes: dur, source: { serviceNumber: svc, activityIndex: 0, sourceType: 'pdf' } });
const interruption = (start, dur, sourceType = 'break') => ({ startMinutes: start, endMinutes: dur == null ? null : start + dur, durationMinutes: dur, sourceType, explicit: true, sourceRefs: [{ serviceNumber: '2101', activityIndex: null, sourceType }] });
const nd = (start, dur, classification) => ({ startMinutes: start, endMinutes: start + dur, durationMinutes: dur, sourceType: classification, explicit: classification !== 'gap', classification });
const circ = (o) => ({ code: o.code ?? '12100', drivingSegments: o.drivingSegments ?? [], drivingBlocks: [], interruptionIntervals: o.interruptionIntervals ?? [], nonDrivingIntervals: o.nonDrivingIntervals ?? [], statistics: {}, warnings: [] });
const projection = (circulations) => ({ metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: circulations.length }, circulations, warnings: [] });
const run = (circulations, ruleConfig = CONFIG) => evaluateDrivingTimeLimit({ drivingProjection: projection(circulations), ruleConfig });
const one = (o, ruleConfig) => run([circ(o)], ruleConfig).circulations[0];

test('no 1/6 / Wendezeit / ArbZG / other BV rule logic in the module', () => {
  assert.doesNotMatch(src, /1\/6|BV015|BV016|BV017|BV018|Linie 18|19:20|Haltestellenabstand|8 Minuten|10 Minuten|ArbZG|Blockpause|Wendezeit|\bscore\b|fuzzy|Math\.random|localStorage|fetch\s*\(/i);
});

test('the closed rule status vocabulary is PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE/DISABLED', () => {
  assert.deepEqual(Object.values(DRIVING_TIME_RULE_STATUS).sort(), ['DISABLED', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'PASS']);
});

test('the rule output has ruleId, status, circulations, violations, warnings, statistics', () => {
  const r = run([circ({ drivingSegments: [dseg(0, 100)] })]);
  assert.deepEqual(Object.keys(r).sort(), ['circulations', 'ruleId', 'statistics', 'status', 'violations', 'warnings']);
  assert.equal(r.ruleId, 'BV008');
});

// ===== gate =====
test('an invalid / not-applicable driving projection → NOT_APPLICABLE', () => {
  const r = evaluateDrivingTimeLimit({ drivingProjection: { metadata: null, circulations: [], warnings: [] }, ruleConfig: CONFIG });
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.ok(r.warnings.some(w => w.code === 'INVALID_DRIVING_PROJECTION'));
});
test('a disabled rule → DISABLED (no evaluation)', () => {
  const r = run([circ({ drivingSegments: [dseg(0, 400)] })], { ...CONFIG, enabled: false });
  assert.equal(r.status, 'DISABLED');
  assert.deepEqual(r.violations, []);
});
test('an invalid config → DISABLED with a config warning', () => {
  const r = run([circ({ drivingSegments: [dseg(0, 100)] })], { ruleId: 'BV008', enabled: true, maxContinuousDrivingMinutes: 0 });
  assert.equal(r.status, 'DISABLED');
  assert.ok(r.warnings.some(w => w.code === 'RULE_CONFIGURATION_INVALID'));
});

// ===== threshold boundary =====
test('269 minutes → PASS, 270 → PASS, 271 → FAIL', () => {
  assert.equal(one({ drivingSegments: [dseg(0, 269)] }).status, 'PASS');
  assert.equal(one({ drivingSegments: [dseg(0, 270)] }).status, 'PASS');
  const fail = one({ drivingSegments: [dseg(0, 271)] });
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.violations[0].actualMinutes, 271);
  assert.equal(fail.violations[0].exceededByMinutes, 1);
  assert.equal(fail.violations[0].limitMinutes, 270);
});

// ===== qualifying interruption =====
test('a 45-minute interruption resets; 44 does not', () => {
  assert.equal(one({ drivingSegments: [dseg(0, 150), dseg(195, 150)], interruptionIntervals: [interruption(150, 45)] }).status, 'PASS');
  assert.equal(one({ drivingSegments: [dseg(0, 150), dseg(194, 150)], interruptionIntervals: [interruption(150, 44)] }).status, 'FAIL');
});

// ===== split interruption =====
test('a 15→30 split resets; 30→15 does not; a lone 15 stays incomplete; two 15s are not a 30', () => {
  assert.equal(one({ drivingSegments: [dseg(0, 200), dseg(245, 200)], interruptionIntervals: [interruption(200, 15), interruption(215, 30)] }).status, 'PASS');
  assert.equal(one({ drivingSegments: [dseg(0, 200), dseg(245, 100)], interruptionIntervals: [interruption(200, 30), interruption(230, 15)] }).status, 'FAIL');
  const incomplete = one({ drivingSegments: [dseg(0, 200), dseg(215, 100)], interruptionIntervals: [interruption(200, 15)] });
  assert.equal(incomplete.status, 'FAIL');
  assert.ok(incomplete.warnings.some(w => w.code === 'INCOMPLETE_SPLIT_INTERRUPTION'));
  assert.equal(one({ drivingSegments: [dseg(0, 200), dseg(230, 100)], interruptionIntervals: [interruption(200, 15), interruption(215, 15)] }).status, 'FAIL');
});

// ===== gaps / unknown never reset =====
test('a 60-minute gap does not reset; an unknown non-driving interval does not reset', () => {
  assert.equal(one({ drivingSegments: [dseg(0, 200), dseg(260, 100)], nonDrivingIntervals: [nd(200, 60, 'gap')] }).status, 'FAIL');
  assert.equal(one({ drivingSegments: [dseg(0, 200), dseg(260, 100)], nonDrivingIntervals: [nd(200, 60, 'unknown')] }).status, 'FAIL');
});

// ===== inconclusive =====
test('an interruption with unknown duration makes an exceedance INCONCLUSIVE (never a silent reset or a hard FAIL)', () => {
  const r = one({ drivingSegments: [dseg(0, 150), dseg(150, 150)], interruptionIntervals: [interruption(150, null)] });
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.ok(r.warnings.some(w => w.code === 'UNKNOWN_INTERRUPTION_QUALIFICATION'));
  assert.deepEqual(r.violations, []);
});
test('a missing driving-segment time → INCONCLUSIVE', () => {
  const r = one({ drivingSegments: [dseg(0, null)] });
  assert.equal(r.status, 'INCONCLUSIVE');
  assert.ok(r.warnings.some(w => w.code === 'MISSING_DRIVING_TIME'));
});

// ===== accumulation details =====
test('midnight-crossing driving accumulates in absolute minutes', () => {
  assert.equal(one({ drivingSegments: [dseg(1400, 100), dseg(1500, 180)] }).status, 'FAIL'); // 280 > 270 across midnight
});
test('multiple qualifying interruptions reset repeatedly', () => {
  const r = one({ drivingSegments: [dseg(0, 200), dseg(245, 200), dseg(490, 200)], interruptionIntervals: [interruption(200, 45), interruption(445, 45)] });
  assert.equal(r.status, 'PASS');
  assert.equal(r.resetCount, 2);
});

// ===== privacy / purity =====
test('a violation exposes only privacy-safe source refs', () => {
  const r = one({ drivingSegments: [dseg(0, 300)] });
  assert.ok(r.violations[0].sourceRefs.every(ref => !('originalText' in ref) && !('rawCells' in ref)));
  assert.equal(r.violations[0].circulationCode, '12100');
});
test('the evaluation is deterministic, JSON-compatible, and does not mutate inputs', () => {
  const input = { drivingProjection: projection([circ({ drivingSegments: [dseg(0, 271)] })]), ruleConfig: CONFIG };
  const snap = JSON.stringify(input);
  const a = evaluateDrivingTimeLimit(input);
  const b = evaluateDrivingTimeLimit(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snap);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
});
test('the top-level status aggregates the circulations (any FAIL → FAIL, else any INCONCLUSIVE → INCONCLUSIVE)', () => {
  assert.equal(run([circ({ code: 'a', drivingSegments: [dseg(0, 100)] }), circ({ code: 'b', drivingSegments: [dseg(0, 300)] })]).status, 'FAIL');
  assert.equal(run([circ({ code: 'a', drivingSegments: [dseg(0, 100)] }), circ({ code: 'b', drivingSegments: [dseg(0, null)] })]).status, 'INCONCLUSIVE');
  assert.equal(run([circ({ code: 'a', drivingSegments: [dseg(0, 100)] }), circ({ code: 'b', drivingSegments: [dseg(0, 200)] })]).status, 'PASS');
});
