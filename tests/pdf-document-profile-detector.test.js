import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectPdfDocumentProfile,
  PDF_DOCUMENT_PROFILES
} from '../js/v2/pdf/document-profile-detector.js';

const tableHeader = 'Dienst Umlauf Tätigkeit Abfahrt Abfahrtsort Ankunft Ankunftsort Beginn Ende Bez. Zeit';

test('erkennt das JES-Referenzprofil regelbasiert', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026 ${tableHeader} Vorbereitungszeit JES`,
    pageCount: 3
  });

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.profile, PDF_DOCUMENT_PROFILES.jes);
});

test('erkennt Regionalbus Montag bis Freitag auch ohne Ferien- oder Schulzusatz', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Regionalbus Montag bis Freitag, ab 14.09.2026 ${tableHeader} Vorbereitungszeit Dienst Pause`,
    pageCount: 8
  });

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.profile, PDF_DOCUMENT_PROFILES.jes);
  assert.equal(result.title, 'Dienste Regionalbus Montag bis Freitag, ab 14.09.2026');
});

test('erkennt das BEU-Referenzprofil regelbasiert', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026 ${tableHeader} Aufrüsten Mitfahrt`,
    pageCount: 15
  });

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.profile, PDF_DOCUMENT_PROFILES.beu);
});

test('lehnt einen BEU-Titel mit Tabellenkopf ohne Dienst- oder Tätigkeitsdaten ab', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Stadtbus Montag bis Freitag, ab 26.10.2026 ${tableHeader}`,
    pageCount: 1
  });

  assert.equal(result.status, 'unsupported');
  assert.equal(result.profile, undefined);
});

test('erkennt Stadtbus ohne Schulzusatz mit unabhängigen Tätigkeitssignalen', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Stadtbus Montag bis Freitag, ab 26.10.2026 ${tableHeader} Aufrüsten Mitfahrt`,
    pageCount: 16
  });

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.profile, PDF_DOCUMENT_PROFILES.beu);
});

test('lehnt unbekannte PDFs ohne Teilanalyse ab', () => {
  const result = detectPdfDocumentProfile({
    text: 'Irgendein Fahrplan mit einer nicht unterstützten Tabellenstruktur',
    pageCount: 1
  });

  assert.equal(result.status, 'unsupported');
  assert.equal(result.profile, undefined);
});
