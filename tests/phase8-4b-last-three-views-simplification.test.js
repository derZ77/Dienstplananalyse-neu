/** Phase 8.4B — the three review surfaces stay one CheckReport projection, with distinct roles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReviewDashboardModel } from '../js/v2/ui/review-dashboard.js';
import { createCheckExplorerModel } from '../js/v2/ui/check-explorer.js';
import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { renderCheckReportHtml } from '../js/v2/report/check-report-view.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const schedule = {
  type: 'CanonicalSchedule',
  services: [
    { id: 'internal:1', serviceNumber: '1001' },
    { id: 'internal:2', serviceNumber: '1002' },
    { id: 'internal:3', serviceNumber: '1003' },
    { id: 'internal:4', serviceNumber: '1004' }
  ]
};

const report = {
  type: 'CheckReport',
  results: [
    { id: 'BV003', name: 'Ortsprüfung', category: 'BV', status: 'FAIL', severity: 'WARNING', message: 'Orte weichen ab.', affectedServices: ['internal:1'] },
    { id: 'BV007', name: 'Beginn', category: 'BV', status: 'PASS', severity: 'INFO', message: 'Grenze eingehalten.', affectedServices: ['internal:2'] }
  ]
};

test('Phase 8.4B: dashboard names the complete evaluated plan mass and defaults to real findings in the UI', () => {
  const model = createReviewDashboardModel(report, { canonicalSchedule: schedule, filter: 'findings' });
  assert.equal(model.statistics.evaluatedServices, 4);
  assert.equal(model.statistics.attentionServices, 1);
  assert.equal(model.statistics.unremarkableServices, 3);
  assert.deepEqual(model.services.map(service => service.serviceNumber), ['1001']);

  const html = source('../index.html');
  assert.match(html, /data-review-stat="evaluatedServices"[^>]*>0<\/strong>Ausgewertete Dienste/);
  assert.match(html, /<option value="findings" selected>Nur Auffälligkeiten<\/option>/);
  assert.match(html, /<th>Dienst<\/th><th>Auffälligkeit<\/th><th>Regel<\/th><th>Status<\/th>/);
  assert.doesNotMatch(html, /<th>Anzahl Checks<\/th>/);
});

test('Phase 8.4B: report keeps the frozen status meanings and exposes technical errors only in a separate details block', () => {
  const model = buildCheckReportViewModel({ ...report, errors: [{ module: { id: 'BV003' }, code: 'DATA_MISSING', message: 'Referenzdaten fehlen.' }] }, { canonicalSchedule: schedule });
  assert.deepEqual(model.results.map(row => row.status), ['FAIL', 'PASS']);
  const html = renderCheckReportHtml(model);
  assert.match(html, /Prüfauffälligkeit/);
  assert.match(html, /Bestanden/);
  assert.match(html, /Technische Details \(1\)/);
});

test('Phase 8.4B: detail view remains optional, compact and displays only real service numbers', () => {
  const explorer = createCheckExplorerModel(report, { canonicalSchedule: schedule, status: 'FAIL' });
  assert.deepEqual(explorer.rows.map(row => row.serviceLabel), ['1001']);
  assert.doesNotMatch(explorer.rows[0].serviceLabel, /internal/);

  const html = source('../index.html');
  assert.match(html, /<h2 id="check-explorer-title">Detailprüfung einzelner Regeln<\/h2>/);
  assert.match(html, /<details class="check-explorer-details">/);
  assert.match(html, /<summary>Erweiterte Filter und Sortierung<\/summary>/);
  assert.match(html, /<th>Regel<\/th><th>Ergebnis<\/th><th>Betroffene Dienste<\/th><th>Begründung<\/th>/);
});

test('Phase 8.4B: mobile styles keep the page narrow while optional tables remain contained', () => {
  const html = source('../index.html');
  assert.match(html, /\.review-dashboard-table \{ width: 100%; min-width: 560px/);
  assert.match(html, /\.review-dashboard-table-wrap \{ overflow-x: auto/);
  assert.match(html, /\.check-explorer-table-wrap \{[\s\S]*overflow-x: auto/);
});
