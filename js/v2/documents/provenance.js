/**
 * Minimal, additive provenance marker (Phase 2). Lets a later combined analysis
 * annotate where a value came from (Dienstplan / Wagenkarte / Umlaufkarte /
 * derived / conflicting) without rewriting existing models onto SourcedValue<T>.
 * Use additively, only where combined/derived values arise.
 *
 * @typedef {'exact'|'derived'|'ambiguous'|'unknown'} ProvenanceConfidence
 */

export const PROVENANCE_CONFIDENCE = Object.freeze({
  EXACT: 'exact', DERIVED: 'derived', AMBIGUOUS: 'ambiguous', UNKNOWN: 'unknown'
});
const CONFIDENCE_VALUES = Object.freeze(Object.values(PROVENANCE_CONFIDENCE));

/**
 * Wraps a value with its origin. Value stays untouched; only metadata is added.
 * @template T
 * @param {T} value
 */
export function createSourcedValue(value, {
  sourceDocumentId = null, sourceType = null, sourceField = null,
  confidence = PROVENANCE_CONFIDENCE.UNKNOWN
} = {}) {
  if (!CONFIDENCE_VALUES.includes(confidence)) throw new TypeError(`Unsupported provenance confidence: ${confidence}`);
  return Object.freeze({ type: 'SourcedValue', value, sourceDocumentId, sourceType, sourceField, confidence });
}

export function isSourcedValue(candidate) {
  return Boolean(candidate) && candidate.type === 'SourcedValue' && CONFIDENCE_VALUES.includes(candidate.confidence);
}

/** Unwraps a SourcedValue to its raw value (pass-through for plain values). */
export function rawValue(candidate) {
  return isSourcedValue(candidate) ? candidate.value : candidate;
}
