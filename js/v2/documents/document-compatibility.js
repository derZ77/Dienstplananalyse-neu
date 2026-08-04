import { DOCUMENT_TYPES as T, isDocumentType } from './document-types.js';

/**
 * Central, deterministic compatibility contract (Phase 2). Pure function; returns
 * an explanatory result object, never a bare boolean. It defines which primary +
 * companion combinations are allowed for a *later* combined analysis — it does not
 * perform any analysis, matching, or detection.
 *
 * `status`      – contract compatibility of the pair.
 * `productive`  – whether the combination is currently selectable in V1. The JNV
 *                 schedule profile (technical id beu-stadtbus-v1) exists, but the
 *                 Umlaufkarte loader + combined analysis do not yet, so JNV+Umlaufkarte
 *                 is contract-compatible but not productive.
 *
 * @typedef {'compatible'|'incompatible'|'incomplete'|'unknown'} CompatibilityStatus
 */

export const COMPATIBILITY_STATUSES = Object.freeze({
  COMPATIBLE: 'compatible', INCOMPATIBLE: 'incompatible', INCOMPLETE: 'incomplete', UNKNOWN: 'unknown'
});

function result(status, code, reason, productive = false) {
  return Object.freeze({ status, code, reason, productive });
}

/**
 * @param {string} primaryType
 * @param {string} [companionType] omit/null → single analysis
 */
export function evaluateDocumentCompatibility(primaryType, companionType = null) {
  if (!isDocumentType(primaryType)) {
    return result(COMPATIBILITY_STATUSES.UNKNOWN, 'UNKNOWN_PRIMARY_TYPE', 'Primary document type is not part of the contract.');
  }
  if (primaryType === T.UNKNOWN) {
    return result(COMPATIBILITY_STATUSES.INCOMPATIBLE, 'UNKNOWN_PRIMARY', 'An unknown primary document cannot be analysed or combined.');
  }

  // No companion → single analysis (always allowed for a known primary).
  if (companionType === null || companionType === undefined) {
    return result(COMPATIBILITY_STATUSES.COMPATIBLE, 'SINGLE_ANALYSIS', 'Primary alone → single analysis.', true);
  }

  if (!isDocumentType(companionType) || companionType === T.UNKNOWN) {
    return result(COMPATIBILITY_STATUSES.INCOMPATIBLE, 'UNKNOWN_COMPANION', 'The companion document type is unknown and cannot be combined.');
  }

  // Allowed / prepared combinations.
  if (primaryType === T.JES_SCHEDULE_PDF && companionType === T.WAGENKARTE) {
    return result(COMPATIBILITY_STATUSES.COMPATIBLE, 'JES_WAGENKARTE', 'JES schedules may be combined with a matching Wagenkarte.', true);
  }
  if (primaryType === T.JNV_SCHEDULE_PDF && companionType === T.UMLAUFKARTE) {
    // The JNV schedule profile exists; the companion loader and combined analysis are not implemented yet.
    return result(COMPATIBILITY_STATUSES.COMPATIBLE, 'JNV_UMLAUFKARTE', 'The JNV schedule profile exists; the companion loader and combined analysis are not implemented yet.', false);
  }

  // Explicitly rejected combinations.
  if (primaryType === T.JES_SCHEDULE_PDF && companionType === T.UMLAUFKARTE) {
    return result(COMPATIBILITY_STATUSES.INCOMPATIBLE, 'JES_UMLAUFKARTE_INVALID', 'JES uses Wagenkarten, not Umlaufkarten.');
  }
  if (primaryType === T.JNV_SCHEDULE_PDF && companionType === T.WAGENKARTE) {
    return result(COMPATIBILITY_STATUSES.INCOMPATIBLE, 'JNV_WAGENKARTE_INVALID', 'JNV schedules use Umlaufkarten, not Wagenkarten.');
  }
  if (primaryType === T.LEGACY_EXCEL_SCHEDULE) {
    return result(COMPATIBILITY_STATUSES.INCOMPATIBLE, 'LEGACY_NO_COMPANION', 'Legacy Excel schedules are analysed on their own.');
  }
  if (primaryType === T.WAGENKARTE || primaryType === T.UMLAUFKARTE) {
    return result(COMPATIBILITY_STATUSES.INCOMPATIBLE, 'COMPANION_AS_PRIMARY_NO_COMBINATION', 'A Wagenkarte/Umlaufkarte is analysed on its own; it does not take a companion.');
  }

  return result(COMPATIBILITY_STATUSES.INCOMPATIBLE, 'UNSUPPORTED_COMBINATION', `No supported combination for ${primaryType} + ${companionType}.`);
}
