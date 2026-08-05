import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 3I.35 (B/C) — the relief information and the affected-duty list in the live report.
 *
 * VARIANTE B stays binding: BV003 keeps FAIL/WARNING. What changes is only that the reader can
 * finally SEE which duties are meant and what the plan says about them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { buildCheckReportViewModel, deriveReportContext } from '../js/v2/report/check-report-view-model.js';
import { renderCheckReportHtml } from '../js/v2/report/check-report-view.js';
import { createBv003Check } from '../js/v2/checks/bv/bv003.js';

const analysisResult = { type: 'AnalysisResult' };
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

const liveModel = async () => {
  const canonicalSchedule = await realImport();
  const check = await createBv003Check({ canonicalSchedule }).run(analysisResult);
  const context = deriveReportContext({
    primaryImport: { documentType: 'legacy_excel_schedule', data: canonicalSchedule },
    ruleAnalysis: { ruleSet: { organization: 'JNV' } },
    checkReport: null
  });
  return {
    check,
    model: buildCheckReportViewModel(
      { type: 'CheckReport', results: [check], errors: [], summary: { resultCount: 1, hitCount: 1 } },
      { canonicalSchedule, document: context.metadata, servicesEvaluated: context.metadata.serviceCount }
    )
  };
};

// =====================================================================================
// B — BV003 live
// =====================================================================================
test('B: the real relief information is visible in the live model', { skip: !available && 'reference plan not present' }, async () => {
  const { model } = await liveModel();
  const row = model.results[0];
  assert.equal(row.handoverAvailable, true);
  assert.equal(row.handover.length, 56);
  const entry = row.handover[0];
  assert.match(entry.serviceNumber, /^\d+$/);
  assert.ok(entry.startLocation && entry.endLocation);
  assert.ok(entry.chain, 'a documented chain is shown');
});

test('B: all 56 findings stay FAIL / WARNING — Variante B is untouched', { skip: !available && 'reference plan not present' }, async () => {
  const { check, model } = await liveModel();
  assert.equal(check.affectedServices.length, 56);
  assert.equal(model.results[0].status, 'FAIL');
  assert.equal(model.results[0].severity, 'WARNING');
  assert.equal(model.results[0].isFinding, true);
  assert.equal(model.summary.status.FAIL, 1, 'one rule reports, and it still reports');
});

test('B: every relief note says plainly that the verdict was left alone', { skip: !available && 'reference plan not present' }, async () => {
  const { model } = await liveModel();
  for (const entry of model.results[0].handover) {
    assert.ok(['consistent', 'partial', 'conflicting', 'missing'].includes(entry.evidence));
    assert.ok(entry.note.length > 0);
    assert.doesNotMatch(entry.note, /regelkonform|zulässig|kein Verstoß|bestanden/i);
  }
});

test('B: the check result itself is never mutated by the projection', { skip: !available && 'reference plan not present' }, async () => {
  const canonicalSchedule = await realImport();
  const check = await createBv003Check({ canonicalSchedule }).run(analysisResult);
  const snapshot = JSON.stringify(check);
  buildCheckReportViewModel({ type: 'CheckReport', results: [check], errors: [], summary: {} }, { canonicalSchedule });
  assert.equal(JSON.stringify(check), snapshot);
});

test('B: without a schedule no chain is invented, and the finding still renders', () => {
  const report = {
    type: 'CheckReport',
    results: [{
      id: 'BV003', name: 'BV003', category: 'BV', status: 'FAIL', severity: 'WARNING',
      message: '', details: {}, affectedServices: ['s1'], affectedActivities: [], sourceReferences: []
    }],
    errors: [], summary: { resultCount: 1, hitCount: 1 }
  };
  const model = buildCheckReportViewModel(report, {});
  assert.deepEqual(model.results[0].handover, []);
  assert.equal(model.results[0].status, 'FAIL');
  const out = renderCheckReportHtml(model);
  assert.ok(out.includes('BV003'));
  assert.ok(!out.includes('Ablösekette:'), 'nothing is drawn where nothing is known');
});

// =====================================================================================
// C — the affected duties as a usable list
// =====================================================================================
const withDuties = (affected, services) => ({
  report: {
    type: 'CheckReport',
    results: [{
      id: 'BV003', name: 'BV003', category: 'BV', status: 'FAIL', severity: 'WARNING',
      message: '', details: {}, affectedServices: affected, affectedActivities: [], sourceReferences: []
    }],
    errors: [], summary: { resultCount: 1, hitCount: 1 }
  },
  schedule: { type: 'CanonicalSchedule', services, activities: [] }
});

const service = (id, number) => ({
  id, serviceNumber: number,
  handover: { previousServiceNumber: null, nextServiceNumber: null },
  activities: [{
    id: `${id}-a`, departureLocation: 'BBU', arrivalLocation: 'TGR',
    originalText: 'ROHZEILE | GEHEIM',
    departureTime: { value: '05:00', minutesSinceStartOfDay: 300 },
    arrivalTime: { value: '12:00', minutesSinceStartOfDay: 720 },
    handover: { previousServiceNumber: null, nextServiceNumber: null }
  }]
});

test('C: the affected duty NUMBERS are in the model, not just a count', () => {
  const { report, schedule } = withDuties(['s1', 's2'], [service('s1', '2211'), service('s2', '2212')]);
  const row = buildCheckReportViewModel(report, { canonicalSchedule: schedule }).results[0];
  assert.equal(row.affectedServiceCount, 2);
  assert.deepEqual(row.affectedServiceNumbers, ['2211', '2212']);
});

test('C: the duty numbers are rendered so a reader can act on them', () => {
  const { report, schedule } = withDuties(['s1', 's2'], [service('s1', '2211'), service('s2', '2212')]);
  const out = renderCheckReportHtml(buildCheckReportViewModel(report, { canonicalSchedule: schedule }));
  assert.ok(out.includes('2211'));
  assert.ok(out.includes('2212'));
  assert.match(out, /report-affected/, 'they live in their own block');
});

test('C: no full service object and no raw activity reaches the model', () => {
  const { report, schedule } = withDuties(['s1'], [service('s1', '2211')]);
  const serialised = JSON.stringify(buildCheckReportViewModel(report, { canonicalSchedule: schedule }));
  assert.ok(!serialised.includes('ROHZEILE'));
  assert.ok(!serialised.includes('originalText'));
  assert.ok(!serialised.includes('"activities"'));
});

test('C: a long duty list stays reachable, and is collapsed rather than cut off', () => {
  const services = Array.from({ length: 56 }, (_, index) => service(`s${index}`, String(2200 + index)));
  const { report, schedule } = withDuties(services.map(s => s.id), services);
  const model = buildCheckReportViewModel(report, { canonicalSchedule: schedule });
  assert.equal(model.results[0].affectedServiceNumbers.length, 56, 'nothing is truncated');
  const out = renderCheckReportHtml(model);
  assert.ok(out.includes('2200') && out.includes('2255'), 'first and last are both present');
  assert.match(out, /<details[^>]*class="report-affected"/, 'a long list is collapsed, not dropped');
});

test('C: where a duty id has no number the entry is skipped, never guessed', () => {
  const { report, schedule } = withDuties(['s1', 'unknown-id'], [service('s1', '2211')]);
  const row = buildCheckReportViewModel(report, { canonicalSchedule: schedule }).results[0];
  assert.deepEqual(row.affectedServiceNumbers, ['2211']);
  assert.equal(row.affectedServiceCount, 2, 'the count still reflects what the check said');
});

test('C: without a schedule the count remains, and no number is fabricated', () => {
  const { report } = withDuties(['s1', 's2'], []);
  const row = buildCheckReportViewModel(report, {}).results[0];
  assert.equal(row.affectedServiceCount, 2);
  assert.deepEqual(row.affectedServiceNumbers, []);
});

test('C (real): BV003 shows all 56 duty numbers', { skip: !available && 'reference plan not present' }, async () => {
  const { model } = await liveModel();
  assert.equal(model.results[0].affectedServiceNumbers.length, 56);
  assert.ok(model.results[0].affectedServiceNumbers.every(number => /^\d+$/.test(number)));
});
