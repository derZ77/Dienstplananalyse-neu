/**
 * Deterministic row-type contract for JNV/BEU schedule PDFs (Phase 3A hardening).
 *
 * This is a small, closed classification that recognises special document lines
 * from their raw text BEFORE they are treated as ordinary ten-column data rows.
 * It is pure (no I/O, no storage, no network) and adds no dependency. It never
 * mutates the existing pipeline; callers use it additively.
 */

export const ROW_TYPES = Object.freeze({
  TABLE_HEADER: 'table_header',
  SERVICE_DATA: 'service_data',
  SERVICE_INTERRUPTION: 'service_interruption',
  DAY_QUALIFIER: 'day_qualifier',
  ANNOTATION: 'annotation',
  EMPTY: 'empty',
  UNSUPPORTED: 'unsupported'
});

export const ROW_TYPE_VALUES = Object.freeze(Object.values(ROW_TYPES));

const HEADER_TOKENS = Object.freeze([
  'Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort',
  'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'
]);

// Known day-type qualifiers → controlled codes. No holiday logic is implemented;
// "Feiertag" is only recognised as a day-like attempt, never given behaviour.
const DAY_QUALIFIERS = Object.freeze({
  'Mo-Do': 'MON_THU',
  'Mo-Fr': 'MON_FRI',
  'Mo-Sa': 'MON_SAT',
  'Di-Do': 'TUE_THU',
  'Di-Fr': 'TUE_FRI',
  'Montag': 'MONDAY',
  'Dienstag': 'TUESDAY',
  'Mittwoch': 'WEDNESDAY',
  'Donnerstag': 'THURSDAY',
  'Freitag': 'FRIDAY',
  'Samstag': 'SATURDAY',
  'Sonntag': 'SUNDAY'
});

// A token that LOOKS like a day qualifier (abbreviation, or abbreviation-range,
// or a full weekday word / "Feiertag") for conservative "unsupported" handling.
const DAY_LIKE = /^(Mo|Di|Mi|Do|Fr|Sa|So)(\s*-\s*[A-Za-zÄÖÜäöü]{1,9})?$|^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Feiertag)$/;

const INTERRUPTION_MARKER = /Dienstunterbrechung/i;
const INTERRUPTION_TIMES = /Dienstunterbrechung\s+von\s+(\d{1,2}):(\d{2})\s+Uhr\s+bis\s+(\d{1,2}):(\d{2})\s+Uhr/i;
const CLOCK = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
const ACTIVITY_KEYWORDS = /\b(Dienst|Vorbereitung|Nachbereitung|Aufrüsten|Abrüsten|Mitfahrt|Wegezeit|Pause|Leerfahrt|Betriebsfahrt)\b/i;

function normalizeText(input) {
  if (typeof input === 'string') return input.replace(/\s+/g, ' ').trim();
  if (input && typeof input === 'object') {
    if (typeof input.originalText === 'string' && input.originalText.trim()) return input.originalText.replace(/\s+/g, ' ').trim();
    if (typeof input.text === 'string') return input.text.replace(/\s+/g, ' ').trim();
  }
  return '';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function isValidClock(hours, minutes) {
  return Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function isTableHeader(text) {
  return HEADER_TOKENS.every(token => text.includes(token));
}

function isDayLike(text) {
  return !!text && DAY_LIKE.test(text);
}

/** Returns { code, label } for a known day qualifier, otherwise null. */
export function matchDayQualifier(input) {
  const text = normalizeText(input);
  const code = DAY_QUALIFIERS[text];
  return code ? { code, label: text } : null;
}

/**
 * Parses a "Dienstunterbrechung von HH:MM Uhr bis HH:MM Uhr" line into a
 * structured serviceInterruption. Invalid/damaged times yield { valid: false }
 * rather than throwing, so the parser run continues.
 */
export function parseServiceInterruption(input) {
  const sourceText = normalizeText(input);
  const invalid = () => ({
    type: 'serviceInterruption', valid: false,
    startTime: null, endTime: null, startMinutes: null, endMinutes: null,
    dayOffsetStart: 0, dayOffsetEnd: 0, sourceText
  });

  const match = sourceText.match(INTERRUPTION_TIMES);
  if (!match) return invalid();

  const startHours = Number(match[1]);
  const startMin = Number(match[2]);
  const endHours = Number(match[3]);
  const endMin = Number(match[4]);
  if (!isValidClock(startHours, startMin) || !isValidClock(endHours, endMin)) return invalid();

  const startMinutes = startHours * 60 + startMin;
  const endMinutes = endHours * 60 + endMin;
  return {
    type: 'serviceInterruption',
    valid: true,
    startTime: `${pad(startHours)}:${pad(startMin)}`,
    endTime: `${pad(endHours)}:${pad(endMin)}`,
    startMinutes,
    endMinutes,
    dayOffsetStart: 0,
    dayOffsetEnd: endMinutes < startMinutes ? 1 : 0,
    sourceText
  };
}

function looksLikeServiceData(input, text) {
  if (input && typeof input === 'object' && input.columns) {
    const col3 = String(input.columns.column3 || '');
    const col4 = String(input.columns.column4 || '').trim();
    const col6 = String(input.columns.column6 || '').trim();
    if (ACTIVITY_KEYWORDS.test(col3)) return true;
    if (/^\d{1,2}:\d{2}$/.test(col4) || /^\d{1,2}:\d{2}$/.test(col6)) return true;
  }
  if (ACTIVITY_KEYWORDS.test(text)) return true;
  return (text.match(CLOCK) || []).length >= 2;
}

/**
 * Classifies a single reconstructed line from its raw text. Usable before column
 * assignment. Returns { type, ...fields } with a closed `type` from ROW_TYPES.
 */
export function classifyRowText(input) {
  const text = normalizeText(input);
  if (!text) return { type: ROW_TYPES.EMPTY };
  if (isTableHeader(text)) return { type: ROW_TYPES.TABLE_HEADER };
  if (INTERRUPTION_MARKER.test(text)) {
    const parsed = parseServiceInterruption(text);
    return { type: ROW_TYPES.SERVICE_INTERRUPTION, startTime: parsed.startTime, endTime: parsed.endTime, valid: parsed.valid, sourceText: text };
  }
  const qualifier = matchDayQualifier(text);
  if (qualifier) return { type: ROW_TYPES.DAY_QUALIFIER, code: qualifier.code, label: qualifier.label };
  if (isDayLike(text)) return { type: ROW_TYPES.ANNOTATION, sourceText: text, dayQualifierAttempt: true };
  if (looksLikeServiceData(input, text)) return { type: ROW_TYPES.SERVICE_DATA };
  return { type: ROW_TYPES.ANNOTATION, sourceText: text };
}

/**
 * Classifies a normalized activity/row that already carries column fields
 * (serviceNumber, rawActivity, originalText, times). Combines raw-text signals
 * with field signals so that special rows are recognised even when the ten-column
 * geometry misplaced their text. Never mutates the input.
 */
export function classifyActivityRow(activity) {
  const originalText = normalizeText(activity?.originalText);
  const rawActivity = normalizeText(activity?.rawActivity);
  const serviceNumber = normalizeText(activity?.serviceNumber);
  const probe = originalText || rawActivity;

  if (INTERRUPTION_MARKER.test(originalText) || INTERRUPTION_MARKER.test(rawActivity)) {
    return { type: ROW_TYPES.SERVICE_INTERRUPTION, interruption: parseServiceInterruption(probe) };
  }

  const qualifier = matchDayQualifier(serviceNumber) || matchDayQualifier(originalText);
  if (qualifier) return { type: ROW_TYPES.DAY_QUALIFIER, code: qualifier.code, label: qualifier.label };
  if (isDayLike(serviceNumber) || isDayLike(originalText)) {
    return { type: ROW_TYPES.ANNOTATION, dayQualifierAttempt: true, sourceText: serviceNumber || originalText };
  }

  if (hasActivityContent(activity)) return { type: ROW_TYPES.SERVICE_DATA };
  if (probe) return { type: ROW_TYPES.ANNOTATION, sourceText: probe };
  return { type: ROW_TYPES.EMPTY };
}

function hasActivityContent(activity) {
  const rawActivity = normalizeText(activity?.rawActivity);
  if (rawActivity && ACTIVITY_KEYWORDS.test(rawActivity)) return true;
  return Boolean(activity?.departureTime?.value || activity?.arrivalTime?.value);
}
