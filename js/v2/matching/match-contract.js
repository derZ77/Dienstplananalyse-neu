/**
 * Deterministic matching *contract* (Phase 2). Defines the shape and states of a
 * match between a primary schedule record and a companion (Wagenkarte /
 * Umlaufkarte) record, plus the automation gate. It performs **no** real matching
 * and fixes **no** feature weighting (reference data is not yet available).
 *
 * @typedef {'exact'|'probable'|'ambiguous'|'unmatched'|'conflicting'} MatchStatus
 */

export const MATCH_STATUSES = Object.freeze({
  EXACT: 'exact', PROBABLE: 'probable', AMBIGUOUS: 'ambiguous', UNMATCHED: 'unmatched', CONFLICTING: 'conflicting'
});
const MATCH_STATUS_VALUES = Object.freeze(Object.values(MATCH_STATUSES));

/** Comparison features a later matcher may use. Weighting is intentionally NOT fixed here. */
export const MATCH_COMPARISON_FEATURES = Object.freeze([
  'serviceNumber', 'umlauf', 'line', 'course', 'trip',
  'departureTime', 'arrivalTime', 'startLocation', 'endLocation', 'sequence'
]);

/**
 * Creates a match-result descriptor.
 * @param {{status: MatchStatus, score?: number|null, reasons?: string[], conflicts?: string[], primaryRefs?: string[], companionRefs?: string[]}} input
 */
export function createMatchResult({ status, score = null, reasons = [], conflicts = [], primaryRefs = [], companionRefs = [] } = {}) {
  if (!MATCH_STATUS_VALUES.includes(status)) throw new TypeError(`Unsupported match status: ${status}`);
  if (score !== null && (typeof score !== 'number' || Number.isNaN(score))) throw new TypeError('score must be a number or null.');
  for (const [name, value] of [['reasons', reasons], ['conflicts', conflicts], ['primaryRefs', primaryRefs], ['companionRefs', companionRefs]]) {
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  }
  return Object.freeze({
    type: 'MatchResult', status, score,
    reasons: Object.freeze([...reasons]),
    conflicts: Object.freeze([...conflicts]),
    primaryRefs: Object.freeze([...primaryRefs]),
    companionRefs: Object.freeze([...companionRefs])
  });
}

/**
 * Automation gate: ONLY an `exact` match may feed automatic professional checks
 * (e.g. later Lenkzeit / 1/6 evaluation). This is the single authority for that rule.
 */
export function isAutomationAllowed(status) {
  return status === MATCH_STATUSES.EXACT;
}

/** `probable` requires explicit manual confirmation before it may be used. */
export function requiresManualConfirmation(status) {
  return status === MATCH_STATUSES.PROBABLE;
}

/** ambiguous / unmatched / conflicting must never trigger an automatic decision. */
export function blocksAutomaticDecision(status) {
  return status === MATCH_STATUSES.AMBIGUOUS || status === MATCH_STATUSES.UNMATCHED || status === MATCH_STATUSES.CONFLICTING;
}
