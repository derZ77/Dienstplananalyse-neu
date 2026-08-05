import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 4.1 (A–D) — CONTRACT TEST for the not-yet-implemented Dienstplan-PDF → XLSX export.
 *
 * WHAT THIS FILE IS
 * -----------------
 * Phase 4.1 is an audit. There is no exporter module yet and this file deliberately does not
 * require one. What it does is freeze the TARGET CONTRACT — admissible document types, sheet
 * names, column order, vocabulary — and audit the preconditions that already exist in the
 * product today. Phase 4.2 implements against exactly these constants.
 *
 * This file is the authority for the contract; the two sibling files restate only the parts
 * they need.
 *
 * SCOPE (binding, from the phase order)
 * -------------------------------------
 * PDF → Excel applies to the JNV and the JES Dienstplan-PDF and to nothing else. Umlauftafeln,
 * Wagenkarten and every other document type are refused. The export carries schedule data, never
 * analysis results — the Prüfbericht export of Phase 3I.36 stays exactly where it is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DOCUMENT_TYPES,
  documentTypeOrganization,
  isCompanionDocumentType
} from '../js/v2/documents/document-types.js';
import {
  DOCUMENT_PROFILES,
  PROFILE_CAPABILITIES,
  getProfilesForDocumentType,
  profileHasCapability,
  listProfiles
} from '../js/v2/documents/document-profiles.js';
import { detectPdfDocumentProfile } from '../js/v2/pdf/document-profile-detector.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// =====================================================================================
// THE CONTRACT — frozen here, implemented in Phase 4.2
// =====================================================================================

/** Exactly the two document types the export may ever be produced for. */
export const EXPORTABLE_DOCUMENT_TYPES = Object.freeze([
  DOCUMENT_TYPES.JNV_SCHEDULE_PDF,
  DOCUMENT_TYPES.JES_SCHEDULE_PDF
]);

/** The capability name that gates the export. It already exists in the profile contract. */
export const EXPORT_CAPABILITY = 'xlsxExport';

/** Sheet names, in workbook order. Stable — a reader may rely on them. */
export const SHEET_NAMES = Object.freeze(['Dienstplan', 'Dienste', 'Importhinweise']);

/**
 * `Dienstplan` — one row per activity, in printed reading order.
 * Positions 1–16 are the columns the phase order names, in the order it names them.
 * 17–19 are the audit columns that make every row traceable without a raw-text copy.
 */
export const DIENSTPLAN_COLUMNS = Object.freeze([
  'Dienstnummer', 'Zeile', 'Linie', 'Umlauf', 'Tätigkeit', 'Beginn', 'Anfangsort',
  'Richtung', 'Ende', 'Endort', 'Vorheriger Dienst', 'Nachfolgender Dienst',
  'Dienstbeginn', 'Dienstende', 'Bezahlte Zeit', 'Pause/Unterbrechung',
  'Quellenstatus', 'Unsichere Felder', 'Seite'
]);

/** `Dienste` — one row per duty. */
export const DIENSTE_COLUMNS = Object.freeze([
  'Dienstnummer', 'Beginn', 'Ende', 'Bezahlte Zeit', 'Abschnitte', 'Pausen',
  'Dokumenttyp', 'Organisation', 'Tagesart'
]);

/** `Importhinweise` — machine codes and a neutral message. Never a raw line, never a path. */
export const IMPORTHINWEISE_COLUMNS = Object.freeze([
  'Warncode', 'Bereich', 'Meldung', 'Dienstnummer'
]);

/**
 * Per-row data quality. The weakest field in the row decides.
 *
 * SUPERSEDED BY PHASE 4.3: the middle level was called `probable` in the Phase 4.1 audit. Phase
 * 4.3 fixed the wording to `derived`, which says WHERE the value comes from (an existing, proven
 * project function) instead of how likely it is to be right. Same three levels, same meaning,
 * one name — the projector and this contract must not disagree.
 */
export const CONFIDENCE_LEVELS = Object.freeze(['exact', 'derived', 'inconclusive']);

const REFERENCE = {
  // An Umlauftafel PDF — in the reference set, explicitly OUT of scope for this export.
  umlauftafel: FIXTURES.jnvUmlauftafelPdf
};
const readable = (path) => { try { readFileSync(path); return true; } catch { return false; } };

// SUPERSEDED BY PHASE 4.2: this helper used to glue the raw text items together with a blank and
// therefore bypassed the real fragmentation. It now uses the SAME projection the productive
// detection uses, so a negative result here is a genuine refusal and not an artefact of the test.
const extractText = async (path) => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
  const { buildDetectionText } = await import('../js/v2/import/pdf-analysis-controller.js');
  const { readFile } = await import('node:fs/promises');
  const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(path)));
  return { pageCount: layout.pageCount, text: buildDetectionText(layout) };
};

// =====================================================================================
// A — only the JNV and the JES Dienstplan-PDF are admissible
// =====================================================================================
test('A: exactly two document types may ever be exported', () => {
  assert.deepEqual([...EXPORTABLE_DOCUMENT_TYPES], ['jnv_schedule_pdf', 'jes_schedule_pdf']);
  assert.equal(EXPORTABLE_DOCUMENT_TYPES.length, 2, 'no third type may be added silently');
});

test('A: both admissible types belong to a real operator and to a real profile', () => {
  assert.equal(documentTypeOrganization(DOCUMENT_TYPES.JNV_SCHEDULE_PDF), 'JNV');
  assert.equal(documentTypeOrganization(DOCUMENT_TYPES.JES_SCHEDULE_PDF), 'JES');
  for (const type of EXPORTABLE_DOCUMENT_TYPES) {
    const profiles = getProfilesForDocumentType(type);
    assert.equal(profiles.length, 1, `${type} is carried by exactly one profile`);
    assert.equal(profiles[0].layoutFamily, 'ten-column-schedule');
    assert.equal(profiles[0].status, 'active');
  }
});

test('A: neither admissible type is a companion-only document', () => {
  for (const type of EXPORTABLE_DOCUMENT_TYPES) {
    assert.equal(isCompanionDocumentType(type), false, `${type} is a primary document`);
  }
});

test('A: the gate is the existing xlsxExport capability, not a new mechanism', () => {
  assert.ok(PROFILE_CAPABILITIES.includes(EXPORT_CAPABILITY), 'the capability name already exists');
  // SUPERSEDED BY PHASE 4.5: Phase 4.1 implemented nothing, so no profile could claim it yet. The
  // export was built in 4.3/4.4 and switched on in 4.5 — for exactly the two exportable profiles
  // and for nobody else, which is the assertion that still carries the meaning.
  const holders = listProfiles()
    .filter(profile => profileHasCapability(profile.id, EXPORT_CAPABILITY))
    .map(profile => profile.id).sort();
  assert.deepEqual(holders, ['beu-stadtbus-v1', 'jes-regionalbus-v1']);
  for (const profile of listProfiles()) {
    assert.ok(EXPORTABLE_DOCUMENT_TYPES.includes(profile.documentType),
      `${profile.id} may only hold ${EXPORT_CAPABILITY} because it produces an exportable type`);
  }
});

// =====================================================================================
// B — Umlauftafel, Wagenkarte, Legacy-Excel and unknown are refused
// =====================================================================================
test('B: every other document type is outside the export contract', () => {
  for (const type of [DOCUMENT_TYPES.UMLAUFKARTE, DOCUMENT_TYPES.WAGENKARTE,
    DOCUMENT_TYPES.LEGACY_EXCEL_SCHEDULE, DOCUMENT_TYPES.UNKNOWN]) {
    assert.ok(!EXPORTABLE_DOCUMENT_TYPES.includes(type), `${type} must never be exported`);
  }
});

test('B: no PDF profile produces an Umlauftafel or a Wagenkarte at all', () => {
  assert.deepEqual(getProfilesForDocumentType(DOCUMENT_TYPES.UMLAUFKARTE), []);
  assert.deepEqual(getProfilesForDocumentType(DOCUMENT_TYPES.WAGENKARTE), []);
  // …so the refusal does not depend on a check being remembered: the type cannot arrive here.
  assert.deepEqual(Object.keys(DOCUMENT_PROFILES).sort(), ['beu-stadtbus-v1', 'jes-regionalbus-v1']);
});

test('B: an Umlauftafel PDF is not recognised as a schedule',
  { skip: !readable(REFERENCE.umlauftafel) && 'Umlauftafel reference not present' }, async () => {
    const { text, pageCount } = await extractText(REFERENCE.umlauftafel);
    const detection = detectPdfDocumentProfile({ text, pageCount });
    assert.equal(detection.status, 'unsupported');
    assert.equal(detection.profile, undefined, 'no profile, therefore no export');
    assert.equal(detection.signals.tableHeaderFound, false, 'it has no Dienstplan table header');
  });

test('B: a plain unknown PDF text yields no profile either', () => {
  const detection = detectPdfDocumentProfile({ text: 'Irgendein anderes Dokument', pageCount: 1 });
  assert.equal(detection.status, 'unsupported');
  assert.equal(detection.profile, undefined);
});

// =====================================================================================
// C — stable sheet names
// =====================================================================================
test('C: the workbook carries exactly three sheets in a fixed order', () => {
  assert.deepEqual([...SHEET_NAMES], ['Dienstplan', 'Dienste', 'Importhinweise']);
});

test('C: no sheet name collides with the Prüfbericht export of Phase 3I.36', () => {
  const reportSheets = ['Zusammenfassung', 'Regelergebnisse', 'Betroffene Dienste', 'Technische Fehler'];
  for (const name of SHEET_NAMES) {
    assert.ok(!reportSheets.includes(name), `${name} must not be a report sheet — two separate exports`);
  }
});

test('C: every sheet name is a legal Excel sheet name', () => {
  for (const name of SHEET_NAMES) {
    assert.ok(name.length > 0 && name.length <= 31, `${name}: 1–31 characters`);
    assert.doesNotMatch(name, /[:\\/?*[\]]/, `${name}: no forbidden character`);
  }
});

// =====================================================================================
// D — stable column order
// =====================================================================================
test('D: the Dienstplan columns are fixed, in this order', () => {
  assert.deepEqual([...DIENSTPLAN_COLUMNS], [
    'Dienstnummer', 'Zeile', 'Linie', 'Umlauf', 'Tätigkeit', 'Beginn', 'Anfangsort',
    'Richtung', 'Ende', 'Endort', 'Vorheriger Dienst', 'Nachfolgender Dienst',
    'Dienstbeginn', 'Dienstende', 'Bezahlte Zeit', 'Pause/Unterbrechung',
    'Quellenstatus', 'Unsichere Felder', 'Seite'
  ]);
});

test('D: the Dienstplan sheet carries every column the phase order requires', () => {
  for (const required of ['Dienstnummer', 'Zeile', 'Linie', 'Umlauf', 'Tätigkeit', 'Beginn',
    'Anfangsort', 'Richtung', 'Ende', 'Endort', 'Vorheriger Dienst', 'Nachfolgender Dienst',
    'Dienstbeginn', 'Dienstende', 'Bezahlte Zeit', 'Pause/Unterbrechung', 'Quellenstatus']) {
    assert.ok(DIENSTPLAN_COLUMNS.includes(required), `${required} is required`);
  }
});

test('D: the Dienste and Importhinweise columns are fixed too', () => {
  assert.deepEqual([...DIENSTE_COLUMNS], ['Dienstnummer', 'Beginn', 'Ende', 'Bezahlte Zeit',
    'Abschnitte', 'Pausen', 'Dokumenttyp', 'Organisation', 'Tagesart']);
  assert.deepEqual([...IMPORTHINWEISE_COLUMNS], ['Warncode', 'Bereich', 'Meldung', 'Dienstnummer']);
});

test('D: no column heading is duplicated within a sheet', () => {
  for (const columns of [DIENSTPLAN_COLUMNS, DIENSTE_COLUMNS, IMPORTHINWEISE_COLUMNS]) {
    assert.equal(new Set(columns).size, columns.length, `duplicate heading in ${columns.join(',')}`);
  }
});

test('D: the confidence vocabulary is closed', () => {
  // SUPERSEDED BY PHASE 4.3: `probable` was renamed to `derived`. Still three levels, no fourth.
  assert.deepEqual([...CONFIDENCE_LEVELS], ['exact', 'derived', 'inconclusive']);
  assert.equal(CONFIDENCE_LEVELS.length, 3);
});

// =====================================================================================
// The audit statement: nothing is implemented yet
// =====================================================================================
test('the contract is implemented without a new dependency', () => {
  // SUPERSEDED BY PHASE 4.4: this used to assert that NO exporter module existed — the honest
  // record that Phase 4.1 was an audit. Phase 4.3 added the projection model and Phase 4.4 the
  // file writer, so the assertion is inverted as announced. The half that still matters — that
  // the whole chain runs on what the app already vendors — is kept and made stricter.
  for (const path of ['../js/v2/export/dienstplan-xlsx-model.js', '../js/v2/export/dienstplan-xlsx-export.js']) {
    const module = src(path);
    assert.ok(module.length > 0, `${path} exists`);
    assert.doesNotMatch(module, /import .* from ['"](?!\.)/, `${path}: no bare specifier`);
  }
  const packageJson = JSON.parse(src('../package.json'));
  assert.equal(packageJson.dependencies, undefined, 'no runtime dependency');
  assert.equal(packageJson.devDependencies, undefined, 'no dev dependency');
});
