import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3H.4 – BV008 CheckReport adapter. ONLY adapter/integration work: it calls the existing
// evaluateDrivingTimeLimit(), maps its five-value determination onto the frozen CHECK_STATUSES /
// CHECK_SEVERITIES via the existing result() helper, and produces the existing CheckReport through
// the existing runCheckModules(). No new rule, no new engine, no new status, no new severity.
import {
  createDrivingTimeLimitCheck,
  runDrivingTimeLimitCheck,
  mapDrivingTimeEvaluationToCheckResult,
  DRIVING_TIME_LIMIT_CHECK_ID,
  DRIVING_TIME_STATUS_TO_CHECK
} from '../js/v2/analysis/driving-time-limit-check.js';
import { evaluateDrivingTimeLimit } from '../js/v2/analysis/driving-time-limit-rule.js';
import { runCheckModules, CHECK_STATUSES, CHECK_SEVERITIES } from '../js/v2/checks/check-runner.js';

const src = readFileSync(new URL('../js/v2/analysis/driving-time-limit-check.js', import.meta.url), 'utf8');
const CONFIG = { ruleId: 'BV008', enabled: true, maxContinuousDrivingMinutes: 270, qualifyingInterruption: { singleMinimumMinutes: 45, splitSequence: [15, 30] } };
const ANALYSIS = { type: 'AnalysisResult', metadata: { documentProfileId: 'jnv-fahrplan-v1' } };

const dseg = (start, dur, svc = '2101') => ({ serviceNumber: svc, kind: 'service', startMinutes: start, endMinutes: dur == null ? null : start + dur, durationMinutes: dur, source: { serviceNumber: svc, activityIndex: 0, sourceType: 'pdf' } });
const interruption = (start, dur, sourceType = 'break') => ({ startMinutes: start, endMinutes: dur == null ? null : start + dur, durationMinutes: dur, sourceType, explicit: true, sourceRefs: [{ serviceNumber: '2101', activityIndex: null, sourceType }] });
const circ = (o) => ({ code: o.code ?? '12100', drivingSegments: o.drivingSegments ?? [], drivingBlocks: [], interruptionIntervals: o.interruptionIntervals ?? [], nonDrivingIntervals: o.nonDrivingIntervals ?? [], statistics: {}, warnings: [] });
const projection = (circs) => ({ metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: circs.length }, circulations: circs, warnings: [] });
const notApplicableProjection = () => ({ metadata: null, circulations: [], warnings: [{ code: 'INVALID_JOINT_TIMELINE' }] });

const mapped = (drivingProjection, ruleConfig = CONFIG) => mapDrivingTimeEvaluationToCheckResult(evaluateDrivingTimeLimit({ drivingProjection, ruleConfig }));
const report = (drivingProjection, ruleConfig = CONFIG) => runDrivingTimeLimitCheck({ analysisResult: ANALYSIS, drivingProjection, ruleConfig });

// ===== adapter only reuses frozen vocabulary =====
test('the adapter defines NO own status or severity vocabulary (reuses the frozen ones)', () => {
  assert.doesNotMatch(src, /CHECK_STATUSES\s*=|CHECK_SEVERITIES\s*=|Object\.freeze\(\[\s*'PASS'/);
  // every mapping target is a frozen check status/severity
  for (const m of Object.values(DRIVING_TIME_STATUS_TO_CHECK)) {
    assert.ok(CHECK_STATUSES.includes(m.status), `status ${m.status} not frozen`);
    assert.ok(CHECK_SEVERITIES.includes(m.severity), `severity ${m.severity} not frozen`);
  }
});

test('the five-value determination maps exactly onto the frozen check vocabulary', () => {
  assert.deepEqual(DRIVING_TIME_STATUS_TO_CHECK, {
    PASS: { status: 'PASS', severity: 'INFO' },
    FAIL: { status: 'FAIL', severity: 'VIOLATION' },
    NOT_APPLICABLE: { status: 'NOT_APPLICABLE', severity: 'INFO' },
    DISABLED: { status: 'SKIP', severity: 'INFO' },
    INCONCLUSIVE: { status: 'SKIP', severity: 'WARNING' }
  });
});

// ===== per-status mapping =====
test('PASS → CheckResult PASS/INFO', () => {
  const r = mapped(projection([circ({ drivingSegments: [dseg(0, 200)] })]));
  assert.equal(r.id, 'BV008');
  assert.equal(r.category, 'BV');
  assert.equal(r.status, 'PASS');
  assert.equal(r.severity, 'INFO');
});
test('FAIL → CheckResult FAIL/VIOLATION with affected services and violations in details', () => {
  const r = mapped(projection([circ({ drivingSegments: [dseg(0, 300)] })]));
  assert.equal(r.status, 'FAIL');
  assert.equal(r.severity, 'VIOLATION');
  assert.deepEqual(r.affectedServices, ['2101']);
  assert.equal(r.details.violations.length, 1);
  assert.equal(r.details.violations[0].code, 'MAX_CONTINUOUS_DRIVING_EXCEEDED');
  assert.ok(r.sourceReferences.length >= 1);
});
test('NOT_APPLICABLE → CheckResult NOT_APPLICABLE/INFO', () => {
  const r = mapped(notApplicableProjection());
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.equal(r.severity, 'INFO');
});
test('DISABLED → CheckResult SKIP/INFO', () => {
  const r = mapped(projection([circ({ drivingSegments: [dseg(0, 400)] })]), { ...CONFIG, enabled: false });
  assert.equal(r.status, 'SKIP');
  assert.equal(r.severity, 'INFO');
});
test('INCONCLUSIVE → CheckResult SKIP/WARNING carrying a structured warning', () => {
  const r = mapped(projection([circ({ drivingSegments: [dseg(0, null)] })]));
  assert.equal(r.status, 'SKIP');
  assert.equal(r.severity, 'WARNING');
  assert.ok(Array.isArray(r.details.warnings) && r.details.warnings.length >= 1);
  assert.ok(r.details.warnings.every(w => typeof w.code === 'string' && w.code));
});

// ===== every produced result is inside the frozen vocabulary =====
test('every produced CheckResult uses only frozen statuses and severities', () => {
  const cases = [
    projection([circ({ drivingSegments: [dseg(0, 200)] })]),
    projection([circ({ drivingSegments: [dseg(0, 300)] })]),
    projection([circ({ drivingSegments: [dseg(0, null)] })]),
    notApplicableProjection()
  ];
  for (const p of cases) {
    const r = mapped(p);
    assert.ok(CHECK_STATUSES.includes(r.status));
    assert.ok(CHECK_SEVERITIES.includes(r.severity));
  }
  assert.equal(mapped(projection([circ({ drivingSegments: [dseg(0, 400)] })]), { ...CONFIG, enabled: false }).status, 'SKIP');
});

// ===== CheckResult shape from the existing helper =====
test('the CheckResult has exactly the fields the existing result() helper produces', () => {
  const r = mapped(projection([circ({ drivingSegments: [dseg(0, 200)] })]));
  assert.deepEqual(Object.keys(r).sort(), ['affectedActivities', 'affectedServices', 'category', 'details', 'id', 'message', 'name', 'severity', 'sourceReferences', 'status']);
  assert.equal(typeof r.message, 'string');
  assert.ok(r.message.length > 0);
});

// ===== existing runner / CheckReport / rule-engine compatibility =====
test('createDrivingTimeLimitCheck yields a CheckModule the existing runner accepts', async () => {
  const module = createDrivingTimeLimitCheck({ drivingProjection: projection([circ({ drivingSegments: [dseg(0, 300)] })]), ruleConfig: CONFIG });
  assert.equal(module.id, 'BV008');
  assert.equal(module.category, 'BV');
  assert.equal(typeof module.run, 'function');
  const rep = await runCheckModules(ANALYSIS, [module]);
  assert.equal(rep.type, 'CheckReport');
  assert.equal(rep.results.length, 1);
  assert.equal(rep.results[0].status, 'FAIL');
  assert.equal(rep.results[0].severity, 'VIOLATION');
  assert.equal(rep.errors.length, 0);
  assert.equal(rep.summary.hitCount, 1);
});
test('runDrivingTimeLimitCheck produces a real CheckReport via the existing runner (no parallel report)', async () => {
  const rep = await report(projection([circ({ drivingSegments: [dseg(0, 200)] })]));
  assert.equal(rep.type, 'CheckReport');
  assert.equal(rep.results[0].id, 'BV008');
  assert.equal(rep.results[0].status, 'PASS');
  assert.equal(rep.summary.resultCount, 1);
  assert.equal(rep.errors.length, 0);
});
test('the module never throws inside the runner for a not-applicable projection', async () => {
  const rep = await runCheckModules(ANALYSIS, [createDrivingTimeLimitCheck({ drivingProjection: notApplicableProjection(), ruleConfig: CONFIG })]);
  assert.equal(rep.errors.length, 0);
  assert.equal(rep.results[0].status, 'NOT_APPLICABLE');
});

// ===== purity =====
test('the adapter is deterministic and does not mutate its inputs', () => {
  const p = projection([circ({ drivingSegments: [dseg(0, 300)] })]);
  const input = { analysisResult: ANALYSIS, drivingProjection: p, ruleConfig: CONFIG };
  const snap = JSON.stringify(input);
  const a = mapped(p);
  const b = mapped(p);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snap);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
});
