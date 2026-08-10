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
const WEEKDAY_TIMEFRAMES = new Set(['Mo–Fr Schule', 'Mo–Fr Ferien']);
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
export function createOriginalBlockViewModel(canonicalSchedule, { checkReport = null } = {}) {
  const analysis = analyzeCanonicalScheduleWithMigratedLegacyChecks(canonicalSchedule);
  const legacy = analysis.legacyAnalyses;
  const planHinweis = legacy.plan.label;
  const pauses = collectInterruptions(canonicalSchedule);
  const segmentAssessments = collectSegmentAssessments(legacy.sharedServices, checkReport);
  const legacyLongText = `Dienste >08:30h: ${ordered(legacy.longPaidServices).join(', ')}`;

  return {
    planTypeText: `Erkannter Dienstplan: ${planHinweis}`,
    countText: `Anzahl eindeutiger Dienst-IDs: ${legacy.serviceCount}`,
    sharedText: renderShared(legacy.sharedServices),
    reserveText: `Anzahl Reserve-Dienste: ${legacy.reserveServices.length}\nIDs: ${ordered(legacy.reserveServices).join(', ')}`,
    longText: `${legacyLongText}\n\n${renderPaidTimeBvAssessment(canonicalSchedule, legacy)}`,
    locText: renderLocations(legacy.differentLocationServices),
    segmentText: renderSegments(legacy.longServiceParts, segmentAssessments),
    realDrivingTimeText: UNAVAILABLE_DRIVING_TIME,
    shiftText: renderShifts(legacy.shifts),
    shiftHtml: renderShiftHtml(legacy.shifts),
    routeText: renderRoutes(legacy.routes),
    pauseHtml: renderInterruptions(pauses, canonicalSchedule, new Set(legacy.sharedServices.map(service => service.serviceNumber))),
    planHinweis
  };
}

function renderPaidTimeBvAssessment(canonicalSchedule, legacy) {
  if (!WEEKDAY_TIMEFRAMES.has(legacy.plan.timeframe)) {
    return [
      'BV-Bewertung:',
      'Nicht anwendbar: Der vorhandene Planzeitraum ist nicht eindeutig als Montag bis Freitag erkannt.'
    ].join('\n');
  }

  const reserveServiceNumbers = new Set(legacy.reserveServices.map(text));
  const longServiceNumbers = ordered(legacy.longPaidServices);
  const servicesByNumber = new Map(canonicalSchedule.services.map(service => [text(service.serviceNumber), service]));
  const details = longServiceNumbers.map(serviceNumber => {
    const service = servicesByNumber.get(text(serviceNumber));
    const type = reserveServiceNumbers.has(text(serviceNumber)) ? 'Reserve' : 'normal';
    return `${serviceNumber} | ${duration(service?.paidTime)} h | ${type}`;
  });
  const reserveCount = longServiceNumbers.filter(serviceNumber => reserveServiceNumbers.has(text(serviceNumber))).length;
  const relevantCount = longServiceNumbers.length - reserveCount;
  const result = relevantCount <= 1 ? 'BV eingehalten.' : 'BV-Verstoß / Prüfung erforderlich.';

  return [
    'BV-Bewertung (Mo–Fr):',
    `Gefunden: ${longServiceNumbers.length} Dienste über 08:30h`,
    `davon Reserve: ${reserveCount}`,
    `für BV relevant: ${relevantCount}`,
    'Begründung: Reserve-Dienste zählen nicht gegen die Begrenzung.',
    'Dienstdetails:',
    'Dienst | Bezahlte Zeit | Typ',
    ...details,
    `Ergebnis: ${result}`
  ].join('\n');
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

function renderSegments(services, assessments) {
  const grouped = new Map();
  for (const service of services) {
    const group = grouped.get(service.serviceNumber) || [];
    group.push(...service.findings);
    grouped.set(service.serviceNumber, group);
  }
  const entries = [...grouped.entries()].sort(([left], [right]) => number(left) - number(right));
  let output = 'Dienstteilstücke >04:30h (ohne Reserve-Dienste, inkl. kombinierter Teile mit Pause <30 Min): ' + entries.length;

  if (!entries.length) return `${output}\n\nKeine relevanten Dienstteilstücke gefunden.`;

  output += '\n\n';
  entries.forEach(([serviceNumber, findings]) => {
    output += `ID ${serviceNumber}:\n`;
    findings.forEach(finding => { output += `${renderSegmentFinding(finding)}\n`; });
    if (findings.some(finding => finding.exceedsSixHours)) {
      output += '  Hinweis: Bitte Fahrtafel prüfen ob 1/6 Dienst und Standzeiten ausreichen.\n';
    }
    const assessmentLines = renderSegmentAssessment(serviceNumber, assessments);
    if (assessmentLines.length) output += `${assessmentLines.join('\n')}\n`;
    output += '\n';
  });
  return output.trim();
}

function collectSegmentAssessments(sharedServices, checkReport) {
  const sharedServiceNumbers = new Set(sharedServices.map(service => text(service.serviceNumber)).filter(Boolean));
  const oneSixthStatusByService = new Map();

  for (const result of checkReport?.results || []) {
    if (result?.id !== 'BV015_BV018') continue;
    for (const service of result?.details?.services || []) {
      const serviceNumber = text(service.serviceNumber);
      const status = text(service.status);
      if (serviceNumber && status) oneSixthStatusByService.set(serviceNumber, status);
    }
  }

  return { sharedServiceNumbers, oneSixthStatusByService };
}

function renderSegmentAssessment(serviceNumber, assessments) {
  const normalizedServiceNumber = text(serviceNumber);
  const isShared = assessments.sharedServiceNumbers.has(normalizedServiceNumber);
  const oneSixthStatus = assessments.oneSixthStatusByService.get(normalizedServiceNumber);
  if (!isShared && !oneSixthStatus) return [];

  const lines = ['  Bewertung:'];
  lines.push(isShared
    ? '  Ausnahmegrund: Geteilter Dienst erkannt (zusätzliche Ausnahmeinformation für Dienstteil >04:30h; keine 1/6-Ausnahme).'
    : '  Ausnahmegrund: Keine vorhandene Ausnahmeinformation.');

  if (!oneSixthStatus) {
    lines.push('  Ergebnis: geteilter Dienst erkannt; keine 1/6-Bewertung vorhanden.');
    return lines;
  }

  lines.push(`  1/6-Prüfung: ${oneSixthStatus}.`);
  lines.push(`  Ergebnis: ${oneSixthAssessmentText(oneSixthStatus)}`);
  return lines;
}

function oneSixthAssessmentText(status) {
  switch (status) {
    case 'PASS':
      return 'zulässiger 1/6-Dienst (bestehendes BV015_BV018-Ergebnis).';
    case 'FAIL':
      return '1/6-Dienst nicht zulässig (bestehendes BV015_BV018-Ergebnis).';
    case 'NOT_APPLICABLE':
      return 'keine 1/6-Ausnahme (bestehendes BV015_BV018-Ergebnis).';
    case 'INCONCLUSIVE':
      return '1/6-Bewertung nicht abschließend (bestehendes BV015_BV018-Ergebnis).';
    default:
      return `1/6-Ergebnis ${status} (bestehendes BV015_BV018-Ergebnis).`;
  }
}

function renderSegmentFinding(finding) {
  if (finding.type === 'single') {
    return `  Einzelsegment ${clock(finding.start)}–${clock(finding.end)}${courseLabel(finding.circuitNumber)} | Dauer ${duration(finding.duration)}`;
  }
  const courses = [finding.first?.circuitNumber, finding.second?.circuitNumber]
    .map(text)
    .filter(Boolean);
  const courseInfo = courses.length ? ` (${courses.join(' / ')})` : '';
  return `  Kombiniert: ${clock(finding.first?.start)}–${clock(finding.first?.end)} und ${clock(finding.second?.start)}–${clock(finding.second?.end)}${courseInfo}` +
    ` | Pause ${finding.gap?.minutes ?? '-'} Min, Gesamtdauer ${duration(finding.duration)}`;
}

function courseLabel(value) {
  const course = text(value);
  return course ? ` (${course})` : '';
}

function renderShifts(shifts) {
  const assignments = uniqueShiftAssignments(shifts)
    .sort((left, right) => number(left.serviceNumber) - number(right.serviceNumber));
  const regularCounts = countShifts(assignments.filter(entry => !entry.isShared));
  const sharedCounts = countShifts(assignments.filter(entry => entry.isShared && entry.shift !== 'Unbekannte'));
  const regularTitle = shifts.weekend
    ? 'Schichtzählung (nicht geteilte Dienste nach WE-F1, WE-F2, S1, S2, N):'
    : 'Schichtzählung (nicht geteilte Dienste nach F1, F2, F3, S1, S2, N):';
  const sharedTitle = 'Geteilte Dienste mit separater Schichtlage (GF1, GF2, ... bzw. GWE-F1, ...):';
  return [
    regularTitle,
    ...renderShiftCounts(regularCounts),
    '',
    sharedTitle,
    ...(Object.keys(sharedCounts).length ? renderShiftCounts(sharedCounts) : ['Keine geteilten Dienste mit zugewiesener Schichtlage gefunden.']),
    '',
    'Zuteilung je Dienst-ID:',
    ...assignments
      .map(entry => `ID ${entry.serviceNumber}: ${entry.shift}${entry.isShared ? ' (geteilt)' : ''}`)
  ].join('\n');
}

function renderShiftHtml(shifts) {
  const assignments = uniqueShiftAssignments(shifts)
    .sort((left, right) => number(left.serviceNumber) - number(right.serviceNumber));
  const title = shifts.weekend
    ? 'Schichtzuweisung nach WE-F1, WE-F2, S1, S2, N'
    : 'Schichtzuweisung nach F1, F2, F3, GF1, GF2, GF3, S1, S2, N';
  const grouped = assignments.reduce((groups, assignment) => {
    const key = assignment.shift || 'Unbekannte';
    const entries = groups.get(key) || [];
    entries.push(assignment);
    groups.set(key, entries);
    return groups;
  }, new Map());
  let html = `<div>${escapeHtml(title)}</div><br>`;
  sortShiftNames([...grouped.keys()]).forEach(name => {
    const entries = grouped.get(name).slice().sort((left, right) => number(left.serviceNumber) - number(right.serviceNumber));
    const cssClass = shiftCssClass(name);
    html += '<div class="shift-group">';
    html += `<div class="shift-group-title${cssClass ? ` ${cssClass}` : ''}">${escapeHtml(name)} (${entries.length})</div>`;
    html += '<div class="shift-group-lines">';
    entries.forEach(entry => { html += `<div>${escapeHtml(`ID ${entry.serviceNumber}: ${entry.shift}${entry.isShared ? ' (geteilt)' : ''}`)}</div>`; });
    html += '</div></div>';
  });
  return html.trim();
}

function uniqueShiftAssignments(shifts) {
  const seen = new Set();
  return (shifts?.assignments || []).filter(assignment => {
    const key = text(assignment.serviceNumber);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countShifts(assignments) {
  return assignments.reduce((counts, assignment) => {
    counts[assignment.shift] = (counts[assignment.shift] || 0) + 1;
    return counts;
  }, {});
}

function renderShiftCounts(counts) {
  return sortShiftNames(Object.keys(counts)).map(name => `${name}: ${counts[name]}`);
}

function sortShiftNames(names) {
  const order = ['F1', 'F2', 'F3', 'GF1', 'GF2', 'GF3', 'S1', 'S2', 'N'];
  return [...names].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex !== rightIndex && leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
    if (leftIndex !== -1) return -1;
    if (rightIndex !== -1) return 1;
    return left.localeCompare(right, 'de');
  });
}

function shiftCssClass(name) {
  if (/^GF1$|^GWE-F1$/i.test(name)) return 'shift-gf1';
  if (/^GF2$|^GWE-F2$/i.test(name)) return 'shift-gf2';
  if (/^GF3$/i.test(name)) return 'shift-gf3';
  if (/^F1$|^WE-F1$/i.test(name)) return 'shift-f1';
  if (/^F2$|^WE-F2$/i.test(name)) return 'shift-f2';
  if (/^F3$/i.test(name)) return 'shift-f3';
  if (/^S1$/i.test(name)) return 'shift-s1';
  if (/^S2$/i.test(name)) return 'shift-s2';
  if (/^N$/i.test(name)) return 'shift-n';
  return '';
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
