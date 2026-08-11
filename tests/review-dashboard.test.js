import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildServiceSummaries,
  calculateServiceStatistics,
  createReviewDashboardModel,
  filterServiceSummaries,
  sortServiceSummaries,
  toggleExpandedService
} from '../js/v2/ui/review-dashboard.js';

const report = {
  type: 'CheckReport',
  results: [
    result('BV003', 'WARNING', 'FAIL', ['service:1103']),
    result('BV005', 'INFO', 'PASS', ['service:1103']),
    result('BV010', 'ERROR', 'FAIL', ['service:42']),
    result('BV012', 'VIOLATION', 'FAIL', ['service:7']),
    result('BV014', 'INFO', 'PASS', ['service:99'])
  ]
};

test('Review Dashboard gruppiert CheckResults vollständig auf Dienstebene', () => {
  const services = buildServiceSummaries(report.results);
  const service1103 = services.find(service => service.serviceNumber === '1103');
  assert.equal(services.length, 4);
  assert.deepEqual(service1103 && {
    checkCount: service1103.checkCount,
    passCount: service1103.passCount,
    warningCount: service1103.warningCount,
    highestSeverity: service1103.highestSeverity,
    reviewState: service1103.reviewState
  }, { checkCount: 2, passCount: 1, warningCount: 1, highestSeverity: 'WARNING', reviewState: 'warning' });
});

test('Review Dashboard filtert kritische, warnende und unauffällige Dienste', () => {
  const services = buildServiceSummaries(report.results);
  assert.deepEqual(filterServiceSummaries(services, 'critical').map(service => service.serviceNumber), ['42', '7']);
  assert.deepEqual(filterServiceSummaries(services, 'warning').map(service => service.serviceNumber), ['1103']);
  assert.deepEqual(filterServiceSummaries(services, 'unremarkable').map(service => service.serviceNumber), ['99']);
});

test('Review Dashboard sortiert nach höchster Severity und anschließend Dienstnummer', () => {
  const sorted = sortServiceSummaries(buildServiceSummaries(report.results));
  assert.deepEqual(sorted.map(service => service.serviceNumber), ['7', '42', '1103', '99']);
});

test('Review Dashboard liefert Statistik und einen aufklappbaren dienstbezogenen Explorer', () => {
  const services = buildServiceSummaries(report.results);
  assert.deepEqual(calculateServiceStatistics(services), {
    totalServices: 4, criticalServices: 2, warningServices: 1, unremarkableServices: 1
  });
  const expanded = toggleExpandedService([], '1103');
  const model = createReviewDashboardModel(report, { expandedServiceNumbers: expanded });
  const service = model.services.find(entry => entry.serviceNumber === '1103');
  assert.equal(service.expanded, true);
  assert.deepEqual(service.explorer.rows.map(row => row.id), ['BV003', 'BV005']);
  assert.deepEqual(toggleExpandedService(expanded, '1103'), []);
});

test('Review Dashboard identifies an available empty CheckReport separately from a filter-empty result', () => {
  const canonicalSchedule = { type: 'CanonicalSchedule', services: [{ serviceNumber: '1103' }, { serviceNumber: '1104' }] };
  const model = createReviewDashboardModel({ type: 'CheckReport', results: [] }, { canonicalSchedule });
  assert.equal(model.checkReportAvailable, true);
  assert.equal(model.checkResultCount, 0);
  assert.equal(model.reportState, 'empty');
  assert.deepEqual(model.statistics, {
    totalServices: 0, criticalServices: 0, warningServices: 0,
    unremarkableServices: null, recognizedServices: 2, evaluatedServices: 0, attentionServices: 0
  });
});

test('Review Dashboard counts only actual FAIL results as warned and resolves canonical service ids', () => {
  const canonicalSchedule = {
    type: 'CanonicalSchedule',
    services: [
      { id: 'service-internal-1', serviceNumber: '1103' },
      { id: 'service-internal-2', serviceNumber: '1104' },
      { id: 'service-internal-3', serviceNumber: '1105' }
    ]
  };
  const services = buildServiceSummaries([
    result('BV003', 'WARNING', 'FAIL', ['service-internal-1']),
    result('BV010', 'ERROR', 'SKIP', ['service-internal-1']),
    result('BV014', 'VIOLATION', 'NOT_APPLICABLE', ['service-internal-2']),
    result('BV005', 'WARNING', 'PASS', ['service-internal-3']),
    result('BVX', 'INFO', 'FAIL', ['service-internal-3'])
  ], canonicalSchedule);

  assert.deepEqual(services.map(service => service.serviceNumber), ['1103', '1104', '1105']);
  assert.deepEqual(calculateServiceStatistics(services), {
    totalServices: 3, criticalServices: 0, warningServices: 2, unremarkableServices: 1
  });
  assert.equal(services.find(service => service.serviceNumber === '1103').errorCount, 0,
    'a skipped technical result is not a service warning');
});

function result(id, severity, status, affectedServices) {
  return {
    id,
    name: `${id} Name`,
    category: 'BV',
    severity,
    status,
    message: `${id} Nachricht`,
    affectedServices
  };
}
