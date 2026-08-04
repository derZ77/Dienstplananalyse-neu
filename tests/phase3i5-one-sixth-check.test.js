import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.5 – the 1/6 CheckReport adapter. It only maps the existing rule evaluation onto the
// frozen CheckResult vocabulary: no rule logic, no thresholds, no rounding, no candidate handling.
import {
  mapOneSixthEvaluationToCheckResult,
  createOneSixthCheck,
  ONE_SIXTH_CHECK_ID,
  ONE_SIXTH_CHECK_CATEGORY,
  ONE_SIXTH_STATUS_TO_CHECK
} from '../js/v2/analysis/one-sixth-check.js';
import { CHECK_STATUSES, CHECK_SEVERITIES } from '../js/v2/checks/check-runner.js';

const src = readFileSync(new URL('../js/v2/analysis/one-sixth-check.js', import.meta.url), 'utf8');

const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

const projection = (circulations) => ({
  metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: circulations.length },
  circulations: circulations.map(c => ({
    code: c.code,
    drivingSegments: (c.serviceNumbers ?? ['2101']).map(sn => ({ serviceNumber: sn, kind: 'service', startMinutes: 0, endMinutes: 10, durationMinutes: 10, source: { serviceNumber: sn, activityIndex: 0, sourceType: 'pdf' } })),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: c.drivingMinutes, nonDrivingMinutes: 0, knownTotalMinutes: c.drivingMinutes },
    warnings: []
  })),
  warnings: []
});
const candidate = (over = {}) => ({
  id: over.id ?? `c#${over.n ?? 1}`, circulationCode: over.code ?? '11100',
  previousSegmentRef: { circulationCode: over.code ?? '11100', sequence: 1, type: 'service_trip' },
  nextSegmentRef: { circulationCode: over.code ?? '11100', sequence: 2, type: 'service_trip' },
  startMinutes: 360, endMinutes: 360 + (over.span ?? 15), observedSpanMinutes: over.span ?? 15,
  creditedMinutes: (over.span ?? 15) >= 11 ? (over.span ?? 15) : 0,
  source: 'umlauftafel', confidence: over.confidence ?? 'exact',
  eligibility: (over.span ?? 15) >= 11 ? 'qualified' : 'below_minimum', warnings: over.warnings ?? []
});
const detection = (candidates, status = 'complete') => ({ status, candidates, warnings: [], statistics: { candidateCount: candidates.length, qualifiedCount: candidates.filter(c => c.eligibility === 'qualified').length, belowMinimumCount: 0, unresolvedCount: 0 } });

// scenario builders producing each rule status through the REAL rule module
const scenario = {
  pass: () => ({ drivingProjection: projection([{ code: '11100', drivingMinutes: 396 }]), turnaroundDetection: detection([candidate({ span: 66 })]), ruleConfig: CONFIG, context: CONTEXT }),
  fail: () => ({ drivingProjection: projection([{ code: '11100', drivingMinutes: 396 }]), turnaroundDetection: detection([candidate({ span: 20 })]), ruleConfig: CONFIG, context: CONTEXT }),
  inconclusive: () => ({ drivingProjection: projection([{ code: '11100', drivingMinutes: null }]), turnaroundDetection: detection([candidate({ span: 66 })]), ruleConfig: CONFIG, context: CONTEXT }),
  disabled: () => ({ ...scenario.pass(), ruleConfig: { ...CONFIG, enabled: false } }),
  notApplicable: () => ({ ...scenario.pass(), context: { organization: 'JES', mode: 'bus' } })
};
const resultOf = (name) => createOneSixthCheck(scenario[name]()).run();

test('the adapter contains no rule logic, no thresholds and no storage or network', () => {
  // NB: the literal "1/6" appears in the module title; the guard targets arithmetic and I/O tokens.
  assert.doesNotMatch(src, /Math\.ceil|Math\.round|Math\.floor|requiredRatio|minimumObservedSpanMinutes|localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest|WebSocket|document\.|\/Users\/|\/Volumes\//);
  assert.doesNotMatch(src, /CHECK_STATUSES\s*=|CHECK_SEVERITIES\s*=/, 'no own status/severity vocabulary');
});
test('every mapping target is part of the frozen check vocabulary', () => {
  for (const mapping of Object.values(ONE_SIXTH_STATUS_TO_CHECK)) {
    assert.ok(CHECK_STATUSES.includes(mapping.status));
    assert.ok(CHECK_SEVERITIES.includes(mapping.severity));
  }
});
test('the five-value determination maps exactly onto the frozen vocabulary', () => {
  assert.deepEqual(ONE_SIXTH_STATUS_TO_CHECK, {
    PASS: { status: 'PASS', severity: 'INFO' },
    FAIL: { status: 'FAIL', severity: 'VIOLATION' },
    NOT_APPLICABLE: { status: 'NOT_APPLICABLE', severity: 'INFO' },
    DISABLED: { status: 'SKIP', severity: 'INFO' },
    INCONCLUSIVE: { status: 'SKIP', severity: 'WARNING' }
  });
});

// ===== status mapping =====
test('PASS → PASS/INFO without a hit or violation', () => {
  const r = resultOf('pass');
  assert.equal(r.status, 'PASS');
  assert.equal(r.severity, 'INFO');
  assert.deepEqual(r.details.violations, []);
  assert.deepEqual(r.affectedServices, []);
  assert.equal(r.details.originalStatus, 'PASS');
});
test('FAIL → FAIL/VIOLATION with the rule violations passed through', () => {
  const r = resultOf('fail');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.severity, 'VIOLATION');
  assert.equal(r.details.violations.length, 1);
  assert.equal(r.details.violations[0].severity, 'VIOLATION');
  assert.equal(r.details.violations[0].deficitMinutes, 46);
});
test('INCONCLUSIVE → SKIP/WARNING with the structured warnings preserved', () => {
  const r = resultOf('inconclusive');
  assert.equal(r.status, 'SKIP');
  assert.equal(r.severity, 'WARNING');
  assert.equal(r.details.originalStatus, 'INCONCLUSIVE');
  assert.ok(r.details.warnings.some(w => w.code === 'DRIVING_TIME_UNAVAILABLE'));
  assert.deepEqual(r.details.violations, []);
});
test('DISABLED → SKIP/INFO with the original status visible', () => {
  const r = resultOf('disabled');
  assert.equal(r.status, 'SKIP');
  assert.equal(r.severity, 'INFO');
  assert.equal(r.details.originalStatus, 'DISABLED');
});
test('NOT_APPLICABLE → NOT_APPLICABLE/INFO', () => {
  const r = resultOf('notApplicable');
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.equal(r.severity, 'INFO');
  assert.equal(r.details.originalStatus, 'NOT_APPLICABLE');
});

// ===== affectedServices =====
test('affectedServices contains only unique non-null service numbers of failing entries', () => {
  const twoFailing = {
    drivingProjection: projection([{ code: 'a', drivingMinutes: 396, serviceNumbers: ['2101'] }, { code: 'b', drivingMinutes: 396, serviceNumbers: ['2101'] }]),
    turnaroundDetection: detection([]), ruleConfig: CONFIG, context: CONTEXT
  };
  const r = createOneSixthCheck(twoFailing).run();
  assert.equal(r.status, 'FAIL');
  assert.deepEqual(r.affectedServices, ['2101'], 'the same service number appears once');
});
test('a circulation without a unique service number contributes no affected service', () => {
  const ambiguous = {
    drivingProjection: projection([{ code: '11100', drivingMinutes: 396, serviceNumbers: ['2101', '2102'] }]),
    turnaroundDetection: detection([]), ruleConfig: CONFIG, context: CONTEXT
  };
  // SUPERSEDED BY PHASE 3I.24: the two duties are two units now, so both service numbers are known.
  // What still must hold: no number is invented from the circulation code.
  const r = createOneSixthCheck(ambiguous).run();
  assert.equal(r.status, 'FAIL');
  assert.deepEqual([...r.affectedServices].sort(), ['2101', '2102']);
  assert.doesNotMatch(JSON.stringify(r.affectedServices), /11100/);
});

// ===== details contract =====
test('the details carry the original status, statistics, per-circulation results, violations and warnings', () => {
  const r = resultOf('fail');
  assert.deepEqual(Object.keys(r.details).sort(), ['originalStatus', 'ruleId', 'services', 'statistics', 'violations', 'warnings']);
  assert.equal(typeof r.details.statistics.evaluatedServices, 'number');
  assert.equal(r.details.services[0].circulationCode, '11100');
  assert.equal(r.details.services[0].status, 'FAIL');
});
test('the details carry no source document payload', () => {
  const serialized = JSON.stringify(resultOf('fail'));
  assert.doesNotMatch(serialized, /"drivingSegments"|"stops"|"rawMarker"|"originalText"|arrayBuffer|"buffer"|nonDrivingIntervals/);
});
test('the CheckResult has exactly the fields of the existing result() helper', () => {
  const r = resultOf('pass');
  assert.deepEqual(Object.keys(r).sort(), ['affectedActivities', 'affectedServices', 'category', 'details', 'id', 'message', 'name', 'severity', 'sourceReferences', 'status']);
  assert.equal(r.id, ONE_SIXTH_CHECK_ID);
  assert.equal(r.category, ONE_SIXTH_CHECK_CATEGORY);
  assert.equal(r.category, 'BV');
  assert.ok(r.message.length > 0);
});

// ===== module contract + purity =====
test('createOneSixthCheck yields a CheckModule with id, category and run()', () => {
  const module = createOneSixthCheck(scenario.pass());
  assert.equal(module.id, ONE_SIXTH_CHECK_ID);
  assert.equal(module.category, 'BV');
  assert.equal(typeof module.run, 'function');
});
test('run() delegates to the existing rule module (no recomputation in the adapter)', () => {
  // the adapter imports the rule; it must not implement the comparison itself
  assert.match(src, /evaluateOneSixthRule/);
  assert.doesNotMatch(src, /creditedMinutes\s*>=\s*requiredMinutes|deficitMinutes\s*=/);
});
test('mapping is deterministic and does not mutate the evaluation', () => {
  const module = createOneSixthCheck(scenario.fail());
  const evaluation = module.run().details;
  const snapshot = JSON.stringify(evaluation);
  const a = createOneSixthCheck(scenario.fail()).run();
  const b = createOneSixthCheck(scenario.fail()).run();
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(evaluation), snapshot);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
});
test('an unknown rule status degrades to NOT_APPLICABLE instead of inventing an outcome', () => {
  const r = mapOneSixthEvaluationToCheckResult({ ruleId: 'BV015_BV018', status: 'MAYBE', services: [], violations: [], warnings: [], statistics: {} });
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.equal(r.severity, 'INFO');
});
