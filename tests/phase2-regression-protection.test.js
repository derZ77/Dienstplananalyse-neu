import test from 'node:test';
import assert from 'node:assert/strict';

// Guards that the Phase-2 contracts (and their JNV correction) did NOT change the
// existing PDF/Excel detection behaviour. The technical profile id `beu-stadtbus-v1`
// stays; only its fachliche mapping (organization JNV, documentType jnv_schedule_pdf)
// is corrected in the contract layer.
const { detectPdfDocumentProfile, PDF_DOCUMENT_PROFILES } = await import('../js/v2/pdf/document-profile-detector.js');
const { detectExcelLayout } = await import('../js/v2/excel/excel-canonical-adapter.js');
const { getProfile } = await import('../js/v2/documents/document-profiles.js');
const { DOCUMENT_TYPES, ORGANIZATIONS } = await import('../js/v2/documents/document-types.js');

const HEADERS = 'Dienst Umlauf Tätigkeit Abfahrt Abfahrtsort Ankunft Ankunftsort Beginn Ende Bez. Zeit';
const JES_TEXT = `Dienste Regionalbus Montag bis Freitag (Ferien), ab 23.07.2026 ${HEADERS} Vorbereitungszeit JES`;
const STADTBUS_TEXT = `Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026 ${HEADERS} Aufrüsten Abrüsten Mitfahrt`;
const UMLAUF_TEXT = 'Montag - Freitag (Ferien), ab 23.07.2026 Dienst: 2299 Linie: 10 Route: 20 BUP Steig 3 Leerfahrt';

test('JES PDF detection unchanged', () => {
  const d = detectPdfDocumentProfile({ text: JES_TEXT, pageCount: 3 });
  assert.equal(d.status, 'supported');
  assert.equal(d.profile.id, 'jes-regionalbus-v1');
});

test('JNV Stadtbus PDF detection unchanged (technical profile beu-stadtbus-v1)', () => {
  const d = detectPdfDocumentProfile({ text: STADTBUS_TEXT, pageCount: 15 });
  assert.equal(d.status, 'supported');
  assert.equal(d.profile.id, 'beu-stadtbus-v1'); // technical id preserved (Strategy A)
});

test('Umlaufkarte / unknown PDF remains unsupported', () => {
  assert.equal(detectPdfDocumentProfile({ text: UMLAUF_TEXT, pageCount: 58 }).status, 'unsupported');
  assert.equal(detectPdfDocumentProfile({ text: 'irgendein text', pageCount: 1 }).status, 'unsupported');
});

test('Excel layout detection unchanged', () => {
  assert.equal(detectExcelLayout([['Dienst', 'Umlauf', 'Tätigkeit']]), 'schedule-10-column');
  assert.equal(detectExcelLayout([['x', 'y']]), 'legacy-tabular-17-column');
});

test('profile contract maps the detector ids to the corrected fachlichkeit', () => {
  assert.equal(getProfile(PDF_DOCUMENT_PROFILES.jes.id).documentType, DOCUMENT_TYPES.JES_SCHEDULE_PDF);
  // the historically-named beu-stadtbus-v1 profile is fachlich JNV
  const jnvProfile = getProfile(PDF_DOCUMENT_PROFILES.beu.id);
  assert.equal(jnvProfile.documentType, DOCUMENT_TYPES.JNV_SCHEDULE_PDF);
  assert.equal(jnvProfile.organization, ORGANIZATIONS.JNV);
});
