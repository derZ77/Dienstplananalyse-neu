import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.23 – the operational day on the DUTY ROSTER side.
//
// The Umlauftafel side was resolved in Phase 3I.21/3I.22. The roster has the very same gap: the
// Excel import reads a clock string and never asks which day it belongs to, so a night duty
//
//     21:36 → 03:14 → 04:24
//
// arrives with `dayOffset` 0 throughout and therefore runs BACKWARDS. Every consumer that compares
// times then fails: the segment attribution finds no duty window, the segments keep
// `serviceNumber: null`, and the rule never reaches the night-shift path.
//
// The rule is the one the roster itself implies, and nothing more:
//   inside ONE duty, whenever a following time is smaller than the previous one, the day advances.
import { resolveDutyOperationalDays } from '../js/v2/schedule/duty-operational-day.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const clock = (value) => {
  const [h, m] = value.split(':').map(Number);
  return { raw: value, value, minutesSinceStartOfDay: h * 60 + m };
};
const activity = (dep, arr, over = {}) => ({ circuitNumber: '10/9', departureTime: clock(dep), arrivalTime: clock(arr), ...over });
const duty = (serviceNumber, begin, end, activities) => ({ serviceNumber, begin: clock(begin), end: clock(end), activities });
const schedule = (services) => ({ type: 'CanonicalSchedule', services });
const absOf = (t) => (t?.dayOffset ?? 0) * 1440 + (t?.minutesSinceStartOfDay ?? 0);
const chainOf = (service) => [service.begin, ...service.activities.flatMap(a => [a.departureTime, a.arrivalTime]), service.end];

// ===== A. the real night duty 2299 =====
const NIGHT = () => schedule([duty('2299', '21:36', '04:24', [activity('21:46', '03:14'), activity('03:14', '04:24', { circuitNumber: '' })])]);

test('A: 21:36 → 03:14 → 04:24 gets the day offsets the roster implies', () => {
  const resolved = resolveDutyOperationalDays(NIGHT());
  const [begin, dep1, arr1, dep2, arr2, end] = chainOf(resolved.schedule.services[0]);
  assert.deepEqual([begin, dep1, arr1, dep2, arr2, end].map(t => t.dayOffset), [0, 0, 1, 1, 1, 1]);
});
test('A: the duty then runs strictly forwards', () => {
  const chain = chainOf(resolveDutyOperationalDays(NIGHT()).schedule.services[0]).map(absOf);
  for (let i = 1; i < chain.length; i += 1) assert.ok(chain[i] >= chain[i - 1], `step ${i} must not go backwards`);
  assert.equal(chain[0], 21 * 60 + 36);
  assert.equal(chain[chain.length - 1], 1440 + 4 * 60 + 24, 'the duty ends on the next calendar day');
});
test('A: the duty window now covers its own activities', () => {
  const service = resolveDutyOperationalDays(NIGHT()).schedule.services[0];
  const first = service.activities[0];
  assert.equal(absOf(first.departureTime), 21 * 60 + 46);
  assert.equal(absOf(first.arrivalTime), 1440 + 3 * 60 + 14, 'no longer 194 — the window stops running backwards');
  assert.ok(absOf(first.arrivalTime) > absOf(first.departureTime));
});
test('A: the shift is reported per duty, never silent', () => {
  const result = resolveDutyOperationalDays(NIGHT());
  assert.ok(result.warnings.some(w => w.code === 'DUTY_CROSSES_OPERATIONAL_DAY' && w.serviceNumber === '2299' && w.dayOffsets === 1));
});

// ===== B. an ordinary day duty gets no offset at all =====
test('B: a plain morning duty stays on day 0', () => {
  const resolved = resolveDutyOperationalDays(schedule([duty('2221', '04:52', '12:57', [activity('05:02', '12:52')])]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 0, 0]);
});
test('B: a duty running to 23:59 stays on day 0', () => {
  const resolved = resolveDutyOperationalDays(schedule([duty('2250', '15:00', '23:59', [activity('15:10', '23:50')])]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 0, 0]);
  assert.deepEqual(resolved.warnings, []);
});
test('B: equal consecutive times are not a day change', () => {
  // 12:52 → 12:52 is a handover, not a new day.
  const resolved = resolveDutyOperationalDays(schedule([duty('2278', '12:42', '20:57', [activity('12:52', '12:52'), activity('12:52', '20:57')])]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 0, 0, 0, 0]);
});

// ===== C. several day changes inside one duty =====
test('C: a second backward step advances the day again', () => {
  const resolved = resolveDutyOperationalDays(schedule([duty('9001', '22:00', '23:00', [activity('23:30', '01:00'), activity('23:45', '00:30')])]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 1, 1, 2, 2]);
});
test('C: the reported offset count is the highest one reached', () => {
  const result = resolveDutyOperationalDays(schedule([duty('9001', '22:00', '23:00', [activity('23:30', '01:00'), activity('23:45', '00:30')])]));
  assert.equal(result.warnings.find(w => w.serviceNumber === '9001').dayOffsets, 2);
});
test('C: every duty is resolved on its own', () => {
  const resolved = resolveDutyOperationalDays(schedule([
    duty('2221', '04:52', '12:57', [activity('05:02', '12:52')]),
    duty('2299', '21:36', '04:24', [activity('21:46', '03:14')])
  ]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 0, 0], 'the day duty is untouched');
  assert.deepEqual(chainOf(resolved.schedule.services[1]).map(t => t.dayOffset), [0, 0, 1, 1], 'the night duty advances');
});

// ===== D. the 03:00 boundary =====
test('D: 02:59 → 03:00 inside a night duty stays on the same advanced day', () => {
  const resolved = resolveDutyOperationalDays(schedule([duty('9002', '21:00', '03:30', [activity('23:50', '02:59'), activity('03:00', '03:30')])]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 1, 1, 1, 1]);
});
test('D: a duty that BEGINS after 03:00 never advances for that reason alone', () => {
  const resolved = resolveDutyOperationalDays(schedule([duty('9003', '03:14', '04:23', [activity('03:14', '04:23')])]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 0, 0], 'the boundary alone shifts nothing');
});
test('D: only a backward step advances the day — the clock value itself never does', () => {
  const resolved = resolveDutyOperationalDays(schedule([duty('9004', '00:10', '02:50', [activity('00:20', '02:40')])]));
  assert.deepEqual(chainOf(resolved.schedule.services[0]).map(t => t.dayOffset), [0, 0, 0, 0],
    'an early-morning duty is a duty, not a continuation');
});

// ===== E. the raw data stays untouched =====
test('E: the input schedule is not mutated', () => {
  const input = NIGHT();
  const before = JSON.stringify(input);
  resolveDutyOperationalDays(input);
  assert.equal(JSON.stringify(input), before, 'a new schedule is returned, the old one is left alone');
});
test('E: the resolved schedule is a different object', () => {
  const input = NIGHT();
  const resolved = resolveDutyOperationalDays(input);
  assert.notEqual(resolved.schedule, input);
  assert.notEqual(resolved.schedule.services[0], input.services[0]);
});
test('E: every other field survives verbatim', () => {
  const input = NIGHT();
  const service = resolveDutyOperationalDays(input).schedule.services[0];
  assert.equal(service.serviceNumber, '2299');
  assert.equal(service.activities[0].circuitNumber, '10/9');
  assert.equal(service.activities[0].departureTime.raw, '21:46');
  assert.equal(service.activities[0].departureTime.value, '21:46', 'the clock string is never rewritten');
  assert.equal(service.activities[0].arrivalTime.minutesSinceStartOfDay, 3 * 60 + 14, 'the raw minute stays what it was');
});
test('E: a schedule without services is handled without throwing', () => {
  assert.deepEqual(resolveDutyOperationalDays({ type: 'CanonicalSchedule' }).schedule.services, []);
  assert.deepEqual(resolveDutyOperationalDays(null).schedule.services, []);
});
test('E: an unreadable time is left alone instead of guessed', () => {
  const broken = schedule([duty('9005', '21:00', '22:00', [{ circuitNumber: '1/1', departureTime: { raw: 'x', value: null, minutesSinceStartOfDay: null }, arrivalTime: clock('21:30') }])]);
  const resolved = resolveDutyOperationalDays(broken);
  const [, dep, arr] = chainOf(resolved.schedule.services[0]);
  assert.equal(dep.minutesSinceStartOfDay, null, 'nothing is invented for it');
  assert.equal(arr.dayOffset, 0, 'and it does not disturb the rest of the chain');
});

// ===== F. the effect the phase exists for =====
test('F: with the resolved schedule a segment falls inside its duty window again', () => {
  // The joint timeline attributes a board segment to the ONE duty whose window contains it.
  const service = resolveDutyOperationalDays(NIGHT()).schedule.services[0];
  const from = absOf(service.activities[0].departureTime);
  const to = absOf(service.activities[0].arrivalTime);
  const segment = { from: 22 * 60, to: 1440 + 2 * 60 };        // a trip at 22:00 → 02:00 (+1)
  assert.ok(segment.from >= from && segment.to <= to, 'contained — the attribution can find its duty');
});
test('F: without the resolver that same segment fits nowhere', () => {
  const service = NIGHT().services[0];
  const from = absOf(service.activities[0].departureTime);
  const to = absOf(service.activities[0].arrivalTime);
  assert.ok(to < from, 'the unresolved window runs backwards');
  assert.ok(!(22 * 60 >= from && 1440 + 2 * 60 <= to), 'so nothing can ever be contained in it');
});

// ===== G. no professional module was touched =====
test('G: rule, validator, matcher, joint timeline and the Umlauftafel layer carry no 3I.23 change', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/identity/operational-circuit-identity.js', '../js/v2/umlauftafel/umlauftafel-time.js']) {
    assert.doesNotMatch(src(path), /3I\.23|resolveDutyOperationalDays/, `${path} must be untouched`);
  }
});
test('G: the rule set stays approved and disabled', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});
test('G: the resolver contains no line logic of its own', () => {
  const resolver = src('../js/v2/schedule/duty-operational-day.js');
  assert.doesNotMatch(resolver, /\bline\b|admissionLine|nightShift/, 'it moves days, it decides nothing professional');
});
