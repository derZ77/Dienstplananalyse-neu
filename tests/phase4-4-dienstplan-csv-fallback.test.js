/**
 * Phase 4.4 (G) — the CSV fallback.
 *
 * CSV is the honest second best: a flat format cannot carry three sheets, so it carries them one
 * after another behind a section marker. What it must NOT lose is a single value, a single umlaut
 * or the formula guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { buildDienstplanXlsxModel, DIENSTPLAN_COLUMNS } = await import('../js/v2/export/dienstplan-xlsx-model.js');
const { createDienstplanCsv, writeDienstplanXlsx, CSV_SECTION_PREFIX, EXPORT_FORMATS } =
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

const JNV_PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
const present = async (path) => { try { await access(path); return true; } catch { return false; } };
const skip = !(await present(JNV_PDF)) && 'JNV reference plan not present';

let cached = null;
const realModel = async () => {
  if (!cached) {
    const bytes = new Uint8Array(await readFile(JNV_PDF));
    cached = buildDienstplanXlsxModel(await analyzePdfImport({ arrayBuffer: async () => bytes.buffer }));
  }
  return cached;
};
/** The bytes decoded WITHOUT stripping the BOM, so the BOM stays visible to the assertions. */
const decode = (bytes) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

// =====================================================================================
// G — the CSV contract
// =====================================================================================
test('G: the CSV starts with a real BOM — checked on the bytes', { skip }, async () => {
  const result = createDienstplanCsv(await realModel(), { now: DAY });
  assert.equal(result.status, 'ready');
  assert.equal(result.format, EXPORT_FORMATS.CSV);
  assert.equal(result.fileName, 'JNV-Dienstplan-Export-2026-08-04.csv');
  assert.match(result.mimeType, /text\/csv/);
  // A plain TextDecoder would silently swallow the BOM, so the raw bytes decide.
  assert.deepEqual([...result.bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
});

test('G: it carries the three sections, in the sheet order', { skip }, async () => {
  // The BOM is the first character of the first line, so it is removed before the lines are read.
  const csv = decode(createDienstplanCsv(await realModel(), { now: DAY }).bytes).replace(/^﻿/, '');
  const markers = [...csv.matchAll(new RegExp(`^${CSV_SECTION_PREFIX}(.+)$`, 'gm'))].map(match => match[1].trim());
  assert.deepEqual(markers, ['Dienstplan', 'Dienste', 'Importhinweise']);
  assert.ok(csv.indexOf(`${CSV_SECTION_PREFIX}Dienstplan`) < csv.indexOf(`${CSV_SECTION_PREFIX}Dienste`));
  assert.ok(csv.indexOf(`${CSV_SECTION_PREFIX}Dienste`) < csv.indexOf(`${CSV_SECTION_PREFIX}Importhinweise`));
});

test('G: every data line is semicolon separated and fully quoted', { skip }, async () => {
  const csv = decode(createDienstplanCsv(await realModel(), { now: DAY }).bytes).replace(/^﻿/, '');
  const lines = csv.split('\r\n').filter(Boolean);
  const dataLines = lines.filter(line => !line.startsWith(CSV_SECTION_PREFIX));
  assert.ok(dataLines.length > 700, 'all three sheets are in there');
  for (const line of dataLines) {
    assert.match(line, /^"(?:[^"]|"")*"(?:;"(?:[^"]|"")*")*$/, `not properly quoted: ${line.slice(0, 70)}`);
  }
  assert.ok(dataLines[0].startsWith('"Dienstnummer";"Zeile";'), 'the header of the first sheet');
});

test('G: a quote inside a value is doubled, and a line break stays inside the quotes', { skip }, async () => {
  const model = await realModel();
  const poisoned = { ...model, sheets: model.sheets.map((sheet, index) => index !== 0 ? sheet : {
    ...sheet, rows: [['Er sagte "halt"', 1, '', '', 'Zeile1\nZeile2', '03:15', 'Ort', '', '12:15', 'Ort',
      '', '', '03:15', '12:15', '09:00', '', 'exact', '', 1]]
  }) };
  const csv = decode(createDienstplanCsv(poisoned, { now: DAY }).bytes);
  assert.ok(csv.includes('""halt""'), 'the inner quote is doubled');
  assert.ok(csv.includes('"Zeile1\nZeile2"'), 'the line break stays inside the field');
});

test('G: German umlauts survive', { skip }, async () => {
  const csv = decode(createDienstplanCsv(await realModel(), { now: DAY }).bytes);
  assert.ok(csv.includes('Tätigkeit'), 'the column heading');
  assert.ok(csv.includes('Pause/Unterbrechung'));
  assert.ok(csv.includes('Löbdergraben') || csv.includes('Bth. Burgau'), 'and the real place names');
});

test('G: the formula guard is untouched by the CSV writer', { skip }, async () => {
  const model = await realModel();
  const poisoned = { ...model, sheets: model.sheets.map((sheet, index) => index !== 0 ? sheet : {
    ...sheet, rows: [["'=cmd|calc", 1, '', '', "'+Dienst", '03:15', "'-Ort", '', '12:15', "'@Ziel",
      '', '', '03:15', '12:15', '09:00', '', 'exact', '', 1]]
  }) };
  const csv = decode(createDienstplanCsv(poisoned, { now: DAY }).bytes).replace(/^﻿/, '');
  for (const line of csv.split('\r\n').filter(line => line && !line.startsWith(CSV_SECTION_PREFIX))) {
    for (const field of line.slice(1, -1).split('";"')) {
      assert.doesNotMatch(field, /^[=+\-@]/, `a field may not start a formula: ${field}`);
    }
  }
  assert.ok(csv.includes(`"'=cmd|calc"`), 'the prefix is kept, the value stays readable');
});

test('G: the section marker itself can never be read as a formula', () => {
  assert.doesNotMatch(CSV_SECTION_PREFIX, /^[=+\-@]/);
  assert.equal(CSV_SECTION_PREFIX, '### ');
});

// =====================================================================================
// G — the CSV says the same as the XLSX
// =====================================================================================
test('G: every value of every sheet appears in the CSV, unchanged', { skip }, async () => {
  const model = await realModel();
  const csv = decode(createDienstplanCsv(model, { now: DAY }).bytes).replace(/^﻿/, '');
  const blocks = csv.split(`${CSV_SECTION_PREFIX}`).slice(1);
  assert.equal(blocks.length, 3);

  for (const [index, sheet] of model.sheets.entries()) {
    const lines = blocks[index].split('\r\n').slice(1).filter(Boolean);
    assert.equal(lines.length, sheet.rows.length + 1, `${sheet.name}: header + all rows`);
    const cells = (line) => line.slice(1, -1).split('";"').map(value => value.replace(/""/g, '"'));
    assert.deepEqual(cells(lines[0]), [...sheet.columns], `${sheet.name}: the header`);
    for (const position of [0, Math.floor(sheet.rows.length / 2), sheet.rows.length - 1]) {
      assert.deepEqual(cells(lines[position + 1]), sheet.rows[position].map(String),
        `${sheet.name}: row ${position + 1}`);
    }
  }
});

test('G: a day change reads the same in CSV as in XLSX', { skip }, async () => {
  const model = await realModel();
  const csv = decode(createDienstplanCsv(model, { now: DAY }).bytes);
  assert.ok(csv.includes('"00:57 (+1)"'), 'the day change is spelled out, not normalised away');

  const book = XLSX.read(writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY }).bytes, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(book.Sheets.Dienste, { header: 1, defval: null });
  const fromXlsx = Array.from(rows).slice(1).map(row => Array.from(row)[2]);
  const rolled = fromXlsx.filter(value => String(value).includes('(+1)'));
  assert.equal(rolled.length, 6);
  for (const value of rolled) assert.ok(csv.includes(`"${value}"`), `${value} must be in the CSV too`);
});

test('G: the CSV carries no path, no source name and no raw line', { skip }, async () => {
  const csv = decode(createDienstplanCsv(await realModel(), { now: DAY }).bytes);
  for (const forbidden of ['/Users/', '.pdf', 'Downloads', 'boundingBox', 'rawCells']) {
    assert.ok(!csv.includes(forbidden), forbidden);
  }
});

test('G: a refused model produces no CSV either', () => {
  const model = buildDienstplanXlsxModel({ documentType: 'umlaufkarte', canonicalSchedule: null });
  const result = createDienstplanCsv(model, { now: DAY });
  assert.equal(result.status, 'not_applicable');
  assert.equal(result.bytes, null);
  assert.equal(result.fileName, null);
});

test('G: an explicit CSV choice is not reported as a fallback', { skip }, async () => {
  const clean = createDienstplanCsv(await realModel(), { now: DAY });
  assert.deepEqual(clean.warnings, [], 'choosing CSV on purpose is not a failure');
  const fallback = writeDienstplanXlsx(await realModel(), { xlsx: null, now: DAY });
  assert.equal(fallback.format, 'csv');
  assert.ok(fallback.warnings.length >= 1, 'a missing library IS worth saying');
});
