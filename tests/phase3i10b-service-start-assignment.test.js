import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.10b – the duty start is assigned PER EVALUATED CIRCULATION via the service number the
// circulation's driving segments already carry. Nothing is derived from a first trip, an earliest
// segment, a file name, a line or a circulation code.
import { evaluateOneSixthEligibility, ELIGIBILITY_STATUS } from '../js/v2/analysis/one-sixth-rule.js';
import { runJnvRuleAnalysis } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const ruleSrc = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');
const controllerSrc = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');

const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: ['SATURDAY', 'SUNDAY_HOLIDAY'], nightShiftIsException: true,
  nightShiftStart: '19:20', nightShiftStartInclusive: true,
  admissionLines: ['18'], admissionLineRequiresPureDuty: true
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

// two circulations, each bound to its own service number
const projection = (circulations) => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: null, generatedFrom: 'driving-projection', circulationCount: circulations.length },
  circulations: circulations.map(c => ({
    code: c.code,
    drivingSegments: (c.services ?? ['2101']).map((serviceNumber, i) => ({ serviceNumber, kind: 'service', line: '12', startMinutes: i * 60, endMinutes: i * 60 + 396, durationMinutes: 396, source: { serviceNumber, activityIndex: i, sourceType: 'pdf' } })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 396, nonDrivingMinutes: 0, knownTotalMinutes: 396 }, warnings: []
  })),
  warnings: []
});
const check = (circulations, eligibility) => evaluateOneSixthEligibility({
  drivingProjection: projection(circulations), ruleConfig: CONFIG, context: CONTEXT, eligibility
});
const circulationOf = (r, code) => r.circulations.find(c => c.circulationCode === code);

// ===== per-circulation assignment =====
test('a circulation with one service number uses that service duty start', () => {
  const r = check([{ code: 'a', services: ['2101'] }], { serviceStarts: { 2101: 19 * 60 + 20 } });
  assert.equal(circulationOf(r, 'a').nightShift, true);
  assert.equal(circulationOf(r, 'a').status, ELIGIBILITY_STATUS.PASS);
});
test('two circulations with different services get their own duty starts', () => {
  const r = check(
    [{ code: 'a', services: ['2101'] }, { code: 'b', services: ['2102'] }],
    { serviceStarts: { 2101: 19 * 60 + 20, 2102: 8 * 60 } }
  );
  assert.equal(circulationOf(r, 'a').nightShift, true, 'the night duty is eligible');
  assert.equal(circulationOf(r, 'a').status, ELIGIBILITY_STATUS.PASS);
  assert.equal(circulationOf(r, 'b').nightShift, false, 'the day duty is not');
  assert.equal(circulationOf(r, 'b').status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
  assert.equal(r.status, ELIGIBILITY_STATUS.PASS, 'at least one circulation stays evaluable');
});
test('several services with the same duty start remain usable', () => {
  const r = check([{ code: 'a', services: ['2101', '2102'] }], { serviceStarts: { 2101: 19 * 60 + 30, 2102: 19 * 60 + 30 } });
  assert.equal(circulationOf(r, 'a').nightShift, true);
});
test('several services with different duty starts are inconclusive, never guessed', () => {
  // SUPERSEDED BY PHASE 3I.24 — the circulation is split per duty, so each unit has ONE duty start
  // and the ambiguity dissolves. It was an artefact of assessing two drivers as one unit.
  const r = check([{ code: 'a', services: ['2101', '2102'] }], { serviceStarts: { 2101: 19 * 60 + 30, 2102: 8 * 60 } });
  const units = r.circulations.filter(c => c.circulationCode === 'a');
  assert.equal(units.length, 2, 'one unit per duty');
  assert.deepEqual(units.map(u => u.nightShift).sort(), [false, true], 'each duty gets its own answer');
  assert.ok(!units.some(u => u.warnings.some(w => w.code === 'DUTY_START_AMBIGUOUS')), 'nothing is ambiguous any more');
});
test('a missing duty start for the circulation service is inconclusive', () => {
  const r = check([{ code: 'a', services: ['2101'] }], { serviceStarts: { 2102: 1200 } });
  assert.equal(circulationOf(r, 'a').nightShift, null);
  assert.equal(circulationOf(r, 'a').status, ELIGIBILITY_STATUS.INCONCLUSIVE);
});
test('an invalid duty start value is refused rather than coerced', () => {
  for (const value of [null, NaN, Infinity, -1, '19:20']) {
    const r = check([{ code: 'a', services: ['2101'] }], { serviceStarts: { 2101: value } });
    assert.equal(circulationOf(r, 'a').nightShift, null, `value ${String(value)}`);
  }
});
test('the document-wide duty start still applies when no per-service value exists', () => {
  const r = check([{ code: 'a', services: ['2101'] }], { dutyStartMinutes: 19 * 60 + 20 });
  assert.equal(circulationOf(r, 'a').nightShift, true, 'the 3I.10 fallback keeps working');
});
test('a per-service value wins over the document-wide value', () => {
  const r = check([{ code: 'a', services: ['2101'] }], { dutyStartMinutes: 8 * 60, serviceStarts: { 2101: 19 * 60 + 20 } });
  assert.equal(circulationOf(r, 'a').nightShift, true, 'the more specific value is used');
});
test('nothing is derived from a first trip, earliest segment, file name, line or code', () => {
  const r = check([{ code: 'a', services: ['2101'] }], {});
  assert.equal(circulationOf(r, 'a').nightShift, null, 'no duty start means no claim');
  assert.doesNotMatch(ruleSrc, /firstTrip|earliestSegment|fileName|sourceName|circuitNumber|shiftNumber/);
});

// ===== the orchestrator builds the per-service map =====
const dutyAct = (svc) => ({
  serviceNumber: svc, circuitNumber: '12100',
  routeIdentity: { line: '12', course: '1', trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: 300, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: 380, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
const scenario = (services) => ({
  bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
  primaryImport: { canonicalSchedule: { hardened: { applied: true, services: services.map(s => ({
    serviceNumber: s.svc,
    begin: s.begin === undefined ? undefined : { value: '—', minutesSinceStartOfDay: s.begin, dayOffset: s.dayOffset ?? 0 },
    dutyActivities: [dutyAct(s.svc)]
  })) }, document: { sourceType: 'pdf' } } },
  companionImport: { document: createUmlauftafelDocument({ mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }), circulations: [createCirculation({ code: '12100', mode: 'bus' })] }) },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: ['12100'], companionRefs: ['12100'] }] } }
});
async function eligibilityOf(services) {
  let received = null;
  await runJnvRuleAnalysis(scenario(services), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    buildOneSixthCheck: (input) => { received = input.eligibility; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  return received;
}

test('the orchestrator provides a per-service duty start map', async () => {
  const e = await eligibilityOf([{ svc: '2101', begin: 300 }, { svc: '2102', begin: 1200 }]);
  assert.deepEqual(e.serviceStarts, { 2101: 300, 2102: 1200 }, 'each duty keeps its own start');
});
test('the map honours the existing day offset', async () => {
  const e = await eligibilityOf([{ svc: '2101', begin: 30, dayOffset: 1 }]);
  assert.deepEqual(e.serviceStarts, { 2101: 1470 });
});
test('a duty without a known start is simply absent from the map', async () => {
  const e = await eligibilityOf([{ svc: '2101', begin: 300 }, { svc: '2102', begin: undefined }]);
  assert.deepEqual(e.serviceStarts, { 2101: 300 });
});
test('the eligibility input stays small: only duty start values', async () => {
  const e = await eligibilityOf([{ svc: '2101', begin: 300 }]);
  assert.deepEqual(Object.keys(e).sort(), ['dutyStartMinutes', 'serviceStarts']);
  const serialized = JSON.stringify(e);
  assert.doesNotMatch(serialized, /segments|stops|circulations|canonicalSchedule|document|originalText|activities/i);
  assert.ok(serialized.length < 400, 'the payload stays tiny');
});
test('the orchestrator reads the duty start only from the existing begin field', () => {
  assert.match(controllerSrc, /begin\?\.minutesSinceStartOfDay/);
  assert.doesNotMatch(controllerSrc, /firstTrip|departureTime|earliest|fileName|sourceName/);
});
