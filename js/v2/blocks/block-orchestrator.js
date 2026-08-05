/**
 * Projects the existing source-neutral CanonicalSchedule into the ORIGINAL PWA
 * block contract. It owns no PDF parsing, no Excel parsing and no business rule:
 * all structured findings are delegated to the already migrated legacy analysis.
 */

import { analyzeCanonicalScheduleWithMigratedLegacyChecks } from '../analysis/analysis-core.js';

const UNAVAILABLE_DRIVING_TIME = 'Für tabellarische Dienstpläne nicht verfügbar.';
const text = value => String(value ?? '').trim();
const number = value => Number.parseInt(value, 10);
const ordered = values => [...values].sort((left, right) => number(left) - number(right));
const clock = value => text(value?.value) || '-';
const duration = value => text(value?.value) || '-';

/**
 * The one common block-analysis entry point for both Excel and PDF schedules.
 * Returns the historic `parseTabular` result shape so the page's original block
 * renderer needs no new block IDs or PDF-only view model.
 */
export function createOriginalBlockViewModel(canonicalSchedule) {
  const analysis = analyzeCanonicalScheduleWithMigratedLegacyChecks(canonicalSchedule);
  const legacy = analysis.legacyAnalyses;
  const planHinweis = legacy.plan.label;
  const pauses = collectInterruptions(canonicalSchedule);

  return {
    planTypeText: `Erkannter Dienstplan: ${planHinweis}`,
    countText: `Anzahl eindeutiger Dienst-IDs: ${legacy.serviceCount}`,
    sharedText: renderShared(legacy.sharedServices),
    reserveText: `Anzahl Reserve-Dienste: ${legacy.reserveServices.length}\nIDs: ${ordered(legacy.reserveServices).join(', ')}`,
    longText: `Dienste >08:30h: ${ordered(legacy.longPaidServices).join(', ') || 'keine'}`,
    locText: renderLocations(legacy.differentLocationServices),
    segmentText: renderSegments(legacy.longServiceParts),
    realDrivingTimeText: UNAVAILABLE_DRIVING_TIME,
    shiftText: renderShifts(legacy.shifts),
    shiftHtml: '',
    routeText: renderRoutes(legacy.routes),
    pauseHtml: renderInterruptions(pauses),
    planHinweis
  };
}

function renderShared(services) {
  const sorted = [...services].sort((left, right) => number(left.serviceNumber) - number(right.serviceNumber));
  const lines = sorted.map(service =>
    `ID ${service.serviceNumber}: Schichtdauer ${duration(service.shiftDuration)}${service.exceedsTwelveHours ? ' (über 12:00h)' : ''}`);
  return [`Anzahl geteilte Dienste: ${sorted.length}`, `IDs: ${sorted.map(service => service.serviceNumber).join(', ') || 'keine'}`,
    lines.length ? '' : 'Keine geteilten Dienste gefunden.', ...lines].join('\n');
}

function renderLocations(locations) {
  if (!locations.length) return 'Unterschiedliche Orte: keine';
  return `Unterschiedliche Orte: ${ordered(locations.map(location => location.serviceNumber)).join(', ')}\n` +
    locations.map(location => `ID ${location.serviceNumber}: ${location.startLocation} → ${location.endLocation}`).join('\n');
}

function renderSegments(services) {
  if (!services.length) return 'Keine Dienstteilstücke >04:30h gefunden.';
  return services.map(service => {
    const findings = service.findings.map(finding => {
      if (finding.type === 'single') return `${finding.circuitNumber || '-'} ${clock(finding.start)}–${clock(finding.end)} (${duration(finding.duration)})`;
      return `${finding.first.circuitNumber || '-'} / ${finding.second.circuitNumber || '-'} ${clock(finding.first.start)}–${clock(finding.second.end)} (${duration(finding.duration)})`;
    });
    return `ID ${service.serviceNumber}: ${findings.join('; ')}`;
  }).join('\n');
}

function renderShifts(shifts) {
  const counts = Object.entries(shifts.counts)
    .sort(([left], [right]) => left.localeCompare(right, 'de', { numeric: true }))
    .map(([name, count]) => `${name}: ${count}`);
  const assignments = [...shifts.assignments]
    .sort((left, right) => number(left.serviceNumber) - number(right.serviceNumber))
    .map(entry => `ID ${entry.serviceNumber}: ${entry.shift}${entry.isShared ? ' (geteilt)' : ''}`);
  return ['Schichtzuweisung anhand des Dienstbeginns:', ...counts, '', 'Zuteilung je Dienst-ID:', ...assignments].join('\n');
}

function renderRoutes(routes) {
  const entries = Object.entries(routes);
  if (!entries.length) return 'Keine Dienste nach Linie/Kurs gefunden.';
  return entries.map(([route, services]) => `${route}: ${ordered(services.map(service => service.serviceNumber)).join(', ')}`).join('\n');
}

function collectInterruptions(schedule) {
  const explicit = Array.isArray(schedule?.interruptions) ? schedule.interruptions : [];
  const perService = (schedule?.services || []).flatMap(service => service?.interruptions || []);
  const seen = new Set();
  return [...explicit, ...perService].filter(interruption => {
    const key = interruption.id || `${interruption.serviceId}|${clock(interruption.start)}|${clock(interruption.end)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderInterruptions(interruptions) {
  if (!interruptions.length) return 'Keine Pausen oder Dienstunterbrechungen erkannt.';
  return interruptions.map(interruption =>
    `ID ${text(interruption.serviceNumber) || '-'}: ${clock(interruption.start)}–${clock(interruption.end)} (${formatMinutes(interruption.durationMinutes)})`
  ).join('\n');
}

function formatMinutes(value) {
  if (!Number.isInteger(value) || value < 0) return '-';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
