/**
 * Dependency-free validator for the extended ScheduleMatchView (Phase 3G.2).
 *
 * Structural only, `{ valid, errors:[{code,path}] }`, no mutation, no auto-repair. It
 * enforces the closed vocabularies, unique string Umlauf codes, string arrays for
 * services/lines/courses/trips, consistent time windows, and privacy-safe source refs
 * (no raw content, paths, coordinates, or byte/file objects).
 */

const SERVICE_REGIMES = ['school', 'holidays', 'regular', 'special', 'unknown'];
const DAY_TYPES = ['mo_fr', 'mo_do', 'friday', 'saturday', 'sunday', 'weekend', 'school_days', 'holidays', 'unknown'];
const CONFIDENCE = ['exact', 'probable', 'ambiguous', 'unknown'];
const UNSAFE_SOURCE_REF_KEYS = ['originalText', 'rawText', 'rawCells', 'cells', 'boundingBox', 'coordinates', 'path', 'filePath', 'file', 'bytes', 'buffer', 'blob'];

const numberOrNull = (v) => v === null || typeof v === 'number';

export function validateExtendedScheduleMatchView(view) {
  if (!view || typeof view !== 'object' || Array.isArray(view)) {
    return { valid: false, errors: [{ code: 'NOT_A_VIEW', path: '' }] };
  }

  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (!SERVICE_REGIMES.includes(view.serviceRegime)) push('INVALID_SERVICE_REGIME', 'serviceRegime');
  if (!DAY_TYPES.includes(view.dayType)) push('INVALID_DAY_TYPE', 'dayType');
  if (!CONFIDENCE.includes(view.validityConfidence)) push('INVALID_VALIDITY_CONFIDENCE', 'validityConfidence');
  if (!Array.isArray(view.validityEvidence)) push('INVALID_VALIDITY_EVIDENCE', 'validityEvidence');
  if (!Array.isArray(view.warnings)) push('INVALID_WARNINGS', 'warnings');

  if (!Array.isArray(view.umlaeufe)) {
    push('INVALID_UMLAEUFE', 'umlaeufe');
    return { valid: false, errors };
  }

  const seen = new Set();
  view.umlaeufe.forEach((u, i) => {
    const base = `umlaeufe[${i}]`;
    if (typeof u?.code !== 'string' || !u.code) {
      push('INVALID_UMLAUF_CODE', `${base}.code`);
    } else {
      if (seen.has(u.code)) push('DUPLICATE_UMLAUF_CODE', `${base}.code`);
      seen.add(u.code);
    }
    for (const field of ['services', 'lines', 'courses', 'trips']) {
      if (!Array.isArray(u?.[field]) || !u[field].every(x => typeof x === 'string')) push('INVALID_STRING_ARRAY', `${base}.${field}`);
    }
    const tw = u?.timeWindow;
    if (!tw || typeof tw !== 'object' || !numberOrNull(tw.startMinutes) || !numberOrNull(tw.endMinutes) || typeof tw.dayOffsetEnd !== 'number') {
      push('INVALID_TIME_WINDOW', `${base}.timeWindow`);
    }
    if (!Array.isArray(u?.sourceRefs)) {
      push('INVALID_SOURCE_REFS', `${base}.sourceRefs`);
    } else {
      u.sourceRefs.forEach((ref, j) => {
        if (ref && typeof ref === 'object' && UNSAFE_SOURCE_REF_KEYS.some(k => k in ref)) push('UNSAFE_SOURCE_REF', `${base}.sourceRefs[${j}]`);
      });
    }
  });

  return { valid: errors.length === 0, errors };
}
