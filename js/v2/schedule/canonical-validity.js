/**
 * Source-neutral validity evidence for CanonicalSchedule.
 *
 * This module only normalizes explicit document facts. It does not infer a
 * weekday from duty numbers, times or an organisation and it never supplies a
 * default for unknown documents.
 */

export const CANONICAL_DAY_TYPES = Object.freeze(['mo_fr', 'saturday', 'sunday', 'unknown']);
export const CANONICAL_SERVICE_REGIMES = Object.freeze(['school', 'holidays', 'unknown']);
export const VALIDITY_SOURCES = Object.freeze(['HEADER', 'DOCUMENT_METADATA', 'FILENAME', 'MANUAL', 'UNKNOWN']);

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const none = () => ({ value: 'unknown', source: 'UNKNOWN' });

function dayTypeFromText(value) {
  const probe = text(value);
  if (/montag\s*(?:bis|-|–)\s*freitag|\bmo\s*(?:-|–)?\s*fr\b/i.test(probe)) return 'mo_fr';
  if (/\bsamstag\b|(?:^|[_.\-\s])sa(?:$|[_.\-\s])/i.test(probe)) return 'saturday';
  if (/\bsonntag\b|(?:^|[_.\-\s])so(?:$|[_.\-\s])/i.test(probe)) return 'sunday';
  return null;
}

function regimeFromText(value) {
  const probe = text(value);
  if (/\bschule\b/i.test(probe)) return 'school';
  if (/\bferien\b/i.test(probe)) return 'holidays';
  return null;
}

function dayTypeFromFilename(value) {
  const probe = text(value);
  if (/mo(?:-|_|\s)?fr/i.test(probe)) return 'mo_fr';
  if (/(?:^|[_\-.])sa(?:[_\-.]|$)|samstag/i.test(probe)) return 'saturday';
  if (/(?:^|[_\-.])so(?:[_\-.]|$)|sonntag/i.test(probe)) return 'sunday';
  return null;
}

function regimeFromFilename(value) {
  const probe = text(value);
  if (/schule/i.test(probe)) return 'school';
  if (/ferien/i.test(probe)) return 'holidays';
  return null;
}

function validFromFromText(value) {
  const match = text(value).match(/\bab\s+(\d{2})\.(\d{2})\.(\d{4})\b/i);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function fromMetadata(metadata, field, values) {
  const value = text(metadata?.[field]);
  return values.includes(value) ? { value, source: 'DOCUMENT_METADATA' } : null;
}

function firstKnown(candidates) {
  return candidates.find(Boolean) || none();
}

/**
 * Resolves a schedule validity using the fixed source precedence:
 * document header → structured metadata → filename → unknown. A header value
 * deliberately wins over a conflicting filename instead of producing a guess.
 */
export function resolveCanonicalValidity({ headerText = '', documentMetadata = null, fileName = '' } = {}) {
  const header = text(headerText);
  const metadata = documentMetadata && typeof documentMetadata === 'object' ? documentMetadata : {};
  const file = text(fileName);
  const day = firstKnown([
    dayTypeFromText(header) && { value: dayTypeFromText(header), source: 'HEADER' },
    fromMetadata(metadata, 'dayType', CANONICAL_DAY_TYPES),
    dayTypeFromFilename(file) && { value: dayTypeFromFilename(file), source: 'FILENAME' }
  ]);
  const regime = firstKnown([
    regimeFromText(header) && { value: regimeFromText(header), source: 'HEADER' },
    fromMetadata(metadata, 'serviceRegime', CANONICAL_SERVICE_REGIMES),
    regimeFromFilename(file) && { value: regimeFromFilename(file), source: 'FILENAME' }
  ]);
  const validFrom = firstKnown([
    validFromFromText(header) && { value: validFromFromText(header), source: 'HEADER' },
    text(metadata.validFrom) && { value: text(metadata.validFrom), source: 'DOCUMENT_METADATA' },
    validFromFromText(file) && { value: validFromFromText(file), source: 'FILENAME' }
  ]);

  return {
    dayType: day.value,
    dayTypeSource: day.source,
    serviceRegime: regime.value,
    serviceRegimeSource: regime.source,
    validFrom: validFrom.value === 'unknown' ? null : validFrom.value,
    validFromSource: validFrom.value === 'unknown' ? 'UNKNOWN' : validFrom.source,
    rawLabel: header || null
  };
}

/** Adds resolved validity without mutating the CanonicalSchedule. */
export function attachCanonicalValidity(schedule, evidence = {}) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');
  const validity = resolveCanonicalValidity(evidence);
  return {
    ...schedule,
    validity,
    metadata: { ...schedule.metadata, dayType: validity.dayType, serviceRegime: validity.serviceRegime }
  };
}

/**
 * Applies an explicit user choice to an already resolved schedule validity.
 * Only day type and its provenance change; school/holiday and valid-from facts
 * remain exactly as imported. The input schedule is never mutated.
 */
export function withManualCanonicalDayType(schedule, dayType) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');
  if (!CANONICAL_DAY_TYPES.includes(dayType)) throw new TypeError('Unsupported canonical day type.');
  const validity = schedule.validity || resolveCanonicalValidity();
  return {
    ...schedule,
    validity: { ...validity, dayType, dayTypeSource: 'MANUAL' },
    metadata: { ...schedule.metadata, dayType }
  };
}

export function formatCanonicalValidity(validity) {
  const day = { mo_fr: 'Montag–Freitag', saturday: 'Samstag', sunday: 'Sonntag', unknown: 'unbekannt' }[validity?.dayType] || 'unbekannt';
  const regime = { school: 'Schule', holidays: 'Ferien' }[validity?.serviceRegime] || '';
  return regime ? `${day} (${regime})` : day;
}

export function formatValiditySource(source) {
  return ({ HEADER: 'Dokumentkopf', DOCUMENT_METADATA: 'Dokumentmetadaten', FILENAME: 'Dateiname', MANUAL: 'manuell ausgewählt', UNKNOWN: 'unbekannt' })[source] || 'unbekannt';
}
