import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.6 – the LIVE path: the shared CheckReport with both results travels through the
// existing session state and the existing explorer bridge into the existing generic explorer
// model. No new session field, no new bridge, no explorer or UI change, no special renderer.
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';
import { runJnvRuleAnalysis, DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createCheckExplorerSessionBridge } from '../js/v2/explorer/check-explorer-session-bridge.js';
import { createCheckExplorerModel, filterCheckResults, calculateCheckStatistics } from '../js/v2/ui/check-explorer.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const CODE = '12100';
const ENABLED_ONE_SIXTH = Object.freeze({ ...DEFAULT_ONE_SIXTH_RULE_CONFIG, enabled: true });

const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: '12', course: '1', trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: o.depMin, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: o.arrMin, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
// SUPERSEDED BY PHASE 3I.10b: a night-shift duty start keeps these live-path fixtures eligible so
// they keep testing the session/bridge/explorer flow they were written for.
const schedule = (driveMinutes) => ({ hardened: { applied: true, services: [{ serviceNumber: '2101', begin: { value: '—', minutesSinceStartOfDay: 19 * 60 + 20, dayOffset: 0 }, dutyActivities: [
  dutyAct({ svc: '2101', code: CODE, depMin: 300, arrMin: 300 + driveMinutes })
] }] }, document: { sourceType: 'pdf' } });
const umlDoc = () => createUmlauftafelDocument({
  mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }),
  circulations: [createCirculation({ code: CODE, mode: 'bus' })]
});
const detectionOf = (candidates) => () => ({ status: 'complete', candidates, warnings: [], statistics: { candidateCount: candidates.length } });
const candidate = (creditedMinutes) => ({
  id: `${CODE}#1->2`, circulationCode: CODE,
  previousSegmentRef: { circulationCode: CODE, sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: CODE, sequence: 2, type: 'service_trip' },
  startMinutes: 360, endMinutes: 360 + creditedMinutes, observedSpanMinutes: creditedMinutes,
  creditedMinutes, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
});

/**
 * A session built entirely from existing productive parts; only the rule-analysis entry is
 * parameterised so a test can activate the still-draft rule set WITHOUT touching product code.
 */
function syntheticSession(driveMinutes, ruleDeps = null) {
  return createMultiDocumentSession({
    importCompanion: () => Promise.resolve({ classification: { type: 'umlaufkarte', confidence: 'exact' }, document: umlDoc() }),
    buildBundle: () => ({ compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } }),
    runMatching: () => ({ attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: [CODE], companionRefs: [CODE] }] } }),
    runRuleAnalysis: ruleDeps
      ? (input) => runJnvRuleAnalysis({ ...input, oneSixthConfig: ENABLED_ONE_SIXTH }, ruleDeps)
      : runJnvRuleAnalysis,                                   // the REAL productive orchestrator
    generateBundleId: () => 'b', generateTimestamp: () => '2026-08-01T00:00:00Z'
  });
}
async function analyzed(driveMinutes, ruleDeps = null) {
  const session = syntheticSession(driveMinutes, ruleDeps);
  session.setPrimaryResult({ canonicalSchedule: schedule(driveMinutes) }, { name: 'p.pdf' });
  await session.setCompanionFile({ name: 'c.xlsx' });
  return session.analyzeRules();
}

// ===== the shared report reaches the existing session state =====
test('the session state carries the shared CheckReport with both results', async () => {
  const state = await analyzed(80);
  assert.equal(state.ruleAnalysis.status, 'completed');
  assert.equal(state.checkReport.type, 'CheckReport');
  // SUPERSEDED BY PHASE 3I.29: the BV modules join the report, so absolute counts grew. The
  // protective statement — BV008 and the 1/6 rule are present and unharmed — is kept.
  assert.deepEqual(state.checkReport.results.map(r => r.id).filter(id => ['BV008','BV015_BV018'].includes(id)), ['BV008', 'BV015_BV018']);
  assert.ok(state.checkReport.summary.resultCount >= 2);
  assert.deepEqual(state.checkReport.errors, []);
});
test('the session exposes the report object itself, not a copy or a merge', async () => {
  const state = await analyzed(80);
  assert.equal(state.checkReport, state.ruleAnalysis.checkReport, 'the very same report object');
});

// ===== the existing bridge hands the very same report to the existing explorer =====
test('the existing bridge hands the identical report with both results to the explorer', async () => {
  const applied = [];
  const bridge = createCheckExplorerSessionBridge({ explorerController: { setCheckReport: (r) => applied.push(r), clear: () => applied.push(null) } });
  const state = await analyzed(80);
  const outcome = bridge.setCheckReport(state.checkReport);
  assert.deepEqual(outcome, { applied: true, reason: null });
  assert.equal(applied.length, 1);
  assert.equal(applied[0], state.checkReport, 'the same reference, unchanged');
  assert.equal(applied[0].results.length, 2);
});

// ===== the existing generic explorer model shows both results =====
test('the generic explorer model produces two rows without a special renderer', async () => {
  const state = await analyzed(80);
  const model = createCheckExplorerModel(state.checkReport);
  assert.equal(model.checkReportAvailable, true);
  assert.equal(model.rows.length, 2);
  assert.deepEqual([...model.rows.map(r => r.id)].sort(), ['BV008', 'BV015_BV018']);
  assert.ok(model.rows.every(row => row.category === 'BV' && row.name.length > 0));
});
test('the free-text search finds the turnaround-quota row by its check id', async () => {
  const state = await analyzed(80);
  const model = createCheckExplorerModel(state.checkReport, { search: 'BV015_BV018' });
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].id, 'BV015_BV018');
});
test('the check-id filter finds the turnaround-quota row', async () => {
  const state = await analyzed(80);
  assert.deepEqual(filterCheckResults(state.checkReport.results, { checkId: 'bv015' }).map(r => r.id), ['BV015_BV018']);
});
test('the SKIP status filter finds the deactivated turnaround-quota rule', async () => {
  const state = await analyzed(80);
  const skipped = filterCheckResults(state.checkReport.results, { status: 'SKIP' });
  assert.deepEqual(skipped.map(r => r.id), ['BV015_BV018']);
  assert.equal(skipped[0].details.originalStatus, 'DISABLED');
});
test('the VIOLATION severity filter finds an activated, failing turnaround-quota rule', async () => {
  // 300 driving minutes → required ceil(300/6) = 50; only 20 credited minutes → FAIL.
  const state = await analyzed(300, { detectTurnarounds: detectionOf([candidate(20)]) });
  const violations = filterCheckResults(state.checkReport.results, { severity: 'VIOLATION' });
  assert.deepEqual([...violations.map(r => r.id)].sort(), ['BV008', 'BV015_BV018']);
  assert.equal(calculateCheckStatistics(state.checkReport.results).violation, 2);
});
test('the service filter finds the failing turnaround-quota rule by its affected service', async () => {
  const state = await analyzed(300, { detectTurnarounds: detectionOf([candidate(20)]) });
  const rows = filterCheckResults(state.checkReport.results, { serviceNumber: '2101', checkId: 'bv015' });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].affectedServices, ['2101']);
});
test('the category grouping keeps both results in the existing BV group', async () => {
  const state = await analyzed(80);
  const model = createCheckExplorerModel(state.checkReport);
  assert.deepEqual(model.groups.map(g => g.key), ['BV']);
  assert.equal(model.groups[0].rows.length, 2);
});

// ===== no UI, explorer, session or bootstrap special logic =====
test('the explorer, the bridge and the review dashboard know nothing about the rule', () => {
  for (const path of ['../js/v2/ui/check-explorer.js', '../js/v2/explorer/check-explorer-session-bridge.js', '../js/v2/ui/review-dashboard.js', '../js/v2/check-explorer-bootstrap.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /one-?sixth|BV015|BV018|turnaround/i, `${path} must stay generic`);
  }
});
test('the import bootstrap still triggers the analysis without importing any rule logic', () => {
  const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /analyzeRules/);
  assert.match(bootstrap, /explorerBridge\.setCheckReport/);
  assert.doesNotMatch(bootstrap, /one-?sixth|OneSixth|BV015|createOneSixthCheck|detectTurnaroundCandidates|runCheckModules/i);
});
test('the session controller transports the report without knowing the rule', () => {
  const session = readFileSync(new URL('../js/v2/import/multi-document-import-controller.js', import.meta.url), 'utf8');
  assert.doesNotMatch(session, /one-?sixth|OneSixth|BV015|createOneSixthCheck|detectTurnaroundCandidates/i);
  assert.match(session, /state\.checkReport = result\.checkReport/);
});
test('the check runner still contains no rule-specific handling', () => {
  const runner = readFileSync(new URL('../js/v2/checks/check-runner.js', import.meta.url), 'utf8');
  assert.doesNotMatch(runner, /one-?sixth|BV015|BV008|turnaround/i);
});
