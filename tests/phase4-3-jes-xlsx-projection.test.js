/**
 * Phase 4.3 (D) — the projection of the REAL JES Regionalbus plan.
 *
 * The JES plan is the harder case: it has no hardening layer, its circuit codes carry no line,
 * and it prints one duty number twice. None of that may be smoothed over.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const {
  buildDienstplanXlsxModel, DIENSTPLAN_COLUMNS, DIENSTE_COLUMNS, MODEL_WARNING_CODES
} = await import('../js/v2/export/dienstplan-xlsx-model.js');

const JES_PDF = '/Users/joergziegler/Downloads/20260713_Dienstübersicht_FDA.pdf';
const present = async (path) => { try { await access(path); return true; } catch { return false; } };
const skip = !(await present(JES_PDF)) && 'JES reference plan not present';

let cached = null;
let model = null;
let schedule = null;
const projection = async () => {
  if (!model) {
    cached ??= await readFile(JES_PDF);
    const bytes = new Uint8Array(cached);
    const result = await analyzePdfImport({ arrayBuffer: async () => bytes.buffer });
    schedule = result.canonicalSchedule;
    model = buildDienstplanXlsxModel(result);
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
// D — the real numbers
// =====================================================================================
test('D: the real JES plan projects to ready', { skip }, async () => {
  const built = await projection();
  assert.equal(built.status, 'ready');
  assert.equal(built.documentType, 'jes_schedule_pdf');
  assert.equal(built.organization, 'JES');
});

test('D: all 19 duty blocks are kept — none is merged away', { skip }, async () => {
  const built = await projection();
  assert.equal(schedule.services.length, 19, 'the parser produced 19 blocks');
  assert.equal(sheetOf(built, 'Dienste').rows.length, 19, 'and the sheet keeps all 19');
  assert.equal(built.statistics.serviceCount, 19);
});

test('D: the duplicate duty number 757 stays visible as two separate rows', { skip }, async () => {
  const built = await projection();
  const numbers = values(built, 'Dienste', 'Dienstnummer');
  assert.equal(numbers.length, 19);
  assert.equal(new Set(numbers).size, 18, 'eighteen distinct numbers across nineteen blocks');
  assert.equal(numbers.filter(value => value === '757').length, 2);

  // The two blocks are genuinely different — merging them would destroy data.
  const rows = sheetOf(built, 'Dienste').rows.filter(row => atDuty(row, 'Dienstnummer') === '757');
  assert.equal(atDuty(rows[0], 'Beginn'), atDuty(rows[1], 'Beginn'), 'same start …');
  assert.notEqual(atDuty(rows[0], 'Ende'), atDuty(rows[1], 'Ende'), '… but a different end');
  assert.notEqual(atDuty(rows[0], 'Bezahlte Zeit'), atDuty(rows[1], 'Bezahlte Zeit'));
  assert.deepEqual([atDuty(rows[0], 'Ende'), atDuty(rows[1], 'Ende')].sort(), ['12:51', '13:05']);
});

test('D: the duplicate produces a structured warning, once', { skip }, async () => {
  const built = await projection();
  const duplicates = built.warnings.filter(w => w.code === MODEL_WARNING_CODES.DIENSTNUMMER_MEHRFACH);
  assert.equal(duplicates.length, 1, 'reported once for the number, not once per block');
  assert.equal(duplicates[0].serviceNumber, '757');
  assert.equal(duplicates[0].scope, 'Dienste');
  assert.ok(duplicates[0].message.length > 0);
  assert.ok(!duplicates[0].message.includes('/'), 'no path in the message');
  const hints = sheetOf(built, 'Importhinweise').rows.filter(row => row[0] === MODEL_WARNING_CODES.DIENSTNUMMER_MEHRFACH);
  assert.equal(hints.length, 1);
  assert.equal(hints[0][3], '757');
});

test('D: the four-digit JES circuit codes never produce a line', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienstplan').rows;
  const withCircuit = rows.filter(row => at(row, 'Umlauf') !== '');
  assert.ok(withCircuit.length > 0, 'the plan does print circuit codes');
  assert.ok(withCircuit.some(row => /^\d{4}$/.test(String(at(row, 'Umlauf')))), 'four digits, e.g. 7511');
  for (const row of rows) {
    assert.equal(at(row, 'Linie'), '', 'no line may be derived from a JES circuit code');
  }
  assert.equal(values(built, 'Dienstplan', 'Linie').filter(Boolean).length, 0);
});

test('D: the circuit code is carried through unchanged, not reformatted', { skip }, async () => {
  const built = await projection();
  const printed = new Set(schedule.activities.map(a => String(a.circuitNumber || '').trim()).filter(Boolean));
  const projected = new Set(values(built, 'Dienstplan', 'Umlauf').filter(Boolean).map(String));
  for (const code of projected) assert.ok(printed.has(code), `${code} was not printed like that`);
  assert.ok(projected.has('7511'));
});

test('D: the classified rows reach the Dienstplan sheet', { skip }, async () => {
  const built = await projection();
  // 139 activity rows = 127 activities + 4 interruption lines + 8 fragment rows.
  assert.equal(sheetOf(built, 'Dienstplan').rows.length, 131, '127 activities + 4 interruptions');
  assert.equal(built.statistics.activityCount, 131);
  const dropped = built.warnings.filter(w => w.code === MODEL_WARNING_CODES.ZEILE_NICHT_ZUGEORDNET);
  assert.equal(dropped.length, 8, 'the eight unassignable fragment rows are reported');
});

test('D: the four Dienstunterbrechungen are kept', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienstplan').rows.filter(row => at(row, 'Tätigkeit') === 'Dienstunterbrechung');
  assert.equal(rows.length, 4);
  assert.equal(at(rows[0], 'Beginn'), '09:09');
  assert.equal(at(rows[0], 'Ende'), '13:07');
  assert.equal(at(rows[0], 'Pause/Unterbrechung'), 'Unterbrechung 09:09–13:07');
});

test('D: all 19 duties carry begin, end and paid time', { skip }, async () => {
  const built = await projection();
  const rows = sheetOf(built, 'Dienste').rows;
  assert.equal(rows.filter(row => atDuty(row, 'Beginn') !== '').length, 19);
  assert.equal(rows.filter(row => atDuty(row, 'Ende') !== '').length, 19);
  assert.equal(rows.filter(row => atDuty(row, 'Bezahlte Zeit') !== '').length, 19);
  for (const row of rows) {
    assert.equal(atDuty(row, 'Dokumenttyp'), 'jes_schedule_pdf');
    assert.equal(atDuty(row, 'Organisation'), 'JES');
  }
});

test('D: no JNV-only field is invented for a JES plan', { skip }, async () => {
  const built = await projection();
  assert.equal('hardened' in schedule, false, 'the JES schedule really has no hardening');
  for (const row of sheetOf(built, 'Dienstplan').rows) {
    assert.equal(at(row, 'Richtung'), '');
    assert.equal(at(row, 'Vorheriger Dienst'), '');
    assert.equal(at(row, 'Nachfolgender Dienst'), '');
    assert.ok(!String(at(row, 'Ende')).includes('(+1)'),
      'without hardening no day change may be claimed for JES');
  }
});

test('D: this plan needs no day-change warning — none of its duties jumps backwards', { skip }, async () => {
  const built = await projection();
  const backwards = schedule.services.filter(s =>
    s.begin?.minutesSinceStartOfDay !== null && s.end?.minutesSinceStartOfDay !== null
    && s.end.minutesSinceStartOfDay < s.begin.minutesSinceStartOfDay);
  assert.equal(backwards.length, 0, 'measured, not assumed');
  assert.equal(built.warnings.filter(w => w.code === MODEL_WARNING_CODES.TAGESWECHSEL_UNBESTIMMT).length, 0);
});

test('D: the page-break question is answered by the data, not by a guess', { skip }, async () => {
  // Both 757 blocks sit on the SAME page — so this is not a duty split across a page break.
  const blocks = schedule.services.filter(s => String(s.serviceNumber).trim() === '757');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].source.pageNumber, blocks[1].source.pageNumber, 'same page');
  assert.notEqual(blocks[0].source.tableIndex, blocks[1].source.tableIndex, 'two separate tables');
  const built = await projection();
  const pages = sheetOf(built, 'Dienstplan').rows
    .filter(row => at(row, 'Dienstnummer') === '757')
    .map(row => at(row, 'Seite'));
  assert.equal(new Set(pages).size, 1, 'and every one of their rows names that one page');
});

test('D: places are trimmed and nothing else', { skip }, async () => {
  const built = await projection();
  for (const place of values(built, 'Dienstplan', 'Anfangsort')) {
    assert.doesNotMatch(String(place), /^\s|\s$/);
  }
  const rows = sheetOf(built, 'Dienstplan').rows;
  assert.ok(rows.some(row => at(row, 'Anfangsort') === 'Betriebshof Jena-Burgau'));
});

test('D: the JES activity vocabulary survives unchanged', { skip }, async () => {
  const built = await projection();
  const verbs = new Set(values(built, 'Dienstplan', 'Tätigkeit').map(String));
  for (const verb of ['Dienst', 'Pause', 'Vorbereitungszeit JES', 'Nachbereitungszeit JES']) {
    assert.ok(verbs.has(verb), `${verb} must be carried through`);
  }
});
