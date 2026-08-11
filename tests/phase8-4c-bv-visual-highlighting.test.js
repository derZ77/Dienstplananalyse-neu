/** Phase 8.4C — visual status mapping consumes existing results only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderExistingStatusText } from '../js/v2/blocks/block-renderer.js';
import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { renderCheckReportHtml } from '../js/v2/report/check-report-view.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 8.4C: migrated block wording receives bounded fail, warning, pass and neutral presentation groups', () => {
  assert.match(renderExistingStatusText('Ergebnis: BV-Verstoß'), /result-status status-fail/);
  assert.match(renderExistingStatusText('Ergebnis: Prüfung erforderlich'), /result-status status-warning/);
  assert.match(renderExistingStatusText('Ergebnis: BV eingehalten'), /result-status status-pass/);
  assert.match(renderExistingStatusText('Nicht anwendbar: Daten fehlen'), /result-status status-neutral/);
});

test('Phase 8.4C: frozen CheckReport statuses receive the same visual classes without changing their meaning', () => {
  const report = {
    type: 'CheckReport',
    results: [
      { id: 'BV003', name: 'Orte', category: 'BV', status: 'FAIL', severity: 'WARNING', message: 'Abweichung' },
      { id: 'BV007', name: 'Beginn', category: 'BV', status: 'PASS', severity: 'INFO', message: 'OK' },
      { id: 'BV010', name: 'Pause', category: 'BV', status: 'SKIP', severity: 'INFO', message: 'später' },
      { id: 'BV012', name: 'Puffer', category: 'BV', status: 'NOT_APPLICABLE', severity: 'INFO', message: 'nicht anwendbar' }
    ]
  };
  const model = buildCheckReportViewModel(report);
  const html = renderCheckReportHtml(model);
  assert.match(html, /data-result-id="BV003"[\s\S]*?status-fail/);
  assert.match(html, /data-result-id="BV007"[\s\S]*?status-pass/);
  assert.match(html, /data-result-id="BV010"[\s\S]*?status-neutral/);
  assert.match(html, /data-result-id="BV012"[\s\S]*?status-neutral/);
  assert.deepEqual(model.results.map(row => row.status), ['FAIL', 'PASS', 'SKIP', 'NOT_APPLICABLE']);
});

test('Phase 8.4C: dashboard and detail view give every FAIL a red class, while non-fail statuses stay non-red', () => {
  const dashboard = source('../js/v2/ui/review-dashboard.js');
  const explorer = source('../js/v2/ui/check-explorer.js');
  const html = source('../index.html');

  assert.match(dashboard, /findingStatus === 'Prüfauffälligkeit' \? 'status-fail' : 'status-neutral'/);
  assert.match(explorer, /if \(row\.status === 'FAIL'\) return 'fail';/);
  assert.match(explorer, /if \(row\.status === 'SKIP' \|\| row\.status === 'NOT_APPLICABLE'\) return 'neutral';/);
  for (const className of ['status-fail', 'status-warning', 'status-pass', 'status-neutral']) {
    assert.match(html, new RegExp(`\\.${className} \\{`));
  }
  assert.match(html, /\.check-explorer-row\.status-fail/);
  assert.match(html, /\.review-service-row\.status-fail/);
});

test('Phase 8.4C: mobile keeps status groups inside their containers and does not rely on colour alone', () => {
  const html = source('../index.html');
  assert.match(html, /Status-Farbvertrag: Farbe unterstützt den sichtbaren Status-Text/);
  assert.match(html, /\.result-status \{ margin: \.35rem 0; padding: \.45rem \.6rem/);
  assert.match(html, /\.review-dashboard-table td \{ display: grid/);
  assert.match(html, /\.check-explorer-table-wrap \{[\s\S]*overflow-x: auto/);
});
