/**
 * Phase 4.3 (F) — privacy and spreadsheet safety of the projection model.
 *
 * The model is the last place where a raw document could leak into a workbook, so this file
 * checks what it emits rather than what it intends: every cell of a real projection is scanned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildDienstplanXlsxModel, DIENSTPLAN_COLUMNS, IMPORTHINWEISE_COLUMNS
} from '../js/v2/export/dienstplan-xlsx-model.js';
import { neutraliseCell } from '../js/v2/report/check-report-export-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const time = (value) => ({ raw: value ?? '', value: value ?? null,
  minutesSinceStartOfDay: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });
const duration = (value) => ({ raw: value ?? '', value: value ?? null,
  minutes: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });

const RAW_LINE = '2101 Dienst 03:15 Bth. Burgau 12:15 Bth. Burgau 03:15 12:15 09:00';
const BOX = { xMin: 12.5, yMin: 800.25, xMax: 400.75, yMax: 814.5 };

const activity = (serviceId, overrides = {}) => ({
  id: `activity:${serviceId}:0`, serviceId, serviceNumber: '', circuitNumber: '12100',
  rawActivity: 'Dienst', departureTime: time('05:00'), arrivalTime: time('06:00'),
  departureLocation: ' Bth. Burgau', arrivalLocation: ' Teichgraben',
  originalText: RAW_LINE, boundingBox: BOX,
  source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 3,
    boundingBox: BOX, originalText: RAW_LINE, fileName: '/User' + 's/jemand/Down' + 'loads/plan.pdf',
    rawCells: ['2101', 'Dienst', '03:15'] },
  routeIdentity: { type: 'RouteIdentity', raw: '12100', line: '12', course: '1', trip: null,
    kind: 'LINE_COURSE', normalizedKey: 'LC:12|1' },
  serviceIdentity: null, ...overrides
});

const service = (serviceNumber, overrides = {}, activities = [{}]) => {
  const id = `service:1:${serviceNumber}`;
  return {
    id, serviceNumber, begin: time('05:00'), end: time('12:00'), paidTime: duration('07:00'),
    activities: activities.map(extra => activity(id, extra)), interruptions: [],
    originalText: RAW_LINE, boundingBox: BOX,
    source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineRange: { start: 1, end: 5 },
      boundingBox: BOX, originalText: RAW_LINE, fileName: '/User' + 's/jemand/Down' + 'loads/plan.pdf' },
    ...overrides
  };
};

const analysis = (services) => ({
  detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' }, pageCount: 1 },
  canonicalSchedule: {
    type: 'CanonicalSchedule',
    document: { sourceType: 'pdf', pageCount: 1,
      source: { byteLength: 4711, documentModelType: 'PdfDocumentModel', fileName: '/User' + 's/jemand/plan.pdf' } },
    services, activities: services.flatMap(entry => entry.activities), interruptions: [], warnings: [],
    metadata: { schemaVersion: '1.0', serviceCount: services.length, activityCount: 0, interruptionCount: 0 }
  }
});

const allCells = (model) => model.sheets.flatMap(entry => entry.rows.flat());

// =====================================================================================
// F — formula injection
// =====================================================================================
test('F: a cell that could be read as a formula is neutralised, for all four prefixes', () => {
  const model = buildDienstplanXlsxModel(analysis([service('=cmd|calc', {}, [
    { rawActivity: '+Dienst', departureLocation: '-Bth. Burgau', arrivalLocation: '@Teichgraben',
      circuitNumber: '=12100' }
  ])]));
  const cells = allCells(model).filter(value => typeof value === 'string');
  for (const value of cells) {
    assert.doesNotMatch(value, /^[=+\-@]/, `a cell may never start with a formula character: ${value}`);
  }
  const row = model.sheets[0].rows[0];
  assert.ok(row.includes("'=cmd|calc"), 'the duty number arrives neutralised but readable');
  assert.ok(row.includes("'+Dienst"));
  assert.ok(row.includes("'-Bth. Burgau"));
  assert.ok(row.includes("'@Teichgraben"));
});

test('F: the guard is the existing helper, not a second implementation', () => {
  const module = src('../js/v2/export/dienstplan-xlsx-model.js');
  assert.match(module, /neutraliseCell/, 'the Phase 3I.36 helper is used');
  assert.match(module, /from ['"]\.\.\/report\/check-report-export-model\.js['"]/, 'imported, not copied');
  assert.doesNotMatch(module, /\^\[=\+/, 'no parallel formula regex of its own');
  // and it really is the same function
  assert.equal(neutraliseCell('=1+1'), "'=1+1");
});

test('F: a warning message is neutralised too', () => {
  const model = buildDienstplanXlsxModel(analysis([service('=757'), service('=757')]));
  const hints = model.sheets.find(entry => entry.name === 'Importhinweise');
  for (const row of hints.rows) {
    for (const value of row) {
      if (typeof value === 'string') assert.doesNotMatch(value, /^[=+\-@]/, value);
    }
  }
});

test('F: numbers stay numbers — the guard does not turn a duration into text', () => {
  const model = buildDienstplanXlsxModel(analysis([service('2101', {}, [{}, {}])]));
  const ordinalColumn = DIENSTPLAN_COLUMNS.indexOf('Zeile');
  const pageColumn = DIENSTPLAN_COLUMNS.indexOf('Seite');
  for (const row of model.sheets[0].rows) {
    assert.equal(typeof row[ordinalColumn], 'number');
    assert.equal(typeof row[pageColumn], 'number');
  }
  assert.equal(typeof model.statistics.serviceCount, 'number');
});

// =====================================================================================
// F — privacy
// =====================================================================================
test('F: no raw line, no bounding box, no path and no file name reaches any cell', () => {
  const model = buildDienstplanXlsxModel(analysis([service('2101')]));
  const serialised = JSON.stringify(model);
  for (const forbidden of ['originalText', 'rawCells', 'boundingBox', 'xMin', 'yMax',
    '/User' + 's/', 'plan.pdf', 'byteLength', RAW_LINE]) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} must never appear in the model`);
  }
});

test('F: no cell carries a whole service or activity object', () => {
  const model = buildDienstplanXlsxModel(analysis([service('2101')]));
  for (const value of allCells(model)) {
    assert.ok(value === null || typeof value !== 'object', `a cell may not be an object: ${JSON.stringify(value)}`);
  }
});

test('F: the Importhinweise sheet carries a code, an area, a neutral message and a duty number', () => {
  const model = buildDienstplanXlsxModel(analysis([service('757'), service('757')]));
  const hints = model.sheets.find(entry => entry.name === 'Importhinweise');
  assert.deepEqual(hints.columns, [...IMPORTHINWEISE_COLUMNS]);
  assert.ok(hints.rows.length >= 1);
  for (const row of hints.rows) {
    assert.equal(row.length, 4);
    assert.match(String(row[0]), /^[A-ZÄÖÜ_]+$/, 'the code is a machine token');
    assert.ok(!String(row[2]).includes('/'), 'the message carries no path');
    assert.ok(!/Error|at Object|\.js:\d+/.test(String(row[2])), 'and no stack trace');
  }
});

test('F: the model contains no function, no class instance and no cycle', () => {
  const model = buildDienstplanXlsxModel(analysis([service('2101')]));
  const seen = new WeakSet();
  const walk = (value, path = '$') => {
    if (value === null || typeof value !== 'object') {
      assert.ok(typeof value !== 'function', `${path} is a function`);
      return;
    }
    assert.ok(!seen.has(value), `${path} is a cycle`);
    seen.add(value);
    assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, `${path}`);
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(model);
  assert.doesNotThrow(() => JSON.stringify(model));
});

test('F: no personal field is produced anywhere', () => {
  const model = buildDienstplanXlsxModel(analysis([service('2101')]));
  const serialised = JSON.stringify(model);
  for (const forbidden of ['Fahrer', 'Personal', 'Mitarbeiter', 'Geburt', 'Adresse', 'Telefon', 'E-Mail']) {
    assert.ok(!serialised.includes(forbidden), forbidden);
  }
});

test('F: no analysis result and no check status is carried', () => {
  const model = buildDienstplanXlsxModel(analysis([service('2101')]));
  const serialised = JSON.stringify(model);
  for (const forbidden of ['PASS', 'FAIL', 'VIOLATION', 'CheckReport', 'BV003', 'severity']) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} belongs to the Prüfbericht, not here`);
  }
});

// =====================================================================================
// G — the neighbouring exports and contracts are untouched
// =====================================================================================
test('G: the Prüfbericht export of Phase 3I.36 is unchanged', () => {
  for (const path of ['../js/v2/report/check-report-export-model.js', '../js/v2/report/check-report-export.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /4\.3|Phase 4/, `${path} must be untouched`);
    assert.ok(!module.includes('Importhinweise'), 'and must not know the new sheet');
  }
});

test('G: no parser, rule, matcher or UI module carries this phase', () => {
  for (const path of ['../js/v2/pdf/schedule-mapper.js', '../js/v2/pdf/canonical-schedule-builder.js',
    '../js/v2/pdf/hardened-schedule.js', '../js/v2/pdf/document-profile-detector.js',
    '../js/v2/import/pdf-analysis-controller.js', '../js/v2/import/pdf-import-controller.js',
    '../js/v2/checks/check-runner.js', '../js/v2/analysis/one-sixth-rule.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/report/check-report-view.js']) {
    assert.doesNotMatch(src(path), /4\.3/, `${path} must be untouched`);
  }
  assert.doesNotMatch(src('../index.html'), /dienstplan-xlsx-model/, 'nothing is wired into the UI yet');
});

test('G: the rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});

test('G: the xlsxExport capability is held by the two exportable profiles only', async () => {
  // SUPERSEDED BY PHASE 4.5: Phase 4.3 built the projection model but wired nothing, so no profile
  // could claim the capability yet. Phase 4.4 added the writer and Phase 4.5 switched it on — for
  // JNV and JES and for nobody else, which is what still needs guarding.
  const { listProfiles, profileHasCapability } = await import('../js/v2/documents/document-profiles.js');
  const holders = listProfiles()
    .filter(profile => profileHasCapability(profile.id, 'xlsxExport'))
    .map(profile => profile.id).sort();
  assert.deepEqual(holders, ['beu-stadtbus-v1', 'jes-regionalbus-v1']);
});
