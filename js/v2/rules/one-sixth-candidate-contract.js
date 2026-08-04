/**
 * JNV 1/6 candidate contract (Phase 3I.2) — VOCABULARY AND SHAPE ONLY.
 *
 * Declares the closed vocabularies for the fallback candidate signal and a factory that builds a
 * well-formed candidate object. It evaluates NOTHING: it reads no schedule, derives no indicator,
 * computes no driving time, and never produces a compliance verdict of any kind — the candidate
 * status only says which data path applies and whether a duty is worth checking.
 *
 * Deliberate rule (see the phase report): an indicator that cannot be *proven* — most importantly
 * a block pause that is merely absent because the source was never classified — yields
 * `inconclusive`, never `probable`. Pure, dependency-free, no storage, no network.
 */

export const CANDIDATE_STATUSES = Object.freeze(['probable', 'not_indicated', 'inconclusive']);

export const CANDIDATE_SOURCES = Object.freeze(['umlauftafel', 'schedule_structured', 'schedule_fallback', 'none']);

export const CANDIDATE_EVIDENCE = Object.freeze(['NO_EXPLICIT_BLOCK_PAUSE', 'PAID_TIME_EQUALS_DUTY_TIME']);

export const CANDIDATE_WARNINGS = Object.freeze([
  'BLOCK_PAUSE_ABSENCE_NOT_PROVABLE',
  'PAID_TIME_NOT_COMPARABLE',
  'NO_UMLAUFTAFEL_AVAILABLE',
  'INSUFFICIENT_DATA'
]);

const uniqueFrom = (values, allowed) =>
  [...new Set((Array.isArray(values) ? values : []).filter(value => allowed.includes(value)))];

/**
 * Build a candidate object. Unknown vocabulary is dropped rather than invented, and an unusable
 * status collapses to `inconclusive`.
 * @param {{status?:string, source?:string, evidence?:string[], warnings?:string[]}} [input]
 * @returns {{status:string, source:string, evidence:string[], warnings:string[]}}
 */
export function createOneSixthCandidate({ status, source, evidence, warnings } = {}) {
  return {
    status: CANDIDATE_STATUSES.includes(status) ? status : 'inconclusive',
    source: CANDIDATE_SOURCES.includes(source) ? source : 'none',
    evidence: uniqueFrom(evidence, CANDIDATE_EVIDENCE),
    warnings: uniqueFrom(warnings, CANDIDATE_WARNINGS)
  };
}

/**
 * Structural validation of a candidate object — closed vocabularies only, no rule semantics.
 * @returns {{valid:boolean, errors:Array<{code:string,path:string}>}}
 */
export function validateOneSixthCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: [{ code: 'NOT_A_CANDIDATE', path: '' }] };
  }
  const errors = [];
  if (!CANDIDATE_STATUSES.includes(candidate.status)) errors.push({ code: 'INVALID_STATUS', path: 'status' });
  if (!CANDIDATE_SOURCES.includes(candidate.source)) errors.push({ code: 'INVALID_SOURCE', path: 'source' });
  if (!Array.isArray(candidate.evidence)) errors.push({ code: 'INVALID_EVIDENCE', path: 'evidence' });
  else candidate.evidence.forEach((item, i) => { if (!CANDIDATE_EVIDENCE.includes(item)) errors.push({ code: 'UNKNOWN_EVIDENCE', path: `evidence[${i}]` }); });
  if (!Array.isArray(candidate.warnings)) errors.push({ code: 'INVALID_WARNINGS', path: 'warnings' });
  else candidate.warnings.forEach((item, i) => { if (!CANDIDATE_WARNINGS.includes(item)) errors.push({ code: 'UNKNOWN_WARNING', path: `warnings[${i}]` }); });
  return { valid: errors.length === 0, errors };
}
