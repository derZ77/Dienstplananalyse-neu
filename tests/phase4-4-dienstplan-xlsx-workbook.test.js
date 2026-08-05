import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 4.4 (B/C/H) — the workbook itself, read back with the same vendored SheetJS, and on the
 * two real plans.
 *
 * The decisive property is that a time keeps its meaning: Phase 4.3 writes `00:57 (+1)` because a
 * bare `00:57` would silently claim the duty ended before it began. The writer must not undo that
 * by handing the value to a date parser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { buildDienstplanXlsxModel, DIENSTPLAN_COLUMNS, DIENSTE_COLUMNS, IMPORTHINWEISE_COLUMNS } =
  await import('../js/v2/export/dienstplan-xlsx-model.js');
const { createDienstplanWorkbook, writeDienstplanXlsx, COLUMN_WIDTH_LIMITS } =
  await import('../js/v2/export/dienstplan-xlsx-export.js');

const loadXlsx = () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.XLSX;
};
const XLSX = loadXlsx();
const DAY = new Date(Date.UTC(2026, 7, 4, 9, 30));
const own = (rows) => Array.from(rows, entry => Array.isArray(entry) ? Array.from(entry) : entry);

const JNV_PDF = FIXTURES.jnvSchedulePdf;
const JES_PDF = FIXTURES.jesSchedulePdf;
const present = async (path) => { try { await access(path); return true; } catch { return false; } };
const skipJnv = !(await present(JNV_PDF)) && 'JNV reference plan not present';
const skipJes = !(await present(JES_PDF)) && 'JES reference plan not present';

const cache = new Map();
const realModel = async (path) => {
  if (!cache.has(path)) {
    const bytes = new Uint8Array(await readFile(path));
    cache.set(path, buildDienstplanXlsxModel(await analyzePdfImport({ arrayBuffer: async () => bytes.buffer })));
  }
  return cache.get(path);
};
const readBack = (result) => XLSX.read(result.bytes, { type: 'array' });
const rowsOf = (book, name) => own(XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null }));
const cellsOf = (sheet) => Object.keys(sheet).filter(key => !key.startsWith('!')).map(key => sheet[key]);

// =====================================================================================
// B — the workbook
// =====================================================================================
test('B: the bytes are a real XLSX and can be read back', { skip: skipJnv }, async () => {
  const result = writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY });
  assert.equal(result.status, 'ready');
  assert.equal(result.bytes[0], 0x50, 'a ZIP container starts with PK');
  assert.equal(result.bytes[1], 0x4B);
  assert.doesNotThrow(() => readBack(result));
});

test('B: the workbook carries the three sheets, in the model order', { skip: skipJnv }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY }));
  assert.deepEqual([...book.SheetNames], ['Dienstplan', 'Dienste', 'Importhinweise']);
});

test('B: the first row of every sheet is its column contract', { skip: skipJnv }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY }));
  assert.deepEqual(rowsOf(book, 'Dienstplan')[0], [...DIENSTPLAN_COLUMNS]);
  assert.deepEqual(rowsOf(book, 'Dienste')[0], [...DIENSTE_COLUMNS]);
  assert.deepEqual(rowsOf(book, 'Importhinweise')[0], [...IMPORTHINWEISE_COLUMNS]);
});

test('B: the data rows arrive complete and in order', { skip: skipJnv }, async () => {
  const model = await realModel(JNV_PDF);
  const book = readBack(writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY }));
  for (const sheet of model.sheets) {
    const back = rowsOf(book, sheet.name);
    assert.equal(back.length, sheet.rows.length + 1, `${sheet.name}: header + ${sheet.rows.length} rows`);
    // First and last data row survive byte-identically once empty cells are compared as blanks.
    for (const index of [0, sheet.rows.length - 1]) {
      const expected = sheet.rows[index].map(value => value === '' ? null : value);
      assert.deepEqual(back[index + 1], expected, `${sheet.name} row ${index + 1}`);
    }
  }
});

test('B: cell types are preserved — numbers stay numbers, text stays text', { skip: skipJnv }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY }));
  const sheet = book.Sheets.Dienstplan;
  const ordinal = XLSX.utils.encode_cell({ r: 1, c: DIENSTPLAN_COLUMNS.indexOf('Zeile') });
  const page = XLSX.utils.encode_cell({ r: 1, c: DIENSTPLAN_COLUMNS.indexOf('Seite') });
  const duty = XLSX.utils.encode_cell({ r: 1, c: DIENSTPLAN_COLUMNS.indexOf('Dienstnummer') });
  assert.equal(sheet[ordinal].t, 'n', 'Zeile is a number');
  assert.equal(sheet[page].t, 'n', 'Seite is a number');
  assert.equal(sheet[duty].t, 's', 'the duty number is text — it is an identifier, not a quantity');
});

test('B: an empty model value becomes a truly empty cell, not the word "null"', { skip: skipJnv }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY }));
  const sheet = book.Sheets.Dienstplan;
  const direction = XLSX.utils.encode_cell({ r: 1, c: DIENSTPLAN_COLUMNS.indexOf('Richtung') });
  assert.equal(sheet[direction], undefined, 'Richtung has no source, so it has no cell');
  for (const cell of cellsOf(sheet)) {
    assert.ok(!['null', 'undefined', 'NaN'].includes(String(cell.v)), String(cell.v));
  }
});

test('B: a sheet without data rows still carries its header', { skip: skipJes }, async () => {
  // Both real plans do produce hints, so the empty case is built explicitly.
  const model = await realModel(JES_PDF);
  const empty = { ...model, sheets: model.sheets.map(s => s.name === 'Importhinweise' ? { ...s, rows: [] } : s) };
  const book = readBack(writeDienstplanXlsx(empty, { xlsx: XLSX, now: DAY }));
  assert.deepEqual([...book.SheetNames], ['Dienstplan', 'Dienste', 'Importhinweise']);
  assert.deepEqual(rowsOf(book, 'Importhinweise'), [[...IMPORTHINWEISE_COLUMNS]]);
});

test('B: no cell in any sheet is a formula', { skip: skipJnv }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY }));
  for (const name of [...book.SheetNames]) {
    for (const cell of cellsOf(book.Sheets[name])) {
      assert.equal(cell.f, undefined, `${name}: a formula cell must never exist`);
      assert.notEqual(cell.t, 'e', `${name}: no error cell`);
    }
  }
});

test('B: the apostrophe guard survives into the file', { skip: skipJnv }, async () => {
  const model = await realModel(JNV_PDF);
  const poisoned = {
    ...model,
    sheets: model.sheets.map(sheet => sheet.name !== 'Dienstplan' ? sheet : {
      ...sheet,
      rows: [["'=cmd|calc", 1, '', '', "'+Dienst", '03:15', "'-Bth. Burgau", '', '12:15', "'@Ort",
        '', '', '03:15', '12:15', '09:00', '', 'exact', '', 1], ...sheet.rows]
    })
  };
  const book = readBack(writeDienstplanXlsx(poisoned, { xlsx: XLSX, now: DAY }));
  const row = rowsOf(book, 'Dienstplan')[1];
  assert.equal(row[0], "'=cmd|calc", 'the prefix is still there');
  for (const name of [...book.SheetNames]) {
    for (const cell of cellsOf(book.Sheets[name])) {
      if (cell.t === 's') assert.doesNotMatch(String(cell.v), /^[=+\-@]/, `${name}: ${cell.v}`);
    }
  }
});

// =====================================================================================
// Column widths
// =====================================================================================
test('B: every sheet gets deterministic column widths, one per column', { skip: skipJnv }, async () => {
  const model = await realModel(JNV_PDF);
  const workbook = createDienstplanWorkbook(model, { xlsx: XLSX });
  for (const sheet of model.sheets) {
    const cols = workbook.Sheets[sheet.name]['!cols'];
    assert.ok(Array.isArray(cols), `${sheet.name}: widths are set`);
    assert.equal(cols.length, sheet.columns.length, `${sheet.name}: one width per column`);
    for (const entry of cols) {
      assert.equal(typeof entry.wch, 'number');
      assert.ok(entry.wch >= COLUMN_WIDTH_LIMITS.min, `${sheet.name}: at least ${COLUMN_WIDTH_LIMITS.min}`);
      assert.ok(entry.wch <= COLUMN_WIDTH_LIMITS.max, `${sheet.name}: at most ${COLUMN_WIDTH_LIMITS.max}`);
      assert.equal(entry.wch, Math.round(entry.wch), 'whole characters — no float drift');
    }
  }
});

test('B: the widths are reproducible and depend only on the data', { skip: skipJnv }, async () => {
  const model = await realModel(JNV_PDF);
  const first = createDienstplanWorkbook(model, { xlsx: XLSX }).Sheets.Dienstplan['!cols'];
  const second = createDienstplanWorkbook(model, { xlsx: XLSX }).Sheets.Dienstplan['!cols'];
  assert.deepEqual(first, second);
  const module = readFileSync(new URL('../js/v2/export/dienstplan-xlsx-export.js', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /document\.createElement\('canvas'\)|measureText|getComputedStyle/,
    'widths are computed from character counts, never from a rendering engine');
});

// =====================================================================================
// C — the times
// =====================================================================================
test('C: a plain time stays text and is not turned into a date', { skip: skipJnv }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY }));
  const sheet = book.Sheets.Dienstplan;
  const begin = XLSX.utils.encode_cell({ r: 1, c: DIENSTPLAN_COLUMNS.indexOf('Beginn') });
  assert.equal(sheet[begin].t, 's', 'a time is text');
  assert.equal(sheet[begin].v, '03:15');
  assert.equal(sheet[begin].z, undefined, 'and carries no date format');
  for (const cell of cellsOf(sheet)) assert.notEqual(cell.t, 'd', 'no date cell anywhere');
});

test('C: a day change survives the file exactly as written', { skip: skipJnv }, async () => {
  const model = await realModel(JNV_PDF);
  const book = readBack(writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY }));
  const rows = rowsOf(book, 'Dienste');
  const endIndex = DIENSTE_COLUMNS.indexOf('Ende');
  const rolled = rows.slice(1).filter(row => String(row[endIndex]).includes('(+1)'));
  assert.equal(rolled.length, 6, 'six duties end on the next day');
  const sample = rolled.find(row => row[0] === '2189');
  assert.equal(sample[endIndex], '00:57 (+1)', 'never a silent modulo-24 loss');
  assert.equal(sample[DIENSTE_COLUMNS.indexOf('Beginn')], '15:27');
});

test('C: the written times equal the model times, character for character', { skip: skipJnv }, async () => {
  const model = await realModel(JNV_PDF);
  const book = readBack(writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY }));
  const back = rowsOf(book, 'Dienstplan');
  for (const heading of ['Beginn', 'Ende', 'Dienstbeginn', 'Dienstende', 'Bezahlte Zeit']) {
    const index = DIENSTPLAN_COLUMNS.indexOf(heading);
    for (const [row, expected] of model.sheets[0].rows.entries()) {
      const wanted = expected[index] === '' ? null : expected[index];
      assert.deepEqual(back[row + 1][index], wanted, `${heading} in row ${row + 1}`);
    }
  }
});

// =====================================================================================
// Metadata
// =====================================================================================
test('B: the workbook metadata is sparse and carries nothing personal', { skip: skipJnv }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY }));
  assert.equal(book.Props.Title, 'Dienstplan-Export');
  assert.equal(book.Props.Company, 'JNV');
  const serialised = JSON.stringify(book.Props);
  for (const forbidden of ['/User' + 's/', '.pdf', 'joergziegler', '@', 'Down' + 'loads']) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} must not be in the metadata`);
  }
  assert.equal(book.Props.CreatedDate, undefined, 'no precise working-time stamp is written');
});

// =====================================================================================
// H — real data
// =====================================================================================
test('H: the real JNV plan writes 641 / 62 / 31 data rows', { skip: skipJnv }, async () => {
  const result = writeDienstplanXlsx(await realModel(JNV_PDF), { xlsx: XLSX, now: DAY });
  assert.equal(result.fileName, 'JNV-Dienstplan-Export-2026-08-04.xlsx');
  const book = readBack(result);
  assert.equal(rowsOf(book, 'Dienstplan').length - 1, 641);
  assert.equal(rowsOf(book, 'Dienste').length - 1, 62);
  assert.equal(rowsOf(book, 'Importhinweise').length - 1, 31);
  const lineIndex = DIENSTPLAN_COLUMNS.indexOf('Linie');
  assert.equal(rowsOf(book, 'Dienstplan').slice(1).filter(row => row[lineIndex]).length, 173);
});

test('H: the real JES plan writes 131 / 19 / 9 data rows and keeps the duplicate', { skip: skipJes }, async () => {
  const result = writeDienstplanXlsx(await realModel(JES_PDF), { xlsx: XLSX, now: DAY });
  assert.equal(result.fileName, 'JES-Dienstplan-Export-2026-08-04.xlsx');
  const book = readBack(result);
  assert.equal(rowsOf(book, 'Dienstplan').length - 1, 131);
  assert.equal(rowsOf(book, 'Dienste').length - 1, 19);
  assert.equal(rowsOf(book, 'Importhinweise').length - 1, 9);

  const numbers = rowsOf(book, 'Dienste').slice(1).map(row => row[0]);
  assert.equal(numbers.length, 19);
  assert.equal(new Set(numbers).size, 18, 'the duplicate duty number survives into the file');
  assert.equal(numbers.filter(value => value === '757').length, 2);
  assert.ok(rowsOf(book, 'Importhinweise').slice(1).some(row => row[0] === 'DIENSTNUMMER_MEHRFACH'));
});

test('H: the JES file derives no line and claims no day change', { skip: skipJes }, async () => {
  const book = readBack(writeDienstplanXlsx(await realModel(JES_PDF), { xlsx: XLSX, now: DAY }));
  const lineIndex = DIENSTPLAN_COLUMNS.indexOf('Linie');
  for (const row of rowsOf(book, 'Dienstplan').slice(1)) {
    assert.ok(row[lineIndex] === null || row[lineIndex] === '', 'no line for a four-digit JES code');
  }
  for (const row of rowsOf(book, 'Dienste').slice(1)) {
    assert.ok(!String(row[DIENSTE_COLUMNS.indexOf('Ende')]).includes('(+1)'));
  }
});

test('H: no path and no source document name reaches either real file', async () => {
  for (const [path, skip] of [[JNV_PDF, skipJnv], [JES_PDF, skipJes]]) {
    if (skip) continue;
    const result = writeDienstplanXlsx(await realModel(path), { xlsx: XLSX, now: DAY });
    const book = readBack(result);
    for (const name of [...book.SheetNames]) {
      for (const cell of cellsOf(book.Sheets[name])) {
        const value = String(cell.v);
        assert.ok(!value.includes('/User' + 's/') && !value.includes('.pdf'), `${name}: ${value}`);
      }
    }
    assert.ok(!JSON.stringify(book.Props).includes('/'), 'and not in the metadata either');
  }
});
