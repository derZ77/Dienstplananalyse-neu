import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.10 – the orchestrator resolves the duty start from the schedule it already reads, hands
// it to the projection, and forwards a complete `eligibility` input to the rule. It changes no
// evaluation logic, no configuration and no report.
import { runJnvRuleAnalysis, DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const src = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');

const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: o.line ?? '12', course: '1', trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: o.depMin, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: o.arrMin, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
// `begin` is the duty start the hardening layer already carries.
const schedule = (services) => ({
  hardened: { applied: true, services: services.map(s => ({
    serviceNumber: s.svc,
    begin: s.begin === undefined ? undefined : { value: '—', minutesSinceStartOfDay: s.begin, dayOffset: s.beginDayOffset ?? 0 },
    dutyActivities: [dutyAct({ svc: s.svc, code: s.code ?? '12100', line: s.line, depMin: 300, arrMin: 300 + (s.drive ?? 80) })]
  })) },
  document: { sourceType: 'pdf' }
});
const umlDoc = () => createUmlauftafelDocument({
  mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }),
  circulations: [createCirculation({ code: '12100', mode: 'bus' })]
});
const scenario = (services) => ({
  bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
  primaryImport: { canonicalSchedule: schedule(services) },
  companionImport: { document: umlDoc() },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: ['12100'], companionRefs: ['12100'] }] } }
});
const runner = () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} });

// Captures what the orchestrator hands downstream.
async function capture(services, deps = {}) {
  const seen = {};
  await runJnvRuleAnalysis(scenario(services), {
    runChecks: runner,
    buildProjection: (input) => { seen.projectionInput = input; return deps.projection ?? { metadata: { serviceRegime: 'school', dayType: 'mo_fr', dutyStartTime: input.dutyStartMinutes ?? null, generatedFrom: 'driving-projection', circulationCount: 0 }, circulations: [], warnings: [] }; },
    validateProjection: () => ({ valid: true }),
    buildOneSixthCheck: (input) => { seen.oneSixthInput = input; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; },
    buildCheck: () => ({ id: 'BV008', name: 'x', category: 'BV', priority: 270, run: () => null }),
    ...deps.extra
  });
  return seen;
}

// ===== the duty start reaches the projection =====
test('the orchestrator hands the resolved duty start to the projection', async () => {
  const seen = await capture([{ svc: '2101', begin: 19 * 60 + 20 }]);
  assert.equal(seen.projectionInput.dutyStartMinutes, 19 * 60 + 20);
});
test('the duty start honours the existing day offset', async () => {
  const seen = await capture([{ svc: '2101', begin: 30, beginDayOffset: 1 }]);
  assert.equal(seen.projectionInput.dutyStartMinutes, 1440 + 30, '00:30 of the following day');
});
test('an absent duty start is forwarded as null, never guessed', async () => {
  const seen = await capture([{ svc: '2101', begin: undefined }]);
  assert.equal(seen.projectionInput.dutyStartMinutes, null);
});
test('several duties with different starts stay ambiguous rather than picking one', async () => {
  const seen = await capture([{ svc: '2101', begin: 300 }, { svc: '2102', begin: 1200 }]);
  assert.equal(seen.projectionInput.dutyStartMinutes, null, 'no duty start is invented for a multi-duty document');
});
test('several duties sharing one start resolve to that start', async () => {
  const seen = await capture([{ svc: '2101', begin: 1200 }, { svc: '2102', begin: 1200 }]);
  assert.equal(seen.projectionInput.dutyStartMinutes, 1200);
});
test('the orchestrator derives the duty start from no trip, file name or code', () => {
  assert.doesNotMatch(src, /firstTrip|fileName|sourceName|circuitNumber|shiftNumber|departureTime/);
  assert.match(src, /begin/, 'the existing duty start field is read');
});

// ===== the eligibility input is complete and minimal =====
test('the rule receives a complete eligibility input', async () => {
  const seen = await capture([{ svc: '2101', begin: 19 * 60 + 20 }]);
  assert.ok(seen.oneSixthInput.eligibility, 'eligibility is forwarded');
  assert.equal(seen.oneSixthInput.eligibility.dutyStartMinutes, 19 * 60 + 20);
});
// SUPERSEDED BY PHASE 3I.10b: the input additionally carries the small per-service duty-start map
// so each circulation can resolve its own start. It still carries nothing but numbers.
test('the eligibility input carries no further data', async () => {
  const seen = await capture([{ svc: '2101', begin: 300 }]);
  assert.deepEqual(Object.keys(seen.oneSixthInput.eligibility).sort(), ['dutyStartMinutes', 'serviceStarts']);
  const serialized = JSON.stringify(seen.oneSixthInput.eligibility);
  assert.doesNotMatch(serialized, /circulations|segments|stops|canonicalSchedule|document|originalText/i);
});
test('organisation, mode and day type still travel through the existing channels', async () => {
  const seen = await capture([{ svc: '2101', begin: 300 }]);
  assert.deepEqual(seen.oneSixthInput.context, { organization: 'JNV', mode: 'bus' });
  assert.equal(seen.oneSixthInput.drivingProjection.metadata.dayType, 'mo_fr', 'the day type stays on the projection');
});
test('the BV008 module is unaffected by the new input', async () => {
  const seen = {};
  await runJnvRuleAnalysis(scenario([{ svc: '2101', begin: 300 }]), {
    runChecks: runner,
    buildCheck: (input) => { seen.bv008 = input; return { id: 'BV008', name: 'x', category: 'BV', priority: 270, run: () => null }; }
  });
  assert.deepEqual(Object.keys(seen.bv008).sort(), ['drivingProjection', 'ruleConfig'], 'BV008 gets no eligibility');
});

// ===== nothing else changed =====
test('the orchestrator still performs exactly one runner call with two modules', async () => {
  const calls = [];
  await runJnvRuleAnalysis(scenario([{ svc: '2101', begin: 300 }]), {
    runChecks: (analysisResult, modules) => { calls.push(modules); return runner(); }
  });
  assert.equal(calls.length, 1);
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.deepEqual([...calls[0].map(x => x.id)].filter(id => ['BV008','BV015_BV018'].includes(id)), ['BV008', 'BV015_BV018']);
});
test('the productive rule configuration stays disabled', () => {
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false);
  assert.equal([...src.matchAll(/enabled:\s*true/g)].length, 1, 'still only BV008 is enabled');
});
test('the controller result keeps its existing shape', async () => {
  const r = await runJnvRuleAnalysis(scenario([{ svc: '2101', begin: 300 }]), { runChecks: runner });
  assert.deepEqual(Object.keys(r).sort(), ['attempted', 'checkReport', 'drivingProjection', 'jointTimeline', 'reason', 'status', 'warnings']);
  assert.equal(r.status, 'completed');
});
// SUPERSEDED BY PHASE 3I.10b: the orchestrator now mirrors the productive eligibility PARAMETERS
// (values only, like every other config value it already mirrors). What it must still not own is
// evaluation LOGIC — no arithmetic, no rule call, no outcome.
test('the orchestrator owns no evaluation logic of its own', () => {
  assert.doesNotMatch(src, /Math\.(ceil|round|floor)|evaluateOneSixth|'PASS'|'FAIL'|>=\s*threshold|includes\(dayType\)/);
});
test('the orchestrator reads no second document and stays free of storage and network', () => {
  assert.doesNotMatch(src, /XLSX|arrayBuffer|readFile|FileReader|pdfjs|localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest/i);
});
