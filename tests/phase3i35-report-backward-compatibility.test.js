/**
 * Phase 3I.35 (E/F/G) — the older, report-only path keeps working, and nothing regresses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { createCheckReportController, renderCheckReportHtml } from '../js/v2/report/check-report-view.js';
import { buildCheckReportViewModel, deriveReportContext } from '../js/v2/report/check-report-view-model.js';
import { createCheckExplorerModel } from '../js/v2/ui/check-explorer.js';
import { createReviewDashboardModel } from '../js/v2/ui/review-dashboard.js';
import { createBv003Check } from '../js/v2/checks/bv/bv003.js';
import { createBv010Check } from '../js/v2/checks/bv/bv010.js';
import { createBv012Check } from '../js/v2/checks/bv/bv012.js';
import { createBv014Check } from '../js/v2/checks/bv/bv014.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const analysisResult = { type: 'AnalysisResult' };
const root = () => ({ innerHTML: '' });

const result = (id, status, severity, extra = {}) => ({
  id, name: id, category: 'BV', status, severity, message: '',
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: [], ...extra
});
const report = (results = [result('BV003', 'FAIL', 'WARNING'), result('BV010', 'PASS', 'INFO')]) => ({
  type: 'CheckReport', results, errors: [], summary: { resultCount: results.length, hitCount: 1 }
});

// =====================================================================================
// E — backward compatibility
// =====================================================================================
test('E: a report handed over WITHOUT any context still renders completely', () => {
  const element = root();
  const controller = createCheckReportController(element);
  const outcome = controller.setCheckReport(report());
  assert.equal(outcome.applied, true);
  assert.ok(element.innerHTML.includes('BV003'));
  assert.ok(element.innerHTML.includes('BV010'));
});

test('E: missing metadata shows as "unbekannt", never as empty or zero', () => {
  const out = renderCheckReportHtml(buildCheckReportViewModel(report()));
  assert.ok(out.includes('unbekannt'));
  assert.ok(!out.includes('>null<'));
  assert.ok(!out.includes('>undefined<'));
});

test('E: a missing schedule leaves BV003 without an invented chain', () => {
  const model = buildCheckReportViewModel(report([result('BV003', 'FAIL', 'WARNING', { affectedServices: ['s1'] })]));
  assert.deepEqual(model.results[0].handover, []);
  assert.deepEqual(model.results[0].affectedServiceNumbers, []);
  assert.equal(model.results[0].affectedServiceCount, 1, 'the count the check gave stays');
});

test('E: setting the context later upgrades the view without a second report', () => {
  const element = root();
  const controller = createCheckReportController(element);
  const original = report();
  controller.setCheckReport(original);
  controller.setReportContext({ metadata: { organization: 'JNV', documentType: 'legacy_excel_schedule', dayType: 'mo_fr', serviceCount: 61 } });
  assert.ok(element.innerHTML.includes('JNV'));
  assert.ok(element.innerHTML.includes('61'));
  assert.equal(controller.getCheckReport(), original, 'the very same report object');
});

test('E: a new import replaces the previous report and its context', () => {
  const element = root();
  const controller = createCheckReportController(element);
  controller.setCheckReport(report([result('BV003', 'FAIL', 'WARNING')]));
  controller.setReportContext({ metadata: { organization: 'JNV', documentType: null, dayType: null, serviceCount: 61 } });
  controller.setCheckReport(report([result('BV012', 'PASS', 'INFO')]));
  controller.setReportContext({ metadata: { organization: null, documentType: null, dayType: null, serviceCount: null } });
  assert.ok(element.innerHTML.includes('BV012'));
  assert.ok(!element.innerHTML.includes('BV003'));
  assert.ok(!element.innerHTML.includes('JNV'), 'the old context is gone too');
});

test('E: clearing the session returns the report to its empty state', () => {
  const element = root();
  const controller = createCheckReportController(element);
  controller.setCheckReport(report());
  controller.clear();
  assert.equal(controller.getCheckReport(), null);
  assert.match(element.innerHTML, /noch kein|kein Dokument/i);
});

test('E: an analysis failure without a report throws nothing', () => {
  const element = root();
  const controller = createCheckReportController(element);
  assert.doesNotThrow(() => controller.setCheckReport(null));
  assert.doesNotThrow(() => controller.setReportContext(null));
  assert.doesNotThrow(() => controller.setReportContext({ metadata: null, canonicalSchedule: 'nonsense' }));
  assert.match(element.innerHTML, /noch kein|kein Dokument/i);
});

test('E: the filters stay operable even on an empty report', () => {
  const element = root();
  const controller = createCheckReportController(element);
  controller.setCheckReport(report([]));
  assert.doesNotThrow(() => controller.setState({ status: 'FAIL' }));
  assert.ok(element.innerHTML.includes('report-filter-search'), 'the controls remain');
});

// =====================================================================================
// F — privacy
// =====================================================================================
test('F: no file, workbook, buffer or path travels through the context', () => {
  const context = deriveReportContext({
    primaryImport: { documentType: 'x', data: { type: 'CanonicalSchedule', services: [], activities: [], document: { source: { rawCells: ['x'], fileName: '/Users/x/plan.xlsx' } } } },
    primaryFileName: '/Users/x/plan.xlsx'
  });
  const serialised = JSON.stringify(context.metadata);
  assert.ok(!serialised.includes('/Users/'));
  assert.ok(!serialised.includes('rawCells'));
  assert.ok(!serialised.includes('.xlsx'));
});

test('F: the report modules never store and never reach the network', () => {
  for (const path of ['../js/v2/report/check-report-view-model.js', '../js/v2/report/check-report-view.js',
    '../js/v2/check-explorer-bootstrap.js', '../js/v2/pdf-import-bootstrap.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/, path);
    assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/, path);
  }
});

test('F: no file name reaches the rendered report', () => {
  const out = renderCheckReportHtml(buildCheckReportViewModel(report(), {
    document: { documentType: 'legacy_excel_schedule', fileName: 'plan.xlsx' }
  }));
  assert.ok(!out.includes('plan.xlsx'));
});

// =====================================================================================
// G — regression
// =====================================================================================
const ELEVEN = () => [
  result('BV001', 'NOT_APPLICABLE', 'INFO'), result('BV002', 'NOT_APPLICABLE', 'INFO'),
  result('BV003', 'FAIL', 'WARNING'), result('BV005', 'SKIP', 'INFO'),
  result('BV007-START', 'PASS', 'INFO'), result('BV007-SPLIT', 'SKIP', 'INFO'),
  result('BV010', 'PASS', 'INFO'), result('BV008', 'FAIL', 'VIOLATION'),
  result('BV012', 'PASS', 'INFO'),
  result('BV015_BV018', 'SKIP', 'INFO', { details: { originalStatus: 'DISABLED' } }),
  result('BV014', 'PASS', 'INFO')
];

test('G: all eleven results remain visible and correctly counted', () => {
  const model = buildCheckReportViewModel(report(ELEVEN()));
  assert.equal(model.results.length, 11);
  assert.deepEqual(model.summary.status, { PASS: 4, FAIL: 2, SKIP: 3, NOT_APPLICABLE: 2 });
  // SUPERSEDED BY PHASE 3I.36: the print projection adds a second, complete list to the markup.
  const out = renderCheckReportHtml(model);
  const screen = out.slice(out.indexOf('report-results'), out.indexOf('report-print-all'));
  assert.equal((screen.match(/data-result-id=/g) || []).length, 11);
});

test('G: the one-sixth rule stays SKIP / INFO / DISABLED', () => {
  const one = buildCheckReportViewModel(report(ELEVEN())).results.find(r => r.id === 'BV015_BV018');
  assert.equal(one.status, 'SKIP');
  assert.equal(one.severity, 'INFO');
  assert.equal(one.originalStatus, 'DISABLED');
  assert.equal(one.isFinding, false);
});

test('G: Check Explorer and Review Dashboard are unaffected', () => {
  assert.equal(createCheckExplorerModel(report(ELEVEN())).rows.length, 11);
  assert.ok(createReviewDashboardModel(report(ELEVEN())));
});

test('G: no rule, runner or import carries a change from this phase', () => {
  for (const path of ['../js/v2/checks/bv/bv001.js', '../js/v2/checks/bv/bv003.js', '../js/v2/checks/bv/bv010.js',
    '../js/v2/checks/bv/bv012.js', '../js/v2/checks/bv/bv014.js', '../js/v2/checks/check-runner.js',
    '../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/jnv-rule-analysis-controller.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/analysis/driving-projection.js', '../js/v2/excel/excel-canonical-adapter.js',
    '../js/v2/excel/excel-break-import.js', '../js/v2/import/legacy-excel-import-adapter.js']) {
    assert.doesNotMatch(src(path), /3I\.35/, `${path} must be untouched`);
  }
});

test('G: the rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});

test('G: no print or export was smuggled in', () => {
  for (const path of ['../js/v2/report/check-report-view.js', '../js/v2/report/check-report-view-model.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /window\.print|toBlob|createObjectURL|download=|text\/csv/, path);
  }
});

const REAL_PLAN = '/Users/joergziegler/Downloads/Test/B_20260727_MoFrFerien.xlsx';
const available = (() => { try { readFileSync(REAL_PLAN); return true; } catch { return false; } })();

const realImport = async () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  const book = sandbox.XLSX.read(readFileSync(REAL_PLAN), { type: 'buffer' });
  const workbook = {
    sheets: book.SheetNames.map(name => ({
      name,
      rows: sandbox.XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: null })
        .map(row => row.map(cell => cell === null ? '' : String(cell).trim()))
    }))
  };
  const { analyzeLegacyExcelWorkbook } = await import('../js/v2/import/legacy-excel-import-adapter.js');
  return analyzeLegacyExcelWorkbook(workbook, { sourceName: 'plan.xlsx' }).data;
};

test('G (real): the real numbers are unchanged', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  assert.equal(schedule.services.length, 61, 'the plan still yields 61 duties');
  const bv003 = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(bv003.affectedServices.length, 56);
  for (const factory of [createBv010Check, createBv012Check, createBv014Check]) {
    assert.equal((await factory({ canonicalSchedule: schedule }).run(analysisResult)).status, 'PASS');
  }
});
