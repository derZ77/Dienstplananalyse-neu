/**
 * Structural validators for turnaround candidates and detection results (Phase 3I.3).
 *
 * `{valid, errors:[{code,path}]}`, no mutation, no repair. They check structure, closed
 * vocabularies, time consistency and the agreed crediting projection — they evaluate no
 * operational rule and know no outcome vocabulary.
 */

import { TURNAROUND_STATUSES, TURNAROUND_SOURCES, TURNAROUND_CONFIDENCE, TURNAROUND_ELIGIBILITY, TURNAROUND_WARNINGS, DEFAULT_TURNAROUND_CREDITING } from './one-sixth-turnaround-candidates.js';

const UNSAFE_REF_KEYS = ['originalText', 'rawText', 'rawCells', 'cells', 'stops', 'boundingBox', 'coordinates', 'path', 'filePath', 'file', 'bytes', 'buffer', 'blob'];
const isNonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function checkRef(ref, path, push) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) { push('INVALID_SEGMENT_REF', path); return; }
  if (UNSAFE_REF_KEYS.some(key => key in ref)) push('UNSAFE_SEGMENT_REF', path);
}

/**
 * @param {object} candidate
 * @param {{minimumObservedSpanMinutes:number, belowMinimumCreditedMinutes:number}} [crediting]
 * @returns {{valid:boolean, errors:Array<{code:string,path:string}>}}
 */
export function validateTurnaroundCandidate(candidate, crediting = DEFAULT_TURNAROUND_CREDITING) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: [{ code: 'NOT_A_CANDIDATE', path: '' }] };
  }
  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (typeof candidate.id !== 'string' || !candidate.id) push('INVALID_ID', 'id');
  if (typeof candidate.circulationCode !== 'string' || !candidate.circulationCode) push('INVALID_CIRCULATION_CODE', 'circulationCode');
  checkRef(candidate.previousSegmentRef, 'previousSegmentRef', push);
  checkRef(candidate.nextSegmentRef, 'nextSegmentRef', push);

  if (!TURNAROUND_SOURCES.includes(candidate.source)) push('INVALID_SOURCE', 'source');
  if (!TURNAROUND_CONFIDENCE.includes(candidate.confidence)) push('INVALID_CONFIDENCE', 'confidence');
  if (!TURNAROUND_ELIGIBILITY.includes(candidate.eligibility)) push('INVALID_ELIGIBILITY', 'eligibility');
  if (!Array.isArray(candidate.warnings)) push('INVALID_WARNINGS', 'warnings');
  else candidate.warnings.forEach((warning, i) => { if (!TURNAROUND_WARNINGS.includes(warning)) push('UNKNOWN_WARNING', `warnings[${i}]`); });

  const { startMinutes, endMinutes, observedSpanMinutes, creditedMinutes } = candidate;
  if (!isNonNegativeNumber(startMinutes)) push('INVALID_START', 'startMinutes');
  if (!isNonNegativeNumber(endMinutes)) push('INVALID_END', 'endMinutes');
  if (!isNonNegativeNumber(observedSpanMinutes)) push('INVALID_SPAN', 'observedSpanMinutes');
  if (!isNonNegativeNumber(creditedMinutes)) push('INVALID_CREDITED', 'creditedMinutes');

  if (isNonNegativeNumber(startMinutes) && isNonNegativeNumber(endMinutes)) {
    if (endMinutes < startMinutes) push('END_BEFORE_START', 'endMinutes');
    else if (isNonNegativeNumber(observedSpanMinutes) && observedSpanMinutes !== endMinutes - startMinutes) push('SPAN_MISMATCH', 'observedSpanMinutes');
  }

  // The agreed crediting projection: below the minimum span nothing is credited, from the minimum
  // span the FULL observed span counts (no deduction, no flat rate).
  if (isNonNegativeNumber(observedSpanMinutes) && isNonNegativeNumber(creditedMinutes)) {
    const qualified = observedSpanMinutes >= crediting.minimumObservedSpanMinutes;
    const expectedCredit = qualified ? observedSpanMinutes : crediting.belowMinimumCreditedMinutes;
    if (creditedMinutes !== expectedCredit) push('CREDITED_MINUTES_MISMATCH', 'creditedMinutes');
    const expectedEligibility = qualified ? 'qualified' : 'below_minimum';
    if (TURNAROUND_ELIGIBILITY.includes(candidate.eligibility) && candidate.eligibility !== 'unresolved' && candidate.eligibility !== expectedEligibility) {
      push('ELIGIBILITY_MISMATCH', 'eligibility');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {object} result
 * @param {{minimumObservedSpanMinutes:number, belowMinimumCreditedMinutes:number}} [crediting]
 * @returns {{valid:boolean, errors:Array<{code:string,path:string}>}}
 */
export function validateTurnaroundDetectionResult(result, crediting = DEFAULT_TURNAROUND_CREDITING) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, errors: [{ code: 'NOT_A_DETECTION_RESULT', path: '' }] };
  }
  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (!TURNAROUND_STATUSES.includes(result.status)) push('INVALID_STATUS', 'status');
  if (!result.statistics || typeof result.statistics !== 'object') push('INVALID_STATISTICS', 'statistics');
  else for (const key of ['candidateCount', 'qualifiedCount', 'belowMinimumCount', 'unresolvedCount']) {
    if (!isNonNegativeNumber(result.statistics[key])) push('INVALID_STATISTIC', `statistics.${key}`);
  }

  if (!Array.isArray(result.warnings)) push('INVALID_WARNINGS', 'warnings');
  else result.warnings.forEach((warning, i) => {
    if (!warning || typeof warning !== 'object' || !TURNAROUND_WARNINGS.includes(warning.code)) push('UNKNOWN_WARNING', `warnings[${i}]`);
  });

  if (!Array.isArray(result.candidates)) {
    push('INVALID_CANDIDATES', 'candidates');
    return { valid: errors.length === 0, errors };
  }

  const seen = new Set();
  result.candidates.forEach((candidate, i) => {
    const inner = validateTurnaroundCandidate(candidate, crediting);
    inner.errors.forEach(error => push(error.code, `candidates[${i}].${error.path}`.replace(/\.$/, '')));
    const id = candidate?.id;
    if (typeof id === 'string' && id) {
      if (seen.has(id)) push('DUPLICATE_CANDIDATE_ID', `candidates[${i}].id`);
      seen.add(id);
    }
  });

  return { valid: errors.length === 0, errors };
}
