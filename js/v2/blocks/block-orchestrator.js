/**
 * Projects the existing source-neutral CanonicalSchedule into the ORIGINAL PWA
 * block contract. It owns no PDF parsing, no Excel parsing and no business rule:
 * all structured findings are delegated to the already migrated legacy analysis.
 */

import { analyzeCanonicalScheduleWithMigratedLegacyChecks } from '../analysis/analysis-core.js';

const UNAVAILABLE_DRIVING_TIME = 'Für tabellarische Dienstpläne nicht verfügbar.';
const SPECIAL_PAUSE_LOCATIONS = new Set(['HLZ', 'TGR', 'LGR']);
const MIN_NORMAL_PAUSE_MINUTES = 30;
const MAX_NORMAL_PAUSE_MINUTES = 120;
const MIN_WORK_BEFORE_PAUSE_MINUTES = 210;
const MAX_WORK_BEFORE_PAUSE_MINUTES = 270;
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
    pauseHtml: renderInterruptions(pauses, canonicalSchedule, new Set(legacy.sharedServices.map(service => service.serviceNumber))),
    planHinweis
  };
}

function renderShared(services) {
  const sorted = [...services].sort((left, right) => number(left.serviceNumber) - number(right.serviceNumber));
  let output = `Anzahl geteilte Dienste: ${sorted.length}\nIDs: ${sorted.map(service => service.serviceNumber).join(', ')}`;

  if (!sorted.length) return `${output}\n\nKeine geteilten Dienste gefunden.`;

  const lines = sorted.map(service => {
    if (service.shiftDuration?.minutes === null) {
      return `ID ${service.serviceNumber}: keine gültigen Zeiten in Spalte O/P gefunden`;
    }
    return `ID ${service.serviceNumber}: Schichtdauer ${duration(service.shiftDuration)} (Spalte O → P)`;
  });
  const overTwelve = sorted
    .filter(service => service.exceedsTwelveHours)
    .map(service => `ID ${service.serviceNumber} (${duration(service.shiftDuration)})`);

  output += '\n\nSchichtdauer je geteilter Dienst (erste Zeit in Spalte O bis letzte Zeit in Spalte P):\n';
  output += lines.join('\n');
  output += overTwelve.length
    ? `\n\nAchtung: folgende geteilte Dienste überschreiten 12:00h Schichtdauer:\n${overTwelve.join(', ')}`
    : '\n\nAlle geteilten Dienste liegen bei maximal 12:00h Schichtdauer.';
  return output;
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

function renderInterruptions(interruptions, schedule, sharedServiceNumbers) {
  const normalized = interruptions
    .filter(interruption => Number.isInteger(interruption.durationMinutes) && interruption.durationMinutes >= MIN_NORMAL_PAUSE_MINUTES)
    .sort(compareInterruption);
  const normal = normalized.filter(interruption =>
    interruption.durationMinutes <= MAX_NORMAL_PAUSE_MINUTES && !sharedServiceNumbers.has(interruption.serviceNumber));
  const shared = normalized.filter(interruption =>
    interruption.durationMinutes <= MAX_NORMAL_PAUSE_MINUTES && sharedServiceNumbers.has(interruption.serviceNumber));
  const extended = normalized.filter(interruption => interruption.durationMinutes > MAX_NORMAL_PAUSE_MINUTES);

  const sections = ['Pausen und Dienstunterbrechungen:', ''];
  sections.push(`Normale Pausen 30–120 Minuten: ${normal.length}`);
  sections.push(normal.length ? renderInterruptionEntries(normal, schedule, { normal: true }) : 'Keine normalen Pausen 30–120 Minuten gefunden.');
  sections.push('', `Unterbrechungen geteilter Dienste 30–120 Minuten: ${shared.length}`);
  sections.push(shared.length ? renderInterruptionEntries(shared, schedule, { normal: true }) : 'Keine Unterbrechungen geteilter Dienste 30–120 Minuten gefunden.');
  sections.push('', `Dienstunterbrechungen >120 Minuten: ${extended.length}`);
  sections.push(extended.length ? renderInterruptionEntries(extended, schedule, { normal: false }) : 'Keine Dienstunterbrechungen >120 Minuten gefunden.');

  if (!normal.length && !shared.length && !extended.length) sections.push('', 'Keine Pausen oder Dienstunterbrechungen erkannt.');
  return sections.join('\n').trim();
}

function renderInterruptionEntries(interruptions, schedule, { normal }) {
  const services = new Map((schedule?.services || []).map(service => [service.id, service]));
  const previousEndByService = new Map();
  return interruptions.map(interruption => {
    const service = services.get(interruption.serviceId);
    const workStart = previousEndByService.get(interruption.serviceId) || service?.begin || null;
    const workMinutes = durationMinutes(workStart, interruption.start);
    previousEndByService.set(interruption.serviceId, interruption.end);
    const location = interruptionLocation(interruption);
    const requiredPauseMinutes = SPECIAL_PAUSE_LOCATIONS.has(location) ? 39 : 33;
    const pauseSufficient = interruption.durationMinutes >= requiredPauseMinutes;
    const workInRange = Number.isInteger(workMinutes) && workMinutes >= MIN_WORK_BEFORE_PAUSE_MINUTES && workMinutes <= MAX_WORK_BEFORE_PAUSE_MINUTES;
    const bvText = normal
      ? (pauseSufficient && workInRange ? 'OK' : 'nicht OK')
      : (workInRange ? 'OK' : 'nicht OK');
    const locationText = location || 'unbekannt';
    return [
      `ID ${text(interruption.serviceNumber) || '-'}:`,
      `  ${interruptionLabel(interruption)}: ${clock(interruption.start)}–${clock(interruption.end)} | ${interruption.durationMinutes} min`,
      `  Ort: ${locationText}`,
      `  Arbeitszeit vor Unterbrechung: ${Number.isInteger(workMinutes) ? formatMinutes(workMinutes) : 'nicht auswertbar'}`,
      normal ? `  Mindestpause am Ort ${locationText}: ${requiredPauseMinutes} min` : '',
      `  BV-Hinweis: ${bvText}`
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function interruptionLabel(interruption) {
  if (interruption.kind === 'pause') return 'Pause';
  if (interruption.kind === 'turnaround') return 'Wendezeit';
  if (interruption.kind === 'walkingTime') return 'Wegezeit';
  return 'Dienstunterbrechung';
}

function interruptionLocation(interruption) {
  return text(interruption.location?.end) || text(interruption.endLocation) ||
    text(interruption.location?.start) || text(interruption.startLocation);
}

function compareInterruption(left, right) {
  return number(left.serviceNumber) - number(right.serviceNumber) ||
    (left.start?.minutesSinceStartOfDay ?? Infinity) - (right.start?.minutesSinceStartOfDay ?? Infinity);
}

function durationMinutes(start, end) {
  const startMinute = start?.minutesSinceStartOfDay;
  const endMinute = end?.minutesSinceStartOfDay;
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) return null;
  const minutes = endMinute - startMinute;
  return minutes >= 0 ? minutes : minutes + (24 * 60);
}

function formatMinutes(value) {
  if (!Number.isInteger(value) || value < 0) return '-';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
