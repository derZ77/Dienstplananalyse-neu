/**
 * Phase 4.3 (A/B/E) — the contract of the pure XLSX projection model.
 *
 * The module reads a CanonicalSchedule and returns plain data. It writes no file, knows no
 * SheetJS, touches no DOM and never mutates its input. Everything asserted here is checked on
 * synthetic schedules; the two real plans are covered by the sibling files.
 *
 * The column contract is the one PHASE 4.1 documented — the Phase 4.3 order named `Abschnitt`
 * and ASCII column names, but 4.1 holds the final contract and its tie-break rule says 4.1 wins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildDienstplanXlsxModel,
  XLSX_MODEL_STATUS,
  CONFIDENCE_LEVELS,
  SHEET_NAMES,
  DIENSTPLAN_COLUMNS,
  DIENSTE_COLUMNS,
  IMPORTHINWEISE_COLUMNS,
  MODEL_WARNING_CODES
} from '../js/v2/export/dienstplan-xlsx-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------------------
// synthetic fixtures — the smallest schedule that still exercises the mapping
// ---------------------------------------------------------------------------------------
const time = (value) => ({ raw: value ?? '', value: value ?? null,
  minutesSinceStartOfDay: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });
const duration = (value) => ({ raw: value ?? '', value: value ?? null,
  minutes: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });

let activityCounter = 0;
const activity = (serviceId, overrides = {}) => ({
  id: `activity:${serviceId}:${activityCounter++}`,
  serviceId,
  serviceNumber: '',
  circuitNumber: '',
  rawActivity: 'Dienst',
  departureTime: time('05:00'),
  arrivalTime: time('06:00'),
  departureLocation: ' Bth. Burgau',
  arrivalLocation: ' Teichgraben',
  originalText: 'ROHZEILE die niemals exportiert werden darf',
  boundingBox: { xMin: 1, yMin: 2, xMax: 3, yMax: 4 },
  source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 3,
    boundingBox: { xMin: 1, yMin: 2, xMax: 3, yMax: 4 }, originalText: 'ROHZEILE' },
  routeIdentity: null,
  serviceIdentity: null,
  ...overrides
});

const service = (serviceNumber, activities, overrides = {}) => {
  const id = `service:1:${serviceNumber}`;
  return {
    id, serviceNumber,
    begin: time('05:00'), end: time('12:00'), paidTime: duration('07:00'),
    activities: activities.map(extra => activity(id, extra)),
    interruptions: [],
    originalText: 'ROHTEXT', boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0,
      lineRange: { start: 1, end: 5 }, boundingBox: {}, originalText: 'ROHTEXT' },
    ...overrides
  };
};

const schedule = (services) => ({
  type: 'CanonicalSchedule',
  document: { sourceType: 'pdf', pageCount: 1, source: { byteLength: 0, documentModelType: 'PdfDocumentModel' } },
  services,
  activities: services.flatMap(entry => entry.activities),
  interruptions: [],
  warnings: [],
  metadata: { schemaVersion: '1.0', serviceCount: services.length, activityCount: 0, interruptionCount: 0 }
});

const analysis = (profileId, services) => ({
  detection: { status: 'supported', profile: { id: profileId }, pageCount: 1 },
  canonicalSchedule: schedule(services)
});

const jnv = (services = [service('2101', [{}])]) => analysis('beu-stadtbus-v1', services);
const jes = (services = [service('751', [{}])]) => analysis('jes-regionalbus-v1', services);

const sheet = (model, name) => model.sheets.find(entry => entry.name === name);
const column = (model, name, heading) => sheet(model, name).columns.indexOf(heading);
const cell = (model, name, rowIndex, heading) => sheet(model, name).rows[rowIndex][column(model, name, heading)];

// =====================================================================================
// A — the contract
// =====================================================================================
test('A: exactly three sheets, in a fixed order', () => {
  const model = buildDienstplanXlsxModel(jnv());
  assert.equal(model.status, XLSX_MODEL_STATUS.READY);
  assert.deepEqual(model.sheets.map(entry => entry.name), ['Dienstplan', 'Dienste', 'Importhinweise']);
  assert.deepEqual([...SHEET_NAMES], ['Dienstplan', 'Dienste', 'Importhinweise']);
});

test('A: the Dienstplan columns are the Phase 4.1 contract, unchanged', () => {
  assert.deepEqual([...DIENSTPLAN_COLUMNS], [
    'Dienstnummer', 'Zeile', 'Linie', 'Umlauf', 'Tätigkeit', 'Beginn', 'Anfangsort',
    'Richtung', 'Ende', 'Endort', 'Vorheriger Dienst', 'Nachfolgender Dienst',
    'Dienstbeginn', 'Dienstende', 'Bezahlte Zeit', 'Pause/Unterbrechung',
    'Quellenstatus', 'Unsichere Felder', 'Seite'
  ]);
  assert.deepEqual(sheet(buildDienstplanXlsxModel(jnv()), 'Dienstplan').columns, [...DIENSTPLAN_COLUMNS]);
});

test('A: the Dienste and Importhinweise columns are the Phase 4.1 contract too', () => {
  assert.deepEqual([...DIENSTE_COLUMNS], ['Dienstnummer', 'Beginn', 'Ende', 'Bezahlte Zeit',
    'Abschnitte', 'Pausen', 'Dokumenttyp', 'Organisation', 'Tagesart']);
  assert.deepEqual([...IMPORTHINWEISE_COLUMNS], ['Warncode', 'Bereich', 'Meldung', 'Dienstnummer']);
  const model = buildDienstplanXlsxModel(jnv());
  assert.deepEqual(sheet(model, 'Dienste').columns, [...DIENSTE_COLUMNS]);
  assert.deepEqual(sheet(model, 'Importhinweise').columns, [...IMPORTHINWEISE_COLUMNS]);
});

test('A: every row has exactly as many cells as its sheet has columns', () => {
  const model = buildDienstplanXlsxModel(jnv([service('2101', [{}, {}]), service('2102', [{}])]));
  for (const entry of model.sheets) {
    for (const row of entry.rows) {
      assert.equal(row.length, entry.columns.length, `${entry.name}: ${JSON.stringify(row)}`);
    }
  }
});

test('A: the result is plain data — serialisable, no functions, no class instances', () => {
  const model = buildDienstplanXlsxModel(jnv());
  const roundTrip = JSON.parse(JSON.stringify(model));
  assert.deepEqual(roundTrip, model, 'a JSON round trip changes nothing');

  const walk = (value, path = '$') => {
    if (value === null) return;
    const kind = typeof value;
    assert.ok(['string', 'number', 'boolean', 'object'].includes(kind), `${path}: ${kind}`);
    if (kind !== 'object') return;
    assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype,
      `${path} must be a plain object or an array`);
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(model);
});

test('A: the module knows no spreadsheet library, no DOM, no I/O', () => {
  const module = src('../js/v2/export/dienstplan-xlsx-model.js');
  assert.doesNotMatch(module, /import .* from ['"](?!\.)/, 'no bare specifier — nothing installed');
  // The module's own exported names contain "XLSX", so the check looks for library USE.
  assert.doesNotMatch(module, /\bXLSX\.|SheetJS|xlsx\.full|book_new|book_append_sheet|aoa_to_sheet/,
    'no spreadsheet writer');
  assert.doesNotMatch(module, /document\.|window\.|Blob|createObjectURL|URL\./, 'no DOM, no blob');
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/, 'no storage');
  assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/, 'no network');
  assert.doesNotMatch(module, /readFile|writeFile|node:fs/, 'no file system');
  // The Phase 3I.36 export model is imported for `neutraliseCell` alone — that is a cell helper,
  // not an analysis result. Reading the runner, a check or the report view stays forbidden.
  assert.doesNotMatch(module, /check-runner|checks\/bv\/|CheckReport|check-report-view/,
    'no analysis result');
  assert.match(module, /import \{ neutraliseCell \} from '\.\.\/report\/check-report-export-model\.js'/,
    'and the only report import is that helper');
});

test('A: the input is never mutated', () => {
  const input = jnv([service('2101', [{}, {}])]);
  const before = JSON.stringify(input);
  buildDienstplanXlsxModel(input);
  assert.equal(JSON.stringify(input), before, 'the CanonicalSchedule comes back untouched');
});

test('A: calling it twice yields the same model', () => {
  const input = jnv([service('2101', [{}, {}])]);
  assert.deepEqual(buildDienstplanXlsxModel(input), buildDienstplanXlsxModel(input));
});

test('A: the confidence vocabulary is closed and has exactly three levels', () => {
  assert.deepEqual([...CONFIDENCE_LEVELS], ['exact', 'derived', 'inconclusive']);
  assert.equal(CONFIDENCE_LEVELS.length, 3, 'no fourth level');
});

test('A: the model status vocabulary is its own — it is not a check status', () => {
  assert.deepEqual(Object.values(XLSX_MODEL_STATUS).sort(), ['inconclusive', 'not_applicable', 'ready']);
  for (const value of Object.values(XLSX_MODEL_STATUS)) {
    assert.ok(!['PASS', 'FAIL', 'SKIP', 'NOT_APPLICABLE'].includes(value), 'never a CheckResult status');
  }
});

test('A: the statistics count what the sheets contain', () => {
  const model = buildDienstplanXlsxModel(jnv([service('2101', [{}, {}]), service('2102', [{}])]));
  assert.equal(model.statistics.serviceCount, 2);
  assert.equal(model.statistics.activityCount, 3);
  assert.equal(sheet(model, 'Dienste').rows.length, 2);
  assert.equal(sheet(model, 'Dienstplan').rows.length, 3);
  assert.equal(model.statistics.warningCount, model.warnings.length);
  const cells = model.statistics.exactCellCount + model.statistics.derivedCellCount
    + model.statistics.inconclusiveCellCount;
  assert.ok(cells > 0, 'the confidence levels are actually counted');
});

// =====================================================================================
// B — the document-type gate
// =====================================================================================
test('B: a JNV Dienstplan-PDF is ready', () => {
  const model = buildDienstplanXlsxModel(jnv());
  assert.equal(model.status, 'ready');
  assert.equal(model.documentType, 'jnv_schedule_pdf');
  assert.equal(model.organization, 'JNV');
});

test('B: a JES Dienstplan-PDF is ready', () => {
  const model = buildDienstplanXlsxModel(jes());
  assert.equal(model.status, 'ready');
  assert.equal(model.documentType, 'jes_schedule_pdf');
  assert.equal(model.organization, 'JES');
});

test('B: every other document type is not_applicable — and never throws', () => {
  for (const documentType of ['legacy_excel_schedule', 'umlaufkarte', 'wagenkarte', 'unknown']) {
    let model;
    assert.doesNotThrow(() => { model = buildDienstplanXlsxModel({ documentType, canonicalSchedule: schedule([]) }); });
    assert.equal(model.status, XLSX_MODEL_STATUS.NOT_APPLICABLE, documentType);
    assert.equal(model.documentType, documentType === 'unknown' ? null : documentType);
    assert.deepEqual(model.sheets, [], 'a refused document produces no sheets');
    assert.equal(model.statistics.serviceCount, 0);
  }
});

test('B: an unsupported detection is not_applicable', () => {
  const model = buildDienstplanXlsxModel({ detection: { status: 'unsupported' }, canonicalSchedule: null });
  assert.equal(model.status, 'not_applicable');
  assert.equal(model.documentType, null);
  assert.equal(model.organization, null);
});

test('B: a missing or structurally broken schedule is inconclusive, never a throw', () => {
  for (const broken of [
    { detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } }, canonicalSchedule: null },
    { detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } }, canonicalSchedule: {} },
    { detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } },
      canonicalSchedule: { type: 'CanonicalSchedule', services: 'nonsense' } },
    { detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } },
      canonicalSchedule: { type: 'SomethingElse', services: [] } }
  ]) {
    let model;
    assert.doesNotThrow(() => { model = buildDienstplanXlsxModel(broken); });
    assert.equal(model.status, XLSX_MODEL_STATUS.INCONCLUSIVE, JSON.stringify(broken.canonicalSchedule));
    assert.deepEqual(model.sheets, []);
    assert.ok(model.warnings.length >= 1, 'and it says why');
  }
});

test('B: no input at all is handled too', () => {
  for (const input of [null, undefined, {}, 'nonsense', 42, []]) {
    let model;
    assert.doesNotThrow(() => { model = buildDienstplanXlsxModel(input); });
    assert.ok(['not_applicable', 'inconclusive'].includes(model.status), String(input));
    assert.deepEqual(model.sheets, []);
  }
});

test('B: a supported JNV document with no duties at all is inconclusive, not ready', () => {
  const model = buildDienstplanXlsxModel(jnv([]));
  assert.equal(model.status, 'inconclusive');
  assert.ok(model.warnings.some(warning => warning.code === MODEL_WARNING_CODES.KEIN_DIENST));
});

// =====================================================================================
// E — fields without a source stay empty
// =====================================================================================
test('E: Richtung, vorheriger and nachfolgender Dienst stay empty — the PDF has no such column', () => {
  const model = buildDienstplanXlsxModel(jnv());
  for (const heading of ['Richtung', 'Vorheriger Dienst', 'Nachfolgender Dienst']) {
    assert.equal(cell(model, 'Dienstplan', 0, heading), '', `${heading} must stay empty`);
  }
});

test('E: an unknown circuit code yields no Linie and no placeholder', () => {
  const model = buildDienstplanXlsxModel(jnv([service('2101', [{ circuitNumber: '7511', routeIdentity: null }])]));
  assert.equal(cell(model, 'Dienstplan', 0, 'Umlauf'), '7511', 'the printed code is kept');
  assert.equal(cell(model, 'Dienstplan', 0, 'Linie'), '', 'but no line is invented');
});

test('E: a missing value is an empty string — never "null", "undefined" or a dash', () => {
  const model = buildDienstplanXlsxModel(jnv([service('2101', [{
    circuitNumber: '', rawActivity: '', departureLocation: '', arrivalLocation: ''
  }])]));
  for (const value of sheet(model, 'Dienstplan').rows[0]) {
    assert.ok(!['null', 'undefined', '-', 'n/a', 'N/A'].includes(String(value)), String(value));
  }
});

test('E: a duty without a day qualifier leaves Tagesart empty rather than guessing', () => {
  const model = buildDienstplanXlsxModel(jnv());
  assert.equal(cell(model, 'Dienste', 0, 'Tagesart'), '');
});

test('E: nothing is recovered from the Legacy-Excel model', () => {
  const module = src('../js/v2/export/dienstplan-xlsx-model.js');
  assert.doesNotMatch(module, /excel-canonical-adapter|legacy-excel|handoverSource|Richtg/,
    'the projection never reaches into the Excel path');
});

// =====================================================================================
// The duty totals: repeated on every row — a deliberate, tested decision
// =====================================================================================
test('duty totals are repeated on every row of the duty, so sorting cannot break them', () => {
  const model = buildDienstplanXlsxModel(jnv([service('2101', [{}, {}, {}])]));
  const rows = sheet(model, 'Dienstplan').rows;
  assert.equal(rows.length, 3);
  for (const [index] of rows.entries()) {
    assert.equal(cell(model, 'Dienstplan', index, 'Dienstnummer'), '2101');
    assert.equal(cell(model, 'Dienstplan', index, 'Dienstbeginn'), '05:00');
    assert.equal(cell(model, 'Dienstplan', index, 'Dienstende'), '12:00');
    assert.equal(cell(model, 'Dienstplan', index, 'Bezahlte Zeit'), '07:00');
  }
});

test('the section ordinal is stable and starts at one within each duty', () => {
  const model = buildDienstplanXlsxModel(jnv([service('2101', [{}, {}]), service('2102', [{}, {}, {}])]));
  assert.deepEqual(sheet(model, 'Dienstplan').rows.map(row => row[DIENSTPLAN_COLUMNS.indexOf('Zeile')]),
    [1, 2, 1, 2, 3]);
});

test('the duty order of the schedule is preserved', () => {
  const model = buildDienstplanXlsxModel(jnv([service('2199', [{}]), service('2101', [{}]), service('2150', [{}])]));
  assert.deepEqual(sheet(model, 'Dienste').rows.map(row => row[0]), ['2199', '2101', '2150']);
});
