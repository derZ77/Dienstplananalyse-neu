import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.24 – the 1/6 rule assesses a DUTY, not a circulation, and one undecidable unit no
// longer takes every other one with it.
//
// Until now `evaluateOneSixthRule` returned an empty result as soon as the document-level
// eligibility verdict was anything but PASS — so a single `DUTY_START_AMBIGUOUS` circulation
// silenced twenty-five assessable ones. And a circulation driven by two duties was assessed as one
// unit, although the 1/6 rule is a rule about a driver's duty.
//
//   PASS + PASS + INCONCLUSIVE  →  document INCONCLUSIVE, but the two PASSes stay on the record.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6,
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  roundingRule: 'ceil_to_full_minute', minimumObservedSpanMinutes: 11, belowMinimumCreditedMinutes: 0, creditingMethod: 'full_observed_span',
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const segment = (serviceNumber, line, startMinutes, durationMinutes) => ({
  serviceNumber, kind: 'service', line, startMinutes, endMinutes: startMinutes + durationMinutes,
  durationMinutes, source: { serviceNumber, activityIndex: null, sourceType: 'umlauftafel' }
});
const circulation = (code, drivingSegments) => ({
  code, drivingSegments, drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
  services: [...new Set(drivingSegments.map(s => s.serviceNumber).filter(Boolean))],
  statistics: { drivingSegmentCount: drivingSegments.length, drivingBlockCount: 0, interruptionCount: 0,
    nonDrivingIntervalCount: 0, drivingMinutes: drivingSegments.reduce((t, s) => t + s.durationMinutes, 0),
    nonDrivingMinutes: 0, knownTotalMinutes: 0 },
  warnings: []
});
const projection = (circulations, dayType = 'mo_fr') => ({
  metadata: { serviceRegime: 'school', dayType, dutyStartTime: null, generatedFrom: 'test', circulationCount: circulations.length },
  circulations, warnings: []
});
const turnaround = (id, circulationCode, startMinutes, spanMinutes) => ({
  id, circulationCode, startMinutes, endMinutes: startMinutes + spanMinutes, observedSpanMinutes: spanMinutes,
  creditedMinutes: spanMinutes, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
});
const detection = (candidates) => ({ status: 'complete', candidates });
const run = (circulations, candidates, serviceStarts = {}, dayType = 'mo_fr') => evaluateOneSixthRule({
  drivingProjection: projection(circulations, dayType), turnaroundDetection: detection(candidates),
  ruleConfig: CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: null, serviceStarts }
});
const forService = (result, serviceNumber) => result.services.find(s => s.serviceNumber === serviceNumber);
// A duty of 300 driving minutes (required 50) with a 68-minute turnaround between its own trips.
const passingDuty = (code, serviceNumber, line = '18', from = 302) =>
  circulation(code, [segment(serviceNumber, line, from, 150), segment(serviceNumber, line, from + 218, 150)]);
const passingTurnaround = (id, code, from = 302) => turnaround(id, code, from + 150, 68);

// ===== A. the real duty 2221 (pure line 18) stays PASS =====
test('A: 2221 is admitted through line 18 and passes', () => {
  const result = run(
    [circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150)])],
    [turnaround('t1', '18100', 452, 68)]                       // the gap between its own two trips
  );
  const duty = forService(result, '2221');
  assert.equal(duty.status, 'PASS');
  assert.equal(duty.eligibilityReason, 'PURE_LINE_18');
  assert.equal(duty.drivingMinutes, 300);
  assert.equal(duty.requiredMinutes, 50, 'ceil(300/6)');
  assert.equal(duty.creditedMinutes, 68);
});
test('A: the result carries the full per-duty shape', () => {
  const result = run([circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150)])], [turnaround('t1', '18100', 452, 68)]);
  const duty = forService(result, '2221');
  for (const key of ['serviceNumber', 'status', 'eligibilityReason', 'drivingMinutes', 'requiredMinutes',
    'creditedMinutes', 'violations', 'warnings']) {
    assert.ok(key in duty, `the duty result must carry ${key}`);
  }
});

// ===== B. the real duty 2299 (night shift) stays PASS =====
test('B: 2299 is admitted as a night shift and passes', () => {
  const result = run(
    [circulation('10901', [segment('2299', '10', 1306, 120), segment('2299', '10', 1470, 118)])],
    [turnaround('t1', '10901', 1426, 44)],
    { 2299: 21 * 60 + 36 }
  );
  const duty = forService(result, '2299');
  assert.equal(duty.status, 'PASS');
  assert.equal(duty.eligibilityReason, 'NIGHT_SHIFT');
  assert.equal(duty.drivingMinutes, 238);
  assert.equal(duty.requiredMinutes, 40, 'ceil(238/6)');
});

// ===== C. an undecidable duty no longer blocks the others =====
test('C: two assessable duties survive an undecidable third', () => {
  const result = run([
    passingDuty('18100', '2221'),
    passingDuty('10901', '2299', '10', 1306),
    circulation('12100', [segment(null, null, 400, 200)])          // no duty, no line → undecidable
  ], [passingTurnaround('t1', '18100'), passingTurnaround('t2', '10901', 1306)], { 2299: 21 * 60 + 36 });

  assert.equal(forService(result, '2221').status, 'PASS');
  assert.equal(forService(result, '2299').status, 'PASS');
  assert.equal(result.statistics.passedServices, 2, 'both confirmed results stay on the record');
  assert.ok(result.services.some(s => s.status === 'INCONCLUSIVE'), 'and the undecidable one is reported as such');
});
test('C: the document says INCONCLUSIVE, but never empties the result', () => {
  const result = run([
    passingDuty('18100', '2221'),
    circulation('12100', [segment(null, null, 400, 200)])
  ], [passingTurnaround('t1', '18100')]);
  assert.equal(result.status, 'INCONCLUSIVE', 'the weaker verdict still decides the document');
  assert.equal(result.services.length, 2, 'and both units are still there');
  assert.equal(result.statistics.evaluatedServices, 2);
});

// ===== D. aggregation over PASS + FAIL + INCONCLUSIVE =====
test('D: FAIL wins over INCONCLUSIVE and INCONCLUSIVE over PASS', () => {
  const result = run([
    passingDuty('18100', '2221'),                                                  // PASS
    circulation('18200', [segment('2222', '18', 302, 600)]),                       // FAIL (no credit)
    circulation('12100', [segment(null, null, 400, 200)])                          // INCONCLUSIVE
  ], [passingTurnaround('t1', '18100')]);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.statistics.passedServices, 1);
  assert.equal(result.statistics.failedServices, 1);
  assert.equal(result.statistics.inconclusiveServices, 1);
});
test('D: without a FAIL the inconclusive one decides', () => {
  const result = run([
    passingDuty('18100', '2221'),
    circulation('12100', [segment(null, null, 400, 200)])
  ], [passingTurnaround('t1', '18100')]);
  assert.equal(result.status, 'INCONCLUSIVE');
});
test('D: only passing duties give a passing document', () => {
  const result = run([
    passingDuty('18100', '2221'),
    passingDuty('18200', '2222')
  ], [passingTurnaround('t1', '18100'), passingTurnaround('t2', '18200')]);
  assert.equal(result.status, 'PASS');
  assert.equal(result.statistics.passedServices, 2);
});
test('D: a failing duty produces exactly one violation, on itself', () => {
  const result = run([
    passingDuty('18100', '2221'),
    circulation('18200', [segment('2222', '18', 302, 600)])
  ], [passingTurnaround('t1', '18100')]);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].serviceNumber, '2222');
});

// ===== E. one circulation, two duties → two results =====
test('E: a circulation driven by two duties yields TWO duty results', () => {
  // 18100 is driven by 2221 (05:02–12:52) and 2278 (12:52–20:57) — the vehicle day, two drivers.
  const result = run(
    [circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150),
      segment('2278', '18', 772, 150), segment('2278', '18', 990, 150)])],
    [turnaround('t1', '18100', 452, 68), turnaround('t2', '18100', 922, 68)]
  );
  assert.equal(result.services.length, 2);
  assert.deepEqual(result.services.map(s => s.serviceNumber).sort(), ['2221', '2278']);
});
test('E: each duty gets only ITS own driving time and credits', () => {
  const result = run(
    [circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150),
      segment('2278', '18', 772, 150), segment('2278', '18', 990, 150)])],
    [turnaround('t1', '18100', 452, 68), turnaround('t2', '18100', 922, 68)]
  );
  assert.equal(forService(result, '2221').drivingMinutes, 300, 'not the 600 of the whole vehicle day');
  assert.equal(forService(result, '2278').drivingMinutes, 300);
  assert.equal(forService(result, '2221').creditedMinutes, 68, 'the turnaround inside its own window');
  assert.equal(forService(result, '2278').creditedMinutes, 68);
});
test('E: a single-duty circulation is unchanged — one unit, all its credits', () => {
  const result = run([passingDuty('18100', '2221')], [passingTurnaround('t1', '18100')]);
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0].creditedMinutes, 68);
  assert.equal(result.services[0].circulationCode, '18100', 'the circulation reference stays visible');
});

// ===== F. no status carries over between duties =====
test('F: a failing duty leaves its neighbour untouched', () => {
  const result = run(
    [circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150),
      segment('2278', '18', 772, 900)])],
    [turnaround('t1', '18100', 452, 68)]
  );
  assert.equal(forService(result, '2221').status, 'PASS');
  assert.equal(forService(result, '2278').status, 'FAIL', 'no credit of its own');
  assert.equal(forService(result, '2221').violations.length, 0, 'the neighbour carries no violation');
});
test('F: an undecidable duty leaves its neighbour untouched', () => {
  const result = run(
    [circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150),
      segment(null, null, 772, 300)])],
    [turnaround('t1', '18100', 452, 68)]
  );
  assert.equal(forService(result, '2221').status, 'PASS');
  assert.equal(forService(result, '2221').eligibilityReason, 'PURE_LINE_18');
  assert.ok(result.services.some(s => s.serviceNumber === null && s.status === 'INCONCLUSIVE'));
});
test('F: an ineligible duty is NOT_APPLICABLE and nothing else', () => {
  const result = run([
    circulation('12100', [segment('2201', '12', 480, 300)]),                       // weekday, line 12, day start
    passingDuty('18100', '2221')
  ], [passingTurnaround('t1', '18100')], { 2201: 8 * 60 });
  assert.equal(forService(result, '2201').status, 'NOT_APPLICABLE');
  assert.equal(forService(result, '2221').status, 'PASS');
  assert.equal(result.statistics.notApplicableServices, 1);
});

// ===== G. the circulation data is not changed =====
test('G: the projection is not mutated', () => {
  const circulations = [circulation('18100', [segment('2221', '18', 302, 150), segment('2221', '18', 520, 150),
    segment('2278', '18', 772, 300)])];
  const before = JSON.stringify(circulations);
  run(circulations, [turnaround('t1', '18100', 452, 68)]);
  assert.equal(JSON.stringify(circulations), before);
});
test('G: matcher, identity layer and duty resolver carry no 3I.24 change', () => {
  for (const path of ['../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/identity/operational-circuit-identity.js',
    '../js/v2/schedule/duty-operational-day.js', '../js/v2/analysis/one-sixth-validation.js']) {
    assert.doesNotMatch(src(path), /3I\.24/, `${path} must be untouched`);
  }
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.parameters.activation.enabled.value, false);
});
