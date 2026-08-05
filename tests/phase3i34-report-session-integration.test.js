import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 3I.34 (F/H) — the report view is fed by the EXISTING CheckReport, and nothing regresses.
 *
 * One report, one session, one consumer. No second store, no second report, no second vocabulary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { createCheckReportController } from '../js/v2/report/check-report-view.js';
import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { createCheckExplorerModel } from '../js/v2/ui/check-explorer.js';
import { createReviewDashboardModel } from '../js/v2/ui/review-dashboard.js';
import { createBv003Check } from '../js/v2/checks/bv/bv003.js';
import { createBv010Check } from '../js/v2/checks/bv/bv010.js';
import { createBv012Check } from '../js/v2/checks/bv/bv012.js';
import { createBv014Check } from '../js/v2/checks/bv/bv014.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const analysisResult = { type: 'AnalysisResult' };

/** The smallest root the controller needs: it only ever sets innerHTML. */
const fakeRoot = () => ({ innerHTML: '' });

const result = (id, status, severity) => ({
  id, name: `${id}`, category: 'BV', status, severity, message: '',
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: []
});
const report = (results = [result('BV003', 'FAIL', 'WARNING'), result('BV010', 'PASS', 'INFO')]) => ({
  type: 'CheckReport', results, errors: [], summary: { resultCount: results.length, hitCount: 1 }
});

// =====================================================================================
// F — session integration
// =====================================================================================
test('F: the controller renders the report it is handed', () => {
  const root = fakeRoot();
  const controller = createCheckReportController(root);
  controller.setCheckReport(report());
  assert.ok(root.innerHTML.includes('BV003'));
  assert.ok(root.innerHTML.includes('BV010'));
});

test('F: the controller keeps the very same report object — no copy, no second store', () => {
  const controller = createCheckReportController(fakeRoot());
  const original = report();
  controller.setCheckReport(original);
  assert.equal(controller.getCheckReport(), original, 'the same reference');
  assert.equal(JSON.stringify(controller.getCheckReport()), JSON.stringify(original), 'and unchanged');
});

test('F: a new import replaces the previous report cleanly', () => {
  const root = fakeRoot();
  const controller = createCheckReportController(root);
  controller.setCheckReport(report([result('BV003', 'FAIL', 'WARNING')]));
  assert.ok(root.innerHTML.includes('BV003'));
  controller.setCheckReport(report([result('BV012', 'PASS', 'INFO')]));
  assert.ok(root.innerHTML.includes('BV012'));
  assert.ok(!root.innerHTML.includes('BV003'), 'the old report is gone, not appended');
});

test('F: clearing returns the view to its empty state', () => {
  const root = fakeRoot();
  const controller = createCheckReportController(root);
  controller.setCheckReport(report());
  controller.clear();
  assert.equal(controller.getCheckReport(), null);
  assert.match(root.innerHTML, /noch kein|kein Dokument/i);
});

test('F: an empty session result is shown, not thrown', () => {
  const root = fakeRoot();
  const controller = createCheckReportController(root);
  assert.doesNotThrow(() => controller.setCheckReport(null));
  assert.match(root.innerHTML, /noch kein|kein Dokument/i);
});

test('F: a foreign object is refused in a controlled way, keeping the last valid view', () => {
  const root = fakeRoot();
  const controller = createCheckReportController(root);
  const valid = report();
  controller.setCheckReport(valid);
  const rendered = root.innerHTML;
  const outcome = controller.setCheckReport({ type: 'Something' });
  assert.equal(outcome.applied, false);
  assert.equal(outcome.reason, 'INVALID_CHECK_REPORT');
  assert.equal(root.innerHTML, rendered, 'a broken update must not destroy a valid view');
  assert.equal(controller.getCheckReport(), valid);
});

test('F: the controller follows the same shape the existing bootstrap already drives', () => {
  const controller = createCheckReportController(fakeRoot());
  assert.equal(typeof controller.setCheckReport, 'function');
  assert.equal(typeof controller.clear, 'function');
});

test('F: the view module builds no report of its own', () => {
  const view = src('../js/v2/report/check-report-view.js');
  assert.doesNotMatch(view, /type:\s*'CheckReport'/, 'it consumes a report, it does not make one');
  assert.doesNotMatch(view, /hitCount\s*[+=]/, 'no recomputed hit count');
  assert.doesNotMatch(view, /check-runner|rule-engine/);
});

test('F: the report section is mounted in the productive page', () => {
  const html = src('../index.html');
  assert.match(html, /id="pruefbericht"/, 'the report has its own section');
  assert.match(html, /check-report-bootstrap\.js|check-explorer-bootstrap\.js/, 'and is mounted by a module');
});

test('F: the productive bootstrap feeds the report from the SAME event as the explorer', () => {
  const bootstrap = src('../js/v2/check-explorer-bootstrap.js');
  assert.match(bootstrap, /dienstplan:v2-check-report/, 'one event');
  assert.match(bootstrap, /createCheckReportController/, 'the report joins the existing fan-out');
  assert.equal((bootstrap.match(/addEventListener\('dienstplan:v2-check-report'/g) || []).length, 1,
    'exactly one subscription — no parallel channel');
});

// =====================================================================================
// G — privacy in the mounted path
// =====================================================================================
test('G: the report modules store nothing and reach no network', () => {
  for (const path of ['../js/v2/report/check-report-view-model.js', '../js/v2/report/check-report-view.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB|caches\./, path);
    assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/, path);
  }
});

test('G: no document copy travels into the view model', () => {
  const canonicalSchedule = {
    type: 'CanonicalSchedule',
    services: [{ id: 's1', serviceNumber: '2211', handover: { previousServiceNumber: '2217', nextServiceNumber: null }, activities: [{ id: 'a1', originalText: 'GEHEIM | ROH' }] }],
    activities: [{ id: 'a1', originalText: 'GEHEIM | ROH' }],
    document: { source: { rawCells: ['x'] } }
  };
  const model = buildCheckReportViewModel(report([{
    ...result('BV003', 'FAIL', 'WARNING'), affectedServices: ['s1']
  }]), { canonicalSchedule });
  const serialised = JSON.stringify(model);
  assert.ok(!serialised.includes('GEHEIM'));
  assert.ok(!serialised.includes('originalText'));
  assert.ok(!serialised.includes('rawCells'));
});

// =====================================================================================
// H — regression
// =====================================================================================
test('H: the Check Explorer still builds its own model', () => {
  const model = createCheckExplorerModel(report());
  assert.equal(model.checkReportAvailable, true);
  assert.equal(model.rows.length, 2);
});

test('H: the Review Dashboard still builds its own model', () => {
  const model = createReviewDashboardModel(report());
  assert.ok(model, 'the dashboard model survives');
});

test('H: no BV module, runner or rule carries a change from this phase', () => {
  for (const path of ['../js/v2/checks/bv/bv001.js', '../js/v2/checks/bv/bv003.js', '../js/v2/checks/bv/bv010.js',
    '../js/v2/checks/bv/bv012.js', '../js/v2/checks/bv/bv014.js', '../js/v2/checks/check-runner.js',
    '../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/jnv-rule-analysis-controller.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/analysis/driving-projection.js', '../js/v2/excel/excel-canonical-adapter.js',
    '../js/v2/excel/excel-break-import.js']) {
    assert.doesNotMatch(src(path), /3I\.34/, `${path} must be untouched`);
  }
});

test('H: the rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});

const REAL_PLAN = FIXTURES.legacyScheduleXlsx;
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

test('H: BV003 still reports 56 duties on the real plan', { skip: !available && 'reference plan not present' }, async () => {
  const check = await createBv003Check({ canonicalSchedule: await realImport() }).run(analysisResult);
  assert.equal(check.affectedServices.length, 56);
  assert.equal(check.status, 'FAIL');
});

test('H: BV010, BV012 and BV014 still pass on the real plan', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  for (const factory of [createBv010Check, createBv012Check, createBv014Check]) {
    const check = await factory({ canonicalSchedule: schedule }).run(analysisResult);
    assert.equal(check.status, 'PASS', check.id);
  }
});

test('H: the real BV003 result renders with a relief note for every named duty', { skip: !available && 'reference plan not present' }, async () => {
  const canonicalSchedule = await realImport();
  const check = await createBv003Check({ canonicalSchedule }).run(analysisResult);
  const model = buildCheckReportViewModel({
    type: 'CheckReport', results: [check], errors: [], summary: { resultCount: 1, hitCount: 1 }
  }, { canonicalSchedule });
  const row = model.results[0];
  assert.equal(row.status, 'FAIL', 'Variante B: unchanged');
  assert.equal(row.handover.length, 56, 'one relief entry per named duty');
  const explained = row.handover.filter(h => h.classification === 'explained_by_handover');
  assert.equal(explained.length, 56, 'and every one of them is a documented relief');
  assert.doesNotThrow(() => JSON.stringify(model));
});
