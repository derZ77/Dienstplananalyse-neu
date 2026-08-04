const SEVERITY_ORDER = Object.freeze({ VIOLATION: 0, ERROR: 1, WARNING: 2, INFO: 3 });
const CATEGORY_ORDER = Object.freeze({ BV: 0, ARBZG: 1, FPERSV: 2, INTERNAL: 3, WAGENKARTE: 4, CUSTOM: 5 });

/**
 * Produces the presentation model for a CheckReport. This module only reads
 * CheckResults; it neither executes checks nor interprets their rules.
 */
export function createCheckExplorerModel(checkReport, state = {}) {
  const results = Array.isArray(checkReport?.results) ? checkReport.results : [];
  const normalizedState = normalizeState(state);
  const rows = sortCheckResults(filterCheckResults(results, normalizedState), normalizedState.sortBy);

  return {
    checkReportAvailable: checkReport?.type === 'CheckReport',
    rows: rows.map(toExplorerRow),
    statistics: calculateCheckStatistics(results),
    groups: groupCheckResults(rows, normalizedState.groupBy),
    state: normalizedState
  };
}

export function filterCheckResults(results, state = {}) {
  const filters = normalizeState(state);
  return (Array.isArray(results) ? results : []).filter(result => {
    const row = toExplorerRow(result);
    if (filters.category && row.category !== filters.category) return false;
    if (filters.severity && row.severity !== filters.severity) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.serviceNumber && !row.serviceNumbers.some(value => value.includes(filters.serviceNumber))) return false;
    if (filters.checkId && !row.id.toLocaleLowerCase('de-DE').includes(filters.checkId)) return false;
    if (filters.search && !searchText(row).includes(filters.search)) return false;
    return true;
  });
}

export function sortCheckResults(results, sortBy = 'severity') {
  const rows = [...(Array.isArray(results) ? results : [])];
  return rows.sort((left, right) => compareRows(toExplorerRow(left), toExplorerRow(right), sortBy));
}

export function calculateCheckStatistics(results) {
  const rows = Array.isArray(results) ? results.map(toExplorerRow) : [];
  return {
    total: rows.length,
    pass: rows.filter(row => row.status === 'PASS').length,
    warning: rows.filter(row => row.severity === 'WARNING').length,
    error: rows.filter(row => row.severity === 'ERROR').length,
    violation: rows.filter(row => row.severity === 'VIOLATION').length
  };
}

export function groupCheckResults(results, groupBy = 'category') {
  const groups = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const row = toExplorerRow(result);
    const key = groupBy === 'service'
      ? (row.serviceNumbers.length ? row.serviceNumbers.join(', ') : 'Kein Dienstbezug')
      : row.category || 'Ohne Kategorie';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, rows }));
}

export function toExplorerRow(result = {}) {
  const serviceNumbers = extractServiceNumbers(result);
  return {
    id: String(result.id || ''),
    name: String(result.name || ''),
    category: String(result.category || ''),
    severity: String(result.severity || ''),
    status: String(result.status || ''),
    message: String(result.message || ''),
    serviceNumbers,
    serviceLabel: serviceNumbers.join(', ') || '–',
    result
  };
}

export function createCheckExplorerController(root) {
  if (!root) throw new TypeError('Check Explorer requires a root element.');
  const controls = getControls(root);
  let report = null;

  const render = () => {
    const state = readState(controls);
    const model = createCheckExplorerModel(report, state);
    renderStatistics(root, model.statistics);
    renderRows(root, model);
  };
  const reset = () => {
    controls.category.value = '';
    controls.severity.value = '';
    controls.status.value = '';
    controls.serviceNumber.value = '';
    controls.checkId.value = '';
    controls.search.value = '';
    controls.sortBy.value = 'severity';
    controls.groupBy.value = 'category';
    render();
  };

  Object.values(controls).filter(control => control?.tagName === 'SELECT' || control?.tagName === 'INPUT')
    .forEach(control => control.addEventListener('input', render));
  controls.reset.addEventListener('click', reset);
  render();

  return {
    setCheckReport(nextReport) {
      if (nextReport?.type !== 'CheckReport') throw new TypeError('Check Explorer expects a CheckReport.');
      report = nextReport;
      render();
    },
    clear() {
      report = null;
      render();
    },
    getCheckReport() {
      return report;
    }
  };
}

function extractServiceNumbers(result) {
  const values = [];
  const add = value => {
    const text = String(value ?? '').trim();
    if (!text) return;
    const normalized = text.replace(/^service:/i, '');
    if (!values.includes(normalized)) values.push(normalized);
  };
  (result.affectedServices || []).forEach(service => add(typeof service === 'object' ? service.serviceNumber ?? service.id : service));
  for (const collection of [result.details?.violations, result.details?.deviations]) {
    (Array.isArray(collection) ? collection : []).forEach(entry => add(entry?.serviceNumber));
  }
  return values;
}

function normalizeState(state) {
  return {
    category: normalizedEnum(state.category),
    severity: normalizedEnum(state.severity),
    status: normalizedEnum(state.status),
    serviceNumber: normalizedText(state.serviceNumber),
    checkId: normalizedText(state.checkId),
    search: normalizedText(state.search),
    sortBy: ['severity', 'serviceNumber', 'checkId', 'category'].includes(state.sortBy) ? state.sortBy : 'severity',
    groupBy: state.groupBy === 'service' ? 'service' : 'category'
  };
}

function normalizedText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('de-DE');
}

function normalizedEnum(value) {
  return String(value ?? '').trim().toLocaleUpperCase('de-DE');
}

function searchText(row) {
  return [row.id, row.name, row.category, row.severity, row.status, row.message, ...row.serviceNumbers]
    .join(' ')
    .toLocaleLowerCase('de-DE');
}

function compareRows(left, right, sortBy) {
  if (sortBy === 'severity') {
    return (SEVERITY_ORDER[left.severity] ?? 99) - (SEVERITY_ORDER[right.severity] ?? 99)
      || left.id.localeCompare(right.id, 'de-DE', { numeric: true });
  }
  if (sortBy === 'serviceNumber') {
    return compareServiceNumber(left.serviceNumbers[0], right.serviceNumbers[0])
      || left.id.localeCompare(right.id, 'de-DE', { numeric: true });
  }
  if (sortBy === 'category') {
    return (CATEGORY_ORDER[left.category] ?? 99) - (CATEGORY_ORDER[right.category] ?? 99)
      || left.id.localeCompare(right.id, 'de-DE', { numeric: true });
  }
  return left.id.localeCompare(right.id, 'de-DE', { numeric: true });
}

function compareServiceNumber(left, right) {
  const leftValue = Number(left);
  const rightValue = Number(right);
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) return leftValue - rightValue;
  if (Number.isFinite(leftValue)) return -1;
  if (Number.isFinite(rightValue)) return 1;
  return String(left || '').localeCompare(String(right || ''), 'de-DE', { numeric: true });
}

function getControls(root) {
  const get = name => root.querySelector(`[data-check-explorer="${name}"]`);
  return {
    category: get('category'), severity: get('severity'), status: get('status'),
    serviceNumber: get('service-number'), checkId: get('check-id'), search: get('search'),
    sortBy: get('sort-by'), groupBy: get('group-by'), reset: get('reset')
  };
}

function readState(controls) {
  return {
    category: controls.category.value,
    severity: controls.severity.value,
    status: controls.status.value,
    serviceNumber: controls.serviceNumber.value,
    checkId: controls.checkId.value,
    search: controls.search.value,
    sortBy: controls.sortBy.value,
    groupBy: controls.groupBy.value
  };
}

function renderStatistics(root, statistics) {
  for (const [key, value] of Object.entries(statistics)) {
    const target = root.querySelector(`[data-check-stat="${key}"]`);
    if (target) target.textContent = String(value);
  }
}

function renderRows(root, model) {
  const body = root.querySelector('[data-check-explorer="rows"]');
  const empty = root.querySelector('[data-check-explorer="empty"]');
  body.replaceChildren();
  const count = model.groups.reduce((sum, group) => sum + group.rows.length, 0);
  empty.hidden = count > 0;
  empty.textContent = model.checkReportAvailable
    ? 'Keine Check-Ergebnisse entsprechen den gewählten Filtern.'
    : 'Noch kein CheckReport vorhanden.';
  for (const group of model.groups) {
    const heading = document.createElement('tr');
    heading.className = 'check-explorer-group';
    const headingCell = document.createElement('th');
    headingCell.colSpan = 7;
    headingCell.scope = 'colgroup';
    headingCell.textContent = model.state.groupBy === 'service' ? `Dienst: ${group.key}` : `Kategorie: ${group.key}`;
    heading.append(headingCell);
    body.append(heading);
    for (const row of group.rows) body.append(createRow(row));
  }
}

function createRow(row) {
  const element = document.createElement('tr');
  element.className = `check-explorer-row check-tone-${getTone(row)}`;
  for (const value of [row.category, row.id, row.name, row.status, row.severity, row.serviceLabel, row.message]) {
    const cell = document.createElement('td');
    cell.textContent = value || '–';
    element.append(cell);
  }
  return element;
}

function getTone(row) {
  if (row.status === 'PASS') return 'pass';
  if (row.severity === 'VIOLATION') return 'violation';
  if (row.severity === 'ERROR') return 'error';
  if (row.severity === 'WARNING') return 'warning';
  return 'neutral';
}
