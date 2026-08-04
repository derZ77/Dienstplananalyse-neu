/**
 * Phase 4.5 (1) — the `xlsxExport` capability is switched on for JNV and JES, and for nobody else.
 *
 * The capability NAME already existed in the profile contract and was declared by no profile. This
 * phase gives it its first two holders. It means exactly one thing: this profile may offer the
 * existing local Dienstplan export. It is not a general permission and it does not travel to any
 * other document type.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DOCUMENT_PROFILES, PROFILE_CAPABILITIES, listProfiles, profileHasCapability, getProfile
} from '../js/v2/documents/document-profiles.js';
import { DOCUMENT_TYPES } from '../js/v2/documents/document-types.js';
import {
  DIENSTPLAN_EXPORT_CAPABILITY, EXPORTABLE_DOCUMENT_TYPES
} from '../js/v2/export/dienstplan-export-ui.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// =====================================================================================
// The capability itself
// =====================================================================================
test('1: the capability name is the one the profile contract already reserved', () => {
  assert.equal(DIENSTPLAN_EXPORT_CAPABILITY, 'xlsxExport');
  assert.ok(PROFILE_CAPABILITIES.includes(DIENSTPLAN_EXPORT_CAPABILITY),
    'no second name is introduced for the same thing');
});

test('1: JNV and JES declare it', () => {
  assert.equal(profileHasCapability('beu-stadtbus-v1', DIENSTPLAN_EXPORT_CAPABILITY), true, 'JNV');
  assert.equal(profileHasCapability('jes-regionalbus-v1', DIENSTPLAN_EXPORT_CAPABILITY), true, 'JES');
});

test('1: exactly those two profiles declare it — no third holder appears', () => {
  const holders = listProfiles()
    .filter(profile => profile.capabilities.includes(DIENSTPLAN_EXPORT_CAPABILITY))
    .map(profile => profile.id)
    .sort();
  assert.deepEqual(holders, ['beu-stadtbus-v1', 'jes-regionalbus-v1']);
  assert.equal(listProfiles().length, 2, 'and the registry still knows exactly two profiles');
});

test('1: the capability is added, nothing else about the profiles changed', () => {
  for (const [id, organization, documentType] of [
    ['beu-stadtbus-v1', 'JNV', DOCUMENT_TYPES.JNV_SCHEDULE_PDF],
    ['jes-regionalbus-v1', 'JES', DOCUMENT_TYPES.JES_SCHEDULE_PDF]
  ]) {
    const profile = getProfile(id);
    assert.equal(profile.organization, organization);
    assert.equal(profile.documentType, documentType);
    assert.equal(profile.status, 'active');
    assert.equal(profile.layoutFamily, 'ten-column-schedule');
    assert.equal(profile.parserId, 'pdf-core/schedule-mapper');
    assert.deepEqual([...profile.capabilities], ['parse', 'normalize', 'analyze', 'xlsxExport'],
      'the three proven capabilities keep their place; the new one is appended');
  }
});

test('1: no OTHER capability was switched on by accident', () => {
  for (const profile of listProfiles()) {
    for (const capability of ['combinedAnalysis', 'lenkzeit', 'oneSixth']) {
      assert.equal(profileHasCapability(profile.id, capability), false,
        `${profile.id} must not claim ${capability}`);
    }
  }
});

// =====================================================================================
// The capability grants nothing to other document types
// =====================================================================================
test('1: only the two Dienstplan-PDF types are exportable', () => {
  assert.deepEqual([...EXPORTABLE_DOCUMENT_TYPES], ['jnv_schedule_pdf', 'jes_schedule_pdf']);
  for (const type of [DOCUMENT_TYPES.LEGACY_EXCEL_SCHEDULE, DOCUMENT_TYPES.UMLAUFKARTE,
    DOCUMENT_TYPES.WAGENKARTE, DOCUMENT_TYPES.UNKNOWN]) {
    assert.ok(!EXPORTABLE_DOCUMENT_TYPES.includes(type), `${type} stays out`);
  }
});

test('1: no profile in the registry produces a companion or an Excel document type', () => {
  for (const profile of listProfiles()) {
    assert.ok(EXPORTABLE_DOCUMENT_TYPES.includes(profile.documentType),
      `${profile.id} produces ${profile.documentType}`);
  }
  // …so a capability holder can never be an Umlauftafel, Wagenkarte or Legacy-Excel document.
  assert.deepEqual(Object.keys(DOCUMENT_PROFILES).sort(), ['beu-stadtbus-v1', 'jes-regionalbus-v1']);
});

test('1: the capability keeps its documented meaning — no second semantics is introduced', () => {
  const contract = src('../js/v2/documents/document-profiles.js');
  assert.match(contract, /xlsxExport/);
  // The contract file describes capabilities; it must not gain export logic of its own.
  assert.doesNotMatch(contract, /\bXLSX\.|book_new|Blob|createObjectURL|downloadDienstplan/,
    'the profile contract stays a contract');
  assert.doesNotMatch(contract, /dienstplan-xlsx-export|dienstplan-xlsx-model/,
    'and imports no exporter');
});

test('1: a capability alone is not a permission — the UI adapter demands more', () => {
  const adapter = src('../js/v2/export/dienstplan-export-ui.js');
  assert.match(adapter, /profileHasCapability/, 'the capability is really consulted');
  assert.match(adapter, /EXPORTABLE_DOCUMENT_TYPES/, 'and so is the document type');
  assert.match(adapter, /'ready'|READY/, 'and the model status');
});
