import { attachCircuitIdentities } from '../identity/identity-normalization.js';
import { attachCanonicalValidity } from '../schedule/canonical-validity.js';

/**
 * Converts the row matrix already produced by SheetJS in the legacy import
 * into the V2 CanonicalSchedule. This module is not connected to the legacy
 * import handler; it neither replaces nor alters legacy analysis results.
 */
export function adaptExcelRowsToCanonicalSchedule(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Expected an Excel row matrix.');

  const layout = detectExcelLayout(rows, options.layout);
  const source = {
    sourceType: 'excel',
    fileName: options.fileName || '',
    sheetName: options.sheetName || '',
    layout
  };
  const services = buildServices(rows, layout, source);
  const activities = services.flatMap(service => service.activities);

  const schedule = {
    type: 'CanonicalSchedule',
    document: {
      sourceType: 'excel',
      pageCount: null,
      source
    },
    services,
    activities,
    interruptions: [],
    warnings: [],
    metadata: {
      schemaVersion: '1.0',
      serviceCount: services.length,
      activityCount: activities.length,
      interruptionCount: 0,
      excelLayout: layout
    }
  };
  // WP24: enrich the finished CanonicalSchedule with RouteIdentity/ServiceIdentity
  // exactly once, at the point the schedule is complete. Additive only.
  return attachCanonicalValidity(attachCircuitIdentities(schedule), {
    headerText: workbookHeaderText(rows),
    documentMetadata: options.documentMetadata,
    fileName: options.fileName || ''
  });
}

function workbookHeaderText(rows) {
  return rows.slice(0, 12)
    .filter(Array.isArray)
    .map(row => row.map(normalized).filter(Boolean).join(' '))
    .join(' ');
}

export function detectExcelLayout(rows, forcedLayout) {
  if (forcedLayout) return forcedLayout;
  const hasTenColumnHeader = rows.some(row =>
    normalized(row?.[0]).toLocaleLowerCase('de') === 'dienst' &&
    normalized(row?.[1]).toLocaleLowerCase('de') === 'umlauf' &&
    normalized(row?.[2]).toLocaleLowerCase('de') === 'tätigkeit'
  );
  return hasTenColumnHeader ? 'schedule-10-column' : 'legacy-tabular-17-column';
}

function buildServices(rows, layout, documentSource) {
  const columns = columnIndexes(layout);
  const services = [];
  let current = null;

  rows.forEach((rawRow, rowIndex) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const serviceNumber = normalized(row[columns.serviceNumber]);
    const isServiceStart = /^\d+$/.test(serviceNumber);
    if (isServiceStart) {
      current = createService(serviceNumber, services.length + 1, row, rowIndex, columns, documentSource);
      services.push(current);
    }
    if (!current || !isScheduleRow(row, columns) || isHeaderRow(row, columns)) return;

    const activity = createActivity(current, current.activities.length + 1, row, rowIndex, columns, documentSource);
    current.activities.push(activity);
    current.source.excelRows.push(sourceRow(row, rowIndex, documentSource));

    // Phase 3I.31: in a multi-row duty the plan prints Dienstende and bez. Zeit on the row where
    // the duty actually ENDS, not on the row where it starts. Reading only the first row lost
    // both values for every multi-row duty. A later value is only taken where none is known yet —
    // the duty's own start row still wins.
    adoptLateServiceFields(current, row, columns);
  });
  return services;
}

/** Fills `end`/`paidTime` from a later row of the same duty when the start row left them empty. */
function adoptLateServiceFields(service, row, columns) {
  if (service.end?.minutesSinceStartOfDay === null) {
    const end = normalizeClockTime(row[columns.end]);
    if (end.minutesSinceStartOfDay !== null) service.end = end;
  }
  if (service.paidTime?.minutes === null) {
    const paidTime = normalizeDuration(row[columns.paidTime]);
    if (paidTime.minutes !== null) service.paidTime = paidTime;
  }
}

function createService(serviceNumber, ordinal, row, rowIndex, columns, documentSource) {
  const source = {
    ...sourceRow(row, rowIndex, documentSource),
    excelRows: [sourceRow(row, rowIndex, documentSource)]
  };
  return {
    id: `excel-service:${ordinal}`,
    serviceNumber,
    begin: normalizeClockTime(row[columns.begin]),
    end: normalizeClockTime(row[columns.end]),
    paidTime: normalizeDuration(row[columns.paidTime]),
    activities: [],
    interruptions: [],
    drivingTimeSource: 'UNKNOWN',
    originalText: originalText(row),
    boundingBox: null,
    source
  };
}

function createActivity(service, ordinal, row, rowIndex, columns, documentSource) {
  // Phase 3I.32: the relief chain the plan prints PER LEG — which duty handed this leg over and
  // which one takes it on. Only the raw cell text is carried; interpretation happens elsewhere.
  // The field appears ONLY where the layout actually has those columns, so an activity from a
  // layout without them keeps exactly the shape it always had.
  const handoverSource = columns.previousService === undefined && columns.nextService === undefined
    ? null
    : {
      previous: columns.previousService === undefined ? '' : normalized(row[columns.previousService]),
      next: columns.nextService === undefined ? '' : normalized(row[columns.nextService])
    };
  return {
    id: `excel-activity:${service.id}:${ordinal}`,
    serviceId: service.id,
    serviceNumber: service.serviceNumber,
    circuitNumber: normalized(row[columns.circuitNumber]),
    rawActivity: normalized(row[columns.activityText]),
    departureTime: normalizeClockTime(row[columns.departureTime]),
    arrivalTime: normalizeClockTime(row[columns.arrivalTime]),
    departureLocation: normalized(row[columns.departureLocation]),
    arrivalLocation: normalized(row[columns.arrivalLocation]),
    ...(handoverSource ? { handoverSource } : {}),
    originalText: originalText(row),
    boundingBox: null,
    source: sourceRow(row, rowIndex, documentSource)
  };
}

function columnIndexes(layout) {
  if (layout === 'schedule-10-column') {
    return { serviceNumber: 0, circuitNumber: 1, activityText: 2, departureTime: 3, departureLocation: 4, arrivalTime: 5, arrivalLocation: 6, begin: 7, end: 8, paidTime: 9 };
  }
  return { serviceNumber: 2, circuitNumber: 4, activityText: 3, departureTime: 5, departureLocation: 6, arrivalTime: 9, arrivalLocation: 10, previousService: 12, nextService: 13, begin: 14, end: 15, paidTime: 16 };
}

function isScheduleRow(row, columns) {
  return [columns.activityText, columns.departureTime, columns.arrivalTime, columns.circuitNumber]
    .some(index => normalized(row[index]) !== '');
}

function isHeaderRow(row, columns) {
  return (normalized(row[columns.serviceNumber]).toLocaleLowerCase('de') === 'dienst' &&
    normalized(row[columns.activityText]).toLocaleLowerCase('de') === 'tätigkeit') ||
    isRepeatedPageHeader(row);
}

/**
 * Phase 3I.33 — the 17-column plan reprints its column header at the top of every page. Those
 * rows were being absorbed into whichever duty happened to be open, giving it a phantom last
 * activity whose "location" was the word `Ort`.
 *
 * The header spans TWO printed lines, so both are described. A row is only discarded when at
 * least MINIMUM_HEADER_MARKERS of the expected titles sit at their expected COLUMNS — a single
 * cell reading `Ort` or `Linie` never suffices, and a genuine duty row survives even if a stop is
 * unluckily named. Comparison is exact after normalisation; no free-text search is performed.
 */
const PAGE_HEADER_SIGNATURES = Object.freeze([
  Object.freeze({ 2: 'dienst-', 3: 'linie', 4: 'umlauf', 5: 'ausf.', 6: 'ort', 9: 'einf.', 10: 'ort', 12: 'vorher.', 13: 'nächst.', 16: 'bez.' }),
  Object.freeze({ 2: 'nr.', 5: '/abl.', 9: '/abl.', 12: 'dienst', 13: 'dienst', 14: 'beginn', 15: 'ende', 16: 'zeit' })
]);
const MINIMUM_HEADER_MARKERS = 4;

function isRepeatedPageHeader(row) {
  return PAGE_HEADER_SIGNATURES.some(signature => {
    let markers = 0;
    for (const [index, expected] of Object.entries(signature)) {
      if (normalized(row[index]).toLocaleLowerCase('de') === expected) markers += 1;
    }
    return markers >= MINIMUM_HEADER_MARKERS;
  });
}

function sourceRow(row, rowIndex, documentSource) {
  return {
    sourceType: 'excel',
    fileName: documentSource.fileName,
    sheetName: documentSource.sheetName,
    rowNumber: rowIndex + 1,
    rawCells: row.map(cell => cell == null ? '' : String(cell))
  };
}

function originalText(row) {
  return row.map(cell => cell == null ? '' : String(cell)).join(' | ');
}

function normalized(value) {
  return String(value ?? '').trim();
}

function normalizeClockTime(value) {
  const raw = normalized(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { raw, value: null, minutesSinceStartOfDay: null };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return { raw, value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, minutesSinceStartOfDay: hours * 60 + minutes };
}

function normalizeDuration(value) {
  const raw = normalized(value);
  const match = raw.match(/^(\d{1,3}):(\d{2})$/);
  if (!match || Number(match[2]) > 59) return { raw, value: null, minutes: null };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return { raw, value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, minutes: hours * 60 + minutes };
}
