import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.10 – with the forwarded data the Phase 3I.9 filters take effect for the first time on a
// real chain. The filters themselves are unchanged; only their inputs now arrive.
import { runJnvRuleAnalysis } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { evaluateOneSixthRule, evaluateOneSixthEligibility } from '../js/v2/analysis/one-sixth-rule.js';
import { createDrivingProjection } from '../js/v2/analysis/driving-projection.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((n, k) => n?.[k], config.parameters);

// an explicitly enabled TEST configuration — the productive one stays draft/disabled
const ENABLED = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: p('eligibility.allowedDayTypes').value,
  nightShiftIsException: p('eligibility.nightShiftIsException').value,
  nightShiftStart: p('eligibility.nightShiftStart').value,
  nightShiftStartInclusive: p('eligibility.nightShiftStartInclusive').value,
  admissionLines: p('eligibility.admissionLines').value,
  admissionLineRequiresPureDuty: p('eligibility.admissionLineRequiresPureDuty').value
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const timelineSegment = (line, durationMinutes = 396) => ({
  serviceNumber: '2101', line, course: '1', trip: null,
  departure: '05:00', arrival: '11:36', dayOffset: 0, durationMinutes,
  source: { serviceNumber: '2101', activityIndex: 0, sourceType: 'pdf' }, kind: 'service'
});
const timeline = (dayType, segments) => ({
  metadata: { serviceRegime: 'school', dayType, generatedFrom: 'joint-timeline' },
  circulations: [{ code: '11100', serviceNumbers: ['2101'], segments, warnings: [] }],
  warnings: []
});
const detection = () => ({ status: 'complete', candidates: [{
  id: 'c#1', circulationCode: '11100', previousSegmentRef: { circulationCode: '11100', sequence: 1, type: 'service_trip', line: '12' },
  nextSegmentRef: { circulationCode: '11100', sequence: 2, type: 'service_trip', line: '12' }, startMinutes: 360, endMinutes: 426,
  observedSpanMinutes: 66, creditedMinutes: 66, source: 'umlauftafel', confidence: 'exact', eligibility: 'qualified', warnings: []
}], warnings: [], statistics: { candidateCount: 1, qualifiedCount: 1, belowMinimumCount: 0, unresolvedCount: 0 } });

// the REAL chain: joint timeline → projection (with the forwarded fields) → rule
const evaluate = ({ dayType = 'saturday', lines = ['12'], dutyStartMinutes = null }) => {
  const drivingProjection = createDrivingProjection({ jointTimeline: timeline(dayType, lines.map(l => timelineSegment(l))), dutyStartMinutes });
  return {
    drivingProjection,
    result: evaluateOneSixthRule({
      drivingProjection, turnaroundDetection: detection(), ruleConfig: ENABLED, context: CONTEXT,
      eligibility: { dutyStartMinutes: drivingProjection.metadata.dutyStartTime }
    })
  };
};

// ===== the line filter now actually reaches the rule =====
// SUPERSEDED BY PHASE 3I.15b: line 18 ADMITS a duty; it removes nothing from the calculation.
test('the forwarded line makes the line-18 admission effective', () => {
  const { drivingProjection, result } = evaluate({ lines: ['18'] });
  assert.equal(drivingProjection.circulations[0].drivingSegments[0].line, '18', 'the line arrived');
  assert.notEqual(result.status, 'NOT_APPLICABLE', 'a pure line-18 duty is assessed, not dismissed');
  assert.equal(result.services.length, 1, 'the quota evaluation ran');
});
test('a non-exception line still reaches the quota evaluation', () => {
  const { result } = evaluate({ lines: ['12'] });
  assert.equal(result.status, 'PASS');
  assert.equal(result.services[0].requiredMinutes, 66, 'ceil(396/6) unchanged');
});
test('a mixed circulation is not exempted and reaches the quota evaluation', () => {
  const { result } = evaluate({ lines: ['18', '12'] });
  assert.notEqual(result.status, 'NOT_APPLICABLE', 'not a whole-circulation exemption');
  assert.equal(result.services.length, 1, 'the quota evaluation ran');
});
// SUPERSEDED BY PHASE 3I.15b: line 18 ADMITS a duty; it removes nothing from the calculation.
test('SUPERSEDED BY PHASE 3I.15b: every segment counts towards the quota again', () => {
  const { result } = evaluate({ lines: ['18', '12'] });
  assert.equal(result.services[0].drivingMinutes, 792, 'both segments count — nothing is removed');
  assert.equal(result.services[0].requiredMinutes, 132, 'ceil(792/6)');
  assert.ok(!('exceptedDrivingMinutes' in result.services[0]), 'no line ever reduces the basis');
});
test('a missing line is forwarded as null and reported as a gap, not as an exception', () => {
  const { drivingProjection, result } = evaluate({ lines: [null] });
  assert.equal(drivingProjection.circulations[0].drivingSegments[0].line, null);
  assert.equal(result.status, 'PASS', 'no exception is claimed without line data');
});

// ===== the night-shift filter now actually reaches the rule =====
test('a forwarded duty start of 19:20 admits a weekday duty through the night-shift exception', () => {
  const { drivingProjection, result } = evaluate({ dayType: 'mo_fr', dutyStartMinutes: 19 * 60 + 20 });
  assert.equal(drivingProjection.metadata.dutyStartTime, 19 * 60 + 20, 'the duty start arrived');
  assert.equal(result.status, 'PASS');
  assert.equal(result.services[0].requiredMinutes, 66);
});
test('a forwarded duty start of 19:19 leaves a weekday duty out of scope', () => {
  const { result } = evaluate({ dayType: 'mo_fr', dutyStartMinutes: 19 * 60 + 19 });
  assert.equal(result.status, 'NOT_APPLICABLE');
  assert.ok(result.warnings.some(w => w.code === 'DAY_TYPE_NOT_ELIGIBLE'));
});
test('an unforwarded duty start leaves a weekday duty undecidable', () => {
  const { drivingProjection, result } = evaluate({ dayType: 'mo_fr', dutyStartMinutes: null });
  assert.equal(drivingProjection.metadata.dutyStartTime, null);
  assert.equal(result.status, 'INCONCLUSIVE', 'no verdict without the duty start');
  assert.deepEqual(result.violations, []);
});
test('a weekend duty needs no duty start at all', () => {
  const { result } = evaluate({ dayType: 'saturday', dutyStartMinutes: null });
  assert.equal(result.status, 'PASS');
});

// ===== the filters themselves are unchanged =====
test('the eligibility evaluation is identical whether the input comes from the projection or directly', () => {
  const drivingProjection = createDrivingProjection({ jointTimeline: timeline('mo_fr', [timelineSegment('12')]), dutyStartMinutes: 1200 });
  const viaProjection = evaluateOneSixthEligibility({ drivingProjection, ruleConfig: ENABLED, context: CONTEXT, eligibility: { dutyStartMinutes: drivingProjection.metadata.dutyStartTime } });
  const direct = evaluateOneSixthEligibility({ drivingProjection, ruleConfig: ENABLED, context: CONTEXT, eligibility: { dutyStartMinutes: 1200 } });
  assert.deepEqual(viaProjection, direct, 'the filter logic did not change, only its input');
});
test('the quota arithmetic is untouched by the forwarding', () => {
  const { result } = evaluate({ dayType: 'saturday', lines: ['12'] });
  assert.equal(result.services[0].drivingMinutes, 396);
  assert.equal(result.services[0].requiredMinutes, 66);
  assert.equal(result.services[0].creditedMinutes, 66);
  assert.equal(result.services[0].deficitMinutes, 0);
});

// ===== the shared report is unchanged =====
const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: '12100',
  routeIdentity: { line: o.line ?? '12', course: '1', trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: 300, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: 300 + (o.drive ?? 80), dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
const liveScenario = (begin) => ({
  bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
  primaryImport: { canonicalSchedule: { hardened: { applied: true, services: [{ serviceNumber: '2101', begin: { value: '—', minutesSinceStartOfDay: begin, dayOffset: 0 }, dutyActivities: [dutyAct({ svc: '2101' })] }] }, document: { sourceType: 'pdf' } } },
  companionImport: { document: createUmlauftafelDocument({ mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }), circulations: [createCirculation({ code: '12100', mode: 'bus' })] }) },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [], matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: ['12100'], companionRefs: ['12100'] }] } }
});

test('the productive shared report still carries both results and stays disabled', async () => {
  const r = await runJnvRuleAnalysis(liveScenario(19 * 60 + 20));
  assert.equal(r.status, 'completed');
  // SUPERSEDED BY PHASE 3I.29: the report also carries the eight BV modules. Both results must
  // still be present, in that order — the count is no longer two, and results are found by id.
  assert.deepEqual(r.checkReport.results.map(x => x.id).filter(id => ['BV008', 'BV015_BV018'].includes(id)),
    ['BV008', 'BV015_BV018']);
  assert.ok(r.checkReport.summary.resultCount >= 2);
  assert.deepEqual(r.checkReport.errors, []);
  const one = r.checkReport.results.find(x => x.id === 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.details.originalStatus, 'DISABLED', 'the productive rule set is still disabled');
});
test('the forwarded fields really arrive in the productive projection', async () => {
  const r = await runJnvRuleAnalysis(liveScenario(19 * 60 + 20));
  assert.equal(r.drivingProjection.metadata.dutyStartTime, 19 * 60 + 20);
  assert.equal(r.drivingProjection.circulations[0].drivingSegments[0].line, '12');
});
test('BV008 is unaffected by the forwarding', async () => {
  const r = await runJnvRuleAnalysis(liveScenario(300));
  // SUPERSEDED BY PHASE 3I.29: BV008 is addressed by id, not by position.
  const bv008 = r.checkReport.results.find(x => x.id === 'BV008');
  assert.equal(bv008.status, 'PASS');
  assert.equal(bv008.severity, 'INFO', 'and it contributes no hit of its own');
});

// CLOSED BY PHASE 3I.10b: the adapter now forwards `eligibility` to the rule, so the chain is
// complete over the productive CheckModule path.
test('CLOSED BY PHASE 3I.10b: the check adapter forwards the eligibility input', () => {
  const adapter = readFileSync(new URL('../js/v2/analysis/one-sixth-check.js', import.meta.url), 'utf8');
  assert.match(adapter, /createOneSixthCheck\(\{ drivingProjection, turnaroundDetection, ruleConfig, context, eligibility \}/);
  assert.match(adapter, /evaluateOneSixthRule\(\{[^}]*eligibility[^}]*\}\)/);
  const orchestrator = readFileSync(new URL('../js/v2/analysis/jnv-rule-analysis-controller.js', import.meta.url), 'utf8');
  assert.match(orchestrator, /eligibility: \{ dutyStartMinutes:/, 'the orchestrator forwards it');
});
test('the forwarded value is nonetheless handed to the CheckModule factory', async () => {
  let received = null;
  await runJnvRuleAnalysis(liveScenario(19 * 60 + 20), {
    runChecks: () => Promise.resolve({ type: 'CheckReport', results: [], errors: [], summary: {} }),
    buildOneSixthCheck: (input) => { received = input; return { id: 'BV015_BV018', name: 'x', category: 'BV', priority: 260, run: () => null }; }
  });
  // SUPERSEDED BY PHASE 3I.10b: the per-service map travels alongside the document-wide value.
  assert.equal(received.eligibility.dutyStartMinutes, 19 * 60 + 20);
  assert.deepEqual(received.eligibility.serviceStarts, { 2101: 19 * 60 + 20 });
});
