/**
 * Dependency-free structural validators for the 270-minute continuous driving-time rule
 * (BV008, Phase 3H.3).
 *
 * `validateDrivingTimeRuleConfig(config)` checks the focused productive parameter shape;
 * `validateDrivingTimeEvaluation(evaluation)` checks a produced evaluation. Both return
 * `{ valid, errors:[{code,path}] }`, never mutate, never repair, and encode structure only —
 * no threshold arithmetic, no reset logic, no other operational rule. The result-status set is
 * the closed vocabulary the rule itself emits; PASS / FAIL / NOT_APPLICABLE align with the
 * frozen CHECK_STATUSES, while DISABLED and INCONCLUSIVE are this analysis rule's own richer
 * determinations (documented, non-mutating, additive).
 */

export const DRIVING_TIME_STATUSES = Object.freeze(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'DISABLED']);

const UNSAFE_SOURCE_KEYS = ['originalText', 'rawText', 'rawCells', 'cells', 'boundingBox', 'coordinates', 'path', 'filePath', 'file', 'bytes', 'buffer', 'blob'];
const positiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const nonNegativeNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validateDrivingTimeRuleConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: [{ code: 'NOT_A_CONFIG', path: '' }] };
  }
  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (typeof config.ruleId !== 'string' || !config.ruleId) push('INVALID_RULE_ID', 'ruleId');
  if (typeof config.enabled !== 'boolean') push('INVALID_ENABLED', 'enabled');
  if (!positiveNumber(config.maxContinuousDrivingMinutes)) push('INVALID_MAX_CONTINUOUS_DRIVING_MINUTES', 'maxContinuousDrivingMinutes');

  const q = config.qualifyingInterruption;
  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    push('INVALID_QUALIFYING_INTERRUPTION', 'qualifyingInterruption');
  } else {
    if (!positiveNumber(q.singleMinimumMinutes)) push('INVALID_SINGLE_MINIMUM_MINUTES', 'qualifyingInterruption.singleMinimumMinutes');
    if (!Array.isArray(q.splitSequence) || q.splitSequence.length !== 2 || !q.splitSequence.every(positiveNumber)) {
      push('INVALID_SPLIT_SEQUENCE', 'qualifyingInterruption.splitSequence');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateDrivingTimeEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    return { valid: false, errors: [{ code: 'NOT_AN_EVALUATION', path: '' }] };
  }
  const errors = [];
  const push = (code, path) => errors.push({ code, path });
  const checkSourceRefs = (refs, path) => {
    if (!Array.isArray(refs)) { push('INVALID_SOURCE_REFS', path); return; }
    refs.forEach((r, k) => { if (r && typeof r === 'object' && UNSAFE_SOURCE_KEYS.some(u => u in r)) push('UNSAFE_SOURCE_REF', `${path}[${k}]`); });
  };

  if (typeof evaluation.ruleId !== 'string' || !evaluation.ruleId) push('INVALID_RULE_ID', 'ruleId');
  if (!DRIVING_TIME_STATUSES.includes(evaluation.status)) push('INVALID_STATUS', 'status');
  if (!evaluation.statistics || typeof evaluation.statistics !== 'object') push('INVALID_STATISTICS', 'statistics');
  if (!Array.isArray(evaluation.warnings)) push('INVALID_WARNINGS', 'warnings');

  if (!Array.isArray(evaluation.circulations)) {
    push('INVALID_CIRCULATIONS', 'circulations');
  } else {
    evaluation.circulations.forEach((c, i) => {
      const base = `circulations[${i}]`;
      if (typeof c?.code !== 'string' || !c.code) push('INVALID_CODE', `${base}.code`);
      if (!DRIVING_TIME_STATUSES.includes(c?.status)) push('INVALID_STATUS', `${base}.status`);
      if (!Array.isArray(c?.violations)) push('INVALID_VIOLATIONS', `${base}.violations`);
      if (!Array.isArray(c?.warnings)) push('INVALID_WARNINGS', `${base}.warnings`);
    });
  }

  if (!Array.isArray(evaluation.violations)) {
    push('INVALID_VIOLATIONS', 'violations');
  } else {
    evaluation.violations.forEach((v, i) => {
      const base = `violations[${i}]`;
      if (typeof v?.ruleId !== 'string' || !v.ruleId) push('INVALID_RULE_ID', `${base}.ruleId`);
      if (typeof v?.code !== 'string' || !v.code) push('INVALID_VIOLATION_CODE', `${base}.code`);
      if (typeof v?.circulationCode !== 'string') push('INVALID_CODE', `${base}.circulationCode`);
      if (!positiveNumber(v?.limitMinutes)) push('INVALID_LIMIT', `${base}.limitMinutes`);
      if (!nonNegativeNumber(v?.actualMinutes)) push('INVALID_ACTUAL', `${base}.actualMinutes`);
      if (!nonNegativeNumber(v?.exceededByMinutes)) push('INVALID_EXCEEDED_BY', `${base}.exceededByMinutes`);
      if (typeof v?.severity !== 'string' || !v.severity) push('INVALID_SEVERITY', `${base}.severity`);
      checkSourceRefs(v?.sourceRefs, `${base}.sourceRefs`);
    });
  }

  return { valid: errors.length === 0, errors };
}
