import { createCheckExplorerModel, toExplorerRow } from './check-explorer.js';

const SEVERITY_ORDER = Object.freeze({ VIOLATION: 0, ERROR: 1, WARNING: 2, INFO: 3 });

/**
 * Creates a service-level review model from an existing CheckReport. This
 * presentation layer never invokes checks and does not alter CheckResults.
 */
export function createReviewDashboardModel(checkReport, state = {}) {
  const normalizedState = normalizeState(state);
  const services = buildServiceSummaries(checkReport?.results || [], normalizedState.canonicalSchedule);
  const visibleServices = sortServiceSummaries(filterServiceSummaries(services, normalizedState.filter));
  const expandedServiceNumbers = new Set(normalizedState.expandedServiceNumbers);
  const baseStatistics = calculateServiceStatistics(services);
  const evaluatedServices = normalizedState.canonicalSchedule?.services?.length ?? baseStatistics.totalServices;

  return {
    checkReportAvailable: checkReport?.type === 'CheckReport',
    checkResultCount: Array.isArray(checkReport?.results) ? checkReport.results.length : 0,
    services: visibleServices.map(service => ({
      ...service,
      expanded: expandedServiceNumbers.has(service.serviceNumber),
      explorer: createCheckExplorerModel({ type: 'CheckReport', results: service.results }, {
        serviceNumber: service.serviceNumber,
        sortBy: 'severity',
        groupBy: 'category',
        canonicalSchedule: normalizedState.canonicalSchedule
      })
    })),
    statistics: {
      ...baseStatistics,
      evaluatedServices,
      attentionServices: baseStatistics.criticalServices + baseStatistics.warningServices
    },
    state: normalizedState
  };
}

export function buildServiceSummaries(results, canonicalSchedule = null) {
  const byService = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const row = toExplorerRow(result, { canonicalSchedule });
    for (const serviceNumber of row.serviceNumbers) {
      if (!byService.has(serviceNumber)) {
        byService.set(serviceNumber, { serviceNumber, results: [] });
      }
      byService.get(serviceNumber).results.push(result);
    }
  }
  // The dashboard is a plan overview. A schedule known to the session therefore supplies the
  // complete evaluated duty set, including duties without a named CheckResult. This is a display
  // projection only; no check status is inferred or changed.
  for (const service of (Array.isArray(results) && results.length > 0
    && canonicalSchedule?.type === 'CanonicalSchedule' && Array.isArray(canonicalSchedule.services))
    ? canonicalSchedule.services : []) {
    const serviceNumber = String(service.serviceNumber ?? '').trim();
    if (serviceNumber && !byService.has(serviceNumber)) byService.set(serviceNumber, { serviceNumber, results: [] });
  }
  return [...byService.values()].map(service => createServiceSummary(service, canonicalSchedule));
}

export function filterServiceSummaries(services, filter = 'all') {
  const selectedFilter = normalizeFilter(filter);
  return (Array.isArray(services) ? services : []).filter(service =>
    selectedFilter === 'all'
      || (selectedFilter === 'findings' && ['critical', 'warning'].includes(service.reviewState))
      || service.reviewState === selectedFilter
  );
}

export function sortServiceSummaries(services) {
  return [...(Array.isArray(services) ? services : [])].sort((left, right) =>
    (SEVERITY_ORDER[left.highestSeverity] ?? 99) - (SEVERITY_ORDER[right.highestSeverity] ?? 99)
    || compareServiceNumber(left.serviceNumber, right.serviceNumber)
  );
}

export function calculateServiceStatistics(services) {
  const entries = Array.isArray(services) ? services : [];
  const criticalServices = entries.filter(service => service.reviewState === 'critical').length;
  const warningServices = entries.filter(service => service.reviewState === 'warning').length;
  return {
    totalServices: entries.length,
    criticalServices,
    warningServices,
    unremarkableServices: entries.filter(service => service.reviewState === 'unremarkable').length
  };
}

export function toggleExpandedService(expandedServiceNumbers, serviceNumber) {
  const expanded = new Set(expandedServiceNumbers || []);
  if (expanded.has(serviceNumber)) expanded.delete(serviceNumber);
  else expanded.add(serviceNumber);
  return [...expanded];
}

export function createReviewDashboardController(root) {
  if (!root) throw new TypeError('Review Dashboard requires a root element.');
  const filter = root.querySelector('[data-review-dashboard="filter"]');
  const body = root.querySelector('[data-review-dashboard="rows"]');
  const empty = root.querySelector('[data-review-dashboard="empty"]');
  let report = null;
  let canonicalSchedule = null;
  let expandedServiceNumbers = [];

  const render = () => {
    const model = createReviewDashboardModel(report, { filter: filter.value, expandedServiceNumbers, canonicalSchedule });
    renderStatistics(root, model.statistics);
    renderServices(body, empty, model, serviceNumber => {
      expandedServiceNumbers = toggleExpandedService(expandedServiceNumbers, serviceNumber);
      render();
    });
  };

  filter.addEventListener('input', render);
  render();
  return {
    setCheckReport(nextReport) {
      if (nextReport?.type !== 'CheckReport') throw new TypeError('Review Dashboard expects a CheckReport.');
      report = nextReport;
      expandedServiceNumbers = [];
      render();
    },
    setCanonicalSchedule(nextSchedule) {
      canonicalSchedule = nextSchedule?.type === 'CanonicalSchedule' ? nextSchedule : null;
      render();
    },
    clear() {
      report = null;
      expandedServiceNumbers = [];
      render();
    }
  };
}

function createServiceSummary({ serviceNumber, results }, canonicalSchedule) {
  const rows = results.map(result => toExplorerRow(result, { canonicalSchedule }));
  // A severity only signals a service warning when its check actually reached a finding.
  // SKIP, NOT_APPLICABLE and PASS retain their report meaning and cannot make a duty look warned.
  const findings = rows.filter(row => row.status === 'FAIL');
  const highestSeverity = findings.map(row => row.severity)
    .sort((left, right) => (SEVERITY_ORDER[left] ?? 99) - (SEVERITY_ORDER[right] ?? 99))[0] || 'INFO';
  const reviewState = highestSeverity === 'VIOLATION' || highestSeverity === 'ERROR'
    ? 'critical'
    : findings.length > 0 ? 'warning' : 'unremarkable';
  return {
    serviceNumber,
    results,
    reviewState,
    overallStatus: reviewState === 'critical' ? 'KRITISCH' : reviewState === 'warning' ? 'WARNING' : 'UNAUFFÄLLIG',
    highestSeverity,
    checkCount: rows.length,
    passCount: rows.filter(row => row.status === 'PASS').length,
    warningCount: findings.filter(row => row.severity === 'WARNING').length,
    errorCount: findings.filter(row => row.severity === 'ERROR').length,
    violationCount: findings.filter(row => row.severity === 'VIOLATION').length,
    findingRule: findings.map(row => row.id).filter(Boolean).join(', ') || '–',
    findingDescription: findings.map(row => row.message || row.name).filter(Boolean).join(' · ') || 'Keine Regelauffälligkeit',
    findingStatus: findings.length ? 'Prüfauffälligkeit' : 'Ohne Regelauffälligkeit'
  };
}

function normalizeState(state) {
  return {
    filter: normalizeFilter(state.filter),
    expandedServiceNumbers: Array.isArray(state.expandedServiceNumbers) ? state.expandedServiceNumbers.map(String) : [],
    canonicalSchedule: state.canonicalSchedule?.type === 'CanonicalSchedule' ? state.canonicalSchedule : null
  };
}

function normalizeFilter(filter) {
  return ['critical', 'warning', 'unremarkable', 'findings'].includes(filter) ? filter : 'all';
}

function compareServiceNumber(left, right) {
  const leftValue = Number(left);
  const rightValue = Number(right);
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) return leftValue - rightValue;
  if (Number.isFinite(leftValue)) return -1;
  if (Number.isFinite(rightValue)) return 1;
  return String(left).localeCompare(String(right), 'de-DE', { numeric: true });
}

function renderStatistics(root, statistics) {
  for (const [key, value] of Object.entries(statistics)) {
    const target = root.querySelector(`[data-review-stat="${key}"]`);
    if (target) target.textContent = String(value);
  }
}

function renderServices(body, empty, model, onToggle) {
  body.replaceChildren();
  empty.hidden = model.services.length > 0;
  empty.textContent = !model.checkReportAvailable
    ? 'Noch kein CheckReport vorhanden.'
    : model.checkResultCount === 0
      ? 'Der Prüflauf hat keine dienstbezogenen Check-Ergebnisse geliefert.'
      : 'Keine Dienste entsprechen dem gewählten Filter.';
  for (const service of model.services) {
    const row = document.createElement('tr');
    row.className = `review-service-row review-state-${service.reviewState}`;
    const values = [
      ['Dienst', service.serviceNumber],
      ['Auffälligkeit', service.findingDescription],
      ['Regel', service.findingRule],
      ['Status', service.findingStatus]
    ];
    for (const [label, value] of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      cell.dataset.label = label;
      row.append(cell);
    }
    body.append(row);
  }
}

function createDetailsRow(service) {
  const row = document.createElement('tr');
  row.className = 'review-dashboard-details';
  const cell = document.createElement('td');
  cell.colSpan = 9;
  const title = document.createElement('strong');
  title.textContent = `Check Explorer – Dienst ${service.serviceNumber}`;
  cell.append(title, createExplorerTable(service.explorer.rows));
  row.append(cell);
  return row;
}

function createExplorerTable(rows) {
  const table = document.createElement('table');
  table.className = 'review-dashboard-checks';
  const header = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const heading of ['Kategorie', 'Check-ID', 'Name', 'Status', 'Severity', 'Dienst', 'Nachricht']) {
    const cell = document.createElement('th');
    cell.textContent = heading;
    headerRow.append(cell);
  }
  header.append(headerRow);
  table.append(header);
  const body = document.createElement('tbody');
  for (const item of rows) {
    const itemRow = document.createElement('tr');
    for (const value of [item.category, item.id, item.name, item.status, item.severity, item.serviceLabel, item.message]) {
      const cell = document.createElement('td');
      cell.textContent = value || '–';
      itemRow.append(cell);
    }
    body.append(itemRow);
  }
  table.append(body);
  return table;
}
