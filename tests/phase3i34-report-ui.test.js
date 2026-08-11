/**
 * Phase 3I.34 (D/E) — search, filters and the rendered report.
 *
 * The view renders an HTML string from the view model. Filters change WHAT IS SHOWN and nothing
 * else: no re-analysis, no status change, no new vocabulary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { renderCheckReportHtml } from '../js/v2/report/check-report-view.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const result = (id, status, severity, extra = {}) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity,
  message: `${id} Meldung`, details: {}, affectedServices: [], affectedActivities: [],
  sourceReferences: [], ...extra
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
  type: 'CheckReport', results, errors: [],
  summary: { resultCount: results.length, hitCount: 2 }
});
/** A schedule whose duty 2211 carries a confirmed relief chain, used for the handover filter. */
const leg = (id, from, to, handover) => ({
  id, departureLocation: from, arrivalLocation: to,
  departureTime: { value: '05:00', minutesSinceStartOfDay: 300 },
  arrivalTime: { value: '12:00', minutesSinceStartOfDay: 720 },
  handover
});
const scheduleWithChain = {
  type: 'CanonicalSchedule',
  services: [
    { id: 's1', serviceNumber: '2211', handover: { previousServiceNumber: '2217', nextServiceNumber: '2273' },
      activities: [leg('a1', 'HLZ', 'LGR', { previousServiceNumber: '2217', nextServiceNumber: '2273' })] },
    { id: 's2', serviceNumber: '2212', handover: { previousServiceNumber: null, nextServiceNumber: null },
      activities: [leg('a2', 'BBU', 'TGR', { previousServiceNumber: null, nextServiceNumber: null })] }
  ],
  activities: []
};
const visible = (state, options = {}) =>
  buildCheckReportViewModel(report(), { state, ...options }).visibleResults.map(r => r.id);

// =====================================================================================
// D — search and filters
// =====================================================================================
test('D: the text search finds a rule by its id', () => {
  assert.deepEqual(visible({ search: 'BV003' }), ['BV003']);
  assert.deepEqual(visible({ search: 'bv003' }), ['BV003'], 'case does not matter');
});

test('D: the text search finds a rule by its name', () => {
  assert.deepEqual(visible({ search: 'BV010 Regelname' }), ['BV010']);
});

test('D: the text search finds a rule by an affected duty number', () => {
  const model = buildCheckReportViewModel(report(), { canonicalSchedule: scheduleWithChain, state: { search: '2212' } });
  assert.deepEqual(model.visibleResults.map(r => r.id), ['BV003'], 'only the rule that names duty 2212');
});

test('D: the status filter shows exactly that status', () => {
  assert.deepEqual(visible({ status: 'FAIL' }), ['BV003', 'BV008']);
  assert.deepEqual(visible({ status: 'PASS' }), ['BV007-START', 'BV010', 'BV012', 'BV014']);
  assert.deepEqual(visible({ status: 'SKIP' }), ['BV005', 'BV007-SPLIT', 'BV015_BV018']);
});

test('D: the severity filter keeps WARNING and VIOLATION apart', () => {
  assert.deepEqual(visible({ severity: 'WARNING' }), ['BV003']);
  assert.deepEqual(visible({ severity: 'VIOLATION' }), ['BV008']);
});

test('D: "findings only" shows the findings and nothing else', () => {
  assert.deepEqual(visible({ findingsOnly: true }), ['BV003', 'BV008']);
});

test('D: "with relief note only" needs the schedule and shows just those', () => {
  const model = buildCheckReportViewModel(report(), {
    canonicalSchedule: scheduleWithChain, state: { handoverOnly: true }
  });
  // Every rule that NAMES a duty with a documented chain carries the note — BV008 names 2211 too.
  assert.deepEqual(model.visibleResults.map(r => r.id), ['BV003', 'BV008']);
  const bare = buildCheckReportViewModel(report(), { state: { handoverOnly: true } });
  assert.deepEqual(bare.visibleResults, [], 'without a schedule there is no relief note to filter on');
});

test('D: filters combine, and an empty result set is stated rather than faked', () => {
  const model = buildCheckReportViewModel(report(), { state: { status: 'PASS', severity: 'VIOLATION' } });
  assert.deepEqual(model.visibleResults, []);
  assert.equal(model.filteredEmpty, true);
  assert.equal(model.results.length, 11, 'the full list is still there underneath');
});

test('D: a filter changes no status, no severity and no count', () => {
  const all = buildCheckReportViewModel(report());
  const filtered = buildCheckReportViewModel(report(), { state: { status: 'FAIL' } });
  assert.deepEqual(filtered.summary, all.summary, 'the summary describes the report, not the filter');
  assert.equal(filtered.results.find(r => r.id === 'BV010').status, 'PASS');
});

test('D: filtering runs no analysis — the module imports no check or rule engine', () => {
  const module = src('../js/v2/report/check-report-view-model.js');
  assert.doesNotMatch(module, /check-runner|rule-engine|checks\/bv\//, 'a consumer never re-runs the checks');
});

// =====================================================================================
// E — the rendered report
// =====================================================================================
/** The on-screen block only — since Phase 3I.36 the print projection follows it in the markup. */
const screenPart = (out) => {
  const start = out.indexOf('report-results');
  const end = out.indexOf('report-print-all');
  return start < 0 ? out : out.slice(start, end < 0 ? undefined : end);
};
const html = (options = {}) => renderCheckReportHtml(buildCheckReportViewModel(report(), options));

test('E: the header shows every headline figure', () => {
  const out = renderCheckReportHtml(buildCheckReportViewModel(report(), {
    document: { documentType: 'legacy_excel_schedule', organization: 'JNV', dayType: 'mo_fr' },
    servicesEvaluated: 61
  }));
  for (const needle of ['legacy_excel_schedule', 'JNV', 'mo_fr', '61', 'Regelergebnisse', 'Prüfauffälligkeiten', 'Warnungen']) {
    assert.ok(out.includes(needle), `header must show ${needle}`);
  }
});

test('E: all eleven results are rendered', () => {
  const out = html();
  for (const id of ['BV001', 'BV002', 'BV003', 'BV005', 'BV007-START', 'BV007-SPLIT',
    'BV010', 'BV008', 'BV012', 'BV015_BV018', 'BV014']) {
    assert.ok(out.includes(id), `${id} must appear`);
  }
  // SUPERSEDED BY PHASE 3I.36: the document now carries TWO lists — the filtered on-screen
  // one and the complete print projection. The screen block is the one this asserts on.
  assert.equal((screenPart(out).match(/data-result-id=/g) || []).length, 11);
});

test('E: the status is readable as TEXT, not only as a colour', () => {
  const out = html();
  assert.ok(out.includes('Prüfauffälligkeit'), 'FAIL is worded');
  assert.ok(out.includes('Bestanden'), 'PASS is worded');
  assert.ok(out.includes('Übersprungen'));
  assert.ok(out.includes('Nicht anwendbar'));
  assert.doesNotMatch(out, /class="[^"]*"\s*>\s*<\/span>/, 'no colour-only status marker');
});

test('E: every status carries an accessible name alongside its symbol', () => {
  const out = html();
  const symbols = out.match(/aria-hidden="true"/g) || [];
  assert.ok(symbols.length >= 11, 'symbols are decorative; the text carries the meaning');
});

test('E: the detail areas are native, keyboard-operable disclosures', () => {
  const out = html();
  // SUPERSEDED BY PHASE 3I.36: the document now carries TWO lists — the filtered on-screen
  // one and the complete print projection. The screen block is the one this asserts on.
  assert.equal((screenPart(out).match(/<details/g) || []).length, 11);
  assert.equal((screenPart(out).match(/<summary/g) || []).length, 11);
  assert.doesNotMatch(out, /onclick=/, 'no script-only expander');
});

test('E: the heading structure is sensible and the report is one landmark', () => {
  const out = html();
  assert.match(out, /<h2[^>]*>/, 'a report heading');
  assert.match(out, /<section[^>]*role="region"|<section[^>]*aria-labelledby=/, 'a labelled region');
});

test('E: no rule needs a renderer of its own', () => {
  const view = src('../js/v2/report/check-report-view.js');
  for (const id of ['BV001', 'BV002', 'BV005', 'BV007', 'BV008', 'BV010', 'BV012', 'BV014']) {
    assert.ok(!view.includes(`'${id}'`), `${id} must not be special-cased in the view`);
  }
});

test('E: an unknown status renders neutrally, never as a finding', () => {
  const model = buildCheckReportViewModel(report([result('BVX', 'WHATEVER', 'INFO')]));
  const out = renderCheckReportHtml(model);
  const article = out.slice(out.indexOf('<article'));
  assert.ok(article.includes('Unbekannt'));
  assert.ok(!article.includes('Prüfauffälligkeit'), 'the row itself is never labelled a finding');
  assert.equal(model.header.findingCount, 0);
});

test('E: the empty states are rendered as text, not as an exception', () => {
  assert.match(renderCheckReportHtml(buildCheckReportViewModel(null)), /noch kein|kein Dokument/i);
  assert.match(renderCheckReportHtml(buildCheckReportViewModel(report([]))), /keine Regelergebnisse/i);
  assert.match(renderCheckReportHtml(buildCheckReportViewModel(report([
    result('BV001', 'NOT_APPLICABLE', 'INFO')
  ]))), /nicht bewertet|nichts bewertet|keine Regel wurde/i);
});

test('E: rendering never throws, whatever it is handed', () => {
  for (const input of [null, undefined, {}, { available: true }, { results: null }]) {
    assert.doesNotThrow(() => renderCheckReportHtml(input));
  }
});

test('E: content is escaped — a report cannot inject markup', () => {
  const nasty = report([result('<img src=x onerror=alert(1)>', 'PASS', 'INFO')]);
  const out = renderCheckReportHtml(buildCheckReportViewModel(nasty));
  assert.ok(!out.includes('<img src=x'), 'the tag is escaped');
  assert.ok(out.includes('&lt;img'));
});

test('E: the view neither stores nor sends anything', () => {
  const view = src('../js/v2/report/check-report-view.js');
  assert.doesNotMatch(view, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(view, /fetch\(|XMLHttpRequest|WebSocket/);
});

test('E: the structure is print-prepared — blocks, no runaway table', () => {
  const out = html();
  assert.match(out, /report-summary/, 'a summary block');
  assert.match(out, /report-results/, 'a results block');
  assert.doesNotMatch(out, /<table/, 'no wide table that cannot break across pages');
});
