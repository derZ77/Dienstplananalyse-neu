/**
 * The XLSX projection of an imported Dienstplan-PDF (Phase 4.3) — A PURE PROJECTOR.
 *
 * It reads a finished `CanonicalSchedule` and returns three flat sheets as plain data. It writes
 * no file, knows no spreadsheet library, touches no DOM, reads no analysis result and never
 * mutates its input. Turning the sheets into a workbook is Phase 4.4.
 *
 * SCOPE
 * -----
 * Only a JNV or a JES Dienstplan-PDF is projected. Every other document type is refused with a
 * structured `not_applicable`; a damaged schedule yields `inconclusive`. A regularly unsupported
 * document never throws.
 *
 * WHAT IT MAY AND MAY NOT INVENT
 * ------------------------------
 * Every value either comes from a structured parser field or from a function this project already
 * proved elsewhere — the row classification of `row-type-contract.js` and the `RouteIdentity` the
 * import already attached. Nothing is derived with new string logic here. A field the PDF does not
 * carry (Richtung, previous/next duty) stays EMPTY; a value that cannot be read stays empty and
 * produces a warning. Nothing is recovered from the Legacy-Excel model.
 *
 * PRIVACY
 * -------
 * `originalText`, `rawCells`, `boundingBox`, file names and paths are never read into a cell. The
 * result consists exclusively of arrays, plain objects, strings, numbers and booleans.
 */

import { neutraliseCell } from '../report/check-report-export-model.js';
import { DOCUMENT_PROFILES } from '../documents/document-profiles.js';
import { DOCUMENT_TYPES } from '../documents/document-types.js';
import { classifyActivityRow, ROW_TYPES } from '../pdf/row-type-contract.js';

/** The projector's own status vocabulary. It is NOT a CheckResult status and never becomes one. */
export const XLSX_MODEL_STATUS = Object.freeze({
  READY: 'ready',
  NOT_APPLICABLE: 'not_applicable',
  INCONCLUSIVE: 'inconclusive'
});

/**
 * Per-value data quality. Closed, three levels, no fourth.
 * `exact`        — taken straight out of a structured parser field.
 * `derived`      — produced by an existing, proven project function (RouteIdentity, the hardened
 *                  timeline, the row classification).
 * `inconclusive` — missing, contradictory or not reliably derivable.
 */
export const CONFIDENCE_LEVELS = Object.freeze(['exact', 'derived', 'inconclusive']);
const EXACT = 'exact';
const DERIVED = 'derived';
const INCONCLUSIVE = 'inconclusive';

export const SHEET_NAMES = Object.freeze(['Dienstplan', 'Dienste', 'Importhinweise']);

/** The column contract of Phase 4.1 — order and wording unchanged. */
export const DIENSTPLAN_COLUMNS = Object.freeze([
  'Dienstnummer', 'Zeile', 'Linie', 'Umlauf', 'Tätigkeit', 'Beginn', 'Anfangsort',
  'Richtung', 'Ende', 'Endort', 'Vorheriger Dienst', 'Nachfolgender Dienst',
  'Dienstbeginn', 'Dienstende', 'Bezahlte Zeit', 'Pause/Unterbrechung',
  'Quellenstatus', 'Unsichere Felder', 'Seite'
]);

export const DIENSTE_COLUMNS = Object.freeze([
  'Dienstnummer', 'Beginn', 'Ende', 'Bezahlte Zeit', 'Abschnitte', 'Pausen',
  'Dokumenttyp', 'Organisation', 'Tagesart'
]);

export const IMPORTHINWEISE_COLUMNS = Object.freeze(['Warncode', 'Bereich', 'Meldung', 'Dienstnummer']);

export const MODEL_WARNING_CODES = Object.freeze({
  KEIN_SCHEDULE: 'KEIN_SCHEDULE',
  KEIN_DIENST: 'KEIN_DIENST',
  ZEILE_NICHT_ZUGEORDNET: 'ZEILE_NICHT_ZUGEORDNET',
  DIENSTNUMMER_MEHRFACH: 'DIENSTNUMMER_MEHRFACH',
  ZEIT_NICHT_LESBAR: 'ZEIT_NICHT_LESBAR',
  TAGESWECHSEL_UNBESTIMMT: 'TAGESWECHSEL_UNBESTIMMT'
});

/** Import warnings that may be projected — everything else is dropped rather than guessed at. */
const PROJECTABLE_IMPORT_WARNINGS = Object.freeze({
  NON_TABULAR_ANNOTATION: 'Eine Zeile gehört nicht zur Diensttabelle und wurde nicht übernommen.',
  UNSUPPORTED_DAY_QUALIFIER: 'Eine Tagesangabe wurde nicht erkannt.',
  AMBIGUOUS_GENERIC_DUTY: 'Eine Tätigkeit konnte nicht eindeutig eingeordnet werden.',
  IMPLAUSIBLE_TIME_SEQUENCE: 'Die Zeitfolge eines Dienstes ist nicht plausibel.',
  INVALID_SERVICE_INTERRUPTION_TIME: 'Eine Dienstunterbrechung trägt keine lesbare Zeit.',
  MIDNIGHT_ROLLOVER_APPLIED: 'Für einen Dienst wurde ein Tageswechsel angenommen.'
});

const MESSAGES = Object.freeze({
  [MODEL_WARNING_CODES.KEIN_SCHEDULE]: 'Es liegt kein auswertbarer Dienstplan vor.',
  [MODEL_WARNING_CODES.KEIN_DIENST]: 'Der Dienstplan enthält keinen einzigen Dienst.',
  [MODEL_WARNING_CODES.ZEILE_NICHT_ZUGEORDNET]: 'Eine Zeile konnte keinem Dienstabschnitt zugeordnet werden.',
  [MODEL_WARNING_CODES.DIENSTNUMMER_MEHRFACH]: 'Diese Dienstnummer kommt in mehreren Blöcken vor. Die Blöcke bleiben getrennt.',
  [MODEL_WARNING_CODES.ZEIT_NICHT_LESBAR]: 'Eine Zeitangabe war nicht lesbar und bleibt leer.',
  [MODEL_WARNING_CODES.TAGESWECHSEL_UNBESTIMMT]: 'Das Dienstende liegt vor dem Dienstbeginn. Ein Tageswechsel ist für dieses Dokument nicht bestimmbar.'
});

const EXPORTABLE_TYPES = Object.freeze([DOCUMENT_TYPES.JNV_SCHEDULE_PDF, DOCUMENT_TYPES.JES_SCHEDULE_PDF]);
const ORGANIZATION_OF = Object.freeze({
  [DOCUMENT_TYPES.JNV_SCHEDULE_PDF]: 'JNV',
  [DOCUMENT_TYPES.JES_SCHEDULE_PDF]: 'JES'
});

// =====================================================================================
// small pure helpers
// =====================================================================================

const text = (value) => String(value ?? '').trim();
const isFilled = (value) => value !== null && value !== undefined && String(value) !== '';

/**
 * A clock value as stable text. A known day change is carried as a suffix instead of being lost:
 * `00:57 (+1)`. There is deliberately no modulo-24 number here — a bare `00:57` would silently
 * claim the duty ended before it began.
 */
function clockText(clock, dayOffset = 0) {
  const value = clock?.value ?? null;
  if (!value) return { value: '', level: text(clock?.raw) === '' ? null : INCONCLUSIVE };
  if (Number.isInteger(dayOffset) && dayOffset > 0) {
    return { value: `${value} (+${dayOffset})`, level: DERIVED };
  }
  return { value, level: EXACT };
}

function durationText(duration) {
  const value = duration?.value ?? null;
  if (!value) return { value: '', level: text(duration?.raw) === '' ? null : INCONCLUSIVE };
  return { value, level: EXACT };
}

/** The weakest level of a row decides how the row is summarised. */
function weakest(levels) {
  if (levels.includes(INCONCLUSIVE)) return INCONCLUSIVE;
  if (levels.includes(DERIVED)) return DERIVED;
  return EXACT;
}

/**
 * Day offsets for a JNV plan, read off the hardened view the import already produced. A document
 * without hardening (JES) simply yields no offsets — none are invented for it.
 */
function dayOffsets(schedule) {
  const activities = new Map();
  const serviceEnds = new Map();
  const hardened = schedule?.hardened;
  if (!hardened || hardened.applied !== true || !Array.isArray(hardened.services)) {
    return { activities, serviceEnds, available: false };
  }
  for (const service of hardened.services) {
    if (Number.isInteger(service?.end?.dayOffset)) serviceEnds.set(service.serviceId, service.end.dayOffset);
    for (const activity of service?.dutyActivities ?? []) {
      activities.set(activity.id, {
        departure: activity.departureTime?.dayOffset ?? 0,
        arrival: activity.arrivalTime?.dayOffset ?? 0
      });
    }
  }
  return { activities, serviceEnds, available: true };
}

/** Only the fields a reader may see; never a source reference, never a raw line. */
function importWarning(code, scope, serviceNumber) {
  return {
    code,
    scope,
    message: PROJECTABLE_IMPORT_WARNINGS[code] ?? MESSAGES[code] ?? '',
    serviceNumber: text(serviceNumber)
  };
}

function refusal(status, documentType, warnings = []) {
  return {
    status,
    documentType: documentType ?? null,
    organization: documentType ? (ORGANIZATION_OF[documentType] ?? null) : null,
    sheets: [],
    statistics: emptyStatistics(warnings.length),
    warnings
  };
}

function emptyStatistics(warningCount = 0) {
  return {
    serviceCount: 0, activityCount: 0, warningCount,
    exactCellCount: 0, derivedCellCount: 0, inconclusiveCellCount: 0, classifiedCellCount: 0
  };
}

/** Resolves the document type from either a detection result or an explicitly named type. */
function resolveDocumentType(input) {
  const named = text(input?.documentType);
  if (named && named !== DOCUMENT_TYPES.UNKNOWN) return named;
  const profileId = input?.detection?.profile?.id;
  if (profileId && DOCUMENT_PROFILES[profileId]) return DOCUMENT_PROFILES[profileId].documentType;
  return null;
}

// =====================================================================================
// the projection
// =====================================================================================

/**
 * Projects an imported Dienstplan-PDF into the three-sheet XLSX model.
 *
 * @param {{detection?: object, documentType?: string, canonicalSchedule?: object}} input
 *        the result of the productive import, or an explicitly typed schedule
 * @returns {{status: string, documentType: string|null, organization: string|null,
 *            sheets: Array, statistics: object, warnings: Array}} plain, serialisable data
 */
export function buildDienstplanXlsxModel(input) {
  const documentType = resolveDocumentType(input);
  if (!documentType || !EXPORTABLE_TYPES.includes(documentType)) {
    return refusal(XLSX_MODEL_STATUS.NOT_APPLICABLE, documentType);
  }

  const schedule = input?.canonicalSchedule;
  if (!schedule || schedule.type !== 'CanonicalSchedule' || !Array.isArray(schedule.services)) {
    return refusal(XLSX_MODEL_STATUS.INCONCLUSIVE, documentType,
      [{ code: MODEL_WARNING_CODES.KEIN_SCHEDULE, scope: 'Dokument',
        message: MESSAGES[MODEL_WARNING_CODES.KEIN_SCHEDULE], serviceNumber: '' }]);
  }
  if (schedule.services.length === 0) {
    return refusal(XLSX_MODEL_STATUS.INCONCLUSIVE, documentType,
      [{ code: MODEL_WARNING_CODES.KEIN_DIENST, scope: 'Dokument',
        message: MESSAGES[MODEL_WARNING_CODES.KEIN_DIENST], serviceNumber: '' }]);
  }

  const organization = ORGANIZATION_OF[documentType];
  const offsets = dayOffsets(schedule);
  const warnings = [];
  const levelCounts = { [EXACT]: 0, [DERIVED]: 0, [INCONCLUSIVE]: 0 };
  const dienstplanRows = [];
  const diensteRows = [];

  for (const service of schedule.services) {
    const serviceNumber = text(service?.serviceNumber);
    const rows = projectService(service, { serviceNumber, offsets, warnings, levelCounts });
    dienstplanRows.push(...rows.cells);
    diensteRows.push(dutyRow(service, {
      serviceNumber, documentType, organization, offsets,
      sectionCount: rows.cells.length, breakCount: rows.breakCount, dayType: rows.dayType, warnings
    }));
  }

  projectImportWarnings(schedule, warnings);
  reportDuplicateServiceNumbers(schedule.services, warnings);

  const statistics = {
    serviceCount: diensteRows.length,
    activityCount: dienstplanRows.length,
    warningCount: warnings.length,
    exactCellCount: levelCounts[EXACT],
    derivedCellCount: levelCounts[DERIVED],
    inconclusiveCellCount: levelCounts[INCONCLUSIVE],
    classifiedCellCount: levelCounts[EXACT] + levelCounts[DERIVED] + levelCounts[INCONCLUSIVE]
  };

  return {
    status: XLSX_MODEL_STATUS.READY,
    documentType,
    organization,
    sheets: [
      { name: 'Dienstplan', columns: [...DIENSTPLAN_COLUMNS], rows: dienstplanRows },
      { name: 'Dienste', columns: [...DIENSTE_COLUMNS], rows: diensteRows },
      { name: 'Importhinweise', columns: [...IMPORTHINWEISE_COLUMNS], rows: warnings.map(hintRow) }
    ],
    statistics,
    warnings
  };
}

/**
 * One duty → its Dienstplan rows. Rows the existing classification does not recognise as duty
 * content are dropped and reported; they never become an activity.
 */
function projectService(service, context) {
  const { serviceNumber, offsets, warnings, levelCounts } = context;
  const cells = [];
  let breakCount = 0;
  let dayType = '';

  const serviceBegin = clockText(service?.begin);
  const serviceEnd = clockText(service?.end, offsets.serviceEnds.get(service?.id) ?? 0);
  const servicePaid = durationText(service?.paidTime);

  for (const activity of service?.activities ?? []) {
    const classified = classifyActivityRow(activity);

    if (classified.type === ROW_TYPES.DAY_QUALIFIER) {
      dayType = dayType || text(classified.label);
      continue;
    }
    if (classified.type !== ROW_TYPES.SERVICE_DATA && classified.type !== ROW_TYPES.SERVICE_INTERRUPTION) {
      warnings.push({
        code: MODEL_WARNING_CODES.ZEILE_NICHT_ZUGEORDNET, scope: 'Dienstplan',
        message: MESSAGES[MODEL_WARNING_CODES.ZEILE_NICHT_ZUGEORDNET], serviceNumber
      });
      continue;
    }

    const row = classified.type === ROW_TYPES.SERVICE_INTERRUPTION
      ? interruptionRow(classified, { serviceNumber, warnings })
      : activityRow(activity, { serviceNumber, offsets });

    if (isFilled(row.values['Pause/Unterbrechung'])) breakCount += 1;

    cells.push(renderRow(row, {
      ordinal: cells.length + 1,
      serviceBegin, serviceEnd, servicePaid,
      page: Number.isInteger(activity?.source?.pageNumber) ? activity.source.pageNumber : '',
      levelCounts
    }));
  }

  // A duty whose end precedes its start crossed midnight. Where the import proved it (JNV
  // hardening) the offset is already carried; where it did not (JES) the fact is reported instead
  // of guessed.
  const begins = service?.begin?.minutesSinceStartOfDay;
  const ends = service?.end?.minutesSinceStartOfDay;
  if (!offsets.available && Number.isInteger(begins) && Number.isInteger(ends) && ends < begins) {
    warnings.push({
      code: MODEL_WARNING_CODES.TAGESWECHSEL_UNBESTIMMT, scope: 'Dienste',
      message: MESSAGES[MODEL_WARNING_CODES.TAGESWECHSEL_UNBESTIMMT], serviceNumber
    });
  }

  return { cells, breakCount, dayType };
}

/** A printed duty row. Fields the PDF has no column for stay empty. */
function activityRow(activity, { serviceNumber, offsets }) {
  const offset = offsets.activities.get(activity?.id) ?? { departure: 0, arrival: 0 };
  const begin = clockText(activity?.departureTime, offset.departure);
  const end = clockText(activity?.arrivalTime, offset.arrival);
  const line = text(activity?.routeIdentity?.line);
  const circuit = text(activity?.circuitNumber);
  const label = text(activity?.rawActivity);

  return {
    values: {
      Dienstnummer: serviceNumber,
      Linie: line,
      Umlauf: circuit,
      'Tätigkeit': label,
      Beginn: begin.value,
      Anfangsort: text(activity?.departureLocation),
      Richtung: '',
      Ende: end.value,
      Endort: text(activity?.arrivalLocation),
      'Vorheriger Dienst': '',
      'Nachfolgender Dienst': '',
      'Pause/Unterbrechung': /^Pause/i.test(label) ? label : ''
    },
    levels: {
      Dienstnummer: serviceNumber ? EXACT : null,
      // The line is not printed — it comes from the RouteIdentity the import attached.
      Linie: line ? DERIVED : null,
      Umlauf: circuit ? EXACT : null,
      'Tätigkeit': label ? EXACT : null,
      Beginn: begin.level,
      Anfangsort: text(activity?.departureLocation) ? EXACT : null,
      Ende: end.level,
      Endort: text(activity?.arrivalLocation) ? EXACT : null,
      'Pause/Unterbrechung': /^Pause/i.test(label) ? EXACT : null
    }
  };
}

/**
 * A `Dienstunterbrechung` line. Its times come from the row contract, which already parsed the
 * free-text sentence when it classified the row — so they are `derived`, this module never reads
 * the raw wording itself, and there is only one parse path rather than two that could drift.
 */
function interruptionRow(classified, { serviceNumber, warnings }) {
  const parsed = classified.interruption;
  const usable = parsed?.valid === true;
  if (!usable) {
    warnings.push({
      code: MODEL_WARNING_CODES.ZEIT_NICHT_LESBAR, scope: 'Dienstplan',
      message: MESSAGES[MODEL_WARNING_CODES.ZEIT_NICHT_LESBAR], serviceNumber
    });
  }
  const endOffset = usable && parsed.dayOffsetEnd > 0 ? ` (+${parsed.dayOffsetEnd})` : '';

  return {
    values: {
      Dienstnummer: serviceNumber,
      Linie: '',
      Umlauf: '',
      'Tätigkeit': 'Dienstunterbrechung',
      Beginn: usable ? parsed.startTime : '',
      Anfangsort: '',
      Richtung: '',
      Ende: usable ? `${parsed.endTime}${endOffset}` : '',
      Endort: '',
      'Vorheriger Dienst': '',
      'Nachfolgender Dienst': '',
      'Pause/Unterbrechung': usable ? `Unterbrechung ${parsed.startTime}–${parsed.endTime}` : ''
    },
    levels: {
      Dienstnummer: serviceNumber ? EXACT : null,
      'Tätigkeit': DERIVED,
      Beginn: usable ? DERIVED : INCONCLUSIVE,
      Ende: usable ? DERIVED : INCONCLUSIVE,
      'Pause/Unterbrechung': usable ? DERIVED : null
    }
  };
}

/** Turns one mapped row into the fixed column order, counting confidence on the way. */
function renderRow(row, { ordinal, serviceBegin, serviceEnd, servicePaid, page, levelCounts }) {
  const levels = {
    ...row.levels,
    Dienstbeginn: serviceBegin.level,
    Dienstende: serviceEnd.level,
    'Bezahlte Zeit': servicePaid.level,
    Seite: page === '' ? null : EXACT
  };
  const values = {
    ...row.values,
    Zeile: ordinal,
    Dienstbeginn: serviceBegin.value,
    Dienstende: serviceEnd.value,
    'Bezahlte Zeit': servicePaid.value,
    Seite: page
  };

  const present = Object.entries(levels).filter(([, level]) => level !== null && level !== undefined);
  for (const [, level] of present) levelCounts[level] += 1;

  const uncertain = present.filter(([, level]) => level !== EXACT).map(([field]) => field);
  values.Quellenstatus = weakest(present.map(([, level]) => level));
  values['Unsichere Felder'] = uncertain.join(', ');

  return DIENSTPLAN_COLUMNS.map(heading => neutraliseCell(values[heading] ?? ''));
}

/** One duty row. `Tagesart` stays empty unless the document itself printed a day qualifier. */
function dutyRow(service, context) {
  const { serviceNumber, documentType, organization, offsets, sectionCount, breakCount, dayType } = context;
  return [
    serviceNumber,
    clockText(service?.begin).value,
    clockText(service?.end, offsets.serviceEnds.get(service?.id) ?? 0).value,
    durationText(service?.paidTime).value,
    sectionCount,
    breakCount,
    documentType,
    organization,
    dayType
  ].map(neutraliseCell);
}

function hintRow(warning) {
  return [warning.code, warning.scope, warning.message, warning.serviceNumber].map(neutraliseCell);
}

/**
 * Warnings the import already produced, projected through a whitelist. Only the code, the area,
 * a neutral German sentence and the duty number survive — never a source reference, a page, a raw
 * line or an error object. An unknown code is dropped rather than passed through unread.
 */
function projectImportWarnings(schedule, warnings) {
  for (const warning of schedule?.hardened?.warnings ?? []) {
    const code = text(warning?.code);
    if (!PROJECTABLE_IMPORT_WARNINGS[code]) continue;
    warnings.push(importWarning(code, 'Import', warning?.serviceNumber));
  }
}

/**
 * A duty number printed on more than one block is reported once. The blocks are NEVER merged —
 * the parser found separate blocks and they may well differ in end time and paid time.
 */
function reportDuplicateServiceNumbers(services, warnings) {
  const counts = new Map();
  for (const service of services) {
    const number = text(service?.serviceNumber);
    if (number) counts.set(number, (counts.get(number) ?? 0) + 1);
  }
  for (const [number, count] of counts) {
    if (count > 1) {
      warnings.push({
        code: MODEL_WARNING_CODES.DIENSTNUMMER_MEHRFACH, scope: 'Dienste',
        message: MESSAGES[MODEL_WARNING_CODES.DIENSTNUMMER_MEHRFACH], serviceNumber: number
      });
    }
  }
}
