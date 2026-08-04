/**
 * Validators for the JNV 1/6 rule configuration and evaluation (Phase 3I.4).
 *
 * `{valid, errors:[{code,path}]}`, no mutation, no repair. They check structure, the closed status
 * vocabulary, the ceiling requirement, deficit consistency and the outcome/violation coupling —
 * they execute no rule and produce no outcome of their own.
 */

export const ONE_SIXTH_STATUSES = Object.freeze(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'DISABLED']);
// The eligibility chain (Phase 3I.9) may never reach a compliance verdict.
export const ELIGIBILITY_STATUSES = Object.freeze(['PASS', 'NOT_APPLICABLE', 'INCONCLUSIVE']);
// Phase 3I.15b: line 18 is an ADMISSION GROUND, so the reasons now say why a unit MAY be assessed,
// not which segments were removed from it.
export const ELIGIBILITY_REASONS = Object.freeze([
  'WEEKEND', 'NIGHT_SHIFT', 'PURE_LINE_18', 'NOT_ELIGIBLE',
  'NOT_JNV', 'UNSUPPORTED_MODE', 'DAY_TYPE_UNKNOWN', 'SEGMENT_LINE_AMBIGUOUS',
  // Phase 3I.27 — VOCABULARY ONLY. Without this entry the block-break verdict the rule now
  // produces would be rejected as UNKNOWN_ELIGIBILITY_REASON. No check and no behaviour changes.
  'BLOCKPAUSE_PRESENT'
]);
export const LINE_18_CLASSIFICATIONS = Object.freeze(['PURE_LINE_18_ONLY', 'MIXED_WITH_OTHER_LINES', 'NO_LINE_INFORMATION']);
export const ONE_SIXTH_MODES = Object.freeze(['bus', 'tram']);
export const ONE_SIXTH_ROUNDING_RULES = Object.freeze(['ceil_to_full_minute']);
export const ONE_SIXTH_CREDITING_METHODS = Object.freeze(['full_observed_span']);
export const ONE_SIXTH_CONFIDENCE = Object.freeze(['exact', 'probable', 'ambiguous']);

const UNSAFE_REF_KEYS = ['originalText', 'rawText', 'rawCells', 'cells', 'stops', 'boundingBox', 'coordinates', 'path', 'filePath', 'file', 'bytes', 'buffer', 'blob'];
// Fields that must stay `null` while the driving time is unknown — never replaced by a number.
const UNKNOWN_NULL_KEYS = ['drivingMinutes', 'requiredMinutes', 'deficitMinutes'];
const nonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The single place that expresses the agreed ceiling requirement. */
export function requiredTurnaroundMinutes(drivingMinutes, numerator, denominator) {
  return Math.ceil((drivingMinutes * numerator) / denominator);
}

export function validateOneSixthRuleConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: [{ code: 'NOT_A_CONFIG', path: '' }] };
  }
  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (typeof config.ruleId !== 'string' || !config.ruleId) push('INVALID_RULE_ID', 'ruleId');
  if (typeof config.enabled !== 'boolean') push('INVALID_ENABLED', 'enabled');

  if (!Array.isArray(config.organizations) || config.organizations.length === 0 || !config.organizations.every(o => typeof o === 'string' && o)) {
    push('INVALID_ORGANIZATIONS', 'organizations');
  }
  if (!Array.isArray(config.modes) || config.modes.length === 0 || !config.modes.every(m => ONE_SIXTH_MODES.includes(m))) {
    push('INVALID_MODES', 'modes');
  }
  if (!positive(config.requiredRatioNumerator)) push('INVALID_RATIO_NUMERATOR', 'requiredRatioNumerator');
  if (!positive(config.requiredRatioDenominator)) push('INVALID_RATIO_DENOMINATOR', 'requiredRatioDenominator');
  if (!ONE_SIXTH_ROUNDING_RULES.includes(config.roundingRule)) push('INVALID_ROUNDING_RULE', 'roundingRule');
  if (!positive(config.minimumObservedSpanMinutes)) push('INVALID_MINIMUM_SPAN', 'minimumObservedSpanMinutes');
  if (!ONE_SIXTH_CREDITING_METHODS.includes(config.creditingMethod)) push('INVALID_CREDITING_METHOD', 'creditingMethod');
  if (!Array.isArray(config.acceptedTurnaroundConfidence) || config.acceptedTurnaroundConfidence.length === 0
      || !config.acceptedTurnaroundConfidence.every(c => ONE_SIXTH_CONFIDENCE.includes(c))) {
    push('INVALID_ACCEPTED_CONFIDENCE', 'acceptedTurnaroundConfidence');
  }
  if (config.locationMismatchBlocksCrediting !== undefined && typeof config.locationMismatchBlocksCrediting !== 'boolean') {
    push('INVALID_LOCATION_MISMATCH_FLAG', 'locationMismatchBlocksCrediting');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates an eligibility result (Phase 3I.9): closed status vocabulary, a reason for every
 * non-passing outcome, consistent segment counts, and no blanket exemption while segments remain
 * evaluable. It executes no rule and reaches no outcome of its own.
 */
export function validateOneSixthEligibility(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, errors: [{ code: 'NOT_AN_ELIGIBILITY_RESULT', path: '' }] };
  }
  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (!ELIGIBILITY_STATUSES.includes(result.status)) push('INVALID_ELIGIBILITY_STATUS', 'status');
  if (result.status !== 'PASS') {
    if (!result.reason) push('MISSING_ELIGIBILITY_REASON', 'reason');
    else if (!ELIGIBILITY_REASONS.includes(result.reason)) push('UNKNOWN_ELIGIBILITY_REASON', 'reason');
  }
  if (result.reason !== null && result.reason !== undefined && result.status === 'PASS') push('REASON_WITHOUT_DECISION', 'reason');
  if (!Array.isArray(result.warnings)) push('INVALID_WARNINGS', 'warnings');
  if (!Array.isArray(result.steps)) push('INVALID_STEPS', 'steps');
  if (result.nightShift !== null && typeof result.nightShift !== 'boolean') push('INVALID_NIGHT_SHIFT', 'nightShift');
  // the chain must never carry quota arithmetic
  for (const forbidden of ['requiredMinutes', 'creditedMinutes', 'deficitMinutes', 'violations']) {
    if (forbidden in result) push('QUOTA_FIELD_IN_ELIGIBILITY', forbidden);
  }

  if (!Array.isArray(result.circulations)) {
    push('INVALID_CIRCULATIONS', 'circulations');
  } else {
    result.circulations.forEach((circulation, i) => {
      const base = `circulations[${i}]`;
      if (!ELIGIBILITY_STATUSES.includes(circulation?.status)) push('INVALID_ELIGIBILITY_STATUS', `${base}.status`);
      if (!nonNegative(circulation?.segmentCount)) push('INVALID_SEGMENT_COUNT', `${base}.segmentCount`);
      if (!ELIGIBILITY_REASONS.includes(circulation?.eligibilityReason)) push('UNKNOWN_ELIGIBILITY_REASON', `${base}.eligibilityReason`);
      if (!LINE_18_CLASSIFICATIONS.includes(circulation?.line18Classification)) push('UNKNOWN_LINE_18_CLASSIFICATION', `${base}.line18Classification`);
      if (typeof circulation?.lineAttributionComplete !== 'boolean') push('INVALID_LINE_ATTRIBUTION', `${base}.lineAttributionComplete`);

      // Phase 3I.15b: a duty running exclusively on the admission line MUST be admitted — the old
      // automatic NOT_APPLICABLE is exactly what the real reference proved wrong.
      if (circulation?.line18Classification === 'PURE_LINE_18_ONLY' && circulation?.status === 'NOT_APPLICABLE') {
        push('PURE_LINE_18_MUST_BE_ADMITTED', `${base}.status`);
      }
      // The admission line never removes anything, so no segment bookkeeping may reappear.
      for (const forbidden of ['exceptedSegmentIndexes', 'exceptedSegmentCount', 'evaluableSegmentCount']) {
        if (forbidden in (circulation || {})) push('SEGMENT_EXCEPTION_IN_ELIGIBILITY', `${base}.${forbidden}`);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function validateOneSixthEvaluation(evaluation, config = null) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    return { valid: false, errors: [{ code: 'NOT_AN_EVALUATION', path: '' }] };
  }
  const errors = [];
  const push = (code, path) => errors.push({ code, path });
  const numerator = config?.requiredRatioNumerator ?? 1;
  const denominator = config?.requiredRatioDenominator ?? 6;

  if (typeof evaluation.ruleId !== 'string' || !evaluation.ruleId) push('INVALID_RULE_ID', 'ruleId');
  if (!ONE_SIXTH_STATUSES.includes(evaluation.status)) push('INVALID_STATUS', 'status');
  if (!Array.isArray(evaluation.warnings)) push('INVALID_WARNINGS', 'warnings');

  if (!evaluation.statistics || typeof evaluation.statistics !== 'object') push('INVALID_STATISTICS', 'statistics');
  else {
    for (const key of ['evaluatedServices', 'passedServices', 'failedServices', 'inconclusiveServices', 'totalDrivingMinutes', 'totalRequiredMinutes', 'totalCreditedMinutes', 'totalDeficitMinutes', 'turnaroundCandidateCount', 'creditedTurnaroundCount']) {
      if (!nonNegative(evaluation.statistics[key])) push('INVALID_STATISTIC', `statistics.${key}`);
    }
    // Optional since Phase 3I.11 — checked when present, never demanded of an older shape.
    if ('notApplicableServices' in evaluation.statistics && !nonNegative(evaluation.statistics.notApplicableServices)) {
      push('INVALID_STATISTIC', 'statistics.notApplicableServices');
    }
  }

  const seen = new Set();
  if (!Array.isArray(evaluation.services)) {
    push('INVALID_SERVICES', 'services');
  } else {
    evaluation.services.forEach((service, i) => {
      const base = `services[${i}]`;
      if (!ONE_SIXTH_STATUSES.includes(service?.status)) push('INVALID_STATUS', `${base}.status`);
      if (typeof service?.circulationCode !== 'string' || !service.circulationCode) push('INVALID_CIRCULATION_CODE', `${base}.circulationCode`);
      if (service?.serviceNumber !== null && typeof service?.serviceNumber !== 'string') push('INVALID_SERVICE_NUMBER', `${base}.serviceNumber`);

      // An unknown driving time (Phase 3I.7) carries no requirement and no deficit: both stay
      // `null`. Substituting 0 would claim a quota the rule never derived, so it is rejected.
      const unknownDrivingTime = service?.drivingMinutes === null;
      for (const key of ['drivingMinutes', 'requiredMinutes', 'creditedMinutes', 'deficitMinutes', 'turnaroundCount', 'creditedTurnaroundCount']) {
        const value = service?.[key];
        if (unknownDrivingTime && UNKNOWN_NULL_KEYS.includes(key)) {
          if (value !== null) push('UNKNOWN_DRIVING_TIME_SUBSTITUTED', `${base}.${key}`);
          continue;
        }
        if (unknownDrivingTime && key === 'creditedMinutes' && value === null) continue;
        if (!nonNegative(value)) push('INVALID_MINUTES', `${base}.${key}`);
      }
      // A unit outside the scope (Phase 3I.11) legitimately carries no driving time either — it is
      // the second, and only other, way a unit may end without a basis.
      const notApplicable = service?.status === 'NOT_APPLICABLE';
      if (unknownDrivingTime) {
        // No verdict may be reached without a driving time, and a verdict-less unit has no violation.
        if (service?.status !== 'INCONCLUSIVE' && !notApplicable) push('OUTCOME_WITHOUT_DRIVING_TIME', `${base}.status`);
        if (Array.isArray(service?.violations) && service.violations.length > 0) push('VIOLATION_WITHOUT_FAIL', `${base}.violations`);
      }
      if (notApplicable) {
        // Not applicable means: no basis, no requirement, no deficit — and a stated reason.
        for (const key of UNKNOWN_NULL_KEYS) {
          if (service?.[key] !== null) push('NOT_APPLICABLE_WITH_QUOTA', `${base}.${key}`);
        }
        if (Array.isArray(service?.violations) && service.violations.length > 0) push('VIOLATION_WITHOUT_FAIL', `${base}.violations`);
        if (!Array.isArray(service?.warnings) || service.warnings.length === 0) push('NOT_APPLICABLE_WITHOUT_REASON', `${base}.warnings`);
      }
      // Phase 3I.15b: no line may reduce the quota basis of an admitted duty.
      for (const forbidden of ['exceptedDrivingMinutes', 'exceptedSegmentCount', 'exceptedSegmentIndexes']) {
        if (forbidden in (service || {})) push('LINE_EXCEPTION_REDUCES_QUOTA', `${base}.${forbidden}`);
      }
      if (service?.eligibilityReason !== undefined && service?.eligibilityReason !== null
          && !ELIGIBILITY_REASONS.includes(service.eligibilityReason)) {
        push('UNKNOWN_ELIGIBILITY_REASON', `${base}.eligibilityReason`);
      }

      const key = `${service?.circulationCode}|${service?.serviceNumber ?? ''}`;
      if (seen.has(key)) push('DUPLICATE_SERVICE_ENTRY', `${base}.circulationCode`);
      seen.add(key);

      // ceiling + deficit + outcome consistency (only for a decided service with a known driving time)
      if (nonNegative(service?.drivingMinutes) && nonNegative(service?.requiredMinutes) && nonNegative(service?.creditedMinutes) && nonNegative(service?.deficitMinutes)) {
        if (service.requiredMinutes !== requiredTurnaroundMinutes(service.drivingMinutes, numerator, denominator)) push('REQUIRED_MINUTES_MISMATCH', `${base}.requiredMinutes`);
        const expectedDeficit = Math.max(0, service.requiredMinutes - service.creditedMinutes);
        if (service.deficitMinutes !== expectedDeficit) push('DEFICIT_MISMATCH', `${base}.deficitMinutes`);
        if (service.status === 'PASS' && service.creditedMinutes < service.requiredMinutes) push('OUTCOME_MISMATCH', `${base}.status`);
        if (service.status === 'FAIL' && service.creditedMinutes >= service.requiredMinutes) push('OUTCOME_MISMATCH', `${base}.status`);
      }
    });
  }

  if (!Array.isArray(evaluation.violations)) {
    push('INVALID_VIOLATIONS', 'violations');
  } else {
    // A violation exists only for a definitive FAIL.
    if (evaluation.violations.length && evaluation.status !== 'FAIL') push('VIOLATION_WITHOUT_FAIL', 'violations');
    evaluation.violations.forEach((violation, i) => {
      const base = `violations[${i}]`;
      if (typeof violation?.ruleId !== 'string' || !violation.ruleId) push('INVALID_RULE_ID', `${base}.ruleId`);
      if (violation?.severity !== 'VIOLATION') push('INVALID_SEVERITY', `${base}.severity`);
      for (const key of ['drivingMinutes', 'requiredMinutes', 'creditedMinutes', 'deficitMinutes']) {
        if (!nonNegative(violation?.[key])) push('INVALID_MINUTES', `${base}.${key}`);
      }
      if (nonNegative(violation?.deficitMinutes) && violation.deficitMinutes <= 0) push('VIOLATION_WITHOUT_DEFICIT', `${base}.deficitMinutes`);
      if (!Array.isArray(violation?.sourceRefs)) push('INVALID_SOURCE_REFS', `${base}.sourceRefs`);
      else violation.sourceRefs.forEach((ref, k) => {
        if (!ref || typeof ref !== 'object' || UNSAFE_REF_KEYS.some(u => u in ref)) push('UNSAFE_SOURCE_REF', `${base}.sourceRefs[${k}]`);
      });
    });
  }

  return { valid: errors.length === 0, errors };
}
