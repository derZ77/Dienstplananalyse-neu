/**
 * Pure, dependency-free validators for the JNV Umlauftafel contracts (Phase 3B.2).
 *
 * Each public validator returns `{ valid, errors: [{ code, path }] }`. Validators are
 * side-effect free: no mutation, no auto-repair, no trimming, deterministic paths,
 * closed-enum + numeric-range checks. Error texts are omitted (code + path only) to
 * stay privacy-light. Validator errors are distinct from the fachliche parser
 * WARNING_CODES defined in the contract module.
 */

import {
  UMLAUFKARTE_DOCUMENT_TYPE, JNV_ORGANIZATION,
  UMLAUFTAFEL_SUBTYPE_VALUES, UMLAUFTAFEL_MODE_VALUES, UMLAUFTAFEL_SOURCE_FORMAT_VALUES,
  DAY_TYPE_VALUES, SERVICE_REGIME_VALUES, SEGMENT_TYPE_VALUES, TIME_ROLE_VALUES,
  TIME_CONFIDENCE_VALUES, STOP_EVENT_ROLE_VALUES, WARNING_CODE_VALUES, WARNING_SEVERITY_VALUES, WARNING_SCOPE_VALUES
} from './umlauftafel-contract.js';

export const VALIDATION_ERROR_CODES = Object.freeze([
  'INVALID_TYPE', 'MISSING_REQUIRED_FIELD', 'INVALID_ENUM_VALUE', 'OUT_OF_RANGE',
  'INVALID_UMLAUF_CODE', 'DUPLICATE_UMLAUF_CODE', 'INCONSISTENT_MODE', 'INCONSISTENT_TIME',
  'INVALID_STATISTICS', 'INCONSISTENT_PARSER_RESULT', 'FORBIDDEN_SOURCE_FIELD'
]);

const err = (code, path) => ({ code, path });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isInt = (v) => Number.isInteger(v);
const inEnum = (v, values) => values.includes(v);
const isAbsolutePathLike = (s) => typeof s === 'string' && (/^\//.test(s) || /^[A-Za-z]:[\\/]/.test(s) || s.includes('\\'));

function wrap(check) {
  return (value) => { const errors = []; check(value, '', errors); return { valid: errors.length === 0, errors }; };
}
const join = (base, field) => (base ? `${base}.${field}` : field);

// --- leaf checks -----------------------------------------------------------
function checkSource(source, path, errors) {
  if (source == null) return;
  if (!isObject(source)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (source.sourceFormat != null && !inEnum(source.sourceFormat, UMLAUFTAFEL_SOURCE_FORMAT_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'sourceFormat')));
  for (const field of ['sheet', 'cell']) {
    if (isAbsolutePathLike(source[field])) errors.push(err('FORBIDDEN_SOURCE_FIELD', join(path, field)));
  }
  for (const field of ['page', 'block', 'row', 'column']) {
    const v = source[field];
    if (v != null && (!isInt(v) || v < 0)) errors.push(err('OUT_OF_RANGE', join(path, field)));
  }
}

function checkNormalizedTime(t, path, errors) {
  if (!isObject(t)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (!inEnum(t.role, TIME_ROLE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'role')));
  if (!inEnum(t.confidence, TIME_CONFIDENCE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'confidence')));
  if (t.confidence === 'unknown') {
    if (t.normalizedMinutes !== null) errors.push(err('INCONSISTENT_TIME', join(path, 'normalizedMinutes')));
    return;
  }
  if (!isInt(t.hour) || t.hour < 0 || t.hour > 23) errors.push(err('OUT_OF_RANGE', join(path, 'hour')));
  if (!isInt(t.minute) || t.minute < 0 || t.minute > 59) errors.push(err('OUT_OF_RANGE', join(path, 'minute')));
  if (!isInt(t.dayOffset) || t.dayOffset < 0) errors.push(err('OUT_OF_RANGE', join(path, 'dayOffset')));
  if (isInt(t.hour) && isInt(t.minute) && isInt(t.dayOffset)) {
    if (t.normalizedMinutes !== t.dayOffset * 1440 + t.hour * 60 + t.minute) errors.push(err('INCONSISTENT_TIME', join(path, 'normalizedMinutes')));
  }
}

function checkStopEvent(s, path, errors) {
  if (!isObject(s)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (!inEnum(s.role, STOP_EVENT_ROLE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'role')));
  if (s.sequence != null && (!isInt(s.sequence) || s.sequence < 0)) errors.push(err('OUT_OF_RANGE', join(path, 'sequence')));
  if (s.name != null && !isString(s.name)) errors.push(err('INVALID_TYPE', join(path, 'name')));
  if (s.time != null) checkNormalizedTime(s.time, join(path, 'time'), errors);
  checkSource(s.source, join(path, 'source'), errors);
}

function checkSegment(s, path, errors) {
  if (!isObject(s)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (!inEnum(s.type, SEGMENT_TYPE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'type')));
  if (s.sequence != null && (!isInt(s.sequence) || s.sequence < 0)) errors.push(err('OUT_OF_RANGE', join(path, 'sequence')));
  if (s.line != null && !isString(s.line)) errors.push(err('INVALID_TYPE', join(path, 'line')));
  if (s.route != null && !isString(s.route)) errors.push(err('INVALID_TYPE', join(path, 'route')));
  if (typeof s.driverChange !== 'boolean') errors.push(err('INVALID_TYPE', join(path, 'driverChange')));
  if (s.departure != null) checkStopEvent(s.departure, join(path, 'departure'), errors);
  if (s.arrival != null) checkStopEvent(s.arrival, join(path, 'arrival'), errors);
  if (s.stops != null) {
    if (!Array.isArray(s.stops)) errors.push(err('INVALID_TYPE', join(path, 'stops')));
    else s.stops.forEach((stop, i) => checkStopEvent(stop, `${join(path, 'stops')}[${i}]`, errors));
  }
  checkSource(s.source, join(path, 'source'), errors);
}

function checkValidity(v, path, errors) {
  if (!isObject(v)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (!inEnum(v.dayType, DAY_TYPE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'dayType')));
  if (!inEnum(v.serviceRegime, SERVICE_REGIME_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'serviceRegime')));
  for (const field of ['validFrom', 'validTo', 'rawLabel']) {
    if (v[field] != null && !isString(v[field])) errors.push(err('INVALID_TYPE', join(path, field)));
  }
}

function checkCirculation(c, path, errors, documentMode) {
  if (!isObject(c)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (!isString(c.code) || c.code.length === 0) errors.push(err('INVALID_UMLAUF_CODE', join(path, 'code')));
  if (!inEnum(c.mode, UMLAUFTAFEL_MODE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'mode')));
  else if (documentMode != null && c.mode !== documentMode) errors.push(err('INCONSISTENT_MODE', join(path, 'mode')));
  if (c.sequence != null && (!isInt(c.sequence) || c.sequence < 0)) errors.push(err('OUT_OF_RANGE', join(path, 'sequence')));
  if (c.segments != null) {
    if (!Array.isArray(c.segments)) errors.push(err('INVALID_TYPE', join(path, 'segments')));
    else c.segments.forEach((seg, i) => checkSegment(seg, `${join(path, 'segments')}[${i}]`, errors));
  }
  checkSource(c.source, join(path, 'source'), errors);
}

function checkDocument(doc, path, errors) {
  if (!isObject(doc)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (!isString(doc.schemaVersion)) errors.push(err('MISSING_REQUIRED_FIELD', join(path, 'schemaVersion')));
  if (doc.documentType !== UMLAUFKARTE_DOCUMENT_TYPE) errors.push(err('INVALID_ENUM_VALUE', join(path, 'documentType')));
  if (!inEnum(doc.subtype, UMLAUFTAFEL_SUBTYPE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'subtype')));
  if (doc.organization !== JNV_ORGANIZATION) errors.push(err('MISSING_REQUIRED_FIELD', join(path, 'organization')));
  if (!inEnum(doc.mode, UMLAUFTAFEL_MODE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'mode')));
  if (!inEnum(doc.sourceFormat, UMLAUFTAFEL_SOURCE_FORMAT_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'sourceFormat')));
  checkValidity(doc.validity, join(path, 'validity'), errors);
  if (!Array.isArray(doc.circulations)) { errors.push(err('INVALID_TYPE', join(path, 'circulations'))); return; }
  const seen = new Set();
  doc.circulations.forEach((c, i) => {
    const cPath = `${join(path, 'circulations')}[${i}]`;
    checkCirculation(c, cPath, errors, doc.mode);
    if (c && isString(c.code) && c.code.length) {
      if (seen.has(c.code)) errors.push(err('DUPLICATE_UMLAUF_CODE', join(cPath, 'code')));
      else seen.add(c.code);
    }
  });
}

function checkWarning(w, path, errors) {
  if (!isObject(w)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (!inEnum(w.code, WARNING_CODE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'code')));
  if (!inEnum(w.severity, WARNING_SEVERITY_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'severity')));
  if (w.scope != null && !inEnum(w.scope, WARNING_SCOPE_VALUES)) errors.push(err('INVALID_ENUM_VALUE', join(path, 'scope')));
}

function checkParserResult(r, path, errors) {
  if (!isObject(r)) { errors.push(err('INVALID_TYPE', path)); return; }
  if (typeof r.ok !== 'boolean') errors.push(err('INVALID_TYPE', join(path, 'ok')));
  if (r.ok === true) {
    if (!isObject(r.document)) errors.push(err('INCONSISTENT_PARSER_RESULT', join(path, 'document')));
    else checkDocument(r.document, join(path, 'document'), errors);
  }
  const stats = r.statistics;
  if (!isObject(stats)) errors.push(err('INVALID_STATISTICS', join(path, 'statistics')));
  else for (const field of ['circulationCount', 'segmentCount', 'stopEventCount']) {
    if (!isInt(stats[field]) || stats[field] < 0) errors.push(err('INVALID_STATISTICS', join(path, `statistics.${field}`)));
  }
  if (r.warnings != null) {
    if (!Array.isArray(r.warnings)) errors.push(err('INVALID_TYPE', join(path, 'warnings')));
    else r.warnings.forEach((w, i) => checkWarning(w, `${join(path, 'warnings')}[${i}]`, errors));
  }
}

// --- public validators -----------------------------------------------------
export const validateNormalizedTime = wrap(checkNormalizedTime);
export const validateStopEvent = wrap(checkStopEvent);
export const validateSegment = wrap(checkSegment);
export const validateValidity = wrap(checkValidity);
export const validateSource = wrap(checkSource);
export const validateUmlauftafelWarning = wrap(checkWarning);
export const validateCirculation = wrap((c, path, errors) => checkCirculation(c, path, errors, null));
export const validateUmlauftafelDocument = wrap(checkDocument);
export const validateParserResult = wrap(checkParserResult);
