import { validateReferenceDataSource } from './reference-data-validator.js';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TRIP_TYPES = new Set(['SERVICE', 'DEAD_RUN']);

/**
 * Validates the technical Wagenkarte payload. It preserves given timetable
 * observations and deliberately derives neither driving time nor compliance
 * assessments.
 */
export function validateWagenkartenReferenceSource(source) {
  const genericReport = validateReferenceDataSource(source);
  const errors = [...genericReport.errors];
  const warnings = [...genericReport.warnings];
  const data = source?.data;
  const cards = Array.isArray(data?.cards) ? data.cards : null;
  const cardReports = [];

  if (source?.area !== 'WAGENKARTE') errors.push(issue('INVALID_WAGENKARTE_AREA', 'Wagenkartenquelle muss area WAGENKARTE verwenden.', source?.id || 'source'));
  if (!cards) errors.push(issue('INVALID_WAGENKARTE_CARDS', 'Wagenkartenquelle benötigt data.cards als Array.', source?.id || 'source'));
  else cards.forEach((card, index) => cardReports.push(validateWagenkarte(card, index)));

  const cardIds = new Set();
  const serviceNumbers = new Set();
  for (const report of cardReports) {
    errors.push(...report.errors);
    warnings.push(...report.warnings);
    if (report.id && cardIds.has(report.id)) errors.push(issue('DUPLICATE_WAGENKARTE_ID', `Wagenkarten-ID ist nicht eindeutig: ${report.id}`, report.id));
    else if (report.id) cardIds.add(report.id);
    if (report.serviceNumber && serviceNumbers.has(report.serviceNumber)) errors.push(issue('DUPLICATE_WAGENKARTE_SERVICE', `Dienstnummer kommt mehrfach vor: ${report.serviceNumber}`, report.serviceNumber));
    else if (report.serviceNumber) serviceNumbers.add(report.serviceNumber);
  }

  return {
    type: 'WagenkartenReferenceValidationReport',
    valid: errors.length === 0,
    sourceId: genericReport.id,
    version: genericReport.version,
    cardCount: cardReports.length,
    cardReports,
    warnings,
    errors
  };
}

export function toWagenkartenReferenceDebugJson(report, spacing = 2) {
  if (report?.type !== 'WagenkartenReferenceValidationReport') throw new TypeError('Expected a WagenkartenReferenceValidationReport.');
  return JSON.stringify(report, null, spacing);
}

function validateWagenkarte(card, index) {
  const errors = [];
  const warnings = [];
  const value = isObject(card) ? card : {};
  const id = value.id;
  const serviceNumber = value.serviceNumber;
  if (!isObject(card)) errors.push(issue('INVALID_WAGENKARTE', `Wagenkarte ${index} muss ein Objekt sein.`, String(index)));
  if (typeof id !== 'string' || !id.trim()) errors.push(issue('INVALID_WAGENKARTE_ID', 'Wagenkarte benötigt eine nichtleere id.', String(index)));
  if (!isIdentifier(serviceNumber)) errors.push(issue('INVALID_WAGENKARTE_SERVICE', 'Wagenkarte benötigt eine Dienstnummer.', String(id || index)));
  if (typeof value.vehicle !== 'string' || !value.vehicle.trim()) errors.push(issue('INVALID_WAGENKARTE_VEHICLE', 'Wagenkarte benötigt eine Fahrzeugkennung.', String(id || index)));
  validateEndpoint(value.start, 'start', id, errors);
  validateEndpoint(value.end, 'end', id, errors);
  if (!Array.isArray(value.trips) || !value.trips.length) errors.push(issue('INVALID_WAGENKARTE_TRIPS', 'Wagenkarte benötigt eine nichtleere Fahrtfolge.', String(id || index)));
  const tripReports = Array.isArray(value.trips) ? value.trips.map((trip, tripIndex) => validateTrip(trip, tripIndex, id)) : [];
  tripReports.forEach(report => errors.push(...report.errors));
  const sequences = new Set();
  tripReports.forEach(report => {
    if (Number.isInteger(report.sequence) && sequences.has(report.sequence)) errors.push(issue('DUPLICATE_TRIP_SEQUENCE', `Fahrtfolge enthält die Sequenz ${report.sequence} mehrfach.`, String(id || index)));
    else if (Number.isInteger(report.sequence)) sequences.add(report.sequence);
  });
  return { index, id: typeof id === 'string' ? id : null, serviceNumber: isIdentifier(serviceNumber) ? String(serviceNumber) : null, valid: errors.length === 0, tripReports, warnings, errors };
}

function validateTrip(trip, index, cardId) {
  const errors = [];
  const value = isObject(trip) ? trip : {};
  if (!isObject(trip)) errors.push(issue('INVALID_TRIP', `Fahrt ${index} muss ein Objekt sein.`, cardId));
  if (!Number.isInteger(value.sequence) || value.sequence < 1) errors.push(issue('INVALID_TRIP_SEQUENCE', 'Fahrt benötigt eine positive ganzzahlige sequence.', cardId));
  if (!TRIP_TYPES.has(value.tripType)) errors.push(issue('INVALID_TRIP_TYPE', 'tripType muss SERVICE oder DEAD_RUN sein.', cardId));
  if (value.tripType === 'SERVICE' && (typeof value.line !== 'string' || !value.line.trim())) errors.push(issue('INVALID_TRIP_LINE', 'Linienfahrt benötigt eine Linie.', cardId));
  if (value.tripType === 'SERVICE' && (typeof value.course !== 'string' || !value.course.trim())) errors.push(issue('INVALID_TRIP_COURSE', 'Linienfahrt benötigt einen Kurs.', cardId));
  validateEndpoint(value.departure, 'departure', cardId, errors);
  validateEndpoint(value.arrival, 'arrival', cardId, errors);
  if (!Array.isArray(value.stops) || value.stops.length < 2) errors.push(issue('INVALID_TRIP_STOPS', 'Jede Fahrt benötigt mindestens zwei Haltestellen.', cardId));
  const stopReports = Array.isArray(value.stops) ? value.stops.map((stop, stopIndex) => validateStop(stop, stopIndex, cardId)) : [];
  stopReports.forEach(report => errors.push(...report.errors));
  assertStrictSequence(stopReports, 'STOP', cardId, errors);
  return { index, sequence: value.sequence, valid: errors.length === 0, stopReports, errors };
}

function validateStop(stop, index, cardId) {
  const errors = [];
  const value = isObject(stop) ? stop : {};
  if (!isObject(stop)) errors.push(issue('INVALID_STOP', `Haltestelle ${index} muss ein Objekt sein.`, cardId));
  if (!Number.isInteger(value.sequence) || value.sequence < 1) errors.push(issue('INVALID_STOP_SEQUENCE', 'Haltestelle benötigt eine positive ganzzahlige sequence.', cardId));
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push(issue('INVALID_STOP_NAME', 'Haltestelle benötigt einen Namen.', cardId));
  if (!isTime(value.time)) errors.push(issue('INVALID_STOP_TIME', 'Haltestelle benötigt einen Zeitpunkt HH:MM.', cardId));
  if (!['ARRIVAL', 'DEPARTURE', 'PASS'].includes(value.event)) errors.push(issue('INVALID_STOP_EVENT', 'Haltestellenereignis muss ARRIVAL, DEPARTURE oder PASS sein.', cardId));
  return { index, sequence: value.sequence, valid: errors.length === 0, errors };
}

function validateEndpoint(value, field, target, errors) {
  if (!isObject(value) || !isTime(value.time) || typeof value.stop !== 'string' || !value.stop.trim()) {
    errors.push(issue(`INVALID_${field.toUpperCase()}`, `${field} benötigt time (HH:MM) und stop.`, String(target || 'source')));
  }
}

function assertStrictSequence(reports, prefix, target, errors) {
  let previous = 0;
  for (const report of reports) {
    if (!Number.isInteger(report.sequence)) continue;
    if (report.sequence <= previous) errors.push(issue(`INVALID_${prefix}_ORDER`, `${prefix}-Sequenzen müssen strikt aufsteigend sein.`, String(target)));
    previous = report.sequence;
  }
}

function isTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function isIdentifier(value) {
  return (typeof value === 'string' && value.trim()) || Number.isInteger(value);
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function issue(code, message, target) {
  return { code, message, target };
}
