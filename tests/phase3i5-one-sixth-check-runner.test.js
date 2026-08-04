import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.5 – the 1/6 CheckModule runs through the EXISTING runner and produces the EXISTING
// CheckReport, side by side with other modules. No productive registration.
import { createOneSixthCheck, runOneSixthCheck, ONE_SIXTH_CHECK_ID } from '../js/v2/analysis/one-sixth-check.js';
import { createDrivingTimeLimitCheck } from '../js/v2/analysis/driving-time-limit-check.js';
import { runCheckModules } from '../js/v2/checks/check-runner.js';

const ANALYSIS = { type: 'AnalysisResult', metadata: { documentProfileId: 'beu-stadtbus-v1' } };
const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const projection = (drivingMinutes) => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: 1 },
  circulations: [{
    code: '11100',
    drivingSegments: [{ serviceNumber: '2101', kind: 'service', startMinutes: 0, endMinutes: 10, durationMinutes: 10, source: { serviceNumber: '2101', activityIndex: 0, sourceType: 'pdf' } }],
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes, nonDrivingMinutes: 0, knownTotalMinutes: drivingMinutes }, warnings: []
  }],
  warnings: []
});
const candidate = (span) => ({
  id: 'c#1', circulationCode: '11100',
  previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip' },
  startMinutes: 360, endMinutes: 360 + span, observedSpanMinutes: span,
  creditedMinutes: span >= 11 ? span : 0, source: 'umlauftafel', confidence: 'exact',
  eligibility: span >= 11 ? 'qualified' : 'below_minimum', warnings: []
});
const detection = (span) => ({ status: 'complete', candidates: [candidate(span)], warnings: [], statistics: { candidateCount: 1, qualifiedCount: 1, belowMinimumCount: 0, unresolvedCount: 0 } });
const inputs = (drivingMinutes, span) => ({ drivingProjection: projection(drivingMinutes), turnaroundDetection: detection(span), ruleConfig: CONFIG, context: CONTEXT });

test('the module runs through the existing runner and produces a valid CheckReport (PASS)', async () => {
  const report = await runCheckModules(ANALYSIS, [createOneSixthCheck(inputs(396, 66))]);
  assert.equal(report.type, 'CheckReport');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].id, ONE_SIXTH_CHECK_ID);
  assert.equal(report.results[0].status, 'PASS');
  assert.equal(report.results[0].severity, 'INFO');
  assert.equal(report.summary.hitCount, 0);
  assert.equal(report.errors.length, 0);
});
test('a FAIL result counts as a hit in the existing summary', async () => {
  const report = await runCheckModules(ANALYSIS, [createOneSixthCheck(inputs(396, 20))]);
  assert.equal(report.results[0].status, 'FAIL');
  assert.equal(report.results[0].severity, 'VIOLATION');
  assert.equal(report.summary.hitCount, 1);
  assert.equal(report.errors.length, 0);
});
test('an INCONCLUSIVE evaluation stays visible as SKIP/WARNING and is not a hit', async () => {
  const report = await runCheckModules(ANALYSIS, [createOneSixthCheck(inputs(null, 66))]);
  assert.equal(report.results[0].status, 'SKIP');
  assert.equal(report.results[0].severity, 'WARNING');
  assert.equal(report.results[0].details.originalStatus, 'INCONCLUSIVE');
  assert.equal(report.summary.hitCount, 0);
});
test('runOneSixthCheck delegates entirely to the existing runner (no own report)', async () => {
  const report = await runOneSixthCheck({ analysisResult: ANALYSIS, ...inputs(396, 66) });
  assert.equal(report.type, 'CheckReport');
  assert.equal(report.results[0].id, ONE_SIXTH_CHECK_ID);
  assert.equal(report.summary.resultCount, 1);
  const src = readFileSync(new URL('../js/v2/analysis/one-sixth-check.js', import.meta.url), 'utf8');
  assert.match(src, /runCheckModules/);
  assert.doesNotMatch(src, /type:\s*'CheckReport'|summary:\s*\{/, 'the adapter assembles no report of its own');
});

// ===== co-execution with other modules =====
test('the 1/6 module runs side by side with the BV008 module in one CheckReport', async () => {
  const bv008 = createDrivingTimeLimitCheck({
    drivingProjection: projection(396),
    ruleConfig: { ruleId: 'BV008', enabled: true, maxContinuousDrivingMinutes: 270, qualifyingInterruption: { singleMinimumMinutes: 45, splitSequence: [15, 30] } }
  });
  const report = await runCheckModules(ANALYSIS, [bv008, createOneSixthCheck(inputs(396, 66))]);
  assert.equal(report.results.length, 2);
  const ids = report.results.map(r => r.id);
  assert.ok(ids.includes('BV008'));
  assert.ok(ids.includes(ONE_SIXTH_CHECK_ID));
  assert.equal(report.errors.length, 0);
  assert.equal(report.summary.resultCount, 2);
});
test('a failing sibling module does not damage the 1/6 result (runner error isolation)', async () => {
  const broken = { id: 'BROKEN', name: 'Broken module', category: 'BV', run() { throw new Error('boom'); } };
  const report = await runCheckModules(ANALYSIS, [broken, createOneSixthCheck(inputs(396, 66))]);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].module.id, 'BROKEN');
  const oneSixth = report.results.find(r => r.id === ONE_SIXTH_CHECK_ID);
  assert.ok(oneSixth, 'the 1/6 result survived');
  assert.equal(oneSixth.status, 'PASS');
});
test('the result order follows the existing runner rules and stays stable', async () => {
  const modules = [createOneSixthCheck(inputs(396, 66)), { id: 'ZZZ', name: 'Z', category: 'BV', priority: 0, run: () => ({ id: 'ZZZ', name: 'Z', category: 'BV', severity: 'INFO', status: 'PASS', message: 'ok' }) }];
  const first = await runCheckModules(ANALYSIS, modules);
  const second = await runCheckModules(ANALYSIS, modules);
  assert.deepEqual(first.results.map(r => r.id), second.results.map(r => r.id));
});
test('the runner accepts the module without any special handling', async () => {
  const runnerSrc = readFileSync(new URL('../js/v2/checks/check-runner.js', import.meta.url), 'utf8');
  assert.doesNotMatch(runnerSrc, /one-?sixth|BV015/i, 'the runner knows nothing about the 1/6 rule');
});

// ===== registration happens ONLY in the orchestrator =====
// SUPERSEDED BY PHASE 3I.6: the orchestrator now registers the check productively. Session and
// bootstrap must still never touch the rule — they only transport the generic CheckReport.
test('only the orchestrator registers the 1/6 check; session and bootstrap stay rule-agnostic', () => {
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
  const session = readFileSync(new URL('../js/v2/import/multi-document-import-controller.js', import.meta.url), 'utf8');
  assert.match(orchestrator, /createOneSixthCheck/);
  assert.doesNotMatch(orchestrator, /runOneSixthCheck/, 'the shared runner call is used, not the single-check entry');
  for (const source of [bootstrap, session]) {
    assert.doesNotMatch(source, /one-sixth|createOneSixthCheck|runOneSixthCheck/i);
  }
});
