const SEVERITY_ORDER = Object.freeze({ VIOLATION: 0, ERROR: 1, WARNING: 2, INFO: 3 });
const CATEGORY_ORDER = Object.freeze({ BV: 0, ARBZG: 1, FPERSV: 2, INTERNAL: 3, WAGENKARTE: 4, CUSTOM: 5 });

/**
 * Produces the presentation model for a CheckReport. This module only reads
 * CheckResults; it neither executes checks nor interprets their rules.
 */
export function createCheckExplorerModel(checkReport, state = {}) {
  const results = Array.isArray(checkReport?.results) ? checkReport.results : [];
  const normalizedState = normalizeState(state);
  const rows = sortCheckResults(filterCheckResults(results, normalizedState), normalizedState.sortBy, normalizedState.canonicalSchedule);

  return {
    checkReportAvailable: checkReport?.type === 'CheckReport',
    rows: rows.map(result => toExplorerRow(result, normalizedState)),
    statistics: calculateCheckStatistics(results, normalizedState),
    groups: groupCheckResults(rows, normalizedState.groupBy, normalizedState),
    state: normalizedState
  };
}

export function filterCheckResults(results, state = {}) {
  const filters = normalizeState(state);
  return (Array.isArray(results) ? results : []).filter(result => {
    const row = toExplorerRow(result, filters);
    if (filters.category && row.category !== filters.category) return false;
    if (filters.severity && row.severity !== filters.severity) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.serviceNumber && !row.serviceNumbers.some(value => value.includes(filters.serviceNumber))) return false;
    if (filters.checkId && !row.id.toLocaleLowerCase('de-DE').includes(filters.checkId)) return false;
    if (filters.search && !searchText(row).includes(filters.search)) return false;
    return true;
  });
}

export function sortCheckResults(results, sortBy = 'severity', canonicalSchedule = null) {
  const rows = [...(Array.isArray(results) ? results : [])];
  return rows.sort((left, right) => compareRows(
    toExplorerRow(left, { canonicalSchedule }),
    toExplorerRow(right, { canonicalSchedule }),
    sortBy
  ));
}

export function calculateCheckStatistics(results, state = {}) {
  const rows = Array.isArray(results) ? results.map(result => toExplorerRow(result, state)) : [];
  return {
    total: rows.length,
    pass: rows.filter(row => row.status === 'PASS').length,
    warning: rows.filter(row => row.severity === 'WARNING').length,
    error: rows.filter(row => row.severity === 'ERROR').length,
    violation: rows.filter(row => row.severity === 'VIOLATION').length
  };
}

export function groupCheckResults(results, groupBy = 'category', state = {}) {
  const groups = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const row = toExplorerRow(result, state);
    const key = groupBy === 'service'
      ? (row.serviceNumbers.length ? row.serviceNumbers.join(', ') : 'Kein Dienstbezug')
      : row.category || 'Ohne Kategorie';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, rows }));
}

export function toExplorerRow(result = {}, state = {}) {
  const serviceNumbers = extractServiceNumbers(result, state.canonicalSchedule);
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
  let canonicalSchedule = null;

  const render = () => {
    const state = readState(controls);
    const model = createCheckExplorerModel(report, { ...state, canonicalSchedule });
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
    setCanonicalSchedule(nextSchedule) {
      canonicalSchedule = nextSchedule?.type === 'CanonicalSchedule' ? nextSchedule : null;
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

function extractServiceNumbers(result, canonicalSchedule) {
  const values = [];
  const add = value => {
    const text = String(value ?? '').trim();
    if (!text) return;
    if (!values.includes(text)) values.push(text);
  };
  const hasSchedule = canonicalSchedule?.type === 'CanonicalSchedule';
  const serviceNumberById = new Map((canonicalSchedule?.services || []).map(service => [String(service.id), String(service.serviceNumber ?? '').trim()]));
  (result.affectedServices || []).forEach(service => {
    if (service && typeof service === 'object' && service.serviceNumber != null) {
      add(service.serviceNumber);
      return;
    }
    const id = String(service && typeof service === 'object' ? service.id : service ?? '').trim();
    const mapped = serviceNumberById.get(id);
    if (mapped) add(mapped);
    // Unit-level consumers have no schedule context. Keep their established compact input
    // convention, while a productive view with a schedule never exposes an internal id.
    else if (!hasSchedule) add(id.replace(/^service:/i, ''));
  });
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
    canonicalSchedule: state.canonicalSchedule?.type === 'CanonicalSchedule' ? state.canonicalSchedule : null,
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
    headingCell.colSpan = 4;
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
  const rule = document.createElement('td');
  rule.textContent = [row.id, row.name].filter(Boolean).join(' — ') || '–';

  const status = document.createElement('td');
  status.textContent = statusLabel(row.status);

  const services = document.createElement('td');
  services.append(createAffectedServicesDetails(row));

  const message = document.createElement('td');
  message.textContent = row.message || '–';
  const relevantValues = createRelevantValuesDetails(row.result?.details);
  if (relevantValues) message.append(document.createElement('br'), relevantValues);

  element.append(rule, status, services, message);
  return element;
}

function statusLabel(status) {
  return ({ PASS: 'Bestanden', FAIL: 'Prüfauffälligkeit', SKIP: 'Übersprungen', NOT_APPLICABLE: 'Nicht anwendbar' })[status]
    || status || '–';
}

function createAffectedServicesDetails(row) {
  if (!row.serviceNumbers.length) return document.createTextNode('Kein Dienstbezug');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `${row.serviceNumbers.length} ${row.serviceNumbers.length === 1 ? 'Dienst' : 'Dienste'}`;
  const list = document.createElement('span');
  list.textContent = row.serviceNumbers.join(', ');
  details.append(summary, list);
  return details;
}

/** Scalar facts are useful for manual review; raw objects and technical structures never enter the view. */
function createRelevantValuesDetails(details) {
  const values = Object.entries(details || {})
    .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 8);
  if (!values.length) return null;
  const element = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Relevante Werte';
  const content = document.createElement('span');
  content.textContent = values.map(([key, value]) => `${key}: ${value}`).join(' · ');
  element.append(summary, content);
  return element;
}

function getTone(row) {
  if (row.status === 'PASS') return 'pass';
  if (row.severity === 'VIOLATION') return 'violation';
  if (row.severity === 'ERROR') return 'error';
  if (row.severity === 'WARNING') return 'warning';
  return 'neutral';
}
