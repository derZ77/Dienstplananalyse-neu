import { assertDocumentType, assertDocumentRole, DOCUMENT_ROLES } from './document-types.js';

/**
 * In-memory-only analysis session model (Phase 2). Holds document *metadata* and
 * session state; it never stores file bytes and never uses browser storage
 * (Local/Session Storage, IndexedDB or the Cache API). It does not replace any existing import logic; it is
 * an isolated, testable container for a later single/combined analysis.
 *
 * @typedef {'single'|'combined'} BundleMode
 */

export const BUNDLE_MODES = Object.freeze({ SINGLE: 'single', COMBINED: 'combined' });

export const BUNDLE_COMPATIBILITY = Object.freeze({
  COMPATIBLE: 'compatible', INCOMPATIBLE: 'incompatible', INCOMPLETE: 'incomplete', UNKNOWN: 'unknown'
});

export const BUNDLE_MATCH_STATUSES = Object.freeze({
  NOT_EVALUATED: 'not_evaluated', EXACT: 'exact', PROBABLE: 'probable',
  AMBIGUOUS: 'ambiguous', UNMATCHED: 'unmatched', CONFLICTING: 'conflicting'
});

export const PARSER_STATUSES = Object.freeze({
  PENDING: 'pending', OK: 'ok', UNSUPPORTED: 'unsupported', ERROR: 'error'
});

const FORBIDDEN_DOCUMENT_KEYS = Object.freeze(['bytes', 'buffer', 'arrayBuffer', 'data', 'blob', 'file']);

/**
 * Creates an imported-document descriptor (metadata only). File bytes are
 * explicitly disallowed to keep the session lightweight and privacy-preserving.
 */
export function createImportedDocument({
  id, role, type, organization = null, profileId = null, fileName = '',
  parserStatus = PARSER_STATUSES.PENDING, sourceMetadata = null
} = {}) {
  if (typeof id !== 'string' || !id) throw new TypeError('ImportedDocument requires a non-empty id.');
  assertDocumentRole(role);
  assertDocumentType(type);
  if (!Object.values(PARSER_STATUSES).includes(parserStatus)) {
    throw new TypeError(`Unsupported parserStatus: ${parserStatus}`);
  }
  if (sourceMetadata && typeof sourceMetadata === 'object') {
    for (const key of FORBIDDEN_DOCUMENT_KEYS) {
      if (key in sourceMetadata) throw new TypeError(`ImportedDocument.sourceMetadata must not carry file bytes ("${key}").`);
    }
  }
  return Object.freeze({
    type: 'ImportedDocument',
    id, role, documentType: type, organization, profileId, fileName, parserStatus,
    sourceMetadata: sourceMetadata ? Object.freeze({ ...sourceMetadata }) : null
  });
}

/**
 * Creates an in-memory analysis bundle. `mode` is derived from the presence of a
 * companion. `createdAt` is supplied by the caller (kept deterministic/testable);
 * the caller is responsible for stamping it in the running app.
 */
export function createAnalysisBundle({ id, primary = null, companion = null, createdAt = null } = {}) {
  if (typeof id !== 'string' || !id) throw new TypeError('AnalysisBundle requires a non-empty id.');
  assertImportedDocumentOrNull(primary, DOCUMENT_ROLES.PRIMARY);
  assertImportedDocumentOrNull(companion, DOCUMENT_ROLES.COMPANION);
  const mode = companion ? BUNDLE_MODES.COMBINED : BUNDLE_MODES.SINGLE;
  return Object.freeze({
    type: 'AnalysisBundle',
    id,
    mode,
    primary,
    companion,
    compatibility: BUNDLE_COMPATIBILITY.UNKNOWN,
    matchStatus: BUNDLE_MATCH_STATUSES.NOT_EVALUATED,
    createdAt
  });
}

/** Returns a new bundle with an updated compatibility/matchStatus (immutably). */
export function withBundleState(bundle, { compatibility, matchStatus } = {}) {
  if (bundle?.type !== 'AnalysisBundle') throw new TypeError('Expected an AnalysisBundle.');
  const next = { ...bundle };
  if (compatibility !== undefined) {
    if (!Object.values(BUNDLE_COMPATIBILITY).includes(compatibility)) throw new TypeError(`Unsupported compatibility: ${compatibility}`);
    next.compatibility = compatibility;
  }
  if (matchStatus !== undefined) {
    if (!Object.values(BUNDLE_MATCH_STATUSES).includes(matchStatus)) throw new TypeError(`Unsupported matchStatus: ${matchStatus}`);
    next.matchStatus = matchStatus;
  }
  return Object.freeze(next);
}

export function isBundleComplete(bundle) {
  if (bundle?.type !== 'AnalysisBundle') return false;
  return bundle.mode === BUNDLE_MODES.SINGLE
    ? Boolean(bundle.primary)
    : Boolean(bundle.primary && bundle.companion);
}

function assertImportedDocumentOrNull(doc, expectedRole) {
  if (doc === null || doc === undefined) return;
  if (doc.type !== 'ImportedDocument') throw new TypeError('Expected an ImportedDocument or null.');
  if (doc.role !== expectedRole) throw new TypeError(`Document role must be "${expectedRole}".`);
}
