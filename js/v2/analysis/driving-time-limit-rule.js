/**
 * Continuous driving-time limit rule (BV008, Phase 3H.3) — the 4 h 30 min (270-minute) rule
 * ONLY: "a driver may accumulate at most 270 minutes of continuous driving without a
 * sufficient interruption."
 *
 * Basis is the neutral driving projection (Phase 3H.2). This module deliberately implements
 * NOTHING else: no driving-quota rule, no creditable turn-around allowance, no stop-distance
 * exception, no weekend / night / line exceptions, no statutory working-time pause, no
 * block-break rule, no other collective-agreement rule, no UI, no recommendation. All
 * thresholds come from the passed rule config (`driving-time-limit.v1.json`); none are wired
 * into the algorithm.
 *
 * Determination vocabulary (closed): PASS / FAIL / INCONCLUSIVE / NOT_APPLICABLE / DISABLED.
 * PASS / FAIL / NOT_APPLICABLE align with the frozen CHECK_STATUSES; DISABLED and INCONCLUSIVE
 * are this rule's own richer states (when later surfaced through the CheckReport they map to the
 * frozen SKIP). Violation severity reuses the frozen `VIOLATION` severity. Pure, non-mutating,
 * deterministic, no storage, no network, no current time, no random.
 */

import { validateDrivingTimeRuleConfig } from './driving-time-limit-validation.js';

export const DRIVING_TIME_RULE_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  DISABLED: 'DISABLED'
});

const VIOLATION_SEVERITY = 'VIOLATION'; // reuse the frozen CheckReport severity vocabulary
const VIOLATION_CODE = 'MAX_CONTINUOUS_DRIVING_EXCEEDED';

const smallRef = (source) => ({
  serviceNumber: source?.serviceNumber ?? null,
  activityIndex: source?.activityIndex ?? null,
  sourceType: source?.sourceType ?? null
});

const emptyStatistics = (evaluated = 0) => ({
  evaluatedCirculations: evaluated,
  passCount: 0,
  failCount: 0,
  inconclusiveCount: 0,
  violationCount: 0,
  totalResets: 0
});

const shell = (ruleId, status, warnings, evaluated) => ({
  ruleId,
  status,
  circulations: [],
  violations: [],
  warnings,
  statistics: emptyStatistics(evaluated)
});

/**
 * @param {{ drivingProjection: object, ruleConfig: object }} input
 * @returns {{ ruleId, status, circulations, violations, warnings, statistics }}
 */
export function evaluateDrivingTimeLimit({ drivingProjection, ruleConfig } = {}) {
  const ruleId = (typeof ruleConfig?.ruleId === 'string' && ruleConfig.ruleId) ? ruleConfig.ruleId : 'BV008';

  // Gate 1 — configuration must be structurally usable, otherwise the rule cannot run.
  const configCheck = validateDrivingTimeRuleConfig(ruleConfig);
  if (!configCheck.valid) {
    return shell(ruleId, DRIVING_TIME_RULE_STATUS.DISABLED, [{ code: 'RULE_CONFIGURATION_INVALID', details: configCheck.errors }], 0);
  }
  if (ruleConfig.enabled === false) {
    return shell(ruleId, DRIVING_TIME_RULE_STATUS.DISABLED, [{ code: 'RULE_DISABLED' }], 0);
  }

  // Gate 2 — the driving projection must be applicable (an exact, projected joint timeline).
  if (!drivingProjection || typeof drivingProjection !== 'object' || drivingProjection.metadata == null || !Array.isArray(drivingProjection.circulations)) {
    return shell(ruleId, DRIVING_TIME_RULE_STATUS.NOT_APPLICABLE, [{ code: 'INVALID_DRIVING_PROJECTION' }], 0);
  }

  const limit = ruleConfig.maxContinuousDrivingMinutes;
  const single = ruleConfig.qualifyingInterruption.singleMinimumMinutes;
  const [splitFirstMin, splitSecondMin] = ruleConfig.qualifyingInterruption.splitSequence;

  const circulations = drivingProjection.circulations.map(c =>
    evaluateCirculation(c, { ruleId, limit, single, splitFirstMin, splitSecondMin })
  );

  const violations = circulations.flatMap(c => c.violations);
  const warnings = circulations.flatMap(c => c.warnings);
  const failCount = circulations.filter(c => c.status === DRIVING_TIME_RULE_STATUS.FAIL).length;
  const inconclusiveCount = circulations.filter(c => c.status === DRIVING_TIME_RULE_STATUS.INCONCLUSIVE).length;
  const passCount = circulations.filter(c => c.status === DRIVING_TIME_RULE_STATUS.PASS).length;

  let status = DRIVING_TIME_RULE_STATUS.PASS;
  if (failCount > 0) status = DRIVING_TIME_RULE_STATUS.FAIL;
  else if (inconclusiveCount > 0) status = DRIVING_TIME_RULE_STATUS.INCONCLUSIVE;

  return {
    ruleId,
    status,
    circulations,
    violations,
    warnings,
    statistics: {
      evaluatedCirculations: circulations.length,
      passCount,
      failCount,
      inconclusiveCount,
      violationCount: violations.length,
      totalResets: circulations.reduce((sum, c) => sum + c.resetCount, 0)
    }
  };
}

function evaluateCirculation(circulation, cfg) {
  const code = typeof circulation?.code === 'string' ? circulation.code : String(circulation?.code ?? '');
  const drivingSegments = Array.isArray(circulation?.drivingSegments) ? circulation.drivingSegments : [];
  const interruptionIntervals = Array.isArray(circulation?.interruptionIntervals) ? circulation.interruptionIntervals : [];

  // Build one chronological event stream from driving segments and explicit interruptions.
  // Plain gaps and unknown non-driving intervals are intentionally NOT candidates — they never
  // reset the accumulator. Stable order: by start minute, interruptions before driving on ties.
  const events = [
    ...drivingSegments.map((s, i) => ({ type: 'driving', order: i, startMinutes: s.startMinutes, durationMinutes: s.durationMinutes, serviceNumber: s.serviceNumber ?? null, source: s.source })),
    ...interruptionIntervals.map((iv, i) => ({ type: 'interruption', order: i, startMinutes: iv.startMinutes, durationMinutes: iv.durationMinutes, sourceType: iv.sourceType ?? null }))
  ];
  const rank = { interruption: 0, driving: 1 };
  events.sort((a, b) => {
    const as = typeof a.startMinutes === 'number' ? a.startMinutes : Number.MAX_SAFE_INTEGER;
    const bs = typeof b.startMinutes === 'number' ? b.startMinutes : Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type];
    return 0;
  });

  let accumulated = 0;
  let peakDrivingMinutes = 0;
  let pendingSplitFirst = false;
  let sawUncertainSinceReset = false;
  let violatedSinceReset = false;
  let resetCount = 0;
  let hasDefiniteViolation = false;
  let hasUncertainty = false;
  const violations = [];
  const warnings = [];

  const reset = () => { accumulated = 0; pendingSplitFirst = false; sawUncertainSinceReset = false; violatedSinceReset = false; resetCount += 1; };

  for (const ev of events) {
    if (ev.type === 'driving') {
      if (typeof ev.durationMinutes !== 'number') {
        sawUncertainSinceReset = true;
        hasUncertainty = true;
        warnings.push({ code: 'MISSING_DRIVING_TIME', circulationCode: code, serviceNumber: ev.serviceNumber });
        continue;
      }
      accumulated += ev.durationMinutes;
      if (accumulated > peakDrivingMinutes) peakDrivingMinutes = accumulated;
      if (accumulated > cfg.limit && !violatedSinceReset) {
        violatedSinceReset = true;
        if (sawUncertainSinceReset) {
          // An interruption of unknown recovery value sits before this exceedance: we cannot
          // decide whether it would have reset the accumulator → inconclusive, never a hard FAIL.
          hasUncertainty = true;
        } else {
          hasDefiniteViolation = true;
          violations.push({
            ruleId: cfg.ruleId,
            code: VIOLATION_CODE,
            severity: VIOLATION_SEVERITY,
            circulationCode: code,
            serviceNumbers: ev.serviceNumber == null ? [] : [String(ev.serviceNumber)],
            limitMinutes: cfg.limit,
            actualMinutes: accumulated,
            exceededByMinutes: accumulated - cfg.limit,
            atStartMinutes: typeof ev.startMinutes === 'number' ? ev.startMinutes : null,
            sourceRefs: ev.source ? [smallRef(ev.source)] : []
          });
        }
      }
      continue;
    }

    // interruption
    const dur = ev.durationMinutes;
    if (typeof dur !== 'number') {
      sawUncertainSinceReset = true;
      hasUncertainty = true;
      warnings.push({ code: 'UNKNOWN_INTERRUPTION_QUALIFICATION', circulationCode: code, sourceType: ev.sourceType });
      continue; // no reset
    }
    if (pendingSplitFirst && dur >= cfg.splitSecondMin) {
      reset(); // split completed (first part earlier, sufficient second part now)
    } else if (dur >= cfg.single) {
      reset(); // single sufficient interruption
    } else if (dur >= cfg.splitFirstMin) {
      pendingSplitFirst = true; // candidate first part of a split; not qualifying on its own
    }
    // else: too short to contribute — non-qualifying, no effect.
  }

  if (pendingSplitFirst) warnings.push({ code: 'INCOMPLETE_SPLIT_INTERRUPTION', circulationCode: code });

  let status = DRIVING_TIME_RULE_STATUS.PASS;
  if (hasDefiniteViolation) status = DRIVING_TIME_RULE_STATUS.FAIL;
  else if (hasUncertainty) status = DRIVING_TIME_RULE_STATUS.INCONCLUSIVE;

  return { code, status, peakDrivingMinutes, resetCount, violations, warnings };
}
