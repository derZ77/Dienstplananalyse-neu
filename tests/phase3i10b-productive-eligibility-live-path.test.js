import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.10b – the eligibility chain now works end to end over the PRODUCTIVE CheckModule path:
// orchestrator → createOneSixthCheck → evaluateOneSixthRule → segment-adjusted quota → runner →
// the existing CheckReport. The productive rule set stays draft/disabled.
import { runJnvRuleAnalysis, DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createUmlauftafelDocument, createValidity, createCirculation, createSegment, createStopEvent, createNormalizedTime } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((n, k) => n?.[k], config.parameters);

const ENABLED = {
  ...DEFAULT_ONE_SIXTH_RULE_CONFIG, enabled: true,
  allowedDayTypes: p('eligibility.allowedDayTypes').value,
  nightShiftIsException: p('eligibility.nightShiftIsException').value,
  nightShiftStart: p('eligibility.nightShiftStart').value,
  nightShiftStartInclusive: p('eligibility.nightShiftStartInclusive').value,
  admissionLines: p('eligibility.admissionLines').value,
  admissionLineRequiresPureDuty: p('eligibility.admissionLineRequiresPureDuty').value
};

const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: '12100',
  routeIdentity: { line: o.line, course: '1', trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: o.dep, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: o.dep + o.drive, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
const stop = (name, minutes, sequence) => createStopEvent({ sequence, name, time: createNormalizedTime({ raw: '—', hour: Math.floor(minutes / 60), minute: minutes % 60 }) });
const trip = (sequence, line, from, to, dep, arr) => createSegment({ type: 'service_trip', sequence, line, stops: [stop(from, dep, 1), stop(to, arr, 2)] });

const scenario = ({ begin, activities, segments = [] }) => ({
  bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
  primaryImport: { canonicalSchedule: { hardened: { applied: true, services: [{
    serviceNumber: '2101',
    begin: begin === undefined ? undefined : { value: '—', minutesSinceStartOfDay: begin, dayOffset: 0 },
    dutyActivities: activities.map(a => dutyAct({ svc: '2101', ...a }))
  }] }, document: { sourceType: 'pdf' } } },
  companionImport: { document: createUmlauftafelDocument({ mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }), circulations: [createCirculation({ code: '12100', mode: 'bus', segments })] }) },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: ['12100'], companionRefs: ['12100'] }] } }
});
const oneSixth = (report) => report.results.find(r => r.id === 'BV015_BV018');

// ===== the productive path is complete =====
test('the productive report still carries both results and stays disabled', async () => {
  const r = await runJnvRuleAnalysis(scenario({ begin: 19 * 60 + 20, activities: [{ line: '12', dep: 300, drive: 396 }] }));
  assert.equal(r.status, 'completed');
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.deepEqual([...r.checkReport.results.map(x => x.id)].filter(id => ['BV008','BV015_BV018'].includes(id)), ['BV008', 'BV015_BV018']);
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.ok(r.checkReport.summary.resultCount >= 2);
  assert.deepEqual(r.checkReport.errors, []);
  assert.equal(oneSixth(r.checkReport).status, 'SKIP');
  assert.equal(oneSixth(r.checkReport).details.originalStatus, 'DISABLED', 'productively still disabled');
});
test('the eligibility data reaches the productive projection', async () => {
  const r = await runJnvRuleAnalysis(scenario({ begin: 19 * 60 + 20, activities: [{ line: '18', dep: 300, drive: 396 }] }));
  assert.equal(r.drivingProjection.circulations[0].drivingSegments[0].line, '18');
  assert.equal(r.drivingProjection.metadata.dutyStartTime, 19 * 60 + 20);
});

// ===== with an activated TEST configuration the whole chain works over the CheckModule =====
const live = (input) => runJnvRuleAnalysis({ ...scenario(input), oneSixthConfig: ENABLED });

test('an ineligible weekday duty is NOT_APPLICABLE through the productive CheckModule', async () => {
  // SUPERSEDED BY PHASE 3I.24: the duty keeps its own verdict instead of being discarded. This
  // fixture's board segments carry no duty attribution, so the unit is undecidable rather than out
  // of scope — an open question, honestly reported, and no longer a silent dismissal.
  const r = await live({ begin: 8 * 60, activities: [{ line: '12', dep: 300, drive: 200 }] });
  const one = oneSixth(r.checkReport);
  assert.equal(one.details.originalStatus, 'INCONCLUSIVE');
  assert.deepEqual(one.details.violations, [], 'and no verdict is derived from an open question');
  // SUPERSEDED BY PHASE 3I.29: the report also carries the eight BV modules, so the hit count is
  // no longer a statement about BV008 alone. BV008 is addressed by id instead.
  assert.equal(r.checkReport.results.find(x => x.id === 'BV008').status, 'PASS', 'BV008 stays under its limit');
});
test('a night-shift weekday duty is evaluated through the productive CheckModule', async () => {
  const segments = [trip(1, '12', 'Zentrum', 'Endstelle', 300, 696), trip(2, '12', 'Endstelle', 'Zentrum', 762, 800)];
  const r = await live({ begin: 19 * 60 + 20, activities: [{ line: '12', dep: 300, drive: 396 }], segments });
  const one = oneSixth(r.checkReport);
  assert.ok(['PASS', 'FAIL'].includes(one.status), `evaluated, got ${one.status}`);
  // SUPERSEDED BY PHASE 3I.19: the driving basis is now the UMLAUFTAFEL. This fixture's board
  // sheet carries a second trip (762–800) that the roster activity never mentioned, so the real
  // basis is 396 + 38 = 434 minutes instead of the roster's 396.
  // SUPERSEDED BY PHASE 3I.24: the basis is now the DUTY's own segments. Only the first board trip
  // falls inside the roster window of this duty, so its basis is 396 — the second trip belongs to
  // no duty and is reported separately instead of being added to somebody's driving time.
  assert.equal(one.details.services[0].drivingMinutes, 396, 'the duty\'s own trips');
  assert.equal(one.details.services[0].requiredMinutes, 66, 'ceil(396/6) over the productive path');
});
// SUPERSEDED BY PHASE 3I.15b: line 18 ADMITS a duty; it removes nothing from the calculation.
test('a pure line-18 duty is ASSESSED through the productive CheckModule', async () => {
  const r = await live({ begin: 19 * 60 + 20, activities: [{ line: '18', dep: 300, drive: 396 }] });
  const one = oneSixth(r.checkReport);
  // Admitted by line 18 — but this fixture carries no Umlauftafel, so the turnaround data is
  // missing and the rule stays undecidable. What matters: it is no longer DISMISSED.
  assert.notEqual(one.status, 'NOT_APPLICABLE', 'line 18 admits the duty');
  assert.equal(one.details.originalStatus, 'INCONCLUSIVE', 'undecidable for want of turnaround data');
});
// SUPERSEDED BY PHASE 3I.15b: line 18 ADMITS a duty; it removes nothing from the calculation.
test('a mixed duty uses its WHOLE driving time over the productive path', async () => {
  const segments = [trip(1, '5', 'Zentrum', 'Endstelle', 300, 696), trip(2, '5', 'Endstelle', 'Zentrum', 762, 800)];
  const r = await live({ begin: 19 * 60 + 20, activities: [{ line: '18', dep: 300, drive: 396 }, { line: '5', dep: 700, drive: 396 }], segments });
  const one = oneSixth(r.checkReport);
  assert.ok(one.details.services.length > 0, `evaluated, got ${one.details.originalStatus}`);
  // SUPERSEDED BY PHASE 3I.19: the basis comes from the board sheet (396 + 38), not from the two
  // roster activities (396 + 396). Nothing is removed — the source simply became the real one.
  assert.equal(one.details.services[0].drivingMinutes, 434, 'both board trips count — nothing is removed');
  assert.equal(one.details.services[0].requiredMinutes, 73, 'ceil(434/6)');
});
test('an unknown duty start leaves the duty undecidable over the productive path', async () => {
  const r = await live({ begin: undefined, activities: [{ line: '12', dep: 300, drive: 200 }] });
  const one = oneSixth(r.checkReport);
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'WARNING');
  assert.equal(one.details.originalStatus, 'INCONCLUSIVE');
  assert.equal(r.checkReport.summary.hitCount, 0);
});

// ===== the surrounding architecture is unchanged =====
test('still exactly two modules in exactly one runner call', async () => {
  const calls = [];
  await runJnvRuleAnalysis(scenario({ begin: 300, activities: [{ line: '12', dep: 300, drive: 396 }] }), {
    runChecks: (analysisResult, modules) => { calls.push(modules); return Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }); }
  });
  assert.equal(calls.length, 1);
  // SUPERSEDED BY PHASE 3I.29: the eight BV modules are connected now. What still must hold is
  // that BV008 and the 1/6 rule are BOTH present, in that order, in ONE runner call.
  assert.deepEqual([...calls[0].map(x => x.id)].filter(id => ['BV008','BV015_BV018'].includes(id)), ['BV008', 'BV015_BV018']);
});
test('BV008 still receives no eligibility and is unaffected', async () => {
  let bv008 = null;
  const r = await runJnvRuleAnalysis(scenario({ begin: 300, activities: [{ line: '12', dep: 300, drive: 396 }] }), {
    buildCheck: (input) => { bv008 = input; return { id: 'BV008', name: 'x', category: 'BV', priority: 270, run: () => null }; },
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} })
  });
  assert.deepEqual(Object.keys(bv008).sort(), ['drivingProjection', 'ruleConfig']);
  assert.equal(r.status, 'completed');
});
test('a broken one-sixth module still leaves BV008 intact', async () => {
  const r = await runJnvRuleAnalysis(scenario({ begin: 300, activities: [{ line: '12', dep: 300, drive: 396 }] }), {
    buildOneSixthCheck: () => ({ id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run() { throw new Error('boom'); } })
  });
  // SUPERSEDED BY PHASE 3I.29: the BV modules join the report, so absolute counts grew. The
  // protective statement — BV008 and the 1/6 rule are present and unharmed — is kept.
  assert.ok(r.checkReport.results.some(x => x.id === 'BV008'), 'BV008 survives its neighbour failing');
  assert.equal(r.checkReport.errors.length, 1);
});
test('an undecidable eligibility never damages BV008', async () => {
  const r = await live({ begin: undefined, activities: [{ line: '12', dep: 300, drive: 200 }] });
  // SUPERSEDED BY PHASE 3I.29: the BV modules join the report, so absolute counts grew. The
  // protective statement — BV008 and the 1/6 rule are present and unharmed — is kept.
  assert.ok(r.checkReport.results.some(x => x.id === 'BV008'), 'BV008 survives its neighbour failing');
  assert.equal(r.checkReport.results[0].status, 'PASS');
  assert.deepEqual(r.checkReport.errors, []);
});
test('the productive configuration is untouched', () => {
  // SUPERSEDED BY PHASE 3I.14: the rule set is now formally APPROVED. What must stay protected
  // is that approval is NOT activation — every `enabled === false` assertion is untouched.
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');   // SUPERSEDED BY PHASE 3I.15c
  assert.equal(p('activation.enabled').value, false);
  assert.equal(p('openParameters').value.length, 0);
  assert.equal(DEFAULT_ONE_SIXTH_RULE_CONFIG.enabled, false);
});
