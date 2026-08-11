/**
 * Projects the existing source-neutral CanonicalSchedule into the ORIGINAL PWA
 * block contract. It owns no PDF parsing, no Excel parsing and no business rule:
 * all structured findings are delegated to the already migrated legacy analysis.
 */

import { analyzeCanonicalScheduleWithMigratedLegacyChecks } from '../analysis/analysis-core.js';
import { normalizeTimeline } from '../pdf/timeline-normalization.js';

const UNAVAILABLE_DRIVING_TIME = [
  'Lenkzeit-/Fahrzeitbewertung nicht verfügbar.',
  '',
  'Grund: Der Dienstplan enthält keine Wagenkarte oder Umlauftafel mit dokumentierter Fahrtenfolge sowie realen Fahr- und Pausenzeiten.',
  '',
  'Optional: Eine passende Wagenkarte oder Umlauftafel als Begleitdokument ergänzen. Sie erweitert die Auswertung; für die übrigen Analyseblöcke ist sie nicht erforderlich.'
].join('\n');
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
  const pauses = collectBlock10Events(canonicalSchedule);
  // A Dienstnummer is the legacy-facing identity of this block. The canonical import may
  // contain the same duty in more than one source row, but it is still one shared duty.
  const sharedServices = uniqueSharedServices(legacy.sharedServices);
  const segmentAssessments = collectSegmentAssessments(sharedServices, checkReport);
  const legacyLongText = `Dienste >08:30h: ${ordered(legacy.longPaidServices).join(', ')}`;

  return {
    planTypeText: `Erkannter Dienstplan: ${planHinweis}`,
    countText: `Anzahl eindeutiger Dienst-IDs: ${legacy.serviceCount}`,
    sharedText: renderShared(sharedServices),
    reserveText: `Anzahl Reserve-Dienste: ${legacy.reserveServices.length}\nIDs: ${ordered(legacy.reserveServices).join(', ')}`,
    longText: `${legacyLongText}\n\n${renderPaidTimeBvAssessment(canonicalSchedule, legacy)}`,
    locText: renderLocations(legacy.differentLocationServices),
    segmentText: renderSegments(legacy.longServiceParts, segmentAssessments),
    realDrivingTimeText: UNAVAILABLE_DRIVING_TIME,
    shiftText: renderShifts(legacy.shifts),
    shiftHtml: renderShiftHtml(legacy.shifts),
    routeText: renderRoutes(legacy.routes),
    pauseHtml: renderInterruptions(pauses, canonicalSchedule),
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
      return `ID ${service.serviceNumber}: keine gültigen Dienstbeginn-/Dienstendezeiten gefunden`;
    }
    return `ID ${service.serviceNumber}: Schichtspanne ${duration(service.shiftDuration)}`;
  });
  const overTwelve = sorted
    .filter(service => service.exceedsTwelveHours)
    .map(service => `ID ${service.serviceNumber} (${duration(service.shiftDuration)})`);

  output += '\n\nSchichtspanne je geteilter Dienst (Dienstbeginn bis Dienstende):\n';
  output += lines.join('\n');
  output += overTwelve.length
    ? `\n\nAchtung: folgende geteilte Dienste überschreiten 12:00h Schichtspanne:\n${overTwelve.join(', ')}`
    : '\n\nAlle geteilten Dienste liegen bei maximal 12:00h Schichtspanne.';
  return output;
}

function uniqueSharedServices(services) {
  const byNumber = new Map();
  for (const service of services || []) {
    const key = text(service?.serviceNumber);
    if (!key) continue;
    const existing = byNumber.get(key);
    // When the same duty is represented twice, retain the most complete (and if needed
    // longer) existing canonical span without inflating the legacy duty count.
    const existingMinutes = existing?.shiftDuration?.minutes ?? -1;
    const candidateMinutes = service?.shiftDuration?.minutes ?? -1;
    if (!existing || candidateMinutes > existingMinutes) byNumber.set(key, service);
  }
  return [...byNumber.values()];
}

function renderLocations(locations) {
  if (!locations.length) return 'Unterschiedliche Orte: ';
  return `Unterschiedliche Orte: ${ordered(locations.map(location => location.serviceNumber)).join(', ')}\n\n` +
    'Zusätzliche Dienstort-Informationen:\n' +
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
    output += '  Hinweis: Arbeitszeit über 04:30 h – BV-Prüfung erforderlich.\n';
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
  if (!entries.length) return 'Dienste nach Linie/Kurs:';

  let output = 'Dienste nach Linie/Kurs:\n';
  entries.forEach(([route, services]) => {
    output += `${route}:\n  ID | Zeitbereich | Start → Ziel\n`;
    services
      .filter(service => text(service.departureTime?.value))
      .forEach(service => {
        output += `  ${text(service.serviceNumber) || '-'} | ${clock(service.departureTime)}–${clock(service.arrivalTime)} | ` +
          `${text(service.departureLocation) || '-'} → ${text(service.arrivalLocation) || '-'}\n`;
      });
    output += '\n';
  });
  return output.trim();
}

function collectBlock10Events(schedule) {
  const explicit = Array.isArray(schedule?.interruptions) ? schedule.interruptions : [];
  const perService = (schedule?.services || []).flatMap(service => service?.interruptions || []);
  const pauses = (schedule?.services || []).flatMap(service => (service?.activities || [])
    .filter(isDeclaredPauseActivity)
    .map(activity => pauseEventFromActivity(service, activity))
    .filter(Boolean));
  return uniquePauseEvents([...explicit, ...perService, ...pauses]);
}

function isDeclaredPauseActivity(activity) {
  return /^\s*pause(?:\s|\(|$)/i.test(text(activity?.rawActivity));
}

function pauseEventFromActivity(service, activity) {
  const duration = durationMinutes(activity?.departureTime, activity?.arrivalTime);
  if (!Number.isInteger(duration)) return null;
  return {
    id: `activity-pause:${activity.id || `${service?.id || ''}:${clock(activity.departureTime)}:${clock(activity.arrivalTime)}`}`,
    type: 'activityPause',
    kind: 'pause',
    serviceId: service?.id ?? activity?.serviceId ?? null,
    serviceNumber: text(service?.serviceNumber) || text(activity?.serviceNumber),
    start: activity.departureTime,
    end: activity.arrivalTime,
    durationMinutes: duration,
    startLocation: text(activity?.departureLocation),
    endLocation: text(activity?.arrivalLocation),
    location: { start: text(activity?.departureLocation), end: text(activity?.arrivalLocation) },
    circuitNumber: text(activity?.circuitNumber),
    source: activity?.source ?? null,
    sourceKind: 'declaredPauseActivity',
    activityId: activity?.id ?? null
  };
}

function uniquePauseEvents(events) {
  const byTime = new Map();
  for (const event of events) {
    const key = `${event?.serviceId || event?.serviceNumber || ''}|${clock(event?.start)}|${clock(event?.end)}|${event?.durationMinutes ?? ''}`;
    const existing = byTime.get(key);
    // An already canonical event takes precedence, while an activity pause fills
    // its missing display fields. Thus the same pause is never shown twice.
    if (!existing) {
      byTime.set(key, event);
      continue;
    }
    byTime.set(key, mergePauseEvents(existing, event));
  }
  return [...byTime.values()];
}

function mergePauseEvents(existing, candidate) {
  const canonical = existing.type === 'activityPause' && candidate.type !== 'activityPause' ? candidate : existing;
  const activity = existing.type === 'activityPause' ? existing : candidate.type === 'activityPause' ? candidate : null;
  if (!activity) return canonical;
  return {
    ...canonical,
    startLocation: text(canonical.startLocation) || text(activity.startLocation),
    endLocation: text(canonical.endLocation) || text(activity.endLocation),
    location: {
      start: text(canonical.location?.start) || text(activity.location?.start),
      end: text(canonical.location?.end) || text(activity.location?.end)
    },
    sourceKind: canonical.sourceKind || activity.sourceKind,
    activityId: canonical.activityId || activity.activityId
  };
}

function renderInterruptions(interruptions, schedule) {
  const orderedInterruptions = interruptions
    .filter(interruption => Number.isInteger(interruption.durationMinutes))
    .sort(compareInterruption);
  const legacyPauses = orderedInterruptions.filter(interruption =>
    interruption.durationMinutes >= MIN_NORMAL_PAUSE_MINUTES &&
    interruption.durationMinutes <= MAX_NORMAL_PAUSE_MINUTES);
  const additional = orderedInterruptions.filter(interruption => !legacyPauses.includes(interruption));
  const sections = [`Pausen zwischen 30 und 120 Minuten${legacyPauses.length ? `: ${legacyPauses.length}` : ':'}`, ''];

  sections.push(legacyPauses.length
    ? renderLegacyPauseEntries(legacyPauses, schedule)
    : 'Keine Pausen im Bereich 30–120 Minuten gefunden.');
  if (legacyPauses.length) sections.push('', renderPauseTimingAssessment(legacyPauses, schedule));
  if (additional.length) {
    sections.push('', 'Weitere Unterbrechungen (keine regulären Blockpausen):', '', renderCanonicalInterruptionEntries(additional));
  }
  return sections.join('\n').trim();
}

function renderPauseTimingAssessment(interruptions, schedule) {
  const services = serviceLookup(schedule);
  return [
    'BV-Pausenlagenprüfung:',
    ...interruptions.map(interruption => {
      const service = serviceForInterruption(services, interruption);
      const structuredMinutes = structuredWorkMinutesBeforePause(service, interruption);
      const fallbackMinutes = durationMinutes(service?.begin, interruption.start);
      const minutes = structuredMinutes ?? fallbackMinutes;
      const basis = structuredMinutes === null ? 'Fallback Dienstbeginn/Pausenbeginn' : 'Arbeitszeitdaten';
      const result = structuredMinutes === null
        ? 'BV-Prüfung erforderlich'
        : Number.isInteger(minutes) && minutes >= MIN_WORK_BEFORE_PAUSE_MINUTES && minutes <= MAX_WORK_BEFORE_PAUSE_MINUTES
          ? 'BV eingehalten'
          : 'BV-Verstoß';
      return [
        `Dienst ${text(interruption.serviceNumber) || '-'}:`,
        `Pause: ${clock(interruption.start)} - ${clock(interruption.end)}`,
        `Dauer: ${interruption.durationMinutes} min`,
        'Mindestpause erfüllt: Ja (reguläre Blockpause ab 30 Minuten)',
        `Zeit vor Pause: ${formatMinutes(minutes)} h`,
        `Grundlage: ${basis}`,
        `BV-Bewertung: ${result}`,
        structuredMinutes === null ? 'Hinweis: Bewertung basiert auf Zeitdifferenz Dienstbeginn bis Pausenbeginn, da keine vollständigen Arbeitszeitdaten vorliegen.' : ''
      ].filter(Boolean).join('\n');
    })
  ].join('\n\n');
}

function structuredWorkMinutesBeforePause(service, interruption) {
  const timeline = normalizedServiceActivities(service);
  const pauseStart = relativePauseStart(timeline, interruption);
  if (!Number.isInteger(pauseStart)) return null;
  const activities = timeline.filter(entry =>
    Number.isInteger(entry.start) &&
    Number.isInteger(entry.end) &&
    entry.end <= pauseStart &&
    !isBreakActivity(entry.activity));
  if (!activities.length) return null;
  const durations = activities.map(entry => durationMinutes(entry.activity.departureTime, entry.activity.arrivalTime));
  return durations.every(Number.isInteger) ? durations.reduce((sum, value) => sum + value, 0) : null;
}

function normalizedServiceActivities(service) {
  const activities = service?.activities || [];
  const timeline = normalizeTimeline([
    service?.begin?.value ?? null,
    ...activities.flatMap(activity => [activity?.departureTime?.value ?? null, activity?.arrivalTime?.value ?? null]),
    service?.end?.value ?? null
  ]);
  return activities.map((activity, index) => ({
    activity,
    start: timeline[1 + index * 2]?.relativeMinutes ?? null,
    end: timeline[2 + index * 2]?.relativeMinutes ?? null
  }));
}

function relativePauseStart(timeline, interruption) {
  const activityId = interruption?.activityId;
  const start = interruption?.start?.value;
  const end = interruption?.end?.value;
  const match = timeline.find(entry => entry.activity?.id === activityId) || timeline.find(entry =>
    entry.activity?.departureTime?.value === start && entry.activity?.arrivalTime?.value === end);
  if (Number.isInteger(match?.start)) return match.start;

  // Older canonical interruption records may not retain the pause activity
  // identity. An activity ending exactly at the pause start is a safe anchor
  // on the already normalised service timeline.
  const pauseClock = interruption?.start?.minutesSinceStartOfDay;
  const precedingActivity = timeline.find(entry =>
    entry.activity?.arrivalTime?.minutesSinceStartOfDay === pauseClock);
  return precedingActivity?.end ?? null;
}

function isBreakActivity(activity) {
  return /pause|unterbrechung/i.test(`${text(activity?.activityType)} ${text(activity?.rawActivity)}`);
}

function renderLegacyPauseEntries(interruptions, schedule) {
  const services = serviceLookup(schedule);
  const grouped = new Map();
  interruptions.forEach(interruption => {
    const entries = grouped.get(interruption.serviceNumber) || [];
    entries.push(interruption);
    grouped.set(interruption.serviceNumber, entries);
  });
  return [...grouped.entries()].sort(([left], [right]) => number(left) - number(right)).map(([serviceNumber, entries]) => [
    `ID ${text(serviceNumber) || '-'}:`,
    ...entries.map(interruption => {
      const service = serviceForInterruption(services, interruption);
      const before = linkedActivity(service, interruption, 'before');
      const after = linkedActivity(service, interruption, 'after');
      const declared = interruption.sourceKind === 'declaredPauseActivity';
      const startLocation = declared ? text(interruption.startLocation) : text(before?.arrivalLocation) || text(interruption.startLocation);
      const endLocation = declared ? text(interruption.endLocation) : text(after?.departureLocation) || text(interruption.endLocation);
      const startCourse = declared ? courseText(interruption) : courseText(before) || courseText(interruption);
      const endCourse = declared ? courseText(interruption) : courseText(after) || courseText(interruption);
      return `  Pause: ${clock(interruption.start)} ${startLocation}${startCourse} → ` +
        `${clock(interruption.end)} ${endLocation}${endCourse} | ${interruption.durationMinutes} min` +
        `${interruption.sourceKind === 'declaredPauseActivity' ? ' | deklarierte Pause im Dienst' : ''}`;
    })
  ].join('\n')).join('\n\n');
}

function linkedActivity(service, interruption, direction) {
  const activities = service?.activities || [];
  const id = direction === 'before' ? interruption.precedingActivityId : interruption.followingActivityId;
  const time = direction === 'before' ? interruption.start?.minutesSinceStartOfDay : interruption.end?.minutesSinceStartOfDay;
  return activities.find(activity => activity.id === id) || activities.find(activity =>
    (direction === 'before' ? activity.arrivalTime?.minutesSinceStartOfDay : activity.departureTime?.minutesSinceStartOfDay) === time);
}

function courseText(activity) {
  const course = text(activity?.circuitNumber);
  return course ? ` ${course}` : '';
}

function renderCanonicalInterruptionEntries(interruptions) {
  return interruptions.map(interruption => [
    `ID ${text(interruption.serviceNumber) || '-'}:`,
    `  ${interruptionLabel(interruption)}: ${clock(interruption.start)}–${clock(interruption.end)} | ${interruption.durationMinutes} min`,
    `  Ort: ${interruptionLocation(interruption) || 'unbekannt'}`
  ].join('\n')).join('\n\n');
}

function interruptionLabel(interruption) {
  if (interruption.durationMinutes < MIN_NORMAL_PAUSE_MINUTES) return 'Kurze Unterbrechung (keine reguläre Blockpause; möglicher 1/6-Kontext)';
  if (interruption.durationMinutes > MAX_NORMAL_PAUSE_MINUTES) return 'Lange Unterbrechung (geteilter Dienst; keine reguläre Blockpause)';
  if (interruption.kind === 'pause') return 'Pause';
  if (interruption.kind === 'turnaround') return 'Wendezeit';
  if (interruption.kind === 'walkingTime') return 'Wegezeit';
  return 'Dienstunterbrechung';
}

function serviceLookup(schedule) {
  const byId = new Map();
  const byNumber = new Map();
  for (const service of schedule?.services || []) {
    if (service?.id) byId.set(service.id, service);
    const serviceNumber = text(service?.serviceNumber);
    if (serviceNumber && !byNumber.has(serviceNumber)) byNumber.set(serviceNumber, service);
  }
  return { byId, byNumber };
}

function serviceForInterruption(lookup, interruption) {
  return lookup.byId.get(interruption?.serviceId)
    || lookup.byNumber.get(text(interruption?.serviceNumber))
    || null;
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
