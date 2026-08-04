/**
 * BV008 CheckReport adapter (Phase 3H.4) — ADAPTER / INTEGRATION ONLY.
 *
 * Bridges the neutral BV008 driving-time evaluation (Phase 3H.3) into the EXISTING check
 * architecture. It calls evaluateDrivingTimeLimit(), maps the rule's five-value determination
 * onto the FROZEN CHECK_STATUSES / CHECK_SEVERITIES using the existing result() helper, and
 * produces the EXISTING CheckReport through the existing runCheckModules(). It introduces no new
 * rule, no new engine, no new status, no new severity, no UI, no storage, and no network, and it
 * changes neither the rule logic nor its JSON configuration.
 *
 * Determination → CheckResult mapping:
 *   PASS           → PASS / INFO
 *   FAIL           → FAIL / VIOLATION
 *   NOT_APPLICABLE → NOT_APPLICABLE / INFO
 *   DISABLED       → SKIP / INFO
 *   INCONCLUSIVE   → SKIP / WARNING  (plus the rule's structured warnings carried in details)
 */

import { evaluateDrivingTimeLimit } from './driving-time-limit-rule.js';
import { result } from '../checks/bv/bv-check-helpers.js';
import { runCheckModules } from '../checks/check-runner.js';

export const DRIVING_TIME_LIMIT_CHECK_ID = 'BV008';
export const DRIVING_TIME_LIMIT_CHECK_NAME = 'BV008 Maximale ununterbrochene Lenkzeit';
export const DRIVING_TIME_LIMIT_CHECK_CATEGORY = 'BV';

// Maps the rule's determination onto EXISTING frozen check statuses/severities only — the adapter
// owns no status or severity vocabulary of its own.
export const DRIVING_TIME_STATUS_TO_CHECK = Object.freeze({
  PASS: { status: 'PASS', severity: 'INFO' },
  FAIL: { status: 'FAIL', severity: 'VIOLATION' },
  NOT_APPLICABLE: { status: 'NOT_APPLICABLE', severity: 'INFO' },
  DISABLED: { status: 'SKIP', severity: 'INFO' },
  INCONCLUSIVE: { status: 'SKIP', severity: 'WARNING' }
});

const MESSAGES = Object.freeze({
  PASS: 'Alle Umläufe halten die maximale ununterbrochene Lenkzeit ein.',
  FAIL: 'Mindestens ein Umlauf überschreitet die maximale ununterbrochene Lenkzeit.',
  NOT_APPLICABLE: 'Keine anwendbare Fahrprojektion (kein exakter Verbund).',
  DISABLED: 'Die Prüfung ist deaktiviert oder unvollständig konfiguriert.',
  INCONCLUSIVE: 'Nicht abschließend entscheidbar: unbekannte Unterbrechungsqualität oder fehlende Zeiten.'
});

const affectedServicesOf = (violations) =>
  [...new Set(violations.flatMap(v => (Array.isArray(v.serviceNumbers) ? v.serviceNumbers : [])).map(String))].sort();
const sourceRefsOf = (violations) =>
  violations.flatMap(v => (Array.isArray(v.sourceRefs) ? v.sourceRefs : []));

/**
 * Map ONE BV008 evaluation onto ONE existing CheckResult, built with the existing result() helper.
 * @param {object} evaluation result of evaluateDrivingTimeLimit()
 * @returns {object} CheckResult
 */
export function mapDrivingTimeEvaluationToCheckResult(evaluation) {
  const ruleStatus = evaluation && typeof evaluation.status === 'string' ? evaluation.status : 'NOT_APPLICABLE';
  const mapping = DRIVING_TIME_STATUS_TO_CHECK[ruleStatus] || DRIVING_TIME_STATUS_TO_CHECK.NOT_APPLICABLE;
  const violations = Array.isArray(evaluation?.violations) ? evaluation.violations : [];
  const warnings = Array.isArray(evaluation?.warnings) ? evaluation.warnings : [];

  const details = {
    ruleId: DRIVING_TIME_LIMIT_CHECK_ID,
    ruleStatus,
    statistics: evaluation?.statistics ?? null,
    circulations: Array.isArray(evaluation?.circulations)
      ? evaluation.circulations.map(c => ({ code: c.code, status: c.status, resetCount: c.resetCount, peakDrivingMinutes: c.peakDrivingMinutes }))
      : [],
    violations,
    warnings
  };

  return result(
    DRIVING_TIME_LIMIT_CHECK_ID,
    DRIVING_TIME_LIMIT_CHECK_NAME,
    DRIVING_TIME_LIMIT_CHECK_CATEGORY,
    mapping.severity,
    mapping.status,
    MESSAGES[ruleStatus] || MESSAGES.NOT_APPLICABLE,
    details,
    affectedServicesOf(violations),
    [],
    sourceRefsOf(violations)
  );
}

/**
 * Build a CheckModule for the EXISTING runCheckModules(). It closes over the driving projection
 * and rule config (this check's analysis inputs), the same way bv010 closes over its schedule.
 * @returns {{ id, name, category, priority, run: function }}
 */
export function createDrivingTimeLimitCheck({ drivingProjection, ruleConfig } = {}) {
  return {
    id: DRIVING_TIME_LIMIT_CHECK_ID,
    name: DRIVING_TIME_LIMIT_CHECK_NAME,
    category: DRIVING_TIME_LIMIT_CHECK_CATEGORY,
    priority: 270,
    run() {
      return mapDrivingTimeEvaluationToCheckResult(evaluateDrivingTimeLimit({ drivingProjection, ruleConfig }));
    }
  };
}

/**
 * Convenience entry that produces the EXISTING CheckReport by delegating entirely to the EXISTING
 * runner — it assembles no report of its own.
 * @returns {Promise<object>} CheckReport
 */
export function runDrivingTimeLimitCheck({ analysisResult, drivingProjection, ruleConfig, options } = {}) {
  return runCheckModules(analysisResult, [createDrivingTimeLimitCheck({ drivingProjection, ruleConfig })], options || {});
}
