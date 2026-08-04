/**
 * Phase 4.3 (C) — the projection of the REAL JNV Stadtbus plan, measured through the real chain.
 *
 * PDF bytes → PDF.js → detection → CanonicalSchedule → XLSX model. Nothing is pre-cleaned and no
 * count is copied from an earlier phase; every figure below was re-measured for this phase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const {
  buildDienstplanXlsxModel, DIENSTPLAN_COLUMNS, DIENSTE_COLUMNS, MODEL_WARNING_CODES
} = await import('../js/v2/export/dienstplan-xlsx-model.js');

const JNV_PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
const present = async (path) => { try { await access(path); return true; } catch { return false; } };
const skip = !(await present(JNV_PDF)) && 'JNV reference plan not present';

let cached = null;
let model = null;
const projection = async () => {
  if (!model) {
    cached ??= await readFile(JNV_PDF);
    const bytes = new Uint8Array(cached);
    model = buildDienstplanXlsxModel(await analyzePdfImport({ arrayBuffer: async () => bytes.buffer }));
  }
  return model;
};

const sheetOf = (built, name) => built.sheets.find(entry => entry.name === name);
const at = (row, heading) => row[DIENSTPLAN_COLUMNS.indexOf(heading)];
const atDuty = (row, heading) => row[DIENSTE_COLUMNS.indexOf(heading)];
const values = (built, name, heading) => {
  const entry = sheetOf(built, name);
  const index = entry.columns.indexOf(heading);
  return entry.rows.map(row => row[index]);
};

// =====================================================================================
// C — the real numbers
// =====================================================================================
test('C: the real JNV plan projects to ready with both operator fields set', { skip }, async () => {
  const built = await projection();
  assert.equal(built.status, 'ready');
  assert.equal(built.documentType, 'jnv_schedule_pdf');
  assert.equal(built.organization, 'JNV');
});

test('C: all 62 duties reach the Dienste sheet, in plan order and unique', { skip }, async () => {
  const built = await projection();
  const numbers = values(built, 'Dienste', 'Dienstnummer');
  assert.equal(numbers.length, 62);
  assert.equal(new Set(numbers).size, 62, 'the JNV plan has no duplicate duty number');
  assert.equal(numbers[0], '2101');
  assert.equal(built.statistics.serviceCount, 62);
});

test('C: the Dienstplan sheet carries the classified rows and drops the page footers', { skip }, async () => {
  const built = await projection();
  // 656 activity rows = 629 activities + 12 interruption lines + 15 page footers.
  assert.equal(sheetOf(built, 'Dienstplan').rows.length, 641, '629 activities + 12 interruptions');
  assert.equal(built.statistics.activityCount, 641);
  for (const value of values(built, 'Dienstplan', 'Tätigkeit')) {
    assert.doesNotMatch(String(value), /^Seite \d+ von \d+$/, 'no page footer became an activity row');
  }
});

test('C: the 15 dropped footer rows are reported rather than silently lost', { skip }, async () => {
  const built = await projection();
  const dropped = built.warnings.filter(warning => warning.code === MODEL_WARNING_CODES.ZEILE_NICHT_ZUGEORDNET);
  assert.equal(dropped.length, 15, 'one hint per page footer');
  for (const warning of dropped) {
    assert.ok(!String(warning.message).includes('Seite 1 von 15'), 'the raw text is not repeated');
  }
});

test('C: duty numbers, times and places arrive as printed', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienstplan').rows;
  const first = rows[0];
  assert.equal(at(first, 'Dienstnummer'), '2101');
  assert.equal(at(first, 'Zeile'), 1);
  assert.equal(at(first, 'Tätigkeit'), 'Dienst');
  assert.equal(at(first, 'Beginn'), '03:15');
  assert.equal(at(first, 'Anfangsort'), 'Bth. Burgau', 'trimmed, nothing else');
  assert.equal(at(first, 'Ende'), '12:15');
  assert.equal(at(first, 'Endort'), 'Bth. Burgau');
  assert.equal(at(first, 'Dienstbeginn'), '03:15');
  assert.equal(at(first, 'Dienstende'), '12:15');
  assert.equal(at(first, 'Bezahlte Zeit'), '09:00');
  assert.equal(at(first, 'Seite'), 1);
  for (const place of values(built, 'Dienstplan', 'Anfangsort')) {
    assert.doesNotMatch(String(place), /^\s|\s$/, 'no leading or trailing blank survives');
  }
});

test('C: the duty totals are repeated on every row of the duty', { skip }, async () => {
  const built = await projection();
  const all = sheetOf(built, 'Dienstplan').rows;
  // Duty 2101 is a single-row block, so the check picks a duty that really has several rows.
  const counts = new Map();
  for (const row of all) counts.set(at(row, 'Dienstnummer'), (counts.get(at(row, 'Dienstnummer')) ?? 0) + 1);
  const multiRow = [...counts.entries()].filter(([, count]) => count > 1);
  assert.ok(multiRow.length >= 40, 'most duties span several rows');

  for (const [number] of multiRow.slice(0, 20)) {
    const rows = all.filter(row => at(row, 'Dienstnummer') === number);
    assert.equal(new Set(rows.map(row => at(row, 'Dienstbeginn'))).size, 1, `${number}: Dienstbeginn`);
    assert.equal(new Set(rows.map(row => at(row, 'Dienstende'))).size, 1, `${number}: Dienstende`);
    assert.equal(new Set(rows.map(row => at(row, 'Bezahlte Zeit'))).size, 1, `${number}: bezahlte Zeit`);
  }
});

test('C: the Linie appears exactly where a circuit code carries one', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienstplan').rows;
  const withLine = rows.filter(row => at(row, 'Linie') !== '');
  const withCircuit = rows.filter(row => at(row, 'Umlauf') !== '');
  assert.equal(withCircuit.length, 173, 'the plan prints 173 circuit codes');
  assert.equal(withLine.length, 173, 'and every one of them yields a line');
  for (const row of rows) {
    if (at(row, 'Umlauf') === '') assert.equal(at(row, 'Linie'), '', 'no circuit code, no line');
  }
  const sample = rows.find(row => at(row, 'Umlauf') === '12100');
  assert.equal(at(sample, 'Linie'), '12', '12100 is line 12');
});

test('C: the 12 Dienstunterbrechungen are kept as their own, neutral rows', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienstplan').rows
    .filter(row => at(row, 'Tätigkeit') === 'Dienstunterbrechung');
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.match(String(at(row, 'Pause/Unterbrechung')), /^Unterbrechung \d{2}:\d{2}–\d{2}:\d{2}$/);
    assert.match(String(at(row, 'Beginn')), /^\d{2}:\d{2}$/);
    assert.equal(at(row, 'Quellenstatus'), 'derived', 'parsed out of a free-text line');
    assert.ok(!String(at(row, 'Pause/Unterbrechung')).includes('Uhr'), 'the raw wording is not repeated');
  }
  assert.equal(rows[0][DIENSTPLAN_COLUMNS.indexOf('Beginn')], '08:22');
});

test('C: paid and unpaid breaks are marked, and counted per duty', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienstplan').rows;
  assert.equal(rows.filter(row => at(row, 'Pause/Unterbrechung') === 'Pause').length, 45);
  assert.equal(rows.filter(row => at(row, 'Pause/Unterbrechung') === 'Pause (bezahlt)').length, 61);
  // 45 + 61 unpaid/paid breaks + 12 interruptions are what the Dienste sheet counts.
  const counted = values(built, 'Dienste', 'Pausen').reduce((sum, value) => sum + value, 0);
  assert.equal(counted, 45 + 61 + 12);
});

test('C: the six duties past midnight keep their day change', { skip }, async () => {
  const built = await projection();
  const rolled = sheetOf(built, 'Dienste').rows.filter(row => String(atDuty(row, 'Ende')).includes('(+1)'));
  assert.equal(rolled.length, 6, 'six duties end on the next day');
  assert.deepEqual(rolled.map(row => atDuty(row, 'Dienstnummer')).sort(),
    ['2189', '2191', '2192', '2193', '2194', '2199']);
  const sample = rolled.find(row => atDuty(row, 'Dienstnummer') === '2189');
  assert.equal(atDuty(sample, 'Beginn'), '15:27');
  assert.equal(atDuty(sample, 'Ende'), '00:57 (+1)', 'never a silent modulo-24 loss');
});

test('C: the Dienste sheet counts sections and names the document', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienste').rows;
  const sections = values(built, 'Dienste', 'Abschnitte').reduce((sum, value) => sum + value, 0);
  assert.equal(sections, 641, 'every projected row belongs to exactly one duty');
  for (const row of rows) {
    assert.equal(atDuty(row, 'Dokumenttyp'), 'jnv_schedule_pdf');
    assert.equal(atDuty(row, 'Organisation'), 'JNV');
    assert.equal(atDuty(row, 'Tagesart'), '', 'the plan prints no day qualifier');
  }
});

test('C: the hardening warnings are projected as neutral import hints', { skip }, async () => {
  const built = await projection();
  const codes = built.warnings.reduce((map, warning) => {
    map[warning.code] = (map[warning.code] || 0) + 1; return map;
  }, {});
  assert.equal(codes.NON_TABULAR_ANNOTATION, 15, 'the 15 hardening annotations');
  assert.equal(codes.AMBIGUOUS_GENERIC_DUTY, 1, 'and the one ambiguous duty');
  assert.equal(built.statistics.warningCount, built.warnings.length);
  const hints = sheetOf(built, 'Importhinweise');
  assert.equal(hints.rows.length, built.warnings.length);
});

test('C: the confidence summary is exact for a plain printed row', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienstplan').rows;
  const plain = rows.find(row => at(row, 'Tätigkeit') === 'Wegezeit' && at(row, 'Umlauf') === '');
  assert.equal(at(plain, 'Quellenstatus'), 'exact');
  assert.equal(at(plain, 'Unsichere Felder'), '');
  const derived = rows.find(row => at(row, 'Linie') !== '');
  assert.equal(at(derived, 'Quellenstatus'), 'derived');
  assert.match(String(at(derived, 'Unsichere Felder')), /Linie/);
  for (const status of values(built, 'Dienstplan', 'Quellenstatus')) {
    assert.ok(['exact', 'derived', 'inconclusive'].includes(status), status);
  }
});

test('C: the cell statistics add up to the cells that were classified', { skip }, async () => {
  const built = await projection();
  const { exactCellCount, derivedCellCount, inconclusiveCellCount } = built.statistics;
  assert.ok(exactCellCount > 0 && derivedCellCount > 0);
  assert.equal(exactCellCount + derivedCellCount + inconclusiveCellCount,
    built.statistics.classifiedCellCount);
});
