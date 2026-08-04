/**
 * Phase 4.1 (G/H/I) — CONTRACT TEST: privacy and security of the planned PDF → XLSX export.
 *
 * The rules asserted here are the ones the exporter of Phase 4.2 has to satisfy. Where the product
 * already contains a proven mechanism (the formula-injection guard of Phase 3I.36) this file pins
 * that mechanism as the reference implementation, so the new export reuses it instead of inventing
 * a second, weaker one.
 *
 * It also guards the other direction: the existing Prüfbericht export must come out of Phase 4.1
 * untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { neutraliseCell, buildCheckReportExportModel } from '../js/v2/report/check-report-export-model.js';
import { createReportExportFile, downloadReportExport, EXPORT_FORMATS } from '../js/v2/report/check-report-export.js';
import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Restated from the contract file; that file is the authority. */
const SHEET_NAMES = ['Dienstplan', 'Dienste', 'Importhinweise'];
const ALL_COLUMNS = [
  'Dienstnummer', 'Zeile', 'Linie', 'Umlauf', 'Tätigkeit', 'Beginn', 'Anfangsort',
  'Richtung', 'Ende', 'Endort', 'Vorheriger Dienst', 'Nachfolgender Dienst',
  'Dienstbeginn', 'Dienstende', 'Bezahlte Zeit', 'Pause/Unterbrechung',
  'Quellenstatus', 'Unsichere Felder', 'Seite',
  'Abschnitte', 'Pausen', 'Dokumenttyp', 'Organisation', 'Tagesart',
  'Warncode', 'Bereich', 'Meldung'
];

/**
 * The fields of a CanonicalSchedule activity/service that may reach a cell. Everything else —
 * above all `originalText`, `boundingBox` and the whole `source` object with its raw cells —
 * is a copy of the document and must never be exported.
 */
const ALLOWED_CELL_SOURCES = Object.freeze([
  'serviceNumber', 'circuitNumber', 'rawActivity',
  'departureTime.value', 'arrivalTime.value', 'departureLocation', 'arrivalLocation',
  'begin.value', 'end.value', 'paidTime.value',
  'routeIdentity.line', 'source.pageNumber'
]);
const FORBIDDEN_CELL_SOURCES = Object.freeze([
  'originalText', 'boundingBox', 'source.originalText', 'source.rawCells',
  'source.fileName', 'document.source', 'transform', 'font'
]);

/** `JNV-Dienstplan-Export-2026-08-04` — operator, purpose, date. Nothing else. */
const FILE_NAME_PATTERN = /^(JNV|JES)-Dienstplan-Export-\d{4}-\d{2}-\d{2}$/;
const fileNameBase = (organization, date) => `${organization}-Dienstplan-Export-${date}`;

// =====================================================================================
// G — formula injection
// =====================================================================================
test('G: a cell that could be read as a formula is neutralised', () => {
  for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)', '=cmd|calc', '=HYPERLINK("http://x")']) {
    const cell = neutraliseCell(dangerous);
    assert.equal(cell, `'${dangerous}`, `${dangerous} must be prefixed`);
    assert.doesNotMatch(cell, /^[=+\-@]/, 'and must no longer start with a formula character');
  }
});

test('G: harmless content passes through untouched', () => {
  for (const harmless of ['Dienst', '2101', '03:15', 'Bth. Burgau', 'Löbdergraben', '', 'Pause (bezahlt)']) {
    assert.equal(neutraliseCell(harmless), harmless);
  }
  assert.equal(neutraliseCell(42), 42, 'numbers stay numbers');
  assert.equal(neutraliseCell(null), '', 'a missing value becomes an empty cell, never "null"');
  assert.equal(neutraliseCell(undefined), '');
});

test('G: a negative duration is the case the guard must not mangle into a formula', () => {
  // A minus sign at the start of a cell is exactly what a spreadsheet reads as a formula, so it
  // is prefixed too. The reader still sees the value.
  assert.equal(neutraliseCell('-00:30'), "'-00:30");
});

test('G: the guard is a single, reusable function — no second implementation', () => {
  const model = src('../js/v2/report/check-report-export-model.js');
  assert.match(model, /export function neutraliseCell/, 'exported, therefore reusable');
  assert.match(model, /\^\[=\+\\?-@\]/, 'the rule covers = + - @');
});

// =====================================================================================
// H — no paths, no raw objects, no binary data
// =====================================================================================
test('H: the allowed cell sources are leaf values only', () => {
  for (const path of ALLOWED_CELL_SOURCES) {
    assert.ok(!FORBIDDEN_CELL_SOURCES.includes(path), `${path} must not be forbidden and allowed at once`);
  }
  for (const path of ALLOWED_CELL_SOURCES) {
    assert.doesNotMatch(path, /originalText|boundingBox|rawCells|fileName/,
      `${path} must not reach into a raw document copy`);
  }
});

test('H: the raw document copies are named and excluded', () => {
  for (const forbidden of ['originalText', 'boundingBox', 'source.rawCells', 'source.fileName']) {
    assert.ok(FORBIDDEN_CELL_SOURCES.includes(forbidden), `${forbidden} must be excluded explicitly`);
  }
});

test('H: the file name carries an operator and a date — never a path or a source name', () => {
  const name = fileNameBase('JNV', '2026-08-04');
  assert.match(name, FILE_NAME_PATTERN);
  assert.ok(!name.includes('/') && !name.includes('\\'), 'no separator');
  assert.ok(!name.includes('..'), 'no traversal');
  assert.match(`${name}.xlsx`, /^[A-Za-z0-9.-]+$/, 'safe characters only');
  assert.match(fileNameBase('JES', '2026-08-04'), FILE_NAME_PATTERN);
  // A source document name must never appear, whatever it is called.
  assert.ok(!fileNameBase('JNV', '2026-08-04').includes('B_20260817'));
});

test('H: no column invites a personal detail into the workbook', () => {
  for (const column of ALL_COLUMNS) {
    assert.doesNotMatch(column, /Name|Fahrer|Personal|Mitarbeiter|Geburt|Adresse|Telefon|E-?Mail/i,
      `${column} must not be a personal field`);
  }
});

test('H: no column carries an analysis result — this export is schedule data', () => {
  for (const column of ALL_COLUMNS) {
    assert.doesNotMatch(column, /\b(Regel|Status|Severity|Verstoß|Prüf|PASS|FAIL|BV\d)/i,
      `${column} belongs to the Prüfbericht, not to the Dienstplan export`);
  }
  // `Quellenstatus` is data provenance, not a check status — and it is one word, so it can never
  // be read as the report's `Status` column.
  assert.ok(ALL_COLUMNS.includes('Quellenstatus'));
  assert.ok(!ALL_COLUMNS.includes('Status'));
});

test('H: the export stays local — the modules it will build on reach nothing outside', () => {
  for (const path of ['../js/v2/pdf/pdf-core.js', '../js/v2/pdf/document-normalizer.js',
    '../js/v2/pdf/schedule-mapper.js', '../js/v2/pdf/canonical-schedule-builder.js',
    '../js/v2/pdf/hardened-schedule.js', '../js/v2/report/check-report-export.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/, `${path}: no storage`);
    assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/, `${path}: no network`);
    assert.doesNotMatch(module, /import .* from ['"](?!\.)/, `${path}: no bare specifier — nothing installed`);
  }
});

test('H: the page still forbids every outbound connection', () => {
  const html = src('../index.html');
  assert.match(html, /connect-src 'none'/, 'the CSP has not been loosened for an export');
});

// =====================================================================================
// I — the existing Prüfbericht export is untouched
// =====================================================================================
const result = (id, status, severity) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity, message: `${id} Meldung`,
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: []
});
const report = () => ({
  type: 'CheckReport', results: [result('BV003', 'FAIL', 'WARNING'), result('BV010', 'PASS', 'INFO')],
  errors: [], summary: { resultCount: 2, hitCount: 1 }
});

test('I: the report export still produces its own four sheets', () => {
  const model = buildCheckReportExportModel(buildCheckReportViewModel(report()),
    { now: new Date(Date.UTC(2026, 7, 4, 9, 0)) });
  assert.equal(model.exportable, true);
  assert.deepEqual(model.sheets.map(sheet => sheet.name),
    ['Zusammenfassung', 'Regelergebnisse', 'Betroffene Dienste', 'Technische Fehler']);
});

test('I: the report export still names its file the way Phase 3I.36 fixed it', () => {
  const file = createReportExportFile(
    buildCheckReportExportModel(buildCheckReportViewModel(report()), { now: new Date(Date.UTC(2026, 7, 4, 9, 0)) }),
    { format: EXPORT_FORMATS.CSV });
  assert.equal(file.ok, true);
  assert.equal(file.fileName, 'Dienstplan-Pruefbericht-2026-08-04.csv');
  assert.equal(typeof downloadReportExport, 'function');
});

test('I: no Dienstplan-export vocabulary has leaked into the report modules', () => {
  // Searched for by their UNAMBIGUOUS tokens only. `Dienste` is an ordinary row label in the
  // report's own summary sheet, and `Dienstplan` is its fallback organization name — neither is
  // evidence of a leak. `Importhinweise` and `Dienstplan-Export` belong to nothing else.
  assert.ok(SHEET_NAMES.includes('Importhinweise'), 'the unambiguous sheet name');
  for (const path of ['../js/v2/report/check-report-export-model.js', '../js/v2/report/check-report-export.js']) {
    const module = src(path);
    assert.ok(!module.includes('Importhinweise'), `${path} must not know the new sheet`);
    assert.doesNotMatch(module, /Dienstplan-Export|pdfToXlsx|dienstplanXlsx/, `${path} stays a report export`);
  }
});

test('I: the two exports keep separate file names, so neither overwrites the other', () => {
  assert.ok(!fileNameBase('JNV', '2026-08-04').includes('Pruefbericht'));
  assert.notEqual(`${fileNameBase('JNV', '2026-08-04')}.xlsx`, 'JNV-Pruefbericht-2026-08-04.xlsx');
});
