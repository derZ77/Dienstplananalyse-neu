/**
 * Central document type and role contract (Phase 2). Single source of truth so
 * that document types and roles are not scattered as free strings across the
 * codebase. Pure constants + helpers; no parsing, no detection, no side effects.
 *
 * @typedef {'legacy_excel_schedule'|'jes_schedule_pdf'|'jnv_schedule_pdf'|'wagenkarte'|'umlaufkarte'|'unknown'} DocumentType
 * @typedef {'primary'|'companion'} DocumentRole
 * @typedef {'JES'|'JNV'|'LEGACY'|'UNKNOWN'} Organization
 */

export const DOCUMENT_TYPES = Object.freeze({
  LEGACY_EXCEL_SCHEDULE: 'legacy_excel_schedule',
  JES_SCHEDULE_PDF: 'jes_schedule_pdf',
  // The real JNV Stadtbus plan. Detected via the historical technical profile id
  // `beu-stadtbus-v1`. "BEU" is not a separate document type or organization.
  JNV_SCHEDULE_PDF: 'jnv_schedule_pdf',
  WAGENKARTE: 'wagenkarte',
  UMLAUFKARTE: 'umlaufkarte',
  UNKNOWN: 'unknown'
});

export const DOCUMENT_TYPE_VALUES = Object.freeze(Object.values(DOCUMENT_TYPES));

export const DOCUMENT_ROLES = Object.freeze({ PRIMARY: 'primary', COMPANION: 'companion' });
export const DOCUMENT_ROLE_VALUES = Object.freeze(Object.values(DOCUMENT_ROLES));

export const ORGANIZATIONS = Object.freeze({
  JES: 'JES', JNV: 'JNV', LEGACY: 'LEGACY', UNKNOWN: 'UNKNOWN'
});

/**
 * Reserved types would be part of the contract but not yet automatically produced.
 * After the JNV correction none remain: jnv_schedule_pdf is a real, detected type
 * (its technical profile is beu-stadtbus-v1). Only later JNV *extensions* (Umlaufkarte
 * loader, combined analysis, 1/6) remain unimplemented — those are not document types.
 */
export const RESERVED_DOCUMENT_TYPES = Object.freeze([]);

/** Types that may only ever appear as a companion in a combined analysis. */
export const COMPANION_DOCUMENT_TYPES = Object.freeze([DOCUMENT_TYPES.WAGENKARTE, DOCUMENT_TYPES.UMLAUFKARTE]);

export function isDocumentType(type) {
  return DOCUMENT_TYPE_VALUES.includes(type);
}

export function isKnownDocumentType(type) {
  return DOCUMENT_TYPE_VALUES.includes(type) && type !== DOCUMENT_TYPES.UNKNOWN;
}

export function isReservedDocumentType(type) {
  return RESERVED_DOCUMENT_TYPES.includes(type);
}

export function isCompanionDocumentType(type) {
  return COMPANION_DOCUMENT_TYPES.includes(type);
}

export function isDocumentRole(role) {
  return DOCUMENT_ROLE_VALUES.includes(role);
}

/** Maps a document type to its operator organization (content-agnostic types → UNKNOWN). */
export function documentTypeOrganization(type) {
  switch (type) {
    case DOCUMENT_TYPES.JES_SCHEDULE_PDF: return ORGANIZATIONS.JES;
    case DOCUMENT_TYPES.JNV_SCHEDULE_PDF: return ORGANIZATIONS.JNV;
    case DOCUMENT_TYPES.LEGACY_EXCEL_SCHEDULE: return ORGANIZATIONS.LEGACY;
    default: return ORGANIZATIONS.UNKNOWN; // wagenkarte/umlaufkarte/unknown depend on content
  }
}

export function assertDocumentType(type) {
  if (!isDocumentType(type)) throw new TypeError(`Unknown document type: ${type}`);
  return type;
}

export function assertDocumentRole(role) {
  if (!isDocumentRole(role)) throw new TypeError(`Unknown document role: ${role}`);
  return role;
}
