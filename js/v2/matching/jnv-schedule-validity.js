/**
 * Deterministic JNV schedule validity resolver (Phase 3G.2).
 *
 * Derives `{ serviceRegime, dayType, confidence, evidence, conflicts, warnings }` from
 * PROVEN signals only: structured day qualifiers (from JNV hardening), a structured title
 * or explicit metadata value, and — as a SUPPORTING signal only — the source filename.
 * It never derives validity from times, lines, code length, page count, duration, depot,
 * or the bare profile name. Pure: no mutation, no I/O, no current time, no random.
 *
 * `ambiguous`/`unknown` must NOT be used by the matcher as a valid Level-1 gate.
 */

const SERVICE_REGIMES = ['school', 'holidays', 'regular', 'special'];
const DAY_TYPES = ['mo_fr', 'mo_do', 'friday', 'saturday', 'sunday', 'weekend', 'school_days', 'holidays'];

const DAY_QUALIFIER_TO_DAY_TYPE = { MON_FRI: 'mo_fr', MON_THU: 'mo_do', FRIDAY: 'friday', SATURDAY: 'saturday', SUNDAY: 'sunday' };

function regimeFromText(text) {
  if (/schule/i.test(text)) return 'school';
  if (/ferien/i.test(text)) return 'holidays';
  return null;
}
function dayTypeFromTitle(text) {
  if (/montag\s+bis\s+freitag|\bmo-?fr\b/i.test(text)) return 'mo_fr';
  if (/montag\s+bis\s+donnerstag|\bmo-?do\b/i.test(text)) return 'mo_do';
  if (/\bfreitag\b/i.test(text)) return 'friday';
  if (/\bsamstag\b/i.test(text)) return 'saturday';
  if (/\bsonntag\b/i.test(text)) return 'sunday';
  return null;
}
function dayTypeFromFilename(name) {
  if (/mo-?fr/i.test(name)) return 'mo_fr';
  if (/mo-?do/i.test(name)) return 'mo_do';
  if (/(^|[_\-.])fr([_\-.]|$)|freitag/i.test(name)) return 'friday';
  if (/(^|[_\-.])sa([_\-.]|$)|samstag/i.test(name)) return 'saturday';
  if (/(^|[_\-.])so([_\-.]|$)|sonntag/i.test(name)) return 'sunday';
  return null;
}

const warn = (code) => ({ code, severity: 'warning', message: '' });

// Resolves one field from its candidates. A single (strong) value → exact; a supporting-only
// value → probable; several distinct values → ambiguous; none → unknown.
function resolveField(candidates) {
  const distinct = [...new Set(candidates.map(c => c.value))];
  if (distinct.length === 0) return { value: 'unknown', confidence: 'unknown', conflict: false };
  if (distinct.length > 1) return { value: 'unknown', confidence: 'ambiguous', conflict: true };
  return { value: distinct[0], confidence: candidates.some(c => c.strong) ? 'exact' : 'probable', conflict: false };
}

function combine(a, b) {
  if (a === 'ambiguous' || b === 'ambiguous') return 'ambiguous';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'exact' && b === 'exact') return 'exact';
  return 'probable';
}

/**
 * @param {{ canonicalSchedule?: object, hardened?: object, profile?: object, detection?: object,
 *           sourceName?: string, metadata?: object }} [input]
 */
export function resolveJnvScheduleValidity(input = {}) {
  const { canonicalSchedule = null, hardened = null, sourceName = null, metadata = {} } = input || {};
  const hard = hardened || canonicalSchedule?.hardened || {};
  const meta = metadata && typeof metadata === 'object' ? metadata : {};

  const regime = [];
  const dayType = [];

  // Explicit normalized metadata (strongest, structured).
  if (SERVICE_REGIMES.includes(meta.serviceRegime)) regime.push({ value: meta.serviceRegime, source: 'metadata', strong: true, code: 'METADATA_VALIDITY_SIGNAL' });
  if (DAY_TYPES.includes(meta.dayType)) dayType.push({ value: meta.dayType, source: 'metadata', strong: true, code: 'METADATA_VALIDITY_SIGNAL' });

  // Structured document title.
  if (typeof meta.title === 'string' && meta.title) {
    const r = regimeFromText(meta.title); if (r) regime.push({ value: r, source: 'title', strong: true, code: 'TITLE_VALIDITY_SIGNAL' });
    const d = dayTypeFromTitle(meta.title); if (d) dayType.push({ value: d, source: 'title', strong: true, code: 'TITLE_VALIDITY_SIGNAL' });
  }

  // Structured day qualifiers from the JNV hardening.
  for (const q of Array.isArray(hard.dayQualifiers) ? hard.dayQualifiers : []) {
    const d = DAY_QUALIFIER_TO_DAY_TYPE[q?.code];
    if (d) dayType.push({ value: d, source: 'dayQualifier', strong: true, code: 'DAY_QUALIFIER_SIGNAL' });
  }

  // Filename — SUPPORTING only (never a sole exact basis).
  if (typeof sourceName === 'string' && sourceName) {
    const r = regimeFromText(sourceName); if (r) regime.push({ value: r, source: 'filename', strong: false, code: 'FILENAME_VALIDITY_SIGNAL' });
    const d = dayTypeFromFilename(sourceName); if (d) dayType.push({ value: d, source: 'filename', strong: false, code: 'FILENAME_VALIDITY_SIGNAL' });
  }

  const regimeResult = resolveField(regime);
  const dayTypeResult = resolveField(dayType);

  const evidence = [...regime, ...dayType].map(c => ({ code: c.code, value: c.value, source: c.source }));
  const conflicts = [];
  if (regimeResult.conflict) conflicts.push('CONFLICTING_SERVICE_REGIME');
  if (dayTypeResult.conflict) conflicts.push('CONFLICTING_DAY_TYPE');

  const warnings = [];
  if (conflicts.length) warnings.push(warn('AMBIGUOUS_SCHEDULE_VALIDITY'));
  if (evidence.length === 0) { warnings.push(warn('UNKNOWN_SCHEDULE_VALIDITY')); warnings.push(warn('MISSING_VALIDITY_EVIDENCE')); }

  return {
    serviceRegime: regimeResult.value,
    dayType: dayTypeResult.value,
    confidence: combine(regimeResult.confidence, dayTypeResult.confidence),
    evidence,
    conflicts,
    warnings
  };
}
