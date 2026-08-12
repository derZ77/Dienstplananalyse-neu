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
const source = (sheetName, row) => ({ sourceType: 'excel', sheetName, row: row + 1 });

export function isWagenkarteDienstSheet(sheet) {
  return clean(sheet?.rows?.[0]?.[1]) === WAGENKARTE_HEADER;
}

/**
 * Projects the already SheetJS-normalized plain workbook into observed JES
 * vehicle-card data. The returned contract is a companion source, never a
 * replacement CanonicalSchedule.
 */
export function projectWagenkarteWorkbook(workbook, { sourceName = '', organization = 'JES' } = {}) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const dienstSheets = sheets.filter(isWagenkarteDienstSheet);
  const headerText = dienstSheets.map(sheet => rowText(sheet.rows?.[0])).filter(Boolean).join(' ');
  const validFrom = normalizeValidFrom(dienstSheets[0]?.rows?.[2]?.[3]);
  const validity = resolveCanonicalValidity({
    headerText,
    documentMetadata: validFrom ? { validFrom } : null,
    fileName: sourceName
  });
  const services = dienstSheets.map((sheet, index) => projectService(sheet, index, validity));

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

function projectService(sheet, ordinal, validity) {
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const sheetName = clean(sheet?.name) || `Dienstblatt ${ordinal + 1}`;
  const serviceNumber = clean(rows?.[0]?.[3]);
  const runId = findRunId(rows);
  const serviceId = `wagenkarte-service:${serviceNumber || ordinal + 1}${runId ? `:${runId}` : ''}`;
  const shiftStart = clock(rows?.[3]?.[3]);
  const shiftEnd = timelineClock(rows?.[4]?.[3], shiftStart.timelineMinutes);
  const shiftDuration = duration(rows?.[2]?.[11]);
  const paidTime = duration(rows?.[3]?.[11]);
  const officialDrivingTime = duration(rows?.[4]?.[11]);
  const observations = readSheetObservations(rows, sheetName);
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

  return {
    serviceId,
    serviceNumber,
    runId: runId || null,
    sheetName,
    validity,
    shiftStart,
    shiftEnd,
    shiftDuration,
    paidTime,
    officialDrivingTime: { ...officialDrivingTime, source: { sourceType: 'excel', sheetName, cell: 'L5' } },
    segments: [...segments, ...activitySegments].sort(byTimeline),
    breaks,
    interruptions,
    additionalTimes,
    source: { sourceType: 'excel', sheetName, row: 1 }
  };
}

function readSheetObservations(rows, sheetName) {
  const observations = [];
  let nextTripType = 'LINE_SERVICE';
  let pendingLine = null;
  let pendingTrip = null;

  const flushTrip = () => {
    if (!pendingTrip || !pendingTrip.stops.length) return;
    const first = pendingTrip.stops[0];
    const last = pendingTrip.stops.at(-1);
    observations.push({
      kind: 'segment',
      row: pendingTrip.row,
      value: {
        type: pendingTrip.type,
        line: pendingTrip.line || null,
        trip: pendingTrip.trip || null,
        course: null,
        start: first.time,
        end: last.time,
        duration: durationBetween(first.time, last.time),
        from: first.location,
        to: last.location,
        stops: pendingTrip.stops,
        rawLabel: pendingTrip.rawLabel,
        source: source(sheetName, pendingTrip.row)
      }
    });
    pendingTrip = null;
  };

  rows.forEach((row, rowIndex) => {
    // D1/D3-D5/L3-L5 are Wagenkartenkopf, not timetable rows. Their clock-like
    // values must never become a synthetic stop or a driving segment.
    if (rowIndex < 5) return;
    const values = (Array.isArray(row) ? row : []).map(clean).filter(Boolean);
    if (!values.length) return;
    const fullText = values.join(' ');
    const activity = parseActivity(fullText);
    if (activity) {
      flushTrip();
      observations.push({ kind: 'activity', row: rowIndex, value: { ...activity, source: source(sheetName, rowIndex) } });
      return;
    }
    if (values.some(value => /^Leerfahrt$/i.test(value))) {
      flushTrip();
      nextTripType = 'DEADHEAD';
      pendingLine = null;
      return;
    }
    if (values.some(value => /^Linie\s*\/\s*Fahrt-Nr\.?$/i.test(value))) return;
    const lineTrip = values.map(parseLineTrip).find(Boolean);
    if (lineTrip) {
      flushTrip();
      pendingLine = lineTrip;
      return;
    }
    const stop = parseStop(values);
    if (!stop) return;
    if (!pendingTrip) {
      pendingTrip = {
        type: nextTripType,
        line: pendingLine?.line || null,
        trip: pendingLine?.trip || null,
        rawLabel: pendingLine ? `${pendingLine.line}/${pendingLine.trip}` : nextTripType === 'DEADHEAD' ? 'Leerfahrt' : '',
        row: rowIndex,
        stops: []
      };
      nextTripType = 'LINE_SERVICE';
      pendingLine = null;
    }
    pendingTrip.stops.push(stop);
  });
  flushTrip();
  return observations;
}

function parseActivity(text) {
  for (const [type, expression] of ACTIVITY_PATTERNS) {
    const match = clean(text).match(expression);
    if (!match) continue;
    const start = clock(match[1]);
    const end = timelineClock(match[2], start.timelineMinutes);
    return { type, start, end, duration: durationBetween(start, end), rawLabel: clean(text) };
  }
  return null;
}

function parseLineTrip(value) {
  const match = clean(value).match(LINE_TRIP);
  return match ? { line: match[1], trip: match[2] } : null;
}

function parseStop(values) {
  const event = values.find(value => /^(ab|an)$/i.test(value));
  const timeValue = values.find(value => TIME.test(value));
  const location = values.find(value => !/^(ab|an)$/i.test(value) && !TIME.test(value) && !parseLineTrip(value) && !/^Linie:/i.test(value));
  if (!timeValue || !location) return null;
  return { event: event ? event.toLowerCase() : 'pass', time: clock(timeValue), location };
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
