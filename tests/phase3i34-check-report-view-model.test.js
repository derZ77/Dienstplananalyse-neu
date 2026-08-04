/**
 * Phase 3I.34 (A/C/G) — the generic report view model.
 *
 * A PURE CONSUMER. It reads the existing CheckReport and produces a presentation projection.
 * It runs no check, moves no threshold, rewrites no status, and never mutates the report.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildCheckReportViewModel,
  REPORT_STATUS_LABELS,
  REPORT_SEVERITY_LABELS
} from '../js/v2/report/check-report-view-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const result = (id, status, severity, extra = {}) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity,
  message: `${id} Meldung`, details: {}, affectedServices: [], affectedActivities: [],
  sourceReferences: [], ...extra
});

/** The eleven results the productive report really carries, in their real order. */
const ELEVEN = () => [
  result('BV001', 'NOT_APPLICABLE', 'INFO'),
  result('BV002', 'NOT_APPLICABLE', 'INFO'),
  result('BV003', 'FAIL', 'WARNING', { affectedServices: ['excel-service:1', 'excel-service:2'] }),
  result('BV005', 'SKIP', 'INFO'),
  result('BV007-START', 'PASS', 'INFO'),
  result('BV007-SPLIT', 'SKIP', 'INFO'),
  result('BV010', 'PASS', 'INFO'),
  result('BV008', 'FAIL', 'VIOLATION', { affectedServices: ['excel-service:1'] }),
  result('BV012', 'PASS', 'INFO'),
  result('BV015_BV018', 'SKIP', 'INFO', { details: { originalStatus: 'DISABLED' } }),
  result('BV014', 'PASS', 'INFO')
];

const report = (results = ELEVEN(), extra = {}) => ({
  type: 'CheckReport',
  results,
  errors: [],
  summary: { resultCount: results.length, hitCount: results.filter(r => r.status === 'FAIL').length },
  ...extra
});

// =====================================================================================
// A — the generic model
// =====================================================================================
test('A: all eleven results are present', () => {
  const model = buildCheckReportViewModel(report());
  assert.equal(model.results.length, 11);
  assert.equal(model.header.resultCount, 11);
});

test('A: the order of the report is preserved exactly', () => {
  const model = buildCheckReportViewModel(report());
  assert.deepEqual(model.results.map(r => r.id), [
    'BV001', 'BV002', 'BV003', 'BV005', 'BV007-START', 'BV007-SPLIT',
    'BV010', 'BV008', 'BV012', 'BV015_BV018', 'BV014'
  ]);
});

test('A: the status counts are taken from the results, each status on its own', () => {
  const { summary } = buildCheckReportViewModel(report());
  assert.deepEqual(summary.status, { PASS: 4, FAIL: 2, SKIP: 3, NOT_APPLICABLE: 2 });
  assert.equal(summary.status.PASS + summary.status.FAIL + summary.status.SKIP + summary.status.NOT_APPLICABLE, 11);
});

test('A: SKIP and NOT_APPLICABLE are never counted as PASS', () => {
  const { summary } = buildCheckReportViewModel(report());
  assert.equal(summary.status.PASS, 4, 'exactly the four real PASS results');
  assert.notEqual(summary.status.PASS, 9);
});

test('A: the severity counts keep WARNING and VIOLATION apart', () => {
  const { summary } = buildCheckReportViewModel(report());
  assert.deepEqual(summary.severity, { INFO: 9, WARNING: 1, VIOLATION: 1, ERROR: 0 });
});

test('A: runner errors are counted separately from rule findings', () => {
  const model = buildCheckReportViewModel(report(ELEVEN(), { errors: [{ code: 'BV_CHECK_UNAVAILABLE' }] }));
  assert.equal(model.summary.runnerErrors, 1);
  assert.equal(model.header.errorCount, 1);
  assert.equal(model.header.findingCount, 2, 'a technical error is not a rule finding');
});

test('A: the model makes no assumption about two results or about results[0]', () => {
  const module = src('../js/v2/report/check-report-view-model.js');
  assert.doesNotMatch(module, /results\[0\]/, 'no first-result shortcut');
  assert.doesNotMatch(module, /length === 2|length == 2/, 'no two-result assumption');
  assert.doesNotMatch(module, /BV008/, 'no rule is singled out by id for the verdict');
});

test('A: the source CheckReport is not mutated', () => {
  const original = report();
  const snapshot = JSON.stringify(original);
  buildCheckReportViewModel(original);
  assert.equal(JSON.stringify(original), snapshot);
});

test('A: status and severity keep their original values alongside a readable label', () => {
  const model = buildCheckReportViewModel(report());
  const bv003 = model.results.find(r => r.id === 'BV003');
  assert.equal(bv003.status, 'FAIL', 'the frozen value survives');
  assert.equal(bv003.severity, 'WARNING');
  assert.equal(bv003.statusLabel, REPORT_STATUS_LABELS.FAIL);
  assert.equal(bv003.severityLabel, REPORT_SEVERITY_LABELS.WARNING);
});

test('A: a FAIL is worded as a finding, never as a proven breach of law', () => {
  assert.equal(REPORT_STATUS_LABELS.FAIL, 'Prüfauffälligkeit');
  const module = src('../js/v2/report/check-report-view-model.js');
  assert.doesNotMatch(module, /Rechtsverstoß|illegal|unzulässig|Gesetzesverstoß/i,
    'the presentation must not pronounce a legal verdict');
});

test('A: each result carries the counts a reader needs', () => {
  const model = buildCheckReportViewModel(report());
  const bv003 = model.results.find(r => r.id === 'BV003');
  assert.equal(bv003.affectedServiceCount, 2);
  assert.equal(bv003.category, 'BV');
  assert.equal(bv003.name, 'BV003 Regelname');
  assert.equal(bv003.message, 'BV003 Meldung');
});

test('A: an unknown status is shown neutrally, never as a finding', () => {
  const model = buildCheckReportViewModel(report([result('BVX', 'SOMETHING_ELSE', 'INFO')]));
  const [row] = model.results;
  assert.equal(row.status, 'SOMETHING_ELSE', 'the value is not swallowed');
  assert.equal(row.statusLabel, 'Unbekannt');
  assert.equal(row.isFinding, false, 'unknown is not a finding');
  assert.equal(model.summary.status.FAIL, 0);
  assert.equal(model.summary.unknownStatusCount, 1);
});

test('A: an unknown severity is shown neutrally too', () => {
  const model = buildCheckReportViewModel(report([result('BVX', 'PASS', 'LOUD')]));
  assert.equal(model.results[0].severityLabel, 'Unbekannt');
  assert.equal(model.summary.severity.VIOLATION, 0);
});

// =====================================================================================
// C — the deactivated one-sixth rule
// =====================================================================================
test('C: the one-sixth rule appears as SKIP / INFO, not as passed', () => {
  const model = buildCheckReportViewModel(report());
  const one = model.results.find(r => r.id === 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'INFO');
  assert.notEqual(one.status, 'PASS');
});

test('C: its original state DISABLED is carried through and named', () => {
  const model = buildCheckReportViewModel(report());
  const one = model.results.find(r => r.id === 'BV015_BV018');
  assert.equal(one.originalStatus, 'DISABLED');
  assert.equal(one.isDisabled, true);
  assert.ok(one.notes.some(note => /nicht aktiviert/i.test(note)), one.notes.join(' | '));
  assert.ok(one.notes.some(note => /freigegeben/i.test(note)));
});

test('C: the deactivated rule is neither a finding nor hidden', () => {
  const model = buildCheckReportViewModel(report());
  const one = model.results.find(r => r.id === 'BV015_BV018');
  assert.equal(one.isFinding, false);
  assert.ok(model.results.includes(one), 'it stays in the list');
  assert.equal(model.summary.severity.VIOLATION, 1, 'only BV008 is a violation');
});

test('C: the view model never suggests activation and touches no flag', () => {
  const module = src('../js/v2/report/check-report-view-model.js');
  assert.doesNotMatch(module, /enabled\s*=|activation|aktivier(en|ung)\b(?!.*nicht)/i,
    'nothing here switches a rule on');
});

// =====================================================================================
// G — privacy
// =====================================================================================
test('G: no file, workbook or buffer object reaches the view model', () => {
  const heavy = report([result('BV001', 'PASS', 'INFO', {
    details: { workbook: { sheets: [] }, file: { name: 'x' }, buffer: new Uint8Array([1, 2, 3]) }
  })]);
  const serialised = JSON.stringify(buildCheckReportViewModel(heavy));
  assert.ok(!serialised.includes('workbook'));
  assert.ok(!serialised.includes('buffer'));
  assert.ok(!serialised.includes('sheets'));
});

test('G: raw rows and original text never travel into the projection', () => {
  const heavy = report([result('BV001', 'PASS', 'INFO', {
    sourceReferences: [{ sourceType: 'excel', fileName: 'plan.xlsx', sheetName: 'S', rowNumber: 7, rawCells: ['a', 'b'] }]
  })]);
  const model = buildCheckReportViewModel(heavy);
  const serialised = JSON.stringify(model);
  assert.ok(!serialised.includes('rawCells'));
  assert.ok(!serialised.includes('"a"'));
  assert.deepEqual(Object.keys(model.results[0].sourceReferences[0]).sort(), ['rowNumber', 'sheetName']);
});

test('G: details are projected shallowly — no nested document survives', () => {
  const heavy = report([result('BV001', 'PASS', 'INFO', {
    details: { minimumMinutes: 30, deviations: [{ serviceNumber: '2211', start: 'BBU', end: 'LGR' }], schedule: { services: [{ activities: [] }] } }
  })]);
  const [row] = buildCheckReportViewModel(heavy).results;
  assert.equal(row.details.minimumMinutes, 30, 'a scalar detail is kept');
  assert.ok(!('schedule' in row.details), 'a nested document is dropped');
});

test('G: the module performs no storage and no network access', () => {
  const module = src('../js/v2/report/check-report-view-model.js');
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(module, /Date\.now|new Date|Math\.random/);
});

// =====================================================================================
// Empty and error states
// =====================================================================================
test('empty: without a report the model says so instead of throwing', () => {
  for (const input of [null, undefined, {}, { type: 'Something' }]) {
    const model = buildCheckReportViewModel(input);
    assert.equal(model.available, false);
    assert.equal(model.emptyReason, 'NO_REPORT');
    assert.deepEqual(model.results, []);
  }
});

test('empty: a report without results is distinguished from a missing report', () => {
  const model = buildCheckReportViewModel(report([]));
  assert.equal(model.available, true);
  assert.equal(model.emptyReason, 'NO_RESULTS');
  assert.equal(model.header.resultCount, 0);
});

test('empty: a report with only SKIP and NOT_APPLICABLE is honest about it', () => {
  const model = buildCheckReportViewModel(report([
    result('BV001', 'NOT_APPLICABLE', 'INFO'), result('BV005', 'SKIP', 'INFO')
  ]));
  assert.equal(model.header.findingCount, 0);
  assert.equal(model.summary.assessedCount, 0, 'nothing was actually assessed');
  assert.equal(model.emptyReason, 'NOTHING_ASSESSED');
});

test('empty: a report carrying only runner errors is shown as partially evaluable', () => {
  const model = buildCheckReportViewModel(report([], { errors: [{ code: 'BV_CHECK_UNAVAILABLE' }] }));
  assert.equal(model.summary.runnerErrors, 1);
  assert.equal(model.emptyReason, 'NO_RESULTS');
  assert.equal(model.available, true);
});

test('header: document facts appear when known and stay neutral when not', () => {
  const model = buildCheckReportViewModel(report(), {
    document: { documentType: 'legacy_excel_schedule', organization: 'JNV', dayType: 'mo_fr' },
    servicesEvaluated: 61
  });
  assert.equal(model.header.documentType, 'legacy_excel_schedule');
  assert.equal(model.header.organization, 'JNV');
  assert.equal(model.header.dayType, 'mo_fr');
  assert.equal(model.header.servicesEvaluated, 61);

  const bare = buildCheckReportViewModel(report());
  assert.equal(bare.header.organization, null);
  assert.equal(bare.header.dayType, null);
  assert.equal(bare.header.documentTitle, 'Prüfbericht', 'a neutral title, never a path');
});

test('header: no absolute path and no file name leak into the header', () => {
  const model = buildCheckReportViewModel(report(), {
    document: { fileName: '/Users/somebody/Downloads/plan.xlsx' }
  });
  const serialised = JSON.stringify(model.header);
  assert.ok(!serialised.includes('/Users/'));
  assert.ok(!serialised.includes('.xlsx'));
});
