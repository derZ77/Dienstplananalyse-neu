/**
 * JES Wagenkarte data projection (Phase 9.7A).
 *
 * This module moves the LEGACY workbook observations into a DOM-free contract.
 * It deliberately does not calculate driving blocks, select a relevant pause or
 * perform a 04:30 assessment; those remain Phase 9.7B responsibilities.
 */

import { resolveCanonicalValidity } from '../schedule/canonical-validity.js';

const WAGENKARTE_HEADER = 'Dienst-Nr.:';
const TIME = /^(\d{1,2}):(\d{2})$/;
const LINE_TRIP = /^(\d+)\s*\/\s*(\d+)$/;
const ACTIVITY_PATTERNS = Object.freeze([
  ['PREPARATION', /^Vorbereiten\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i],
  ['POSTPROCESSING', /^Nachbereiten\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i],
  ['PROVISIONING', /^Bereitstellungszeit\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i],
  ['TURNAROUND', /^Wendezeit\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i],
  ['STANDBY', /^Dienstbereitschaft\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i],
  ['UNPAID_BREAK', /^unbezahlte Pause\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i],
  ['PAUSE', /^Pause\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i],
  ['SERVICE_INTERRUPTION', /^Dienstunterbrechung(?:\s+von)?\s+(\d{1,2}:\d{2})\s*(?:bis|[-–])\s*(\d{1,2}:\d{2})$/i],
  ['SERVICE_INTERRUPTION', /^Geteilter Dienst von\s+(\d{1,2}:\d{2})\s+bis\s+(\d{1,2}:\d{2})$/i]
]);

const ADDITIONAL_TIME_KEYS = Object.freeze({
  TURNAROUND: 'turnaround', PROVISIONING: 'provisioning', PREPARATION: 'preparation',
  POSTPROCESSING: 'postprocessing', STANDBY: 'standby'
});

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const source = (sheetName, row, region = null) => ({ sourceType: 'excel', sheetName, row: row + 1, region });

export function isWagenkarteDienstSheet(sheet) {
  return (sheet?.rows?.[0] || []).some(value => clean(value) === WAGENKARTE_HEADER);
}

/**
 * Projects the already SheetJS-normalized plain workbook into observed JES
 * vehicle-card data. The returned contract is a companion source, never a
 * replacement CanonicalSchedule.
 */
export function projectWagenkarteWorkbook(workbook, { sourceName = '', organization = 'JES' } = {}) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const dienstSheets = sheets.filter(isWagenkarteDienstSheet);
  const serviceEvidence = dienstSheets.map(sheet => {
    const rows = sheet.rows;
    const headerText = serviceValidityLabel(rows);
    const validFrom = normalizeValidFrom(headerValue(rows, 'Gültig ab:') ?? rows?.[2]?.[3]);
    const validity = resolveCanonicalValidity({
      headerText,
      documentMetadata: validFrom ? { validFrom } : null,
      fileName: sourceName
    });
    const dayQualifier = parseServiceDayQualifier(headerText);
    return { validity: { ...validity, dayQualifier }, headerText };
  });
  // A workbook-level summary may contain only facts shared by every service
  // sheet. Per-sheet qualifiers remain attached to their own service below.
  const validity = mergeSharedValidity(serviceEvidence.map(evidence => evidence.validity));
  const services = dienstSheets.map((sheet, index) => projectService(sheet, index, serviceEvidence[index].validity));

  return {
    type: 'VehicleCardSchedule',
    organization,
    documentType: 'wagenkarte',
    source: { sourceType: 'excel', fileName: sourceName || null },
    validity,
    services,
    metadata: { sheetCount: sheets.length, dienstSheetCount: dienstSheets.length, serviceCount: services.length }
  };
}

function serviceValidityLabel(rows) {
  const serviceNumber = clean(headerValue(rows, WAGENKARTE_HEADER) ?? rows?.[0]?.[2]);
  return (Array.isArray(rows?.[0]) ? rows[0] : [])
    .map(clean)
    .filter(value => value && value !== WAGENKARTE_HEADER && value !== serviceNumber)
    .join(' ');
}

function parseServiceDayQualifier(label) {
  const value = clean(label);
  const patterns = [
    ['TUESDAY_FRIDAY', /^(?:dienstag\s*(?:-|–|bis)\s*freitag|di\s*(?:-|–)\s*fr)(?:\b|\s*\()/i],
    ['TUESDAY_WEDNESDAY_THURSDAY_FRIDAY', /^(?:dienstag\s*,\s*mittwoch\s*,\s*donnerstag\s*,\s*freitag|di\s*,\s*mi\s*,\s*do\s*,\s*fr)(?:\b|\s*\()/i],
    ['MON_TUE_WED_FRI', /^(?:montag\s*,\s*dienstag\s*,\s*mittwoch\s*,\s*freitag|mo\s*,\s*di\s*,\s*mi\s*,\s*fr)(?:\b|\s*\()/i],
    ['MON_THU', /^(?:montag\s*(?:-|–|bis)\s*donnerstag|mo\s*(?:-|–)\s*do)(?:\b|\s*\()/i],
    ['THURSDAY_FRIDAY', /^(?:donnerstag\s*(?:\+|,|und|&)\s*freitag|do\s*(?:\+|,|&|-)\s*fr)(?:\b|\s*\()/i],
    ['MON_FRI', /^(?:montag\s*(?:-|–|bis)\s*freitag|mo\s*(?:-|–)\s*fr)(?:\b|\s*\()/i],
    ['MONDAY', /^(?:montag|mo)\b/i],
    ['TUESDAY', /^(?:dienstag|di)\b/i],
    ['WEDNESDAY', /^(?:mittwoch|mi)\b/i],
    ['THURSDAY', /^(?:donnerstag|do)\b/i],
    ['FRIDAY', /^(?:freitag|fr)\b/i],
    ['SATURDAY', /^(?:samstag|sa)\b/i],
    ['SUNDAY', /^(?:sonntag|so)\b/i]
  ];
  const match = patterns.find(([, expression]) => expression.test(value));
  if (!match) return null;
  const daysByCode = {
    MON_THU: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'],
    TUESDAY_FRIDAY: ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    TUESDAY_WEDNESDAY_THURSDAY_FRIDAY: ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    MON_TUE_WED_FRI: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'FRIDAY'],
    THURSDAY_FRIDAY: ['THURSDAY', 'FRIDAY'],
    MON_FRI: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
  };
  return { code: match[0], label: value, days: daysByCode[match[0]] || [match[0]] };
}

function mergeSharedValidity(validities) {
  const shared = key => {
    const values = validities.map(validity => validity?.[key] ?? null);
    return values.length && values.every(value => value === values[0]) ? values[0] : null;
  };
  const dayType = shared('dayType') || 'unknown';
  const serviceRegime = shared('serviceRegime') || 'unknown';
  const validFrom = shared('validFrom');
  const rawLabel = shared('rawLabel');
  return {
    dayType,
    dayTypeSource: dayType === 'unknown' ? 'UNKNOWN' : validities[0]?.dayTypeSource || 'UNKNOWN',
    serviceRegime,
    serviceRegimeSource: serviceRegime === 'unknown' ? 'UNKNOWN' : validities[0]?.serviceRegimeSource || 'UNKNOWN',
    validFrom,
    validFromSource: validFrom ? validities[0]?.validFromSource || 'UNKNOWN' : 'UNKNOWN',
    rawLabel
  };
}

function projectService(sheet, ordinal, validity) {
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const sheetName = clean(sheet?.name) || `Dienstblatt ${ordinal + 1}`;
  const headers = rows.map((row, index) => (row || []).some(value => clean(value) === WAGENKARTE_HEADER) ? index : -1).filter(index => index >= 0);
  const sectionStarts = headers.length ? headers : [0];
  const physicalStartRow = Number.isInteger(sheet?.startRow) ? sheet.startRow : 1;
  const physicalSections = sectionStarts.map((start, index) => {
    const end = (sectionStarts[index + 1] ?? rows.length) - 1;
    return projectServiceSection(rows.slice(start, end + 1), {
      sheetName, sectionIndex: index, serviceOrdinal: ordinal, validity,
      headerRow: physicalStartRow + start, endRow: physicalStartRow + end,
      sourceRowOffset: physicalStartRow + start - 1,
      hasNextSection: index < sectionStarts.length - 1
    });
  });
  const sections = mergePhysicalContinuations(physicalSections);
  const first = sections[0] || {};
  const multiSection = sections.length > 1;
  return {
    serviceId: first.serviceId || `wagenkarte-service:${ordinal + 1}`,
    serviceNumber: first.serviceNumber || clean(headerValue(rows, WAGENKARTE_HEADER) ?? rows?.[0]?.[3]),
    runId: multiSection ? null : first.runId || null,
    sheetName,
    validity: multiSection ? validity : first.validity,
    shiftStart: multiSection ? null : first.shiftStart,
    shiftEnd: multiSection ? null : first.shiftEnd,
    shiftDuration: multiSection ? null : first.shiftDuration,
    paidTime: multiSection ? null : first.paidTime,
    officialDrivingTime: multiSection ? null : first.officialDrivingTime,
    officialL5: multiSection ? null : first.officialL5,
    segments: multiSection ? [] : first.segments || [],
    breaks: multiSection ? [] : first.breaks || [],
    interruptions: multiSection ? [] : first.interruptions || [],
    additionalTimes: multiSection ? emptyAdditionalTimes() : first.additionalTimes || emptyAdditionalTimes(),
    sections,
    source: { sourceType: 'excel', sheetName, row: physicalStartRow, ref: sheet?.ref || null }
  };
}

function mergePhysicalContinuations(physicalSections) {
  const semanticSections = [];
  for (const [index, physical] of physicalSections.entries()) {
    const previous = semanticSections.at(-1);
    if (previous && sameSemanticSection(previous, physical)) {
      mergeIntoSemanticSection(previous, physical);
    } else {
      semanticSections.push({ ...physical, sourceRanges: [physicalSourceRange(physical, index === 0 ? 'DOCUMENT_START' : semanticBoundaryReason(previous, physical))] });
    }
  }
  return semanticSections;
}

function physicalSourceRange(section, semanticBoundaryBefore) {
  return {
    ...section.source,
    physicalBoundaryBefore: section.source.sectionIndex === 0 ? 'INITIAL_HEADER' : 'REPEATED_HEADER',
    semanticBoundaryBefore,
    dayQualifier: section.validity?.dayQualifier || null,
    officialL5Minutes: section.officialL5?.minutes ?? null
  };
}

function semanticBoundaryReason(previous, current) {
  if (!previous) return 'DOCUMENT_START';
  if (previous.validity?.dayQualifier?.code !== current.validity?.dayQualifier?.code
    || clean(previous.validity?.dayQualifier?.label) !== clean(current.validity?.dayQualifier?.label)) return 'DAY_QUALIFIER_CHANGED';
  if (previous.officialL5?.minutes !== current.officialL5?.minutes) return 'OFFICIAL_L5_CHANGED';
  if (previous.runId && current.runId && previous.runId !== current.runId) return 'VARIANT_CHANGED';
  if (previous.shiftStart?.timelineMinutes !== current.shiftStart?.timelineMinutes
    || previous.shiftEnd?.timelineMinutes !== current.shiftEnd?.timelineMinutes) return 'SHIFT_CHANGED';
  return 'STRUCTURED_SECTION_CHANGE';
}

function sameSemanticSection(left, right) {
  const qualifierKey = section => {
    const qualifier = section.validity?.dayQualifier;
    return qualifier ? `${qualifier.code}|${clean(qualifier.label).toLocaleLowerCase()}` : '';
  };
  return left.serviceNumber === right.serviceNumber
    && qualifierKey(left) === qualifierKey(right)
    && !(left.runId && right.runId && left.runId !== right.runId)
    && (left.shiftStart?.timelineMinutes ?? null) === (right.shiftStart?.timelineMinutes ?? null)
    && (left.shiftEnd?.timelineMinutes ?? null) === (right.shiftEnd?.timelineMinutes ?? null)
    && (left.officialL5?.minutes ?? null) === (right.officialL5?.minutes ?? null);
}

function mergeIntoSemanticSection(target, continuation) {
  target.sourceRanges.push(physicalSourceRange(continuation, 'CONTINUATION'));
  target.segments = [...target.segments, ...continuation.segments].sort(byTimeline);
  target.breaks = [...target.breaks, ...continuation.breaks].sort(byTimeline);
  target.interruptions = [...target.interruptions, ...continuation.interruptions].sort(byTimeline);
  for (const key of Object.keys(target.additionalTimes || {})) {
    target.additionalTimes[key] = [...(target.additionalTimes[key] || []), ...(continuation.additionalTimes?.[key] || [])].sort(byTimeline);
  }
  target.source.endRow = continuation.source.endRow;
  target.warnings = [...new Set([...(target.warnings || []), ...(continuation.warnings || [])])];
  target.unresolvedTrips = [...(target.unresolvedTrips || []), ...(continuation.unresolvedTrips || [])];
  target.assignmentStatus = target.warnings.length ? 'UNRESOLVED' : 'RESOLVED';
  target.incompleteTrip = target.warnings.length > 0;
  if (target.incompleteTrip) {
    target.tripTime = { minutes: null, value: null };
  } else {
    const mergedMinutes = (target.tripTime?.minutes || 0) + (continuation.tripTime?.minutes || 0);
    target.tripTime = { minutes: mergedMinutes, value: formatDuration(mergedMinutes) };
  }
}

function projectServiceSection(rows, { sheetName, sectionIndex, serviceOrdinal, validity, headerRow, endRow, sourceRowOffset, hasNextSection }) {
  const serviceNumber = clean(headerValue(rows, WAGENKARTE_HEADER) ?? rows?.[0]?.[3]);
  const headerText = serviceValidityLabel(rows);
  const sectionValidity = { ...resolveCanonicalValidity({ headerText, documentMetadata: validity?.validFrom ? { validFrom: validity.validFrom } : null }), dayQualifier: parseServiceDayQualifier(headerText) };
  const runId = findRunId(rows);
  const serviceId = `wagenkarte-service:${serviceNumber || serviceOrdinal + 1}${runId ? `:${runId}` : ''}`;
  const shiftStart = clock(headerValue(rows, 'Dienstbeginn:') ?? rows?.[3]?.[3]);
  const shiftEnd = timelineClock(headerValue(rows, 'Dienstende:') ?? rows?.[4]?.[3], shiftStart.timelineMinutes);
  const shiftDuration = duration(headerValue(rows, 'Schichtdauer:') ?? rows?.[2]?.[11]);
  const paidTime = duration(headerValue(rows, 'Bezahlte Zeit:') ?? rows?.[3]?.[11]);
  const officialDrivingTime = duration(headerValue(rows, 'Lenkzeit') ?? rows?.[4]?.[11]);
  const { observations, incompleteTrip, unresolvedTrips } = readSheetObservations(rows, sheetName, sourceRowOffset);
  const normalized = normalizeObservationTimeline(observations, shiftStart.timelineMinutes);
  const segments = normalized.filter(item => item.kind === 'segment').map(item => item.value);
  const activitySegments = normalized.filter(item => item.kind === 'activity').map(item => item.value);
  const breaks = activitySegments.filter(item => item.type === 'PAUSE' || item.type === 'UNPAID_BREAK');
  const interruptions = activitySegments.filter(item => item.type === 'SERVICE_INTERRUPTION');
  const additionalTimes = Object.fromEntries(Object.values(ADDITIONAL_TIME_KEYS).map(key => [key, []]));
  for (const activity of activitySegments) {
    const key = ADDITIONAL_TIME_KEYS[activity.type];
    if (key) additionalTimes[key].push(activity);
  }

  const tripMinutes = segments.filter(item => item.type === 'LINE_SERVICE' || item.type === 'DEADHEAD')
    .reduce((sum, item) => sum + (Number.isInteger(item.duration?.minutes) ? item.duration.minutes : 0), 0);
  const warnings = incompleteTrip && hasNextSection ? ['SECTION_BOUNDARY_AMBIGUOUS'] : [];
  const section = {
    serviceId,
    serviceNumber,
    runId: runId || null,
    sheetName,
    validity: sectionValidity.dayType !== 'unknown' || sectionValidity.dayQualifier ? sectionValidity : validity,
    shiftStart,
    shiftEnd,
    shiftDuration,
    paidTime,
    officialL5: { ...officialDrivingTime, source: { sourceType: 'excel', sheetName, field: 'Lenkzeit', cell: `L${headerRow + 4}`, headerRow } },
    officialDrivingTime: { ...officialDrivingTime, source: { sourceType: 'excel', sheetName, field: 'Lenkzeit', cell: `L${headerRow + 4}`, headerRow } },
    segments: [...segments, ...activitySegments].sort(byTimeline),
    breaks,
    interruptions,
    additionalTimes,
    source: { sourceType: 'excel', sheetName, row: headerRow, headerRow, endRow, sectionIndex, validitySource: { sourceType: 'excel', sheetName, row: headerRow, field: 'validity' }, l5Cell: `L${headerRow + 4}` },
    tripTime: { minutes: warnings.length ? null : tripMinutes, value: warnings.length ? null : formatDuration(tripMinutes) },
    warnings,
    unresolvedTrips: warnings.length ? unresolvedTrips : [],
    assignmentStatus: warnings.length ? 'UNRESOLVED' : 'RESOLVED',
    incompleteTrip: warnings.length > 0
  };
  return section;
}

function emptyAdditionalTimes() { return Object.fromEntries(Object.values(ADDITIONAL_TIME_KEYS).map(key => [key, []])); }
function formatDuration(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }

/**
 * Extracts the three parallel Wagenkarten regions independently, then returns
 * their observations for the existing chronological normalizer. This is the
 * DOM-free counterpart of the legacy `extractWagenkarteStructuredData` flow.
 */
function readSheetObservations(rows, sheetName, sourceRowOffset = 0) {
  const observations = [];
  let incompleteTrip = false;
  const unresolvedTrips = [];
  for (const region of WAGENKARTE_REGIONS) {
    const regionRows = rows.map((row, rowIndex) => ({ rowIndex, cells: (Array.isArray(row) ? row : []).slice(region.start, region.end + 1) }));
    const result = readRegionObservations(regionRows, sheetName, region, sourceRowOffset);
    observations.push(...result.observations);
    incompleteTrip ||= result.incompleteTrip && result.pendingTripRow >= rows.length - 1;
    if (result.incompleteTrip && result.pendingTripRow >= rows.length - 1 && result.pendingTrip) {
      unresolvedTrips.push({
        type: result.pendingTrip.type,
        line: result.pendingTrip.line,
        trip: result.pendingTrip.trip,
        rawLabel: result.pendingTrip.rawLabel,
        status: 'SECTION_BOUNDARY_AMBIGUOUS',
        source: source(sheetName, result.pendingTrip.row + sourceRowOffset, result.region)
      });
    }
  }
  // A Wagenkarte continues chronologically from its left region to its right
  // region. Rows repeat vertically in every region, so sorting by row would
  // interleave e.g. 04:xx, 07:xx and 10:xx events and corrupt driving blocks.
  return { observations, incompleteTrip, unresolvedTrips };
}

const WAGENKARTE_REGIONS = Object.freeze([
  // SheetJS exposes merged Wagenkarten labels at the left edge of their
  // visual table. The legacy DOM indices were one column to the right; using
  // the plain workbook positions keeps each complete region intact.
  { index: 0, start: 0, end: 7 },
  { index: 1, start: 8, end: 15 },
  { index: 2, start: 16, end: 22 }
]);

function readRegionObservations(regionRows, sheetName, region, sourceRowOffset = 0) {
  const observations = [];
  let pendingTrip = null;
  let pendingTripType = 'LINE_SERVICE';
  let lastLineMarkerRow = null;
  let lastDeadheadMarkerRow = null;

  const flush = () => {
    if (!pendingTrip?.stops?.length) { pendingTrip = null; return; }
    const first = pendingTrip.stops[0];
    const last = pendingTrip.stops.at(-1);
    observations.push({ kind: 'segment', row: pendingTrip.row, region: region.index, value: {
      type: pendingTrip.type, line: pendingTrip.line, trip: pendingTrip.trip, course: null,
      start: first.time, end: last.time, duration: durationBetween(first.time, last.time),
      from: first.location, to: last.location, stops: pendingTrip.stops,
      rawLabel: pendingTrip.rawLabel, source: source(sheetName, pendingTrip.row + sourceRowOffset, region.index),
      sourceRange: { startRow: first.sourceRow, endRow: last.sourceRow }
    } });
    pendingTrip = null;
  };

  for (const { rowIndex, cells } of regionRows) {
    // The four top rows are the Wagenkartenkopf. Real workbooks do not keep a
    // blank spacer row, so a fixed `rowIndex < 5` would discard the first
    // preparation/activity line.
    if (rowIndex < 4) continue;
    const values = cells.map(clean).filter(Boolean);
    if (!values.length) continue;
    const activities = values.map(parseActivity).filter(Boolean);
    const lineTrip = values.map(parseLineTrip).find(Boolean);
    const stop = parseStop(values);
    // The legacy reader treats a Leerfahrt marker as the boundary of the
    // preceding line trip. It then opens a separate deadhead trip at the next
    // stop. Only the two structural table labels are non-boundaries.
    const boundary = activities.some(activity => !['ROUTE_MARKER', 'LINE_MARKER'].includes(activity.type));
    if (pendingTrip && (lineTrip || boundary || (pendingTrip.lastRow !== null && rowIndex - pendingTrip.lastRow > 3))) flush();

    for (const activity of activities) {
      if (activity.type === 'DEADHEAD_MARKER') { pendingTripType = 'DEADHEAD'; lastDeadheadMarkerRow = rowIndex; }
      else if (activity.type === 'LINE_MARKER') lastLineMarkerRow = rowIndex;
      else if (activity.type !== 'ROUTE_MARKER') observations.push({ kind: 'activity', row: rowIndex + sourceRowOffset, region: region.index, value: { ...activity, source: source(sheetName, rowIndex + sourceRowOffset, region.index) } });
    }
    if (lineTrip && lastLineMarkerRow !== null && rowIndex - lastLineMarkerRow <= 2) {
      pendingTrip = { type: pendingTripType, line: lineTrip.line, trip: lineTrip.trip, rawLabel: `${lineTrip.line}/${lineTrip.trip}`, row: rowIndex, lastRow: null, stops: [] };
      pendingTripType = 'LINE_SERVICE'; lastDeadheadMarkerRow = null; continue;
    }
    if (!pendingTrip && stop && pendingTripType === 'DEADHEAD' && lastDeadheadMarkerRow !== null && rowIndex > lastDeadheadMarkerRow && rowIndex - lastDeadheadMarkerRow <= 3) {
      pendingTrip = { type: 'DEADHEAD', line: null, trip: null, rawLabel: 'Leerfahrt', row: rowIndex, lastRow: rowIndex, stops: [{ ...stop, sourceRow: rowIndex + sourceRowOffset + 1 }] };
      pendingTripType = 'LINE_SERVICE'; lastDeadheadMarkerRow = null; continue;
    }
    if (pendingTrip && stop) { pendingTrip.stops.push({ ...stop, sourceRow: rowIndex + sourceRowOffset + 1 }); pendingTrip.lastRow = rowIndex; }
  }
  const incompleteTrip = Boolean(pendingTrip && !pendingTrip.stops?.length);
  if (pendingTrip?.stops?.length) flush();
  return { observations, incompleteTrip, pendingTripRow: pendingTrip?.row ?? null, pendingTrip, region: region.index };
}

function parseActivity(text) {
  for (const [type, expression] of ACTIVITY_PATTERNS) {
    const match = clean(text).match(expression);
    if (!match) continue;
    const start = clock(match[1]);
    const end = timelineClock(match[2], start.timelineMinutes);
    return { type, start, end, duration: durationBetween(start, end), rawLabel: clean(text) };
  }
  if (/^Leerfahrt$/i.test(clean(text))) return { type: 'DEADHEAD_MARKER', rawLabel: clean(text) };
  if (/^Umlauf$/i.test(clean(text))) return { type: 'ROUTE_MARKER', rawLabel: clean(text) };
  if (/^Linie\s*\/\s*Fahrt-Nr\.?$/i.test(clean(text))) return { type: 'LINE_MARKER', rawLabel: clean(text) };
  return null;
}

function parseLineTrip(value) {
  const match = clean(value).match(LINE_TRIP);
  return match ? { line: match[1], trip: match[2] } : null;
}

function parseStop(values) {
  const event = values.find(value => /^(ab|an)$/i.test(value));
  const timeValue = values.find(value => TIME.test(value));
  const location = values.find(value => !isStopNoise(value));
  if (!timeValue || !location) return null;
  return { event: event ? event.toLowerCase() : 'pass', time: clock(timeValue), location };
}

function isStopNoise(value) {
  return !value || TIME.test(value) || /^(ab|an)$/i.test(value) || Boolean(parseActivity(value))
    || Boolean(parseLineTrip(value)) || /^(Zusteiger aus:|Umsteiger in:)$/i.test(value) || /^Linie:\s*\d+/i.test(value)
    || /^(Dienst-Nr\.:|Gültig ab:|Schichtdauer:|Dienstbeginn:|Bezahlte Zeit:|Dienstende:|Lenkzeit)$/i.test(value);
}

function normalizeObservationTimeline(observations, initialTimeline) {
  let previous = Number.isInteger(initialTimeline) ? initialTimeline : null;
  return observations.map(observation => {
    const value = observation.value;
    const start = normalizeClock(value.start, previous);
    const end = normalizeEnd(value.end, start.timelineMinutes);
    previous = end.timelineMinutes ?? start.timelineMinutes ?? previous;
    const normalizedStops = Array.isArray(value.stops)
      ? normalizeStops(value.stops, start.timelineMinutes)
      : undefined;
    return {
      ...observation,
      value: {
        ...value,
        start,
        end,
        duration: durationBetween(start, end),
        ...(normalizedStops ? { stops: normalizedStops } : {})
      }
    };
  });
}

function normalizeStops(stops, initialTimeline) {
  let previous = initialTimeline;
  return stops.map(stop => {
    const time = normalizeClock(stop.time, previous);
    previous = time.timelineMinutes ?? previous;
    return { ...stop, time };
  });
}

function normalizeClock(value, previousTimeline = null) {
  const basic = clock(value);
  if (basic.minutesSinceStartOfDay === null) return basic;
  let timelineMinutes = basic.minutesSinceStartOfDay;
  if (Number.isInteger(previousTimeline)) {
    while (timelineMinutes < previousTimeline) timelineMinutes += 1440;
  }
  return { ...basic, timelineMinutes };
}

function normalizeEnd(value, startTimeline) {
  return normalizeClock(value, startTimeline);
}

function timelineClock(value, previousTimeline = null) {
  return normalizeClock(value, previousTimeline);
}

function clock(value) {
  if (value && typeof value === 'object' && 'minutesSinceStartOfDay' in value) return value;
  const raw = clean(value);
  const match = raw.match(TIME);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { raw, value: null, minutesSinceStartOfDay: null, timelineMinutes: null };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return { raw, value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, minutesSinceStartOfDay: hours * 60 + minutes, timelineMinutes: hours * 60 + minutes };
}

function duration(value) {
  const time = clock(value);
  return { raw: time.raw, value: time.value, minutes: time.minutesSinceStartOfDay };
}

function durationBetween(start, end) {
  const startMinute = start?.timelineMinutes;
  const endMinute = end?.timelineMinutes;
  const minutes = Number.isInteger(startMinute) && Number.isInteger(endMinute) && endMinute >= startMinute ? endMinute - startMinute : null;
  return { value: minutes === null ? null : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, minutes };
}

function findRunId(rows) {
  for (const row of rows) {
    const match = rowText(row).match(/\bUmlauf\s*:?\s*(\d+)\b/i);
    if (match) return match[1];
  }
  return null;
}

function headerValue(rows, label) {
  const wanted = clean(label).toLowerCase();
  for (const row of rows || []) {
    const cells = Array.isArray(row) ? row : [];
    const index = cells.findIndex(value => clean(value).toLowerCase() === wanted);
    if (index < 0) continue;
    for (let cursor = index + 1; cursor < cells.length; cursor += 1) {
      const value = clean(cells[cursor]);
      if (value) return value;
    }
  }
  return null;
}

function normalizeValidFrom(value) {
  const text = clean(value);
  const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function rowText(row) {
  return (Array.isArray(row) ? row : []).map(clean).filter(Boolean).join(' ');
}

function byTimeline(left, right) {
  return (left?.start?.timelineMinutes ?? Number.MAX_SAFE_INTEGER) - (right?.start?.timelineMinutes ?? Number.MAX_SAFE_INTEGER);
}
