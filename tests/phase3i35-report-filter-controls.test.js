/**
 * Phase 3I.35 (D) — real controls for the filter model that already existed.
 *
 * The controls only ever call the controller's own state API. They run no analysis and change no
 * status; they change what is shown.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { renderCheckReportHtml, createCheckReportController } from '../js/v2/report/check-report-view.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const result = (id, status, severity, extra = {}) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity, message: `${id} Meldung`,
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: [], ...extra
});
const ELEVEN = () => [
  result('BV001', 'NOT_APPLICABLE', 'INFO'), result('BV002', 'NOT_APPLICABLE', 'INFO'),
  result('BV003', 'FAIL', 'WARNING', { affectedServices: ['s1', 's2'] }),
  result('BV005', 'SKIP', 'INFO'), result('BV007-START', 'PASS', 'INFO'),
  result('BV007-SPLIT', 'SKIP', 'INFO'), result('BV010', 'PASS', 'INFO'),
  result('BV008', 'FAIL', 'VIOLATION', { affectedServices: ['s1'] }),
  result('BV012', 'PASS', 'INFO'),
  result('BV015_BV018', 'SKIP', 'INFO', { details: { originalStatus: 'DISABLED' } }),
  result('BV014', 'PASS', 'INFO')
];
const report = (results = ELEVEN()) => ({
  type: 'CheckReport', results, errors: [], summary: { resultCount: results.length, hitCount: 2 }
});
const leg = (from, to, handover) => ({
  id: 'a', departureLocation: from, arrivalLocation: to,
  departureTime: { value: '05:00', minutesSinceStartOfDay: 300 },
  arrivalTime: { value: '12:00', minutesSinceStartOfDay: 720 }, handover
});
const scheduleWithChain = {
  type: 'CanonicalSchedule',
  services: [
    { id: 's1', serviceNumber: '2211', handover: { previousServiceNumber: '2217', nextServiceNumber: '2273' },
      activities: [leg('HLZ', 'LGR', { previousServiceNumber: '2217', nextServiceNumber: '2273' })] },
    { id: 's2', serviceNumber: '2212', handover: { previousServiceNumber: null, nextServiceNumber: null },
      activities: [leg('BBU', 'TGR', { previousServiceNumber: null, nextServiceNumber: null })] }
  ],
  activities: []
};
const html = (state = {}, options = {}) =>
  renderCheckReportHtml(buildCheckReportViewModel(report(), { state, ...options }));
const visible = (state, options = {}) =>
  buildCheckReportViewModel(report(), { state, ...options }).visibleResults.map(r => r.id);

// =====================================================================================
// D — the controls exist and are usable
// =====================================================================================
test('D: every filter has a control', () => {
  const out = html();
  for (const name of ['report-filter-search', 'report-filter-status', 'report-filter-severity',
    'report-filter-findings', 'report-filter-handover', 'report-filter-reset']) {
    assert.ok(out.includes(name), `${name} must exist`);
  }
});

test('D: every control carries a visible label', () => {
  const out = html();
  assert.equal((out.match(/<label/g) || []).length >= 5, true, 'search, status, severity and both checkboxes');
  for (const caption of ['Suche', 'Status', 'Schwere', 'Nur Auffälligkeiten', 'Nur mit Ablösehinweis', 'Filter zurücksetzen']) {
    assert.ok(out.includes(caption), `${caption} must be readable`);
  }
  // Every labelled control is reachable by its id.
  for (const match of out.matchAll(/<label[^>]*for="([^"]+)"/g)) {
    assert.ok(out.includes(`id="${match[1]}"`), `label points at a real control: ${match[1]}`);
  }
});

test('D: the controls are native and keyboard-operable', () => {
  const out = html();
  assert.match(out, /<input[^>]*type="search"|<input[^>]*type="text"/);
  assert.equal((out.match(/<select/g) || []).length, 2, 'status and severity');
  assert.equal((out.match(/type="checkbox"/g) || []).length, 2);
  assert.match(out, /<button[^>]*type="button"/, 'a real reset button');
  assert.doesNotMatch(out, /onclick=|oninput=/, 'no inline handlers');
});

test('D: the filter group is a labelled fieldset', () => {
  const out = html();
  assert.match(out, /<fieldset/);
  assert.match(out, /<legend[^>]*>[^<]*Filter/);
});

test('D: the filter area is marked as not for print', () => {
  assert.match(html(), /class="[^"]*no-print/);
});

test('D: the hit count is announced politely', () => {
  const out = html();
  assert.match(out, /aria-live="polite"/);
  assert.ok(out.includes('11 von 11'), out.slice(out.indexOf('aria-live'), out.indexOf('aria-live') + 160));
});

test('D: the hit count follows the filter', () => {
  assert.ok(html({ status: 'FAIL' }).includes('2 von 11'));
  assert.ok(html({ severity: 'VIOLATION' }).includes('1 von 11'));
});

test('D: the active filter state is visible in the controls themselves', () => {
  const out = html({ search: 'BV003', status: 'FAIL', findingsOnly: true });
  assert.match(out, /id="report-filter-search"[^>]*value="BV003"/);
  assert.match(out, /<option value="FAIL" selected/);
  assert.match(out, /id="report-filter-findings"[^>]*checked/);
});

test('D: the controller exposes the state API the controls use', () => {
  const root = { innerHTML: '' };
  const controller = createCheckReportController(root);
  controller.setCheckReport(report());
  const outcome = controller.setState({ status: 'FAIL' });
  assert.equal(outcome.applied, true);
  assert.ok(root.innerHTML.includes('2 von 11'));
  // SUPERSEDED BY PHASE 3I.36: the complete print list also names BV010, deliberately — a screen
  // filter must never remove a result from the printout. The SCREEN block is what the filter drives.
  const screen = root.innerHTML.slice(root.innerHTML.indexOf('report-results'), root.innerHTML.indexOf('report-print-all'));
  assert.ok(screen.includes('BV003'));
  assert.ok(!screen.includes('data-result-id="BV010"'));
});

test('D: resetting restores all eleven results', () => {
  const root = { innerHTML: '' };
  const controller = createCheckReportController(root);
  controller.setCheckReport(report());
  controller.setState({ status: 'FAIL', search: 'BV003', findingsOnly: true });
  assert.ok(root.innerHTML.includes('1 von 11'));
  controller.setState({});
  assert.ok(root.innerHTML.includes('11 von 11'));
  // SUPERSEDED BY PHASE 3I.36: counted on the screen block; the print projection lists all eleven too.
  const screen = root.innerHTML.slice(root.innerHTML.indexOf('report-results'), root.innerHTML.indexOf('report-print-all'));
  assert.equal((screen.match(/data-result-id=/g) || []).length, 11);
});

test('D: setting a filter never changes a status or the summary', () => {
  const root = { innerHTML: '' };
  const controller = createCheckReportController(root);
  const original = report();
  const snapshot = JSON.stringify(original);
  controller.setCheckReport(original);
  controller.setState({ status: 'FAIL' });
  assert.equal(JSON.stringify(original), snapshot, 'the report is untouched');
  assert.ok(root.innerHTML.includes('Prüfauffälligkeiten'), 'the summary still describes the whole report');
});

// =====================================================================================
// The filter behaviour §10 asks for, one by one
// =====================================================================================
test('§10: searching by rule id, by the disabled rule and by duty number', () => {
  assert.deepEqual(visible({ search: 'BV003' }), ['BV003']);
  assert.deepEqual(visible({ search: 'BV015_BV018' }), ['BV015_BV018']);
  assert.deepEqual(
    buildCheckReportViewModel(report(), { canonicalSchedule: scheduleWithChain, state: { search: '2211' } })
      .visibleResults.map(r => r.id),
    ['BV003', 'BV008'], 'both rules name duty 2211');
});

test('§10: status and severity filters', () => {
  assert.deepEqual(visible({ status: 'FAIL' }), ['BV003', 'BV008']);
  assert.deepEqual(visible({ status: 'SKIP' }), ['BV005', 'BV007-SPLIT', 'BV015_BV018']);
  assert.deepEqual(visible({ severity: 'WARNING' }), ['BV003']);
  assert.deepEqual(visible({ severity: 'VIOLATION' }), ['BV008']);
});

test('§10: findings only, relief only, and a combination', () => {
  assert.deepEqual(visible({ findingsOnly: true }), ['BV003', 'BV008']);
  assert.deepEqual(
    buildCheckReportViewModel(report(), { canonicalSchedule: scheduleWithChain, state: { handoverOnly: true } })
      .visibleResults.map(r => r.id), ['BV003', 'BV008']);
  assert.deepEqual(visible({ findingsOnly: true, severity: 'WARNING' }), ['BV003']);
  assert.deepEqual(visible({ status: 'PASS', severity: 'VIOLATION' }), []);
});

test('§10: an unknown status or severity is filtered neutrally, never as a finding', () => {
  const odd = report([result('BVX', 'WHATEVER', 'LOUD'), ...ELEVEN()]);
  const model = buildCheckReportViewModel(odd, { state: { findingsOnly: true } });
  assert.ok(!model.visibleResults.some(r => r.id === 'BVX'));
  assert.deepEqual(buildCheckReportViewModel(odd, { state: { status: 'WHATEVER' } })
    .visibleResults.map(r => r.id), ['BVX'], 'it can still be looked up explicitly');
});

test('§10: an empty filter result is explained, and the full list survives underneath', () => {
  const out = html({ status: 'PASS', severity: 'VIOLATION' });
  assert.match(out, /Kein Ergebnis entspricht der aktuellen Auswahl/);
  assert.ok(out.includes('0 von 11'));
});

test('D: the controls introduce no external dependency and no storage', () => {
  const view = src('../js/v2/report/check-report-view.js');
  assert.doesNotMatch(view, /import .* from ['"]http|cdn|unpkg/);
  assert.doesNotMatch(view, /localStorage|sessionStorage|indexedDB|fetch\(/);
});
