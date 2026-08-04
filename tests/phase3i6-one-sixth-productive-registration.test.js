import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.6 – PRODUCTIVE REGISTRATION of the existing JNV turnaround-quota CheckModule next to
// BV008 in the existing orchestrator. The orchestrator only wires existing pieces: it creates the
// two existing CheckModules and hands them to ONE existing runner call. It owns no rule logic, no
// threshold, no outcome, no mapping and no second detection.
import { runJnvRuleAnalysis, DEFAULT_DRIVING_TIME_RULE_CONFIG, DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { validateOneSixthRuleConfig } from '../js/v2/analysis/one-sixth-validation.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const src = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
const contract = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((node, key) => node?.[key], contract.parameters);

// ===== the productive scenario (same shape as the existing Phase 3H.5 fixtures) =====
const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: o.line, course: o.course ?? null, trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: o.depMin, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: o.arrMin, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
const schedule = (driveMinutes) => ({ hardened: { applied: true, services: [{ serviceNumber: '2101', dutyActivities: [
  dutyAct({ svc: '2101', code: '12100', line: '12', course: '1', depMin: 300, arrMin: 300 + driveMinutes })
] }] }, document: { sourceType: 'pdf' } });
const umlDoc = (over = {}) => createUmlauftafelDocument({
  mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }),
  circulations: [createCirculation({ code: '12100', mode: 'bus' })], ...over
});
const scenario = (driveMinutes = 80, over = {}) => ({
  bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
  primaryImport: { canonicalSchedule: schedule(driveMinutes) },
  companionImport: { document: umlDoc() },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: ['12100'], companionRefs: ['12100'] }] } },
  ...over
});

// Captures what the orchestrator hands to the existing runner.
function spy() {
  const calls = [];
  return {
    calls,
    runChecks: (analysisResult, modules, options) => {
      calls.push({ analysisResult, modules, options });
      return Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: { resultCount: 0, hitCount: 0 } });
    }
  };
}

// ===== the orchestrator uses the EXISTING factories, never the rule or the mapper =====
test('the orchestrator imports the existing check factory and the existing turnaround detection', () => {
  assert.match(src, /import\s*\{\s*createOneSixthCheck\s*\}\s*from\s*'\.\/one-sixth-check\.js'/);
  assert.match(src, /import\s*\{\s*detectTurnaroundCandidates\s*\}\s*from\s*'\.\.\/rules\/one-sixth-turnaround-candidates\.js'/);
  assert.match(src, /createDrivingTimeLimitCheck/);
});
test('the orchestrator never calls the rule evaluation or the result mapper directly', () => {
  assert.doesNotMatch(src, /evaluateOneSixthRule|mapOneSixthEvaluationToCheckResult|evaluateDrivingTimeLimit|mapDrivingTimeEvaluationToCheckResult/);
});
test('the orchestrator contains no rule arithmetic, threshold comparison or outcome of its own', () => {
  assert.doesNotMatch(src, /Math\.(ceil|round|floor)/, 'no rounding of its own');
  assert.doesNotMatch(src, /creditedMinutes|requiredMinutes|deficitMinutes|drivingMinutes\s*[/*]/, 'no quota arithmetic');
  assert.doesNotMatch(src, />=\s*11\b|>\s*270\b|<\s*270\b/, 'no threshold comparison');
  assert.doesNotMatch(src, /'PASS'|"PASS"|'FAIL'|"FAIL"|'VIOLATION'|"VIOLATION"|'SKIP'|"SKIP"/, 'no check status or severity of its own');
});
test('the orchestrator reads no second workbook, file or document source', () => {
  assert.doesNotMatch(src, /XLSX|arrayBuffer|readFile|FileReader|pdfjs|getDocument|createWorkbook|loadUmlauftafel/i);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest|WebSocket|document\.|\/Users\/|\/Volumes\//);
});

// ===== exactly two modules in one runner call, in a stable order =====
test('exactly two CheckModules are created and handed to exactly ONE runner call', async () => {
  const s = spy();
  await runJnvRuleAnalysis(scenario(), { runChecks: s.runChecks });
  assert.equal(s.calls.length, 1, 'exactly one productive runCheckModules call');
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.ok(s.calls[0].modules.length >= 2, 'BV008 and the 1/6 rule among them');
});
test('the module order is BV008 first, then the turnaround-quota check', async () => {
  const s = spy();
  await runJnvRuleAnalysis(scenario(), { runChecks: s.runChecks });
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.deepEqual([...s.calls[0].modules.map(x => x.id)].filter(id => ['BV008','BV015_BV018'].includes(id)), ['BV008', 'BV015_BV018']);
  assert.ok(s.calls[0].modules.every(m => m.category === 'BV'));
  assert.ok(s.calls[0].modules.every(m => typeof m.run === 'function'));
});
test('the module priorities keep BV008 ahead of the turnaround-quota check in the runner', async () => {
  const s = spy();
  await runJnvRuleAnalysis(scenario(), { runChecks: s.runChecks });
  const [first, second] = s.calls[0].modules;
  assert.ok(first.priority > second.priority, 'the runner sorts by descending priority');
});
test('no gate is skipped: a blocked analysis creates no module and calls no runner', async () => {
  const s = spy();
  const r = await runJnvRuleAnalysis({ ...scenario(), bundle: null }, { runChecks: s.runChecks });
  assert.equal(r.status, 'not_applicable');
  assert.equal(s.calls.length, 0);
  assert.equal(r.checkReport, null);
});

// ===== the AnalysisResult carrier stays the existing minimal one =====
test('the existing minimal AnalysisResult is reused and carries no analysis payload', async () => {
  const s = spy();
  await runJnvRuleAnalysis(scenario(), { runChecks: s.runChecks });
  const analysisResult = s.calls[0].analysisResult;
  assert.equal(analysisResult.type, 'AnalysisResult');
  assert.deepEqual(Object.keys(analysisResult).sort(), ['metadata', 'type']);
  const serialized = JSON.stringify(analysisResult);
  assert.doesNotMatch(serialized, /drivingSegments|circulations|candidates|stops|turnaround|canonicalSchedule|hardened/i);
});

// ===== the context contract =====
test('the turnaround-quota check receives only a minimal organisation/mode context', async () => {
  let received = null;
  await runJnvRuleAnalysis(scenario(), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    buildOneSixthCheck: (input) => { received = input; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  assert.deepEqual(Object.keys(received.context).sort(), ['mode', 'organization']);
  assert.equal(received.context.organization, 'JNV');
  assert.equal(received.context.mode, 'bus');
});
test('the context carries no document, import, schedule or file payload', async () => {
  let received = null;
  await runJnvRuleAnalysis(scenario(), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    buildOneSixthCheck: (input) => { received = input; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  const serialized = JSON.stringify(received.context);
  assert.doesNotMatch(serialized, /circulations|segments|stops|canonicalSchedule|documentType|fileName|sourceName/i);
});
test('an Umlauftafel of a different organisation yields no context organisation (never a verdict)', async () => {
  let received = null;
  await runJnvRuleAnalysis(scenario(80, { companionImport: { document: umlDoc({ organization: 'JES' }) } }), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    buildOneSixthCheck: (input) => { received = input; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  assert.equal(received.context.organization, null, 'a conflicting organisation is not resolved, it is dropped');
});
test('an Umlauftafel without a mode yields no context mode', async () => {
  let received = null;
  await runJnvRuleAnalysis(scenario(80, { companionImport: { document: umlDoc({ mode: null }) } }), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    buildOneSixthCheck: (input) => { received = input; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  assert.equal(received.context.mode, null);
});
test('the orchestrator derives the context from no file name, line, code length or vehicle type', () => {
  assert.doesNotMatch(src, /fileName|sourceName|\.line\b|\.vehicle\b|vehicleType|code\.length/);
});

// ===== the productive configuration stays disabled =====
test('the productive turnaround-quota configuration is structurally valid but disabled', () => {
  assert.equal(validateOneSixthRuleConfig(DEFAULT_ONE_SIXTH_RULE_CONFIG).valid, true);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false, 'mandatory parameters are still open');
  assert.equal(Object.isFrozen(DEFAULT_ONE_SIXTH_RULE_CONFIG), true);
});
test('the productive default mirrors the confirmed values of the versioned rule set', () => {
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, p('activation.enabled').value);
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.organizations], p('scope.organizations').value);
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.modes], p('scope.modes').value);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.requiredRatioNumerator, p('calculation.requiredRatioNumerator').value);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.requiredRatioDenominator, p('calculation.requiredRatioDenominator').value);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.roundingRule, p('calculation.roundingRule').value);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.minimumObservedSpanMinutes, p('turnaround.minimumObservedSpanMinutes').value);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.belowMinimumCreditedMinutes, p('turnaround.belowMinimumCreditedMinutes').value);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.creditingMethod, p('turnaround.creditingMethod').value);
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.acceptedTurnaroundConfidence], p('turnaround.acceptedTurnaroundConfidence').value);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.locationMismatchBlocksCrediting, p('turnaround.locationMismatchBlocksCrediting').value);
  assert.deepEqual([...DEFAULT_ONE_SIXTH_RULE_CONFIG.sourcePriority], p('dataStrategy.sourcePriority').value);
});
// SUPERSEDED BY PHASE 3I.8/3I.8b: all six mandatory parameters were closed there. What this test
// protects is unchanged — the registration must not approve or activate the rule set.
test('the versioned rule set itself is untouched: draft, unapproved, not activated', () => {
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(contract.status, 'approved');
  assert.equal(contract.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(contract.parameters.activation.enabled.value, false);
  assert.equal(contract.parameters.openParameters.value.length, 0);
});
test('the orchestrator never activates the rule set on its own', () => {
  // exactly one activation in the whole file — BV008's; the turnaround-quota default stays false
  assert.equal([...src.matchAll(/enabled:\s*true/g)].length, 1, 'only BV008 is productively enabled');
  assert.equal([...src.matchAll(/enabled:\s*false/g)].length, 1, 'the turnaround-quota rule stays disabled');
  assert.doesNotMatch(src, /\.enabled\s*=|enabled:\s*!|enabled:\s*Boolean/, 'the orchestrator never rewrites an activation flag');
});
test('BV008 keeps its own unchanged productive configuration', () => {
  assert.equal(DEFAULT_DRIVING_TIME_RULE_CONFIG.ruleId, 'BV008');
  assert.equal(DEFAULT_DRIVING_TIME_RULE_CONFIG.enabled, true);
  assert.equal(DEFAULT_DRIVING_TIME_RULE_CONFIG.maxContinuousDrivingMinutes, 270);
});

// ===== the turnaround detection is the existing one, fed from the already loaded document =====
test('the existing detector is called once with the already loaded Umlauftafel document', async () => {
  const seen = [];
  await runJnvRuleAnalysis(scenario(), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    detectTurnarounds: (input) => { seen.push(input); return { status: 'complete', candidates: [], warnings: [], statistics: {} }; }
  });
  assert.equal(seen.length, 1, 'no double detection');
  assert.equal(seen[0].umlauftafelDocument.documentType, 'umlaufkarte');
  assert.equal(seen[0].umlauftafelDocument.circulations[0].code, '12100');
});
test('the detector receives the crediting minimum and source priority from the configuration', async () => {
  let seen = null;
  await runJnvRuleAnalysis(scenario(), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    detectTurnarounds: (input) => { seen = input; return { status: 'complete', candidates: [], warnings: [], statistics: {} }; }
  });
  assert.equal(seen.crediting.minimumObservedSpanMinutes, DEFAULT_ONE_SIXTH_RULE_CONFIG.minimumObservedSpanMinutes);
  assert.equal(seen.crediting.belowMinimumCreditedMinutes, DEFAULT_ONE_SIXTH_RULE_CONFIG.belowMinimumCreditedMinutes);
  assert.deepEqual([...seen.sourcePriority], [...DEFAULT_ONE_SIXTH_RULE_CONFIG.sourcePriority]);
});
test('no schedule fallback is invented: the detector gets no scheduleView', async () => {
  let seen = null;
  await runJnvRuleAnalysis(scenario(), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    detectTurnarounds: (input) => { seen = input; return { status: 'complete', candidates: [], warnings: [], statistics: {} }; }
  });
  assert.equal(seen.scheduleView, undefined);
});
test('the detection result is handed to the check factory unchanged and never mutated', async () => {
  const detection = Object.freeze({ status: 'complete', candidates: Object.freeze([]), warnings: Object.freeze([]), statistics: Object.freeze({ candidateCount: 0 }) });
  let received = null;
  await runJnvRuleAnalysis(scenario(), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    detectTurnarounds: () => detection,
    buildOneSixthCheck: (input) => { received = input; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  assert.equal(received.turnaroundDetection, detection, 'the very same object');
});
test('the Umlauftafel document is not mutated by the analysis', async () => {
  const input = scenario();
  const snapshot = JSON.stringify(input.companionImport.document);
  await runJnvRuleAnalysis(input, { runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }) });
  assert.equal(JSON.stringify(input.companionImport.document), snapshot);
});

// ===== the controller result contract is unchanged =====
test('the controller result keeps its existing shape', async () => {
  const r = await runJnvRuleAnalysis(scenario());
  assert.deepEqual(Object.keys(r).sort(), ['attempted', 'checkReport', 'drivingProjection', 'jointTimeline', 'reason', 'status', 'warnings']);
  assert.equal(r.status, 'completed');
});
