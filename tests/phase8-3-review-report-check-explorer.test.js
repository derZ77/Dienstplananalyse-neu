/** Phase 8.3 — shared CheckReport status and service-number presentation acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXTURES } from './fixtures/paths.js';
import { runJnvBaseAnalysis, runJesBaseAnalysis } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createReviewDashboardModel } from '../js/v2/ui/review-dashboard.js';
import { createCheckExplorerModel } from '../js/v2/ui/check-explorer.js';
import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';

const fileOf = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type: 'application/pdf', arrayBuffer: async () => bytes.slice().buffer };
};

test('Phase 8.3: JNV PDF uses the same CheckReport status and canonical duty numbers in all review views', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const primaryImport = await analyzePdfImport(await fileOf(FIXTURES.jnvSchedulePdf));
  const analysis = await runJnvBaseAnalysis({ primaryImport });
  const report = analysis.checkReport;
  const dashboard = createReviewDashboardModel(report, { canonicalSchedule: primaryImport.canonicalSchedule });
  const explorer = createCheckExplorerModel(report, { canonicalSchedule: primaryImport.canonicalSchedule });
  const readable = buildCheckReportViewModel(report, { canonicalSchedule: primaryImport.canonicalSchedule });
  const serviceNumbers = new Set(primaryImport.canonicalSchedule.services.map(service => String(service.serviceNumber)));

  assert.equal(dashboard.statistics.warningServices + dashboard.statistics.unremarkableServices
    + dashboard.statistics.criticalServices, dashboard.statistics.totalServices);
  for (const service of dashboard.services) assert.ok(serviceNumbers.has(service.serviceNumber));
  for (const row of explorer.rows) row.serviceNumbers.forEach(number => assert.ok(serviceNumbers.has(number)));
  assert.deepEqual(readable.results.map(row => row.status), report.results.map(result => result.status));
});

test('Phase 8.3: JES PDF remains a valid empty-report review without an invented warning', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const primaryImport = await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf));
  const analysis = await runJesBaseAnalysis({ primaryImport });
  const dashboard = createReviewDashboardModel(analysis.checkReport, { canonicalSchedule: primaryImport.canonicalSchedule });

  assert.equal(analysis.checkReport.results.length, 0);
  assert.deepEqual(dashboard.statistics, {
    totalServices: 0, criticalServices: 0, warningServices: 0, unremarkableServices: 0,
    evaluatedServices: primaryImport.canonicalSchedule.services.length, attentionServices: 0
  });
});
