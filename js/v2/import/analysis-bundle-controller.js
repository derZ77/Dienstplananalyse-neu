/**
 * Productive AnalysisBundle controller (Phase 3E) — INFRASTRUCTURE ONLY.
 *
 * Turns already-produced ImportResults (the unchanged single-import outputs) into
 * lightweight metadata descriptors and assembles an AnalysisBundle ONLY when a second
 * (companion) document is present. It performs no analysis, no matching, no combined
 * evaluation; it reads only the document *type* from each import result. No storage,
 * no network, no UI. The existing single-import handlers are not touched.
 */

import { createImportedDocument } from '../documents/analysis-bundle.js';
import { DOCUMENT_ROLES, isDocumentType, documentTypeOrganization, DOCUMENT_TYPES as T } from '../documents/document-types.js';
import { getProfile } from '../documents/document-profiles.js';
import { createAnalysisBundle } from './import-analysis-bundle.js';

/**
 * Reads the document type of an import result without touching its payload:
 * - Excel import → `classification.type`
 * - PDF import   → the detected profile’s document type (unsupported → unknown)
 */
function documentTypeOf(importResult) {
  if (!importResult || typeof importResult !== 'object') return T.UNKNOWN;
  if (importResult.classification && typeof importResult.classification === 'object') {
    const type = importResult.classification.type;
    return isDocumentType(type) ? type : T.UNKNOWN;
  }
  if (importResult.detection && typeof importResult.detection === 'object') {
    const profile = importResult.detection.status === 'supported' ? getProfile(importResult.detection.profile?.id) : null;
    return profile ? profile.documentType : T.UNKNOWN;
  }
  return T.UNKNOWN;
}

/**
 * Builds a metadata-only ImportedDocument descriptor for an import result in the given
 * role. Reuses the frozen `createImportedDocument` (which forbids file bytes). The role
 * comes from the slot the caller fills; type/role mismatches are surfaced later as bundle
 * warnings, not here.
 * @param {object} importResult
 * @param {'primary'|'companion'} role
 * @param {{ id?: string, fileName?: string }} [options]
 */
export function describeImportResult(importResult, role, { id = null, fileName = '' } = {}) {
  const type = documentTypeOf(importResult);
  const profileId = importResult?.detection?.profile?.id || null;
  return createImportedDocument({
    id: id || `document:${role}`,
    role,
    type,
    organization: documentTypeOrganization(type),
    profileId,
    fileName
  });
}

/**
 * Assembles an AnalysisBundle from a primary import and an OPTIONAL companion import.
 * Returns `null` when no companion is present (§8: no second document → no bundle).
 * Deterministic: `id` and `createdAt` are caller-supplied. No analysis is performed.
 * @param {{ id: string, createdAt?: string|number|null, primaryImport: object, companionImport?: object|null, primaryFileName?: string, companionFileName?: string }} args
 */
export function createBundleFromImports({ id, createdAt = null, primaryImport, companionImport = null, primaryFileName = '', companionFileName = '' }) {
  if (companionImport === null || companionImport === undefined) return null;

  const primary = primaryImport
    ? describeImportResult(primaryImport, DOCUMENT_ROLES.PRIMARY, { id: `${id}:primary`, fileName: primaryFileName })
    : null;
  const companion = describeImportResult(companionImport, DOCUMENT_ROLES.COMPANION, { id: `${id}:companion`, fileName: companionFileName });

  return createAnalysisBundle({ id, createdAt, primary, companion });
}
