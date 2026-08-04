/**
 * Productive AnalysisBundle infrastructure (Phase 3E) — DATA MODEL ONLY.
 *
 * Lets the app hold two imported documents together WITHOUT performing any fachliche
 * work: no matching, no combined analysis, no Lenkzeit, no 1/6. The bundle carries only
 * metadata descriptors plus a purely *structural* compatibility verdict derived from the
 * document types (reusing the frozen profile pairing knowledge). It never stores file
 * bytes, analysis results, or match results, and it uses no storage and no network.
 *
 * This is a separate, leaner productive projection; the Phase-2 in-memory
 * `documents/analysis-bundle.js` contract stays frozen and untouched.
 */

import { DOCUMENT_TYPES as T, isCompanionDocumentType } from '../documents/document-types.js';
import { getProfilesForDocumentType } from '../documents/document-profiles.js';

/** Document types that may act as the bundle's primary (a schedule). */
export const PRIMARY_DOCUMENT_TYPES = Object.freeze([
  T.JES_SCHEDULE_PDF, T.JNV_SCHEDULE_PDF, T.LEGACY_EXCEL_SCHEDULE
]);

/**
 * Closed structural-compatibility vocabulary. `exact`/`conflicting`/`unsupported` are
 * produced for the current concrete type set; `probable`/`ambiguous` are part of the
 * contract and reserved for future underdetermined types (e.g. a schedule whose operator
 * is not yet resolved). No status expresses any fachliche statement — types only.
 */
export const BUNDLE_COMPATIBILITY_STATUS = Object.freeze({
  EXACT: 'exact', PROBABLE: 'probable', AMBIGUOUS: 'ambiguous', CONFLICTING: 'conflicting', UNSUPPORTED: 'unsupported'
});

const S = BUNDLE_COMPATIBILITY_STATUS;
const compat = (status, code, reason) => Object.freeze({ status, code, reason });

export function isPrimaryDocumentType(type) {
  return PRIMARY_DOCUMENT_TYPES.includes(type);
}

/**
 * Pure, deterministic structural compatibility of a (primary, companion) type pair.
 * Reuses the frozen profile `supportedCompanionTypes` as the single source of truth for
 * which companion belongs to which schedule. Returns an explanatory object, never a bool.
 * @param {string} primaryType
 * @param {string} companionType
 */
export function evaluateBundleCompatibility(primaryType, companionType) {
  if (!isPrimaryDocumentType(primaryType)) {
    return compat(S.UNSUPPORTED, 'PRIMARY_NOT_ALLOWED', 'The primary document type may not act as a schedule primary.');
  }
  if (!isCompanionDocumentType(companionType)) {
    return compat(S.UNSUPPORTED, 'COMPANION_NOT_ALLOWED', 'The companion document type may not act as a companion.');
  }
  if (primaryType === T.LEGACY_EXCEL_SCHEDULE) {
    return compat(S.UNSUPPORTED, 'LEGACY_NO_COMPANION', 'Legacy Excel schedules are analysed on their own; they take no companion.');
  }
  // PDF schedule primaries: the profile declares its canonical companion type(s).
  const supported = getProfilesForDocumentType(primaryType).flatMap(profile => profile.supportedCompanionTypes || []);
  if (supported.includes(companionType)) {
    return compat(S.EXACT, 'CANONICAL_PAIR', 'The companion type is the schedule operator’s canonical companion.');
  }
  return compat(S.CONFLICTING, 'WRONG_OPERATOR_COMPANION', 'The companion belongs to a different operator than the schedule.');
}

const warn = (code) => Object.freeze({ code, severity: 'warning', message: '' });

function roleTypeWarnings(primary, companion) {
  const warnings = [];
  if (primary) {
    if (primary.role !== 'primary') warnings.push(warn('INVALID_PRIMARY_ROLE'));
    if (!isPrimaryDocumentType(primary.documentType)) warnings.push(warn('INVALID_PRIMARY_TYPE'));
  }
  if (companion) {
    if (companion.role !== 'companion') warnings.push(warn('INVALID_COMPANION_ROLE'));
    if (!isCompanionDocumentType(companion.documentType)) warnings.push(warn('INVALID_COMPANION_TYPE'));
  }
  return warnings;
}

/**
 * Creates a productive AnalysisBundle with EXACTLY the fields
 * `{ id, createdAt, primary, companion, compatibility, warnings }`.
 *
 * Deterministic: `id` and `createdAt` are caller-supplied (no Date.now / Math.random).
 * Invalid role/type or an incompatible combination produce WARNINGS, never exceptions;
 * only a missing `id` (a programmer error) throws. No analysis, no matches, no side effects.
 *
 * @param {{ id: string, createdAt?: string|number|null, primary?: object|null, companion?: object|null }} args
 */
export function createAnalysisBundle({ id, createdAt = null, primary = null, companion = null } = {}) {
  if (typeof id !== 'string' || !id) throw new TypeError('AnalysisBundle requires a non-empty id.');

  const warnings = roleTypeWarnings(primary, companion);

  const compatibility = (primary && companion)
    ? evaluateBundleCompatibility(primary.documentType, companion.documentType)
    : null;
  if (compatibility && (compatibility.status === S.CONFLICTING || compatibility.status === S.UNSUPPORTED)) {
    warnings.push(warn('INCOMPATIBLE_DOCUMENT_COMBINATION'));
  }

  return Object.freeze({ id, createdAt, primary, companion, compatibility, warnings: Object.freeze(warnings) });
}

/**
 * Dependency-free validation in the established `{ valid, errors:[{code,path}] }` style.
 * Structural only — it makes no fachliche claim.
 */
export function validateAnalysisBundle(bundle) {
  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, errors: [{ code: 'NOT_A_BUNDLE', path: '' }] };
  }
  if (typeof bundle.id !== 'string' || !bundle.id) push('MISSING_ID', 'id');
  if (!(bundle.createdAt === null || typeof bundle.createdAt === 'string' || typeof bundle.createdAt === 'number')) push('INVALID_CREATED_AT', 'createdAt');
  if (bundle.primary != null && bundle.primary.role !== 'primary') push('INVALID_PRIMARY', 'primary');
  if (bundle.companion != null && bundle.companion.role !== 'companion') push('INVALID_COMPANION', 'companion');
  if (bundle.compatibility != null && !Object.values(BUNDLE_COMPATIBILITY_STATUS).includes(bundle.compatibility.status)) push('INVALID_COMPATIBILITY', 'compatibility');
  if (!Array.isArray(bundle.warnings)) push('INVALID_WARNINGS', 'warnings');

  return { valid: errors.length === 0, errors };
}
