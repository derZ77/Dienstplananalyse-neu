/**
 * JNV 1/6 CheckReport adapter (Phase 3I.5) — ADAPTER / INTEGRATION ONLY.
 *
 * Bridges the existing 1/6 rule evaluation (Phase 3I.4) into the EXISTING check architecture,
 * strictly mirroring the BV008 adapter: it calls evaluateOneSixthRule(), maps the rule's
 * five-value determination onto the FROZEN check statuses and severities with the existing
 * result() helper, and produces the EXISTING report through the existing runCheckModules().
 *
 * It owns NO rule logic: no ratio, no ceiling, no threshold, no candidate handling, no violation
 * structure of its own — violations are passed through unchanged. No new status, no new severity,
 * no own report, no own error architecture, no storage, no network, no DOM.
 *
 * Determination → CheckResult mapping:
 *   PASS           → PASS / INFO
 *   FAIL           → FAIL / VIOLATION
 *   NOT_APPLICABLE → NOT_APPLICABLE / INFO
 *   DISABLED       → SKIP / INFO
 *   INCONCLUSIVE   → SKIP / WARNING  (structured warnings + originalStatus stay in details)
 */

import { evaluateOneSixthRule } from './one-sixth-rule.js';
import { result } from '../checks/bv/bv-check-helpers.js';
import { runCheckModules } from '../checks/check-runner.js';

export const ONE_SIXTH_CHECK_ID = 'BV015_BV018';
export const ONE_SIXTH_CHECK_NAME = 'BV015-BV018 Anrechenbare Wendezeit (1/6)';
export const ONE_SIXTH_CHECK_CATEGORY = 'BV';

// Maps the rule determination onto EXISTING frozen statuses/severities only — the adapter owns no
// vocabulary of its own.
export const ONE_SIXTH_STATUS_TO_CHECK = Object.freeze({
  PASS: { status: 'PASS', severity: 'INFO' },
  FAIL: { status: 'FAIL', severity: 'VIOLATION' },
  NOT_APPLICABLE: { status: 'NOT_APPLICABLE', severity: 'INFO' },
  DISABLED: { status: 'SKIP', severity: 'INFO' },
  INCONCLUSIVE: { status: 'SKIP', severity: 'WARNING' }
});

const MESSAGES = Object.freeze({
  PASS: 'Die anrechenbaren Wendezeiten erreichen den erforderlichen Anteil.',
  FAIL: 'Mindestens ein Umlauf erreicht den erforderlichen Wendezeitanteil nicht.',
  NOT_APPLICABLE: 'Die Regel ist für diesen Dokumentkontext nicht anwendbar.',
  DISABLED: 'Die Prüfung ist deaktiviert oder unvollständig konfiguriert.',
  INCONCLUSIVE: 'Nicht abschließend entscheidbar: fehlende Lenkzeit- oder Wendezeitdaten.'
});

// Only unique, non-empty service numbers of failing entries — never derived from a circulation
// code, a line or a time.
const affectedServicesOf = (violations) =>
  [...new Set(violations
    .map(violation => violation?.serviceNumber)
    .filter(value => typeof value === 'string' && value))].sort();

const sourceRefsOf = (violations) => violations.flatMap(v => (Array.isArray(v.sourceRefs) ? v.sourceRefs : []));

/**
 * Map ONE 1/6 evaluation onto ONE existing CheckResult, built with the existing result() helper.
 * @param {object} evaluation result of evaluateOneSixthRule()
 * @returns {object} CheckResult
 */
export function mapOneSixthEvaluationToCheckResult(evaluation) {
  const originalStatus = evaluation && typeof evaluation.status === 'string' ? evaluation.status : 'NOT_APPLICABLE';
  const mapping = ONE_SIXTH_STATUS_TO_CHECK[originalStatus] || ONE_SIXTH_STATUS_TO_CHECK.NOT_APPLICABLE;
  const violations = Array.isArray(evaluation?.violations) ? evaluation.violations : [];
  const warnings = Array.isArray(evaluation?.warnings) ? evaluation.warnings : [];

  const details = {
    ruleId: (typeof evaluation?.ruleId === 'string' && evaluation.ruleId) ? evaluation.ruleId : ONE_SIXTH_CHECK_ID,
    originalStatus,
    statistics: evaluation?.statistics ?? null,
    // small per-circulation projection — never the driving projection or the candidate detection
    services: Array.isArray(evaluation?.services)
      ? evaluation.services.map(s => ({
          circulationCode: s.circulationCode,
          serviceNumber: s.serviceNumber ?? null,
          status: s.status,
          drivingMinutes: s.drivingMinutes,
          requiredMinutes: s.requiredMinutes,
          creditedMinutes: s.creditedMinutes,
          deficitMinutes: s.deficitMinutes
        }))
      : [],
    violations,
    warnings
  };

  return result(
    ONE_SIXTH_CHECK_ID,
    ONE_SIXTH_CHECK_NAME,
    ONE_SIXTH_CHECK_CATEGORY,
    mapping.severity,
    mapping.status,
    MESSAGES[originalStatus] || MESSAGES.NOT_APPLICABLE,
    details,
    affectedServicesOf(violations),
    [],
    sourceRefsOf(violations)
  );
}

/**
 * Build a CheckModule for the EXISTING runCheckModules(); it closes over this check's analysis
 * inputs exactly as the BV008 adapter does.
 * @returns {{ id, name, category, priority, run: function }}
 */
export function createOneSixthCheck({ drivingProjection, turnaroundDetection, ruleConfig, context, eligibility } = {}) {
  return {
    id: ONE_SIXTH_CHECK_ID,
    name: ONE_SIXTH_CHECK_NAME,
    category: ONE_SIXTH_CHECK_CATEGORY,
    priority: 260,
    run() {
      // `eligibility` is passed through unchanged (Phase 3I.10b) — the adapter interprets nothing.
      return mapOneSixthEvaluationToCheckResult(evaluateOneSixthRule({ drivingProjection, turnaroundDetection, ruleConfig, context, eligibility }));
    }
  };
}

/**
 * Convenience entry that delegates entirely to the EXISTING runner — it assembles no report,
 * summary or error handling of its own.
 * @returns {Promise<object>} the existing report
 */
export function runOneSixthCheck({ analysisResult, drivingProjection, turnaroundDetection, ruleConfig, context, eligibility, options } = {}) {
  return runCheckModules(analysisResult, [createOneSixthCheck({ drivingProjection, turnaroundDetection, ruleConfig, context, eligibility })], options || {});
}
