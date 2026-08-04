import { DOCUMENT_TYPES, ORGANIZATIONS } from './document-types.js';

/**
 * Central profile contract for document families (Phase 2). Describes which
 * document families exist, their status and their *proven* capabilities. It does
 * not detect anything and claims no capability that is not backed by code.
 *
 * @typedef {'active'|'experimental'|'reserved'|'unsupported'} ProfileStatus
 */

export const PROFILE_STATUSES = Object.freeze({
  ACTIVE: 'active', EXPERIMENTAL: 'experimental', RESERVED: 'reserved', UNSUPPORTED: 'unsupported'
});

/** All capability names a profile may declare. Declaration ≠ live-wiring. */
export const PROFILE_CAPABILITIES = Object.freeze([
  'parse', 'normalize', 'analyze', 'combinedAnalysis', 'xlsxExport', 'lenkzeit', 'oneSixth'
]);

/**
 * JES/JNV: `parse`/`normalize`/`analyze` are backed by tested V2 modules
 * (pdf-core → normalizer → schedule-mapper → canonical-schedule-builder →
 * analysis-core). They are NOT yet live-wired into the UI (that is Phase 3).
 *
 * Phase 4.5 adds `xlsxExport` to both — and to nobody else. It means exactly one thing: this
 * profile may OFFER the local Dienstplan export built in Phases 4.3/4.4. It is not a general
 * permission, it grants nothing to another document type, and it is not sufficient on its own —
 * the UI additionally demands a supported import and a `ready` projection model.
 * `combinedAnalysis`, `lenkzeit` and `oneSixth` remain declared by no profile (unimplemented).
 *
 * The JNV Stadtbus plan is carried by the historical technical profile id
 * `beu-stadtbus-v1` (organization JNV). "BEU" is only a technical/historical profile
 * label — not a separate organization and not a separate document type. Later JNV
 * *extensions* (Umlaufkarte loader, combined analysis, 1/6) remain unimplemented.
 */
export const DOCUMENT_PROFILES = Object.freeze({
  'jes-regionalbus-v1': Object.freeze({
    id: 'jes-regionalbus-v1',
    organization: ORGANIZATIONS.JES,
    documentType: DOCUMENT_TYPES.JES_SCHEDULE_PDF,
    status: PROFILE_STATUSES.ACTIVE,
    version: '1',
    parserId: 'pdf-core/schedule-mapper',
    layoutFamily: 'ten-column-schedule',
    supportedCompanionTypes: Object.freeze([DOCUMENT_TYPES.WAGENKARTE]),
    capabilities: Object.freeze(['parse', 'normalize', 'analyze', 'xlsxExport'])
  }),
  'beu-stadtbus-v1': Object.freeze({
    id: 'beu-stadtbus-v1', // historical technical id, kept for backward compatibility
    organization: ORGANIZATIONS.JNV,
    documentType: DOCUMENT_TYPES.JNV_SCHEDULE_PDF,
    status: PROFILE_STATUSES.ACTIVE,
    version: '1',
    parserId: 'pdf-core/schedule-mapper',
    layoutFamily: 'ten-column-schedule',
    supportedCompanionTypes: Object.freeze([DOCUMENT_TYPES.UMLAUFKARTE]),
    capabilities: Object.freeze(['parse', 'normalize', 'analyze', 'xlsxExport'])
  })
});

export function getProfile(profileId) {
  return DOCUMENT_PROFILES[profileId] || null;
}

export function listProfiles() {
  return Object.values(DOCUMENT_PROFILES);
}

export function listProfilesByStatus(status) {
  return listProfiles().filter(profile => profile.status === status);
}

export function getProfilesForDocumentType(documentType) {
  return listProfiles().filter(profile => profile.documentType === documentType);
}

export function profileHasCapability(profileId, capability) {
  const profile = getProfile(profileId);
  return Boolean(profile && profile.capabilities.includes(capability));
}
