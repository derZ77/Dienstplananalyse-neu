/**
 * Phase 3I.36 (D/F/G) — the export FILE, on synthetic and on real data.
 *
 * The workbook is written with the SheetJS build the app already vendors — no new dependency, no
 * network. The download happens purely in the browser and is injected here so it can be observed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { createReportExportFile, downloadReportExport, EXPORT_FORMATS } from '../js/v2/report/check-report-export.js';
import { buildCheckReportExportModel } from '../js/v2/report/check-report-export-model.js';
import { buildCheckReportViewModel, deriveReportContext } from '../js/v2/report/check-report-view-model.js';
import { createBv003Check } from '../js/v2/checks/bv/bv003.js';
import { createBv010Check } from '../js/v2/checks/bv/bv010.js';
import { createBv012Check } from '../js/v2/checks/bv/bv012.js';
import { createBv014Check } from '../js/v2/checks/bv/bv014.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DAY = new Date(Date.UTC(2026, 7, 3, 9, 30));
const analysisResult = { type: 'AnalysisResult' };

/** The very SheetJS build index.html loads — vendored, offline, no install. */
const loadXlsx = () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.XLSX;
};
const XLSX = loadXlsx();
/** Copies a sandbox array (and its rows) into this realm so assert/strict can compare it. */
const own = (rows) => Array.from(rows, entry => Array.isArray(entry) ? Array.from(entry) : entry);
/** Reads one sheet back as plain rows of this realm. */
const sheetRows = (book, name) => own(XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1 }));

const result = (id, status, severity, extra = {}) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity, message: `${id} Meldung`,
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: [], ...extra
});
const report = (results = [result('BV003', 'FAIL', 'WARNING'), result('BV010', 'PASS', 'INFO')]) => ({
  type: 'CheckReport', results, errors: [], summary: { resultCount: results.length, hitCount: 1 }
});
const exportModel = (rep = report(), options = {}) =>
  buildCheckReportExportModel(buildCheckReportViewModel(rep, options), { now: DAY });

// =====================================================================================
// D — the file
// =====================================================================================
test('D: an XLSX file is produced with the vendored library and no new dependency', () => {
  const file = createReportExportFile(exportModel(), { xlsx: XLSX });
  assert.equal(file.ok, true);
  assert.equal(file.format, EXPORT_FORMATS.XLSX);
  assert.equal(file.fileName, 'JNV-Pruefbericht-2026-08-03.xlsx'.replace('JNV', 'Dienstplan'));
  assert.match(file.mimeType, /spreadsheetml/);
  assert.ok(file.data instanceof Uint8Array && file.data.length > 0);
  const module = src('../js/v2/report/check-report-export.js');
  assert.doesNotMatch(module, /import .* from ['"](?!\.)/, 'no bare module specifier — nothing installed');
});

test('D: the workbook really carries the four sheets and can be read back', () => {
  const file = createReportExportFile(exportModel(), { xlsx: XLSX });
  const book = XLSX.read(file.data, { type: 'array' });
  assert.deepEqual([...book.SheetNames],
    ['Zusammenfassung', 'Regelergebnisse', 'Betroffene Dienste', 'Technische Fehler']);
  const rows = sheetRows(book, 'Regelergebnisse');
  assert.equal(rows[0][1], 'Regel-ID');
  assert.deepEqual(rows.slice(1).map(row => row[1]), ['BV003', 'BV010']);
});

test('D: German umlauts survive the round trip', () => {
  const file = createReportExportFile(
    exportModel(report([result('BV003', 'FAIL', 'WARNING', { message: 'Löbdergraben, Ankunftsort geändert' })])),
    { xlsx: XLSX });
  const book = XLSX.read(file.data, { type: 'array' });
  const rows = sheetRows(book, 'Regelergebnisse');
  assert.ok(rows[1].some(cell => String(cell).includes('Löbdergraben')));
});

test('D: a formula-looking cell arrives neutralised in the file', () => {
  const file = createReportExportFile(exportModel(report([result('=cmd|calc', 'FAIL', 'WARNING')])), { xlsx: XLSX });
  const book = XLSX.read(file.data, { type: 'array' });
  const rows = sheetRows(book, 'Regelergebnisse');
  assert.equal(rows[1][1], "'=cmd|calc");
  for (const sheetName of [...book.SheetNames]) {
    for (const cell of sheetRows(book, sheetName).flat()) {
      assert.ok(!/^[=+\-@]/.test(String(cell)), `${sheetName}: ${cell}`);
    }
  }
});

test('D: a CSV fallback is available and correctly formed', () => {
  const file = createReportExportFile(exportModel(), { format: EXPORT_FORMATS.CSV });
  assert.equal(file.ok, true);
  assert.equal(file.fileName, 'Dienstplan-Pruefbericht-2026-08-03.csv');
  // The BOM is checked on the BYTES: a plain TextDecoder silently strips it again.
  assert.deepEqual([...file.data.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'a BOM so Excel reads UTF-8');
  const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.data);
  assert.ok(csv.includes(';'), 'semicolon separated');
  assert.ok(csv.includes('"Regel-ID"'), 'cells are quoted');
  for (const line of csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)) {
    assert.match(line, /^"(?:[^"]|"")*"(?:;"(?:[^"]|"")*")*$/, `every field is quoted: ${line.slice(0, 60)}`);
  }
});

test('D: the CSV escapes quotes and neutralises formulas too', () => {
  const file = createReportExportFile(
    exportModel(report([result('BV003', 'FAIL', 'WARNING', { message: 'Er sagte "halt" =1+1' })])),
    { format: EXPORT_FORMATS.CSV });
  const csv = new TextDecoder().decode(file.data);
  assert.ok(csv.includes('""halt""'), 'a quote inside a cell is doubled');
  assert.ok(!/;=1\+1/.test(csv));
});

test('D: without an XLSX library the export falls back rather than failing', () => {
  const file = createReportExportFile(exportModel(), { xlsx: null });
  assert.equal(file.ok, true);
  assert.equal(file.format, EXPORT_FORMATS.CSV);
  assert.equal(file.reason, 'XLSX_UNAVAILABLE');
});

test('D: an unexportable model yields a controlled refusal, never a throw', () => {
  const nothing = buildCheckReportExportModel(buildCheckReportViewModel(null), { now: DAY });
  const file = createReportExportFile(nothing, { xlsx: XLSX });
  assert.equal(file.ok, false);
  assert.equal(file.reason, 'NO_REPORT');
  assert.equal(file.data, null);
});

test('D: a broken library is caught and reported, not thrown', () => {
  const file = createReportExportFile(exportModel(), { xlsx: { utils: {}, write: () => { throw new Error('boom'); } } });
  assert.equal(file.ok, false);
  assert.equal(file.reason, 'EXPORT_FAILED');
  assert.ok(!JSON.stringify(file).includes('boom'), 'no internal message leaks');
});

test('D: the file name never carries a path or an original document name', () => {
  const file = createReportExportFile(
    exportModel(report(), { document: { organization: 'JNV', fileName: '/Users/x/plan.xlsx' } }), { xlsx: XLSX });
  assert.equal(file.fileName, 'JNV-Pruefbericht-2026-08-03.xlsx');
  assert.ok(!file.fileName.includes('/'));
  assert.ok(!file.fileName.includes('plan'));
});

test('D: the download happens locally and the object URL is released again', () => {
  const created = [];
  const revoked = [];
  const clicked = [];
  const anchor = { click() { clicked.push(this.download); } };
  const fakeDocument = {
    createElement: () => anchor,
    body: { appendChild() {}, removeChild() {} }
  };
  const fakeUrl = {
    createObjectURL: (blob) => { created.push(blob); return 'blob:local/1'; },
    revokeObjectURL: (url) => revoked.push(url)
  };
  const outcome = downloadReportExport(createReportExportFile(exportModel(), { xlsx: XLSX }), {
    document: fakeDocument, url: fakeUrl, blobFactory: (parts, options) => ({ parts, options })
  });
  assert.equal(outcome.applied, true);
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, ['blob:local/1'], 'the URL is released, nothing lingers');
  assert.deepEqual(clicked, ['Dienstplan-Pruefbericht-2026-08-03.xlsx']);
});

test('D: a refused file is not downloaded', () => {
  const nothing = createReportExportFile(buildCheckReportExportModel(buildCheckReportViewModel(null), { now: DAY }), { xlsx: XLSX });
  const outcome = downloadReportExport(nothing, { document: null, url: null });
  assert.equal(outcome.applied, false);
  assert.equal(outcome.reason, 'NO_REPORT');
});

test('D: the export module neither stores nor reaches the network', () => {
  const module = src('../js/v2/report/check-report-export.js');
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

// =====================================================================================
// F — real data
// =====================================================================================
const REAL_PLAN = '/Users/joergziegler/Downloads/Test/B_20260727_MoFrFerien.xlsx';
const available = (() => { try { readFileSync(REAL_PLAN); return true; } catch { return false; } })();

const realImport = async () => {
  const book = XLSX.read(readFileSync(REAL_PLAN), { type: 'buffer' });
  const workbook = {
    sheets: book.SheetNames.map(name => ({
      name,
      rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: null })
        .map(row => row.map(cell => cell === null ? '' : String(cell).trim()))
    }))
  };
  const { analyzeLegacyExcelWorkbook } = await import('../js/v2/import/legacy-excel-import-adapter.js');
  return analyzeLegacyExcelWorkbook(workbook, { sourceName: 'plan.xlsx' }).data;
};

const realExport = async () => {
  const canonicalSchedule = await realImport();
  const results = [];
  for (const id of ['bv001', 'bv002', 'bv003', 'bv005', 'bv007', 'bv010', 'bv012', 'bv014']) {
    const factory = Object.values(await import(`../js/v2/checks/bv/${id}.js`))[0];
    const outcome = await factory({ canonicalSchedule }).run(analysisResult);
    results.push(...(Array.isArray(outcome) ? outcome : [outcome]));
  }
  results.splice(7, 0, { id: 'BV008', name: 'BV008 Lenkzeitgrenze', category: 'BV', status: 'FAIL', severity: 'VIOLATION', message: 'Lenkzeitgrenze überschritten.', details: {}, affectedServices: [canonicalSchedule.services[0].id], affectedActivities: [], sourceReferences: [] });
  results.splice(9, 0, { id: 'BV015_BV018', name: 'BV015/BV018 Ein-Sechstel-Regel', category: 'BV', status: 'SKIP', severity: 'INFO', message: 'Regel ist nicht aktiviert.', details: { originalStatus: 'DISABLED' }, affectedServices: [], affectedActivities: [], sourceReferences: [] });

  const context = deriveReportContext({
    primaryImport: { documentType: 'legacy_excel_schedule', canonicalSchedule },
    matching: { validity: { scheduleDayType: 'mo_fr' } },
    ruleAnalysis: { ruleSet: { organization: 'JNV' } }
  });
  const view = buildCheckReportViewModel(
    { type: 'CheckReport', results, errors: [], summary: { resultCount: results.length, hitCount: 2 } },
    { canonicalSchedule, document: context.metadata, servicesEvaluated: context.metadata.serviceCount });
  return { view, model: buildCheckReportExportModel(view, { now: DAY }) };
};

test('F (real): the summary sheet matches the live display exactly', { skip: !available && 'reference plan not present' }, async () => {
  const { view, model } = await realExport();
  const values = new Map(model.sheets[0].rows.slice(1).map(row => [row[0], row[1]]));
  assert.equal(values.get('Organisation'), 'JNV');
  assert.equal(values.get('Dienste'), 61);
  assert.equal(values.get('Regelergebnisse'), 11);
  assert.equal(values.get('PASS'), 4);
  assert.equal(values.get('FAIL'), 2);
  assert.equal(values.get('SKIP'), 3);
  assert.equal(values.get('NOT_APPLICABLE'), 2);
  assert.equal(values.get('Technische Fehler'), 0);
  assert.equal(values.get('PASS'), view.summary.status.PASS, 'the export repeats the view, it does not recount');
});

test('F (real): BV003 exports 56 duty rows with relief information', { skip: !available && 'reference plan not present' }, async () => {
  const { model } = await realExport();
  const rows = model.sheets.find(s => s.name === 'Betroffene Dienste').rows.filter(row => row[0] === 'BV003');
  assert.equal(rows.length, 56);
  assert.ok(rows.every(row => row[2] === 'FAIL'), 'Variante B: unchanged');
  assert.ok(rows.every(row => row[8] === 'ja'), 'every one has a documented chain');
  assert.ok(rows.every(row => /nicht automatisch verändert/.test(row[9])));
});

test('F (real): the deactivated rule and the passing rules are exported correctly', { skip: !available && 'reference plan not present' }, async () => {
  const { model } = await realExport();
  const rows = model.sheets.find(s => s.name === 'Regelergebnisse').rows;
  assert.equal(rows.length, 12);
  const one = rows.find(row => row[1] === 'BV015_BV018');
  assert.equal(one[4], 'SKIP');
  assert.equal(one[8], 'DISABLED');
  for (const id of ['BV010', 'BV012', 'BV014']) {
    assert.equal(rows.find(row => row[1] === id)[4], 'PASS', id);
  }
});

test('F (real): the written file carries no path and no raw row', { skip: !available && 'reference plan not present' }, async () => {
  const { model } = await realExport();
  const file = createReportExportFile(model, { xlsx: XLSX });
  assert.equal(file.ok, true);
  const book = XLSX.read(file.data, { type: 'array' });
  const everything = [...book.SheetNames]
    .flatMap(name => sheetRows(book, name).flat())
    .map(String).join(' | ');
  assert.ok(!everything.includes('/Users/'));
  assert.ok(!everything.includes('.xlsx'));
  assert.ok(!everything.includes('MICROBUS'));
});

// =====================================================================================
// G — regression
// =====================================================================================
test('G: no rule, runner or import carries a change from this phase', () => {
  for (const path of ['../js/v2/checks/bv/bv001.js', '../js/v2/checks/bv/bv003.js', '../js/v2/checks/bv/bv010.js',
    '../js/v2/checks/bv/bv012.js', '../js/v2/checks/bv/bv014.js', '../js/v2/checks/check-runner.js',
    '../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/jnv-rule-analysis-controller.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/analysis/driving-projection.js', '../js/v2/excel/excel-canonical-adapter.js',
    '../js/v2/import/legacy-excel-import-adapter.js']) {
    assert.doesNotMatch(src(path), /3I\.36/, `${path} must be untouched`);
  }
});

test('G: the rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.parameters.activation.enabled.value, false);
});

test('G (real): the real numbers are unchanged by this phase', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  assert.equal(schedule.services.length, 61);
  assert.equal((await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult)).affectedServices.length, 56);
  for (const factory of [createBv010Check, createBv012Check, createBv014Check]) {
    assert.equal((await factory({ canonicalSchedule: schedule }).run(analysisResult)).status, 'PASS');
  }
});
