import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3H.5 – productive JNV rule-analysis orchestrator. It ONLY wires the frozen pieces
// (exact match → joint timeline → driving projection → BV008 CheckModule → existing runner →
// existing CheckReport) behind strict gates. No new rule, no new engine, no PASS/FAIL of its own.
import { runJnvRuleAnalysis, DEFAULT_DRIVING_TIME_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const src = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');

const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: o.line, course: o.course ?? null, trip: o.trip ?? null, kind: 'LINE_COURSE' },
  departureTime: { value: o.dep ?? null, minutesSinceStartOfDay: o.depMin ?? null, dayOffset: o.depOff ?? 0 },
  arrivalTime: { value: o.arr ?? null, minutesSinceStartOfDay: o.arrMin ?? null, dayOffset: o.arrOff ?? 0 },
  dutyKind: o.dutyKind ?? 'serviceDrive', source: { sourceType: 'pdf' }
});
const schedule = (services) => ({ hardened: { applied: true, services }, document: { sourceType: 'pdf' } });
const umlDoc = (codes) => createUmlauftafelDocument({ mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }), circulations: codes.map(c => createCirculation({ code: c, mode: 'bus' })) });
const matchResult = (codes, status = 'exact') => ({ status, warnings: [], statistics: { umlauftafelCirculationCount: codes.length, exact: codes.length }, matches: codes.map(c => ({ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: [c], companionRefs: [c] })) });
const bundle = (compat = 'exact', p = 'jnv_schedule_pdf', c = 'umlaufkarte') => ({ compatibility: { status: compat }, primary: { documentType: p }, companion: { documentType: c } });
const matching = (status = 'completed', matchStatus = 'exact', codes = ['12100']) => ({ attempted: true, status, reason: null, matchResult: status === 'completed' ? matchResult(codes, matchStatus) : null, warnings: [] });

// A single-circulation exact scenario with a controllable driving duration.
const scenario = (driveMinutes, { arrMissing = false } = {}) => ({
  bundle: bundle(),
  primaryImport: { canonicalSchedule: schedule([{ serviceNumber: '2101', dutyActivities: [
    dutyAct({ svc: '2101', code: '12100', line: '12', course: '1', dep: '05:00', depMin: 300, arr: arrMissing ? null : '—', arrMin: arrMissing ? null : 300 + driveMinutes })
  ] }]) },
  companionImport: { document: umlDoc(['12100']) },
  matching: matching('completed', 'exact', ['12100'])
});
const run = (over, deps) => runJnvRuleAnalysis({ ruleConfig: DEFAULT_DRIVING_TIME_RULE_CONFIG, ...over }, deps);

// SUPERSEDED BY PHASE 3I.6: the turnaround-quota rule id is now legitimately registered here, so
// `BV015` alone no longer indicates rule logic. Every protective alternative stays; that the
// orchestrator still owns no arithmetic, threshold or outcome is asserted in the Phase 3I.6 tests.
test('the orchestrator contains no rule/scoring/storage/network logic of its own', () => {
  assert.doesNotMatch(src, /1\/6|ArbZG|Blockpause|Wendezeit|Haltestellenabstand|\bscore\b|fuzzy|Math\.random|localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest/i);
});
test('the result shape is {attempted,status,reason,jointTimeline,drivingProjection,checkReport,warnings}', async () => {
  const r = await run({ bundle: null });
  assert.deepEqual(Object.keys(r).sort(), ['attempted', 'checkReport', 'drivingProjection', 'jointTimeline', 'reason', 'status', 'warnings']);
});

// ===== gates → not_applicable (no throw, checkReport null) =====
test('no bundle → not_applicable', async () => { const r = await run({ bundle: null }); assert.equal(r.status, 'not_applicable'); assert.equal(r.checkReport, null); });
test('bundle not exact → not_applicable', async () => { assert.equal((await run({ bundle: bundle('conflicting') })).status, 'not_applicable'); });
test('invalid document pair → not_applicable', async () => { assert.equal((await run({ bundle: bundle('exact', 'legacy', 'wagenkarte') })).status, 'not_applicable'); });
test('matching not completed → not_applicable', async () => { assert.equal((await run({ ...scenario(60), matching: matching('blocked') })).status, 'not_applicable'); });
// SUPERSEDED BY PHASE 3I.19 — a weaker AGGREGATE no longer stops the chain; the per-circulation
// filter inside the joint timeline is the automation gate. A proven contradiction still does.
test('a non-exact match aggregate is carried as a warning, not as a refusal', async () => {
  const r = await run({ ...scenario(60), matching: matching('completed', 'ambiguous') });
  assert.notEqual(r.status, 'not_applicable');
  assert.ok(r.warnings.some(w => w.code === 'MATCH_NOT_FULLY_EXACT'));
});
test('a conflicting match result → not_applicable', async () => {
  const r = await run({ ...scenario(60), matching: matching('completed', 'conflicting') });
  assert.equal(r.status, 'not_applicable');
  assert.equal(r.reason, 'MATCH_CONFLICTING');
});
test('missing canonical schedule → not_applicable', async () => { assert.equal((await run({ ...scenario(60), primaryImport: {} })).status, 'not_applicable'); });
test('missing umlauftafel document → not_applicable', async () => { assert.equal((await run({ ...scenario(60), companionImport: {} })).status, 'not_applicable'); });
test('joint timeline not applicable → not_applicable', async () => {
  const r = await run(scenario(60), { buildJointTimeline: () => ({ metadata: null, circulations: [], warnings: [] }) });
  assert.equal(r.status, 'not_applicable'); assert.equal(r.checkReport, null);
});
test('projection not applicable → not_applicable', async () => {
  const r = await run(scenario(60), { buildProjection: () => ({ metadata: null, circulations: [], warnings: [] }) });
  assert.equal(r.status, 'not_applicable'); assert.equal(r.checkReport, null);
});

// ===== gates → blocked (structurally invalid) =====
test('invalid joint timeline → blocked', async () => {
  const r = await run(scenario(60), { validateTimeline: () => ({ valid: false, errors: [] }) });
  assert.equal(r.status, 'blocked'); assert.equal(r.checkReport, null);
});
test('invalid driving projection → blocked', async () => {
  const r = await run(scenario(60), { validateProjection: () => ({ valid: false, errors: [] }) });
  assert.equal(r.status, 'blocked'); assert.equal(r.checkReport, null);
});

// ===== completed: the real check chain produces the CheckReport =====
// BV008 by id — since Phase 3I.29 the report also carries the eight BV modules.
const bv008 = (r) => r.checkReport.results.find(x => x.id === 'BV008');

test('exact ≤270 → completed, CheckReport PASS/INFO, hitCount 0', async () => {
  const r = await run(scenario(80));
  assert.equal(r.status, 'completed');
  assert.equal(r.checkReport.type, 'CheckReport');
  // SUPERSEDED BY PHASE 3I.29: BV008 is no longer the FIRST result — the eight BV modules join the
  // report. Every statement about it is therefore addressed by id, which is what was meant all along.
  assert.equal(bv008(r).status, 'PASS');
  assert.equal(bv008(r).severity, 'INFO');
  assert.equal(bv008(r).hitCount ?? 0, 0);
});
test('exact >270 → completed, CheckReport FAIL/VIOLATION, hitCount 1', async () => {
  const r = await run(scenario(300));
  assert.equal(r.status, 'completed');
  // SUPERSEDED BY PHASE 3I.29: addressed by id (see above).
  assert.equal(bv008(r).status, 'FAIL');
  assert.equal(bv008(r).severity, 'VIOLATION');
});
test('missing driving time → completed, CheckReport SKIP/WARNING (inconclusive)', async () => {
  const r = await run(scenario(0, { arrMissing: true }));
  assert.equal(r.status, 'completed');
  assert.equal(bv008(r).status, 'SKIP');
  assert.equal(bv008(r).severity, 'WARNING');
});
test('invalid config → completed, CheckReport SKIP/INFO (disabled), no throw', async () => {
  const r = await run({ ...scenario(80), ruleConfig: { ruleId: 'BV008', enabled: true, maxContinuousDrivingMinutes: 0 } });
  assert.equal(r.status, 'completed');
  assert.equal(bv008(r).status, 'SKIP');
  assert.equal(bv008(r).severity, 'INFO');
});
test('rule disabled → completed, CheckReport SKIP/INFO', async () => {
  const r = await run({ ...scenario(80), ruleConfig: { ...DEFAULT_DRIVING_TIME_RULE_CONFIG, enabled: false } });
  assert.equal(bv008(r).status, 'SKIP');
  assert.equal(bv008(r).severity, 'INFO');
});

// ===== runner called exactly once, determinism, no mutation, error isolation =====
test('the CheckRunner is invoked exactly once per analysis', async () => {
  let calls = 0;
  const runChecks = (analysisResult, modules, options) => { calls += 1; return Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: { hitCount: 0 } }); };
  await run(scenario(80), { runChecks });
  assert.equal(calls, 1);
});
test('the analysis is deterministic (equal results) and does not mutate inputs', async () => {
  const input = { ruleConfig: DEFAULT_DRIVING_TIME_RULE_CONFIG, ...scenario(300) };
  const snap = JSON.stringify(input);
  const a = await runJnvRuleAnalysis(input);
  const b = await runJnvRuleAnalysis(input);
  assert.equal(a.status, b.status);
  assert.deepEqual(a.checkReport.results, b.checkReport.results);
  assert.equal(JSON.stringify(input), snap);
});
test('an unexpected error is isolated → failed, no throw, checkReport null', async () => {
  const r = await run(scenario(80), { buildJointTimeline: () => { throw new Error('boom'); } });
  assert.equal(r.status, 'failed');
  assert.equal(r.checkReport, null);
});
