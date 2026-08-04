/**
 * JNV Umlauftafel contracts (Phase 3B.2) — closed vocabularies + deterministic
 * factories for a source-neutral Umlauftafel model.
 *
 * Design decisions (see PHASE-3B.2 doc):
 *  - The document reuses the FROZEN canonical document type `umlaufkarte`
 *    (js/v2/documents/document-types.js) and adds `subtype: "jnv_umlauftafel"`,
 *    `mode` (bus|tram) and `sourceFormat` (xlsx|pdf). No new canonical document
 *    type is minted; document-types.js stays untouched.
 *  - Pure data only: no DOM, no File/ArrayBuffer, no SheetJS/PDF.js objects, no I/O,
 *    no Date.now()/Math.random(), no global counters. JSON-serializable, deterministic.
 *  - Factories build conservative defaults; the validators (umlauftafel-validation.js)
 *    check correctness. Factories throw only on programmer errors (non-object input).
 */

import { DOCUMENT_TYPES, ORGANIZATIONS } from '../documents/document-types.js';

export const UMLAUFTAFEL_SCHEMA_VERSION = '1.0';
export const UMLAUFKARTE_DOCUMENT_TYPE = DOCUMENT_TYPES.UMLAUFKARTE; // 'umlaufkarte'
export const JNV_ORGANIZATION = ORGANIZATIONS.JNV;                   // 'JNV'

const freezeValues = (obj) => Object.freeze(Object.values(obj));

export const UMLAUFTAFEL_SUBTYPES = Object.freeze({ JNV_UMLAUFTAFEL: 'jnv_umlauftafel' });
export const UMLAUFTAFEL_SUBTYPE_VALUES = freezeValues(UMLAUFTAFEL_SUBTYPES);

export const UMLAUFTAFEL_MODES = Object.freeze({ BUS: 'bus', TRAM: 'tram' });
export const UMLAUFTAFEL_MODE_VALUES = freezeValues(UMLAUFTAFEL_MODES);

export const UMLAUFTAFEL_SOURCE_FORMATS = Object.freeze({ XLSX: 'xlsx', PDF: 'pdf' });
export const UMLAUFTAFEL_SOURCE_FORMAT_VALUES = freezeValues(UMLAUFTAFEL_SOURCE_FORMATS);

export const DAY_TYPES = Object.freeze({
  MO_FR: 'mo_fr', MO_DO: 'mo_do', FRIDAY: 'friday', SATURDAY: 'saturday',
  SUNDAY: 'sunday', WEEKEND: 'weekend', SCHOOL_DAYS: 'school_days', HOLIDAYS: 'holidays', UNKNOWN: 'unknown'
});
export const DAY_TYPE_VALUES = freezeValues(DAY_TYPES);

export const SERVICE_REGIMES = Object.freeze({
  SCHOOL: 'school', HOLIDAYS: 'holidays', REGULAR: 'regular', SPECIAL: 'special', UNKNOWN: 'unknown'
});
export const SERVICE_REGIME_VALUES = freezeValues(SERVICE_REGIMES);

// Only reference-backed types (see JNV-UMLAUFTAFELN-REFERENZANALYSE-V1.md). Unprovable
// candidates (pull_out/pull_in/standby/break/driver_change/vehicle_change) are excluded;
// driver/vehicle changes are modeled as boolean flags on a segment instead.
export const SEGMENT_TYPES = Object.freeze({
  SERVICE_TRIP: 'service_trip', DEADHEAD: 'deadhead', DUTY_REFERENCE: 'duty_reference',
  CONTINUATION: 'continuation', ANNOTATION: 'annotation', UNKNOWN: 'unknown'
});
export const SEGMENT_TYPE_VALUES = freezeValues(SEGMENT_TYPES);

export const TIME_ROLES = Object.freeze({
  BEGIN: 'begin', END: 'end', DEPARTURE: 'departure', ARRIVAL: 'arrival', EVENT: 'event', UNKNOWN: 'unknown'
});
export const TIME_ROLE_VALUES = freezeValues(TIME_ROLES);

export const TIME_CONFIDENCE = Object.freeze({ EXACT: 'exact', INFERRED_ROLLOVER: 'inferred_rollover', UNKNOWN: 'unknown' });
export const TIME_CONFIDENCE_VALUES = freezeValues(TIME_CONFIDENCE);

export const STOP_EVENT_ROLES = Object.freeze({
  DEPARTURE: 'departure', ARRIVAL: 'arrival', PASS: 'pass', BEGIN: 'begin', END: 'end',
  DEPOT_EXIT: 'depot_exit', DEPOT_ENTRY: 'depot_entry', UNKNOWN: 'unknown'
});
export const STOP_EVENT_ROLE_VALUES = freezeValues(STOP_EVENT_ROLES);

export const WARNING_CODES = Object.freeze({
  UNKNOWN_DOCUMENT_MODE: 'UNKNOWN_DOCUMENT_MODE', UNKNOWN_SOURCE_FORMAT: 'UNKNOWN_SOURCE_FORMAT',
  UNKNOWN_VALIDITY: 'UNKNOWN_VALIDITY', INVALID_UMLAUF_CODE: 'INVALID_UMLAUF_CODE',
  DUPLICATE_UMLAUF_CODE: 'DUPLICATE_UMLAUF_CODE', INVALID_TIME: 'INVALID_TIME',
  TIME_ROLLOVER_APPLIED: 'TIME_ROLLOVER_APPLIED', IMPLAUSIBLE_TIME_SEQUENCE: 'IMPLAUSIBLE_TIME_SEQUENCE',
  UNKNOWN_SEGMENT_TYPE: 'UNKNOWN_SEGMENT_TYPE', MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  UNSUPPORTED_LAYOUT: 'UNSUPPORTED_LAYOUT', AMBIGUOUS_BLOCK_ORDER: 'AMBIGUOUS_BLOCK_ORDER',
  CONTINUATION_UNRESOLVED: 'CONTINUATION_UNRESOLVED'
});
export const WARNING_CODE_VALUES = freezeValues(WARNING_CODES);

export const WARNING_SEVERITIES = Object.freeze({ INFO: 'info', WARNING: 'warning', ERROR: 'error' });
export const WARNING_SEVERITY_VALUES = freezeValues(WARNING_SEVERITIES);

export const WARNING_SCOPES = Object.freeze({
  DOCUMENT: 'document', CIRCULATION: 'circulation', SEGMENT: 'segment', STOP_EVENT: 'stop_event', TIME: 'time'
});
export const WARNING_SCOPE_VALUES = freezeValues(WARNING_SCOPES);

// --- helpers (pure) --------------------------------------------------------
function assertObjectInput(value, fnName) {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError(`${fnName} expects an object.`);
  }
}
const asStringOrNull = (v) => (v === null || v === undefined ? null : String(v));
const asNumberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const copyArray = (v) => (Array.isArray(v) ? v.slice() : []);
const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// --- factories -------------------------------------------------------------
export function createValidity(input = {}) {
  assertObjectInput(input, 'createValidity');
  const { dayType = DAY_TYPES.UNKNOWN, serviceRegime = SERVICE_REGIMES.UNKNOWN, validFrom = null, validTo = null, rawLabel = null } = input;
  return { dayType, serviceRegime, validFrom: asStringOrNull(validFrom), validTo: asStringOrNull(validTo), rawLabel: rawLabel === null ? null : String(rawLabel) };
}

export function createSource(input = {}) {
  assertObjectInput(input, 'createSource');
  const { sourceFormat = null, sheet = null, page = null, block = null, row = null, column = null, cell = null } = input;
  return { sourceFormat, sheet: asStringOrNull(sheet), page: asNumberOrNull(page), block: asNumberOrNull(block), row: asNumberOrNull(row), column: asNumberOrNull(column), cell: asStringOrNull(cell) };
}

export function createNormalizedTime(input = {}) {
  assertObjectInput(input, 'createNormalizedTime');
  const { raw = '', hour = null, minute = null, dayOffset = 0, role = TIME_ROLES.EVENT, confidence = TIME_CONFIDENCE.EXACT } = input;
  const h = asNumberOrNull(hour);
  const m = asNumberOrNull(minute);
  const off = asNumberOrNull(dayOffset) ?? 0;
  const normalizedMinutes = (h !== null && m !== null) ? off * 1440 + h * 60 + m : null;
  return { raw: raw === null || raw === undefined ? '' : String(raw), hour: h, minute: m, dayOffset: off, normalizedMinutes, role, confidence };
}

export function createStopEvent(input = {}) {
  assertObjectInput(input, 'createStopEvent');
  const { sequence = null, name = null, code = null, platform = null, role = STOP_EVENT_ROLES.UNKNOWN, time = null, rawMarker = null, source = {} } = input;
  return {
    sequence: asNumberOrNull(sequence), name: asStringOrNull(name), code: asStringOrNull(code), platform: asStringOrNull(platform),
    role, time: time ?? null, rawMarker: asStringOrNull(rawMarker), warnings: copyArray(input.warnings), source: { ...plainObject(source) }
  };
}

export function createSegment(input = {}) {
  assertObjectInput(input, 'createSegment');
  const { id = null, type = SEGMENT_TYPES.UNKNOWN, sequence = null, line = null, route = null, tripId = null, dutyRef = null,
    departure = null, arrival = null, stops = [], vehicle = null, driverChange = false, vehicleChange = false, notes = [], source = {} } = input;
  const seq = asNumberOrNull(sequence);
  const derivedId = id !== null && id !== undefined ? String(id) : (Number.isInteger(seq) ? `segment-${String(seq).padStart(4, '0')}` : null);
  return {
    id: derivedId, type, sequence: seq, line: asStringOrNull(line), route: asStringOrNull(route), tripId: asStringOrNull(tripId), dutyRef: asStringOrNull(dutyRef),
    departure: departure ?? null, arrival: arrival ?? null, stops: copyArray(stops), vehicle: vehicle ?? null,
    driverChange: Boolean(driverChange), vehicleChange: Boolean(vehicleChange), notes: copyArray(notes), warnings: copyArray(input.warnings), source: { ...plainObject(source) }
  };
}

export function createCirculation(input = {}) {
  assertObjectInput(input, 'createCirculation');
  const { id = null, code = null, mode = null, sequence = null, begin = null, end = null, depot = null, vehicle = null, page = null, part = null, segments = [], source = {} } = input;
  const codeStr = asStringOrNull(code);
  return {
    id: id !== null && id !== undefined ? String(id) : codeStr, code: codeStr, mode, sequence: asNumberOrNull(sequence),
    begin: begin ?? { time: null, location: null }, end: end ?? { time: null, location: null },
    depot: depot ?? { start: null, end: null }, vehicle: vehicle ?? { type: null, number: null },
    page: page ?? { current: null, total: null }, part: part ?? { index: null, total: null, parentCode: null },
    segments: copyArray(segments), warnings: copyArray(input.warnings), source: { ...plainObject(source) }
  };
}

export function createUmlauftafelDocument(input = {}) {
  assertObjectInput(input, 'createUmlauftafelDocument');
  const {
    schemaVersion = UMLAUFTAFEL_SCHEMA_VERSION, documentType = UMLAUFKARTE_DOCUMENT_TYPE, subtype = UMLAUFTAFEL_SUBTYPES.JNV_UMLAUFTAFEL,
    organization = JNV_ORGANIZATION, mode = null, sourceFormat = null, sourceName = null, validity = null, circulations = [], metadata = {}
  } = input;
  return {
    schemaVersion, documentType, subtype, organization, mode, sourceFormat, sourceName: asStringOrNull(sourceName),
    validity: validity ?? createValidity({}), circulations: copyArray(circulations), warnings: copyArray(input.warnings), metadata: { ...plainObject(metadata) }
  };
}

export function createUmlauftafelWarning(input = {}) {
  assertObjectInput(input, 'createUmlauftafelWarning');
  const { code = null, severity = WARNING_SEVERITIES.WARNING, message = '', scope = null, source = {} } = input;
  return { code, severity, message: message === null ? '' : String(message), scope, source: { ...plainObject(source) } };
}

export function createParserResult(input = {}) {
  assertObjectInput(input, 'createParserResult');
  const { ok = false, document = null, warnings = [], statistics = null } = input;
  return {
    ok: Boolean(ok), document: document ?? null, warnings: copyArray(warnings),
    statistics: statistics ?? { circulationCount: 0, segmentCount: 0, stopEventCount: 0 }
  };
}
