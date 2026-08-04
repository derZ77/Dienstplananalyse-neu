import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.6 – ONE shared CheckReport for BV008 and the turnaround-quota check. Both rules are
// independent: neither status influences the other, and a broken module never removes the other
// result. Everything below runs through the REAL orchestrator and the REAL runner.
import { runJnvRuleAnalysis, DEFAULT_DRIVING_TIME_RULE_CONFIG, DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import {
  createUmlauftafelDocument, createValidity, createCirculation, createSegment, createStopEvent, createNormalizedTime
} from '../js/v2/umlauftafel/umlauftafel-contract.js';

const CODE = '12100';

// An explicitly ENABLED test configuration. The productive default stays draft/disabled; only
// tests activate the rule, and only by injection — never by touching product code.
const ENABLED_ONE_SIXTH = Object.freeze({ ...DEFAULT_ONE_SIXTH_RULE_CONFIG, enabled: true });

const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: '12', course: '1', trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: o.depMin, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: o.arrMin, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
// SUPERSEDED BY PHASE 3I.10b: since the eligibility chain is live over the productive path, these
// fixtures carry a night-shift duty start so they keep exercising the quota and report behaviour
// they were written for instead of being filtered out as an ineligible weekday duty.
const schedule = (driveMinutes, { arrMissing = false } = {}) => ({ hardened: { applied: true, services: [{ serviceNumber: '2101', begin: { value: '—', minutesSinceStartOfDay: 19 * 60 + 20, dayOffset: 0 }, dutyActivities: [
  dutyAct({ svc: '2101', code: CODE, depMin: 300, arrMin: arrMissing ? null : 300 + driveMinutes })
] }] }, document: { sourceType: 'pdf' } });

const stop = (name, minutes, sequence) => createStopEvent({
  sequence, name, time: createNormalizedTime({ raw: '—', hour: Math.floor(minutes / 60), minute: minutes % 60 })
});
const trip = (sequence, from, to, departureMinutes, arrivalMinutes) => createSegment({
  type: 'service_trip', sequence, line: '12',
  stops: [stop(from, departureMinutes, 1), stop(to, arrivalMinutes, 2)]
});
// A circulation with two adjacent service trips; the gap between them is the observed turnaround.
const umlDoc = (segments = []) => createUmlauftafelDocument({
  mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }),
  circulations: [createCirculation({ code: CODE, mode: 'bus', segments })]
});
const withTurnaround = (spanMinutes) => umlDoc([
  trip(1, 'Zentrum', 'Endstelle', 300, 360),
  trip(2, 'Endstelle', 'Zentrum', 360 + spanMinutes, 420 + spanMinutes)
]);

const scenario = ({ driveMinutes = 80, arrMissing = false, document = umlDoc() } = {}) => ({
  bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
  primaryImport: { canonicalSchedule: schedule(driveMinutes, { arrMissing }) },
  companionImport: { document },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: [CODE], companionRefs: [CODE] }] } }
});

const detectionOf = (candidates, status = 'complete') => () => ({
  status, candidates, warnings: [],
  statistics: { candidateCount: candidates.length, qualifiedCount: candidates.length, belowMinimumCount: 0, unresolvedCount: 0 }
});
const candidate = (creditedMinutes) => ({
  id: `${CODE}#1->2`, circulationCode: CODE,
  previousSegmentRef: { circulationCode: CODE, sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: CODE, sequence: 2, type: 'service_trip' },
  startMinutes: 360, endMinutes: 360 + creditedMinutes, observedSpanMinutes: creditedMinutes,
  creditedMinutes, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
});

const byId = (report, id) => report.results.find(r => r.id === id);
const run = (input, deps) => runJnvRuleAnalysis(input, deps);

// ===== productive state: the rule set is still disabled =====
test('the productive run produces ONE report with exactly two results', async () => {
  const r = await run(scenario());
  assert.equal(r.status, 'completed');
  assert.equal(r.checkReport.type, 'CheckReport');
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.ok(r.checkReport.results.length >= 2);
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.ok(r.checkReport.summary.resultCount >= 2);
  assert.ok(r.checkReport.summary.moduleCount >= 2);
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.deepEqual([...r.checkReport.results.map(x => x.id)].filter(id => ['BV008','BV015_BV018'].includes(id)), ['BV008', 'BV015_BV018']);
});
test('the disabled turnaround-quota rule reports SKIP/INFO with the original status visible', async () => {
  const r = await run(scenario());
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'INFO');
  assert.equal(one.details.originalStatus, 'DISABLED');
  assert.deepEqual(one.details.violations, []);
  assert.deepEqual(one.affectedServices, []);
});
test('BV008 runs unchanged next to the disabled rule and still owns the hit count', async () => {
  const pass = await run(scenario({ driveMinutes: 80 }));
  assert.equal(byId(pass.checkReport, 'BV008').status, 'PASS');
  // SUPERSEDED BY PHASE 3I.29: the BV modules join the report, so absolute counts grew. The
  // protective statement — BV008 and the 1/6 rule are present and unharmed — is kept.
  assert.equal(byId(pass.checkReport, 'BV008').status, 'PASS', 'BV008 itself contributes no hit');
  assert.deepEqual(pass.checkReport.errors, []);

  const fail = await run(scenario({ driveMinutes: 300 }));
  assert.equal(byId(fail.checkReport, 'BV008').status, 'FAIL');
  assert.equal(byId(fail.checkReport, 'BV008').severity, 'VIOLATION');
  assert.equal(fail.checkReport.summary.hitCount, 1, 'only the real FAIL counts');
  assert.equal(byId(fail.checkReport, 'BV015_BV018').status, 'SKIP');
  assert.deepEqual(fail.checkReport.errors, []);
});

// ===== enabled TEST configuration (injected, never productive) =====
test('an enabled rule with sufficient credited turnaround reports PASS/INFO', async () => {
  // 300 driving minutes → required ceil(300/6) = 50; a credited turnaround of 60 satisfies it.
  const r = await run({ ...scenario({ driveMinutes: 300 }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([candidate(60)]) });
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'PASS');
  assert.equal(one.severity, 'INFO');
  assert.equal(one.details.originalStatus, 'PASS');
  assert.equal(one.details.services[0].requiredMinutes, 50);
  assert.equal(one.details.services[0].creditedMinutes, 60);
});
test('an enabled rule with too little credited turnaround reports FAIL/VIOLATION', async () => {
  const r = await run({ ...scenario({ driveMinutes: 300 }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([candidate(20)]) });
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'FAIL');
  assert.equal(one.severity, 'VIOLATION');
  assert.equal(one.details.violations.length, 1);
  assert.equal(one.details.violations[0].deficitMinutes, 30);
  assert.deepEqual(one.affectedServices, ['2101']);
});
test('an enabled rule without usable turnaround data reports SKIP/WARNING (inconclusive)', async () => {
  // 240 driving minutes stay inside the BV008 limit, so the report has no hit at all: an
  // inconclusive quota result must never produce one.
  const r = await run({ ...scenario({ driveMinutes: 240 }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([], 'not_applicable') });
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'WARNING');
  assert.equal(one.details.originalStatus, 'INCONCLUSIVE');
  assert.ok(one.details.warnings.some(w => w.code === 'TURNAROUND_DATA_UNAVAILABLE'));
  assert.equal(byId(r.checkReport, 'BV008').status, 'PASS');
  assert.equal(r.checkReport.summary.hitCount, 0, 'inconclusive is never a hit');
});
// SUPERSEDED BY PHASE 3I.19 — the driving basis is the Umlauftafel now, and this fixture's board
// sheet carries TWO trips of 60 minutes, not the single one the roster declared. The crediting
// itself is untouched: the 12-minute span is still credited in full, it is simply measured against
// the real 120 minutes (required 20) instead of an incomplete 60.
test('the real detector on a real Umlauftafel feeds the enabled rule end to end', async () => {
  const r = await run({ ...scenario({ driveMinutes: 60, document: withTurnaround(12) }), oneSixthConfig: ENABLED_ONE_SIXTH });
  const one = byId(r.checkReport, 'BV015_BV018');
  // SUPERSEDED BY PHASE 3I.24: the basis is the DUTY's own trips. Only the first board trip lies
  // inside this duty's window, so 60 minutes are its basis; the second belongs to no duty.
  assert.equal(one.details.services[0].drivingMinutes, 60, 'the duty\'s own trip');
  assert.equal(one.details.services[0].requiredMinutes, 10, 'ceil(60/6)');
  // SUPERSEDED BY PHASE 3I.24: the turnaround leads from this duty's trip to a trip that belongs to
  // NO duty. It therefore lies between units and is credited to neither — reported, never guessed.
  assert.equal(one.details.services[0].creditedMinutes, 0, 'the turnaround does not lie inside one duty');
  assert.ok(one.details.warnings.some(w => (w.code || w) === 'TURNAROUND_BETWEEN_DUTIES'));
  assert.equal(one.status, 'FAIL', 'nothing credited against 10 required');
});
test('a real observed span below the minimum credits nothing and fails the enabled rule', async () => {
  const r = await run({ ...scenario({ driveMinutes: 60, document: withTurnaround(10) }), oneSixthConfig: ENABLED_ONE_SIXTH });
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'FAIL');
  assert.equal(one.details.services[0].creditedMinutes, 0);
  // SUPERSEDED BY PHASE 3I.29: the BV modules join the report, so absolute counts grew. The
  // protective statement — BV008 and the 1/6 rule are present and unharmed — is kept.
  assert.ok(r.checkReport.summary.hitCount >= 1);
});

// ===== summary / hit count aggregation =====
test('both failing rules aggregate to a hit count of two in the shared summary', async () => {
  const r = await run({ ...scenario({ driveMinutes: 300 }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([candidate(20)]) });
  assert.equal(byId(r.checkReport, 'BV008').status, 'FAIL');
  assert.equal(byId(r.checkReport, 'BV015_BV018').status, 'FAIL');
  // SUPERSEDED BY PHASE 3I.29: the BV modules join the report, so absolute counts grew. The
  // protective statement — BV008 and the 1/6 rule are present and unharmed — is kept.
  assert.ok(r.checkReport.summary.hitCount >= 2, 'both failing rules are counted');
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.ok(r.checkReport.summary.resultCount >= 2);
  assert.equal(r.checkReport.summary.errorCount, 0);
  assert.deepEqual(r.checkReport.errors, []);
});
test('the shared report keeps a stable result order across repeated runs', async () => {
  const input = scenario({ driveMinutes: 300 });
  const a = await run(input);
  const b = await run(input);
  assert.deepEqual(a.checkReport.results.map(x => x.id), b.checkReport.results.map(x => x.id));
  assert.deepEqual(a.checkReport.results.map(x => x.status), b.checkReport.results.map(x => x.status));
});

// ===== independence of the two rules =====
test('BV008 FAIL does not influence the turnaround-quota result', async () => {
  const r = await run({ ...scenario({ driveMinutes: 300 }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([candidate(60)]) });
  assert.equal(byId(r.checkReport, 'BV008').status, 'FAIL');
  assert.equal(byId(r.checkReport, 'BV015_BV018').status, 'PASS');
});
test('BV008 PASS does not suppress a failing turnaround-quota result', async () => {
  // 240 driving minutes stay under the BV008 limit; required turnaround is ceil(240/6) = 40.
  const r = await run({ ...scenario({ driveMinutes: 240 }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([candidate(20)]) });
  assert.equal(byId(r.checkReport, 'BV008').status, 'PASS');
  assert.equal(byId(r.checkReport, 'BV015_BV018').status, 'FAIL');
  // SUPERSEDED BY PHASE 3I.29: the BV modules join the report, so absolute counts grew. The
  // protective statement — BV008 and the 1/6 rule are present and unharmed — is kept.
  assert.ok(r.checkReport.summary.hitCount >= 1);
});
test('a disabled turnaround-quota rule never blocks BV008', async () => {
  const r = await run(scenario({ driveMinutes: 240 }));
  assert.equal(byId(r.checkReport, 'BV008').status, 'PASS');
  assert.equal(byId(r.checkReport, 'BV015_BV018').details.originalStatus, 'DISABLED');
});
test('missing driving data leaves BV008 inconclusive and produces no hit', async () => {
  const r = await run({ ...scenario({ arrMissing: true }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([candidate(60)]) });
  assert.equal(byId(r.checkReport, 'BV008').status, 'SKIP');
  assert.equal(byId(r.checkReport, 'BV008').severity, 'WARNING');
  assert.equal(r.checkReport.summary.hitCount, 0, 'an unknown duration never produces a violation');
});
// FIXED BY PHASE 3I.7 — this replaces the former KNOWN GAP test. The driving projection reports an
// UNKNOWN segment duration as `statistics.drivingMinutes: 0` while flagging it via the circulation
// warning MISSING_SEGMENT_TIME and `drivingSegments[].durationMinutes: null`. The quota rule used to
// take that aggregate at face value, derive ceil(0/6) = 0 and report PASS although it knew nothing.
// It now recognises the unknown and stays inconclusive, exactly like BV008.
test('FIXED BY PHASE 3I.7: an unknown driving time is inconclusive, never a quota PASS', async () => {
  const r = await run({ ...scenario({ arrMissing: true }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([candidate(60)]) });
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'WARNING');
  assert.equal(one.details.originalStatus, 'INCONCLUSIVE');
  assert.equal(one.details.services[0].drivingMinutes, null, 'the partial sum is not reported as known');
  assert.equal(one.details.services[0].requiredMinutes, null, 'no artificial requirement of 0');
  assert.deepEqual(one.details.violations, []);
  assert.equal(r.checkReport.summary.hitCount, 0);
  // the signal the fix relies on is present in the projection and stays untouched
  const circulation = r.drivingProjection.circulations[0];
  assert.ok(circulation.warnings.some(w => w.code === 'MISSING_SEGMENT_TIME'));
  assert.equal(circulation.drivingSegments[0].durationMinutes, null);
});
test('missing turnaround data never damages BV008', async () => {
  const r = await run({ ...scenario({ driveMinutes: 300 }), oneSixthConfig: ENABLED_ONE_SIXTH }, { detectTurnarounds: detectionOf([], 'inconclusive') });
  assert.equal(byId(r.checkReport, 'BV008').status, 'FAIL');
  assert.equal(byId(r.checkReport, 'BV015_BV018').status, 'SKIP');
});

// ===== error isolation (the existing runner isolation, no parallel architecture) =====
test('a failing turnaround-quota module leaves the BV008 result intact', async () => {
  const r = await run(scenario({ driveMinutes: 300 }), {
    buildOneSixthCheck: () => ({ id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run() { throw new Error('boom'); } })
  });
  assert.equal(r.status, 'completed');
  assert.equal(byId(r.checkReport, 'BV008').status, 'FAIL');
  assert.equal(r.checkReport.results.length, 1);
  assert.equal(r.checkReport.errors.length, 1);
  assert.equal(r.checkReport.errors[0].module.id, 'BV015_BV018');
});
test('a failing BV008 module leaves the turnaround-quota result intact', async () => {
  const r = await run(scenario(), {
    buildCheck: () => ({ id: 'BV008', name: 'x', category: 'BV', priority: 270, run() { throw new Error('boom'); } })
  });
  assert.equal(r.status, 'completed');
  assert.equal(byId(r.checkReport, 'BV015_BV018').status, 'SKIP');
  assert.equal(r.checkReport.errors.length, 1);
  assert.equal(r.checkReport.errors[0].module.id, 'BV008');
});
test('a throwing turnaround detection degrades only the quota rule, never BV008', async () => {
  const r = await run({ ...scenario({ driveMinutes: 300 }), oneSixthConfig: ENABLED_ONE_SIXTH }, {
    detectTurnarounds: () => { throw new Error('detector down'); }
  });
  assert.equal(r.status, 'completed');
  assert.equal(byId(r.checkReport, 'BV008').status, 'FAIL');
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'WARNING');
  assert.equal(one.details.originalStatus, 'INCONCLUSIVE', 'a technical failure is never a FAIL');
  assert.ok(r.warnings.some(w => w.code === 'TURNAROUND_DETECTION_FAILED'));
});
test('an unexpected runner failure keeps the existing controlled controller status', async () => {
  const r = await run(scenario(), { runChecks: () => { throw new Error('runner down'); } });
  assert.equal(r.status, 'failed');
  assert.equal(r.checkReport, null);
});

// ===== the orchestrator never rewrites a status or severity =====
test('the orchestrator hands through the module results unchanged', async () => {
  const marker = { id: 'BV015_BV018', name: 'marker', category: 'BV', severity: 'WARNING', status: 'SKIP', message: 'm', details: { originalStatus: 'INCONCLUSIVE' }, affectedServices: [], affectedActivities: [], sourceReferences: [] };
  const r = await run(scenario(), {
    buildOneSixthCheck: () => ({ id: 'BV015_BV018', name: 'marker', category: 'BV', priority: 260, run: () => marker })
  });
  const one = byId(r.checkReport, 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'WARNING');
  assert.equal(one.message, 'm');
  assert.deepEqual(one.details, { originalStatus: 'INCONCLUSIVE' });
});
test('BV008 keeps its own configuration; the two rule configs never mix', async () => {
  let bv008Config = null;
  let oneSixthConfig = null;
  await run({ ...scenario(), oneSixthConfig: ENABLED_ONE_SIXTH }, {
    buildCheck: (input) => { bv008Config = input.ruleConfig; return { id: 'BV008', name: 'x', category: 'BV', priority: 270, run: () => null }; },
    buildOneSixthCheck: (input) => { oneSixthConfig = input.ruleConfig; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  assert.equal(bv008Config, DEFAULT_DRIVING_TIME_RULE_CONFIG);
  assert.equal(oneSixthConfig, ENABLED_ONE_SIXTH);
});
test('both modules receive the very same driving projection (computed once)', async () => {
  let a = null;
  let b = null;
  await run(scenario(), {
    buildCheck: (input) => { a = input.drivingProjection; return { id: 'BV008', name: 'x', category: 'BV', priority: 270, run: () => null }; },
    buildOneSixthCheck: (input) => { b = input.drivingProjection; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  assert.equal(a, b, 'no second projection is built for the second rule');
});
