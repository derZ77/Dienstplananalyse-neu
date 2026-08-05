/**
 * Phase 3I.36 (A) — the printable A4 report.
 *
 * The print output is the SAME view, styled for paper. A screen filter must never quietly remove a
 * result from an official printout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { renderCheckReportHtml } from '../js/v2/report/check-report-view.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = src('../index.html');

const result = (id, status, severity, extra = {}) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity, message: `${id} Meldung`,
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: [], ...extra
});
const ELEVEN = () => [
  result('BV001', 'NOT_APPLICABLE', 'INFO'), result('BV002', 'NOT_APPLICABLE', 'INFO'),
  result('BV003', 'FAIL', 'WARNING', { affectedServices: ['s1'] }),
  result('BV005', 'SKIP', 'INFO'), result('BV007-START', 'PASS', 'INFO'),
  result('BV007-SPLIT', 'SKIP', 'INFO'), result('BV010', 'PASS', 'INFO'),
  result('BV008', 'FAIL', 'VIOLATION'), result('BV012', 'PASS', 'INFO'),
  result('BV015_BV018', 'SKIP', 'INFO', { details: { originalStatus: 'DISABLED' } }),
  result('BV014', 'PASS', 'INFO')
];
const report = () => ({ type: 'CheckReport', results: ELEVEN(), errors: [], summary: { resultCount: 11, hitCount: 2 } });
const leg = (from, to, handover) => ({
  id: `a-${from}-${to}`, departureLocation: from, arrivalLocation: to,
  departureTime: { value: '05:00', minutesSinceStartOfDay: 300 },
  arrivalTime: { value: '12:00', minutesSinceStartOfDay: 720 }, handover
});
/** 2217 → 2211 → 2273, with BOTH counterparts present so the chain is confirmed. */
const schedule = {
  type: 'CanonicalSchedule',
  services: [
    { id: 's1', serviceNumber: '2211', handover: { previousServiceNumber: '2217', nextServiceNumber: '2273' },
      activities: [leg('HLZ', 'LGR', { previousServiceNumber: '2217', nextServiceNumber: '2273' })] },
    { id: 's2', serviceNumber: '2217', handover: { previousServiceNumber: null, nextServiceNumber: '2211' },
      activities: [leg('BBU', 'HLZ', { previousServiceNumber: null, nextServiceNumber: '2211' })] },
    { id: 's3', serviceNumber: '2273', handover: { previousServiceNumber: '2211', nextServiceNumber: null },
      activities: [leg('LGR', 'BBU', { previousServiceNumber: '2211', nextServiceNumber: null })] }
  ],
  activities: []
};
const rendered = (state = {}) => renderCheckReportHtml(buildCheckReportViewModel(report(), {
  canonicalSchedule: schedule,
  document: { organization: 'JNV', documentType: 'legacy_excel_schedule', dayType: 'mo_fr' },
  servicesEvaluated: 61,
  state
}));

// =====================================================================================
// A — the print view
// =====================================================================================
test('A: the page is set to A4 portrait with real margins', () => {
  assert.match(html, /@page\s*\{[^}]*size:\s*A4\s+portrait/);
  assert.match(html, /@page\s*\{[^}]*margin:/);
});

test('A: the filter block and the buttons are excluded from print', () => {
  assert.match(html, /@media print[^}]*\{[\s\S]{0,400}?\.no-print[^}]*display:\s*none/);
  assert.match(rendered(), /class="report-filters no-print"/);
  assert.match(rendered(), /class="report-actions no-print"/);
});

test('A: developer views do not travel onto the paper', () => {
  assert.match(html, /@media print[\s\S]{0,600}#check-explorer[^{]*\{[^}]*display:\s*none/);
  assert.match(html, /@media print[\s\S]{0,600}#review-dashboard[^{]*\{[^}]*display:\s*none/);
});

test('A: all eleven results are on the printed report', () => {
  const out = rendered();
  for (const id of ['BV001', 'BV002', 'BV003', 'BV005', 'BV007-START', 'BV007-SPLIT',
    'BV010', 'BV008', 'BV012', 'BV015_BV018', 'BV014']) {
    assert.ok(out.includes(id), id);
  }
});

test('A: the header facts are all on the printout', () => {
  const out = rendered();
  for (const needle of ['Prüfbericht', 'JNV', 'legacy_excel_schedule', 'mo_fr', '61',
    'Regelergebnisse', 'Prüfauffälligkeiten', 'Warnungen', 'Technische Fehler']) {
    assert.ok(out.includes(needle), needle);
  }
});

test('A: detail areas are opened for print rather than dropped', () => {
  assert.match(html, /@media print[\s\S]{0,800}details[^{]*\{[^}]*display:\s*block/);
  assert.match(html, /@media print[\s\S]{0,900}details\s*>\s*div[^{]*\{[^}]*display:\s*block/);
});

test('A: the BV003 relief information is part of the printout', () => {
  const out = rendered();
  assert.ok(out.includes('Dokumentierte Ablösekette'));
  assert.ok(out.includes('2217 → 2211 → 2273'));
  assert.match(out, /nicht automatisch verändert/);
});

test('A: the disabled one-sixth note is on the printout', () => {
  const out = rendered();
  assert.ok(out.includes('Fachlich freigegeben, derzeit nicht aktiviert.'));
  assert.ok(out.includes('BV015_BV018'));
});

test('A: status is legible without colour on paper', () => {
  const out = rendered();
  assert.ok(out.includes('Prüfauffälligkeit') && out.includes('Bestanden'));
  assert.match(html, /@media print[\s\S]{0,1200}\.report-status[^{]*\{[^}]*(border|color)/);
});

test('A: result blocks are kept together and may break between them', () => {
  assert.match(html, /\.report-result[^{]*\{[^}]*break-inside:\s*avoid/);
  assert.match(html, /page-break-inside:\s*avoid/);
});

test('A: no path and no file name reaches the paper', () => {
  const out = rendered();
  assert.ok(!out.includes('/User' + 's/'));
  assert.ok(!out.includes('.xlsx'));
});

test('A: no wide table is printed', () => {
  assert.ok(!rendered().includes('<table'));
});

// =====================================================================================
// Filter independence — the decisive one
// =====================================================================================
test('A: a screen filter does NOT remove results from the printout', () => {
  const out = rendered({ status: 'FAIL' });
  // On screen only the two findings are listed …
  assert.ok(out.includes('2 von 11'), 'the screen says what it shows');
  // … but the print section carries the complete report.
  const printBlock = out.slice(out.indexOf('report-print-all'));
  for (const id of ['BV001', 'BV010', 'BV012', 'BV014', 'BV015_BV018']) {
    assert.ok(printBlock.includes(id), `${id} must still be printed`);
  }
});

test('A: the complete print projection is hidden on screen and shown on paper', () => {
  assert.match(rendered(), /class="report-print-all"/);
  assert.match(html, /\.report-print-all[^{]*\{[^}]*display:\s*none/);
  assert.match(html, /@media print[\s\S]{0,1400}\.report-print-all[^{]*\{[^}]*display:\s*block/);
});

test('A: the filtered on-screen list is the one hidden from paper', () => {
  assert.match(html, /@media print[\s\S]{0,1400}\.report-results[^{]*\{[^}]*display:\s*none/);
});

test('A: the print projection is built from the same results, not a second report', () => {
  const view = src('../js/v2/report/check-report-view.js');
  assert.doesNotMatch(view, /type:\s*'CheckReport'/);
  assert.match(view, /model\.results\.map\(renderResult\)/, 'the print block renders the full list');
});
