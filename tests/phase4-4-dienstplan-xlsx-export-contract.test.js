/**
 * Phase 4.4 (A/D/F/I) — the export contract of the Dienstplan file writer.
 *
 * The writer is the last step: it takes the FINISHED Phase 4.3 projection model and turns it into
 * bytes. It re-projects nothing, re-parses nothing and interprets nothing. Whatever the model says
 * is what the file says.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import {
  createDienstplanWorkbook, writeDienstplanXlsx, createDienstplanCsv,
  DIENSTPLAN_EXPORT_STATUS, EXPORT_FORMATS, EXPORT_WARNING_CODES, DIENSTPLAN_FILE_NAME_PATTERN
} from '../js/v2/export/dienstplan-xlsx-export.js';
import { buildDienstplanXlsxModel } from '../js/v2/export/dienstplan-xlsx-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DAY = new Date(Date.UTC(2026, 7, 4, 9, 30));

/** The very SheetJS build the page loads — vendored, offline, nothing installed. */
const loadXlsx = () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.XLSX;
};
const XLSX = loadXlsx();

// ---------------------------------------------------------------------------------------
// a synthetic model, built through the real Phase 4.3 projector
// ---------------------------------------------------------------------------------------
const time = (value) => ({ raw: value ?? '', value: value ?? null,
  minutesSinceStartOfDay: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });
const duration = (value) => ({ raw: value ?? '', value: value ?? null,
  minutes: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });

let counter = 0;
const activity = (serviceId, overrides = {}) => ({
  id: `activity:${serviceId}:${counter++}`, serviceId, serviceNumber: '', circuitNumber: '',
  rawActivity: 'Dienst', departureTime: time('05:00'), arrivalTime: time('06:00'),
  departureLocation: ' Bth. Burgau', arrivalLocation: ' Teichgraben',
  originalText: 'ROHZEILE', boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
  source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 3,
    boundingBox: {}, originalText: 'ROHZEILE' },
  routeIdentity: null, serviceIdentity: null, ...overrides
});
const service = (serviceNumber, activities = [{}]) => {
  const id = `service:1:${serviceNumber}`;
  return {
    id, serviceNumber, begin: time('05:00'), end: time('12:00'), paidTime: duration('07:00'),
    activities: activities.map(extra => activity(id, extra)), interruptions: [],
    originalText: 'ROH', boundingBox: {},
    source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineRange: { start: 1, end: 5 },
      boundingBox: {}, originalText: 'ROH' }
  };
};
const analysis = (profileId, services) => ({
  detection: { status: 'supported', profile: { id: profileId }, pageCount: 1 },
  canonicalSchedule: {
    type: 'CanonicalSchedule',
    document: { sourceType: 'pdf', pageCount: 1, source: { byteLength: 0, documentModelType: 'PdfDocumentModel' } },
    services, activities: services.flatMap(entry => entry.activities), interruptions: [], warnings: [],
    metadata: { schemaVersion: '1.0', serviceCount: services.length, activityCount: 0, interruptionCount: 0 }
  }
});

const jnvModel = (services = [service('2101', [{}, {}])]) =>
  buildDienstplanXlsxModel(analysis('beu-stadtbus-v1', services));
const jesModel = (services = [service('751')]) =>
  buildDienstplanXlsxModel(analysis('jes-regionalbus-v1', services));

// =====================================================================================
// A — the export contract
// =====================================================================================
test('A: a ready model produces an XLSX file', () => {
  const result = writeDienstplanXlsx(jnvModel(), { xlsx: XLSX, now: DAY });
  assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.READY);
  assert.equal(result.format, EXPORT_FORMATS.XLSX);
  assert.equal(result.fileName, 'JNV-Dienstplan-Export-2026-08-04.xlsx');
  assert.match(result.mimeType, /spreadsheetml/);
  assert.ok(result.bytes instanceof Uint8Array && result.bytes.length > 0);
  assert.deepEqual(result.warnings, []);
});

test('A: the result contract has exactly the agreed shape', () => {
  const result = writeDienstplanXlsx(jnvModel(), { xlsx: XLSX, now: DAY });
  assert.deepEqual(Object.keys(result).sort(),
    ['bytes', 'fileName', 'format', 'mimeType', 'status', 'warnings']);
  assert.ok(Array.isArray(result.warnings));
});

test('A: a JES model gets the JES file name', () => {
  const result = writeDienstplanXlsx(jesModel(), { xlsx: XLSX, now: DAY });
  assert.equal(result.fileName, 'JES-Dienstplan-Export-2026-08-04.xlsx');
  assert.equal(createDienstplanCsv(jesModel(), { now: DAY }).fileName, 'JES-Dienstplan-Export-2026-08-04.csv');
});

test('A: the file name is safe — no path, no source name, no duty number, no day type', () => {
  for (const model of [jnvModel(), jesModel()]) {
    const name = writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY }).fileName;
    assert.match(name.replace(/\.xlsx$/, ''), DIENSTPLAN_FILE_NAME_PATTERN);
    assert.match(name, /^[A-Za-z0-9.-]+$/, 'only safe characters');
    assert.ok(!name.includes('/') && !name.includes('\\') && !name.includes('..'));
    assert.ok(!/2101|751|mo_fr|Ferien|Schule/.test(name));
  }
});

test('A: the date is injectable, so the name is deterministic', () => {
  const first = writeDienstplanXlsx(jnvModel(), { xlsx: XLSX, now: new Date(Date.UTC(2026, 0, 9, 5)) });
  assert.equal(first.fileName, 'JNV-Dienstplan-Export-2026-01-09.xlsx', 'month and day are padded');
  const again = writeDienstplanXlsx(jnvModel(), { xlsx: XLSX, now: DAY });
  assert.equal(again.fileName, writeDienstplanXlsx(jnvModel(), { xlsx: XLSX, now: DAY }).fileName);
});

test('A: a not_applicable model is refused, never written', () => {
  const model = buildDienstplanXlsxModel({ documentType: 'wagenkarte', canonicalSchedule: null });
  assert.equal(model.status, 'not_applicable');
  const result = writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY });
  assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.NOT_APPLICABLE);
  assert.equal(result.bytes, null);
  assert.equal(result.format, null);
  assert.equal(result.fileName, null);
  assert.ok(result.warnings.some(w => w.code === EXPORT_WARNING_CODES.MODELL_NICHT_EXPORTIERBAR));
});

test('A: an inconclusive model is refused too', () => {
  const model = buildDienstplanXlsxModel(analysis('beu-stadtbus-v1', []));
  assert.equal(model.status, 'inconclusive');
  const result = writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY });
  assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.NOT_APPLICABLE);
  assert.equal(result.bytes, null);
});

test('A: the model is never mutated', () => {
  const model = jnvModel([service('2101', [{}, {}]), service('2102')]);
  const before = JSON.stringify(model);
  writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY });
  createDienstplanCsv(model, { now: DAY });
  createDienstplanWorkbook(model, { xlsx: XLSX });
  assert.equal(JSON.stringify(model), before);
});

test('A: writing twice yields identical bytes', () => {
  const model = jnvModel();
  const first = writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY });
  const second = writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY });
  assert.equal(first.bytes.length, second.bytes.length, 'the writer is deterministic in size');
  assert.equal(createDienstplanCsv(model, { now: DAY }).bytes.length,
    createDienstplanCsv(model, { now: DAY }).bytes.length);
});

// =====================================================================================
// Model validation at the export boundary
// =====================================================================================
test('A: a structurally wrong model is refused with a controlled error', () => {
  const ready = jnvModel();
  const broken = [
    null, undefined, {}, 'nonsense', 42,
    { ...ready, sheets: [] },
    { ...ready, sheets: ready.sheets.slice(0, 2) },
    { ...ready, sheets: [{ name: 'Anderes', columns: [], rows: [] }, ...ready.sheets.slice(1)] },
    { ...ready, sheets: [{ ...ready.sheets[0], columns: 'nope' }, ...ready.sheets.slice(1)] },
    { ...ready, sheets: [{ ...ready.sheets[0], rows: 'nope' }, ...ready.sheets.slice(1)] }
  ];
  for (const model of broken) {
    let result;
    assert.doesNotThrow(() => { result = writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY }); },
      JSON.stringify(model)?.slice(0, 60));
    assert.notEqual(result.status, DIENSTPLAN_EXPORT_STATUS.READY, JSON.stringify(model)?.slice(0, 60));
    assert.equal(result.bytes, null);
  }
});

test('A: an object, array or function in a cell is refused rather than written', () => {
  const ready = jnvModel();
  for (const poison of [{ a: 1 }, [1, 2], () => 'x', new Date(0)]) {
    const model = {
      ...ready,
      sheets: ready.sheets.map((sheet, index) => index !== 0 ? sheet
        : { ...sheet, rows: [[poison, ...sheet.rows[0].slice(1)]] })
    };
    const result = writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY });
    assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.ERROR, String(poison));
    assert.equal(result.bytes, null);
    assert.ok(result.warnings.some(w => w.code === EXPORT_WARNING_CODES.MODELL_UNGUELTIG));
  }
});

test('A: a row that is longer or shorter than its columns is refused', () => {
  const ready = jnvModel();
  for (const rows of [[[1, 2]], [[...ready.sheets[0].rows[0], 'zu viel']]]) {
    const model = { ...ready, sheets: ready.sheets.map((s, i) => i !== 0 ? s : { ...s, rows }) };
    assert.equal(writeDienstplanXlsx(model, { xlsx: XLSX, now: DAY }).status, DIENSTPLAN_EXPORT_STATUS.ERROR);
  }
});

// =====================================================================================
// D — privacy and safety of the module itself
// =====================================================================================
test('D: the module reads no schedule, no check report and no parser', () => {
  const module = src('../js/v2/export/dienstplan-xlsx-export.js');
  // The prose names what the module deliberately does NOT do, so the checks look for real access.
  assert.doesNotMatch(module, /\.canonicalSchedule|\.services\b|\.activities\b|\.hardened\b/,
    'no schedule field is ever read here');
  assert.doesNotMatch(module, /import .* from ['"].*(check-report|checks\/|pdf\/|import\/)/,
    'and nothing from the analysis or parser side is imported');
  assert.doesNotMatch(module, /dienstplan-xlsx-model/, 'the projection is handed in, not called');
  assert.doesNotMatch(module, /neutraliseCell|classifyActivityRow|routeIdentity/,
    'no projection logic is repeated');
});

test('D: the module is local — no network, no storage, no telemetry, nothing installed', () => {
  const module = src('../js/v2/export/dienstplan-xlsx-export.js');
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(module, /import\s*\(|require\(/, 'no dynamic import of a library');
  assert.doesNotMatch(module, /import .* from ['"](?!\.)/, 'no bare specifier');
  assert.doesNotMatch(module, /https?:\/\//, 'no external host');
  assert.doesNotMatch(module, /\/Users\/|Downloads/, 'no local path');
});

test('D: no result carries a path, a source name or a raw document field', () => {
  for (const result of [writeDienstplanXlsx(jnvModel(), { xlsx: XLSX, now: DAY }),
    createDienstplanCsv(jnvModel(), { now: DAY })]) {
    const serialised = JSON.stringify({ ...result, bytes: null });
    for (const forbidden of ['/Users/', '.pdf', 'originalText', 'rawCells', 'boundingBox', 'ROHZEILE']) {
      assert.ok(!serialised.includes(forbidden), forbidden);
    }
  }
});

// =====================================================================================
// I — the neighbours are untouched
// =====================================================================================
test('I: the Phase 4.3 projection model is unchanged', () => {
  const model = src('../js/v2/export/dienstplan-xlsx-model.js');
  // Its header names Phase 4.4 as the phase that will write the file, so the check is behavioural:
  // the projector must still know nothing about writing one.
  assert.doesNotMatch(model, /\bXLSX\.|book_new|aoa_to_sheet|!cols|Props/,
    'the projector still knows no spreadsheet library');
  assert.doesNotMatch(model, /Blob|createObjectURL|download|mimeType|bytes/, 'and writes no file');
  assert.doesNotMatch(model, /dienstplan-xlsx-export/, 'and does not reach into the writer');
});

test('I: the Prüfbericht export of Phase 3I.36 is unchanged', () => {
  for (const path of ['../js/v2/report/check-report-export.js', '../js/v2/report/check-report-export-model.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /4\.4|Dienstplan-Export|dienstplan-xlsx/, `${path} must be untouched`);
  }
});

test('I: no parser, rule or check file carries this phase', () => {
  // SUPERSEDED BY PHASE 4.5: the profile contract was on this list because Phase 4.4 wired
  // nothing. Phase 4.5 switched the capability on there, so the file is checked by its own phase
  // now. The parsers, rules and checks stay on the list unchanged.
  for (const path of ['../js/v2/pdf/schedule-mapper.js', '../js/v2/pdf/hardened-schedule.js',
    '../js/v2/import/pdf-analysis-controller.js', '../js/v2/checks/check-runner.js',
    '../js/v2/analysis/one-sixth-rule.js']) {
    assert.doesNotMatch(src(path), /4\.4/, `${path} must be untouched`);
  }
});

test('I: the writer itself is still not wired into the page', () => {
  // Phase 4.5 mounts a small adapter; the page must never reach into the writer directly.
  assert.doesNotMatch(src('../index.html'), /dienstplan-xlsx/, 'no direct writer call in the markup');
  assert.doesNotMatch(src('../js/v2/pdf-import-bootstrap.js'), /dienstplan-xlsx-export/,
    'and none in the bootstrap either — the adapter is the only caller');
});

test('I: the xlsxExport capability is held by the two exportable profiles only', async () => {
  // SUPERSEDED BY PHASE 4.5: this asserted that nothing was activated, which was true while the
  // writer had no user interface. The guard that still matters is that the capability never
  // spreads beyond the two Dienstplan-PDF profiles.
  const { listProfiles, profileHasCapability } = await import('../js/v2/documents/document-profiles.js');
  const holders = listProfiles()
    .filter(profile => profileHasCapability(profile.id, 'xlsxExport'))
    .map(profile => profile.id).sort();
  assert.deepEqual(holders, ['beu-stadtbus-v1', 'jes-regionalbus-v1']);
});

test('I: the rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});
