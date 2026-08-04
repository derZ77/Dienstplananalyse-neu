/**
 * JNV schedule hardening layer (Phase 3A).
 *
 * Additive, deterministic enrichment that sits AFTER the frozen CanonicalSchedule
 * builder. It never mutates the base schedule and never changes the existing
 * pipeline contracts (shapes, cell/row counts, top-level `interruptions`). It
 * produces a separate JnvHardenedSchedule that models the reference-proven
 * special cases: split-shift interruptions, day-type qualifiers, midnight
 * rollovers, non-tabular annotations and the overloaded "Dienst" activity.
 *
 * Pure (no I/O, storage, network), no dependency. Intended input for Phase 3B.
 */

import {
  ROW_TYPES,
  classifyActivityRow,
  parseServiceInterruption
} from './row-type-contract.js';
import { normalizeTimeline } from './timeline-normalization.js';

export const WARNING_CODES = Object.freeze({
  INVALID_SERVICE_INTERRUPTION_TIME: 'INVALID_SERVICE_INTERRUPTION_TIME',
  UNSUPPORTED_DAY_QUALIFIER: 'UNSUPPORTED_DAY_QUALIFIER',
  NON_TABULAR_ANNOTATION: 'NON_TABULAR_ANNOTATION',
  MIDNIGHT_ROLLOVER_APPLIED: 'MIDNIGHT_ROLLOVER_APPLIED',
  IMPLAUSIBLE_TIME_SEQUENCE: 'IMPLAUSIBLE_TIME_SEQUENCE',
  AMBIGUOUS_GENERIC_DUTY: 'AMBIGUOUS_GENERIC_DUTY'
});

export const DUTY_KINDS = Object.freeze({
  SERVICE_DRIVE: 'serviceDrive',
  DEPOT_DUTY: 'depotDuty',
  STANDBY_OR_RESERVE: 'standbyOrReserve',
  GENERIC_DUTY: 'genericDuty'
});

const RESERVE_LABEL = /\b(Reserve|Bereitschaft|Rufbereitschaft|Standby)\b/i;

/**
 * Conservatively classifies an overloaded "Dienst" activity using only present,
 * provable context. Never infers reserve from duration; unclear cases stay
 * genericDuty with an explicit uncertainty flag.
 */
export function classifyDuty(activityLike = {}) {
  const rawActivity = String(activityLike.rawActivity || '').trim();
  const circuit = String(activityLike.circuitNumber || '').trim();
  const from = String(activityLike.departureLocation || '').trim();
  const to = String(activityLike.arrivalLocation || '').trim();
  const note = String(activityLike.note || '');
  const routeKind = activityLike.routeIdentity && activityLike.routeIdentity.kind;
  const routeKnown = Boolean(routeKind) && routeKind !== 'UNKNOWN';

  // Explicit reserve/standby label only — never derived from duration.
  if (RESERVE_LABEL.test(rawActivity) || RESERVE_LABEL.test(note)) {
    return { dutyKind: DUTY_KINDS.STANDBY_OR_RESERVE, ambiguous: false, reason: 'explicit-label' };
  }
  // Non-"Dienst" activities are not the overloaded case.
  if (rawActivity && !/^Dienst$/i.test(rawActivity)) {
    return { dutyKind: DUTY_KINDS.GENERIC_DUTY, ambiguous: false, reason: 'not-a-dienst-activity' };
  }
  // Line service: a circuit code (or a known route identity) is present.
  if (circuit || routeKnown) {
    return { dutyKind: DUTY_KINDS.SERVICE_DRIVE, ambiguous: false, reason: 'circuit-present' };
  }
  // Depot / positioning move: no circuit, identical start and end place.
  if (from && to && from === to) {
    return { dutyKind: DUTY_KINDS.DEPOT_DUTY, ambiguous: false, reason: 'depot-to-depot' };
  }
  // Not reliably distinguishable → conservative generic + uncertainty.
  return { dutyKind: DUTY_KINDS.GENERIC_DUTY, ambiguous: true, reason: 'insufficient-evidence' };
}

/**
 * Produces a JnvHardenedSchedule from a CanonicalSchedule without mutating it.
 * @param {object} canonical CanonicalSchedule (from canonical-schedule-builder)
 */
export function enrichJnvSchedule(canonical) {
  if (!canonical || !Array.isArray(canonical.services)) {
    throw new TypeError('enrichJnvSchedule expects a CanonicalSchedule with a services array.');
  }

  const warnings = [];
  const interruptions = [];
  const services = canonical.services.map(service => enrichService(service, warnings, interruptions));

  return {
    type: 'JnvHardenedSchedule',
    baseType: canonical.type ?? null,
    services,
    interruptions,
    warnings,
    metadata: {
      serviceCount: services.length,
      serviceInterruptionCount: interruptions.length,
      dayQualifierCount: services.reduce((sum, service) => sum + service.dayQualifiers.length, 0),
      annotationCount: services.reduce((sum, service) => sum + service.annotations.length, 0),
      midnightServiceCount: services.filter(service => service.end.dayOffset > 0).length,
      warningCount: warnings.length
    }
  };
}

function enrichService(service, warnings, allInterruptions) {
  const ref = { serviceNumber: service.serviceNumber, serviceId: service.id, page: service.source?.pageNumber ?? null };
  const dayQualifiers = [];
  const interruptions = [];
  const annotations = [];
  const dutyActivities = [];

  for (const activity of service.activities ?? []) {
    const classified = classifyActivityRow(activity);

    if (classified.type === ROW_TYPES.SERVICE_INTERRUPTION) {
      const model = classified.interruption ?? parseServiceInterruption(activity.originalText || '');
      const entry = { ...model, source: activity.source };
      interruptions.push(entry);
      allInterruptions.push({ ...entry, ...ref });
      if (!model.valid) warnings.push({ code: WARNING_CODES.INVALID_SERVICE_INTERRUPTION_TIME, ...ref });
      continue;
    }
    if (classified.type === ROW_TYPES.DAY_QUALIFIER) {
      dayQualifiers.push({ type: 'dayQualifier', code: classified.code, label: classified.label, source: activity.source });
      continue;
    }
    if (classified.type === ROW_TYPES.ANNOTATION) {
      annotations.push({ type: 'annotation', sourceText: classified.sourceText || '', source: activity.source });
      warnings.push({ code: classified.dayQualifierAttempt ? WARNING_CODES.UNSUPPORTED_DAY_QUALIFIER : WARNING_CODES.NON_TABULAR_ANNOTATION, ...ref });
      continue;
    }
    if (classified.type === ROW_TYPES.EMPTY) {
      continue;
    }

    // service_data → conservative duty classification (additive fields on a copy)
    const duty = classifyDuty(activity);
    if (duty.ambiguous) warnings.push({ code: WARNING_CODES.AMBIGUOUS_GENERIC_DUTY, ...ref });
    dutyActivities.push({
      ...activity,
      rowType: ROW_TYPES.SERVICE_DATA,
      dutyKind: duty.dutyKind,
      ambiguousDuty: duty.ambiguous
    });
  }

  // Midnight-aware timeline across begin, activity dep/arr times, and end.
  const timelineValues = [
    service.begin?.value ?? null,
    ...dutyActivities.flatMap(activity => [activity.departureTime?.value ?? null, activity.arrivalTime?.value ?? null]),
    service.end?.value ?? null
  ];
  const timeline = normalizeTimeline(timelineValues);
  if (timeline.some(entry => entry.implausible)) warnings.push({ code: WARNING_CODES.IMPLAUSIBLE_TIME_SEQUENCE, ...ref });

  const beginEntry = timeline[0];
  const endEntry = timeline[timeline.length - 1];
  dutyActivities.forEach((activity, index) => {
    const departure = timeline[1 + index * 2];
    const arrival = timeline[2 + index * 2];
    activity.departureTime = { ...activity.departureTime, dayOffset: departure?.dayOffset ?? 0, relativeMinutes: departure?.relativeMinutes ?? null };
    activity.arrivalTime = { ...activity.arrivalTime, dayOffset: arrival?.dayOffset ?? 0, relativeMinutes: arrival?.relativeMinutes ?? null };
  });

  return {
    serviceNumber: service.serviceNumber,
    serviceId: service.id,
    begin: { ...service.begin, dayOffset: beginEntry?.dayOffset ?? 0, relativeMinutes: beginEntry?.relativeMinutes ?? null },
    end: { ...service.end, dayOffset: endEntry?.dayOffset ?? 0, relativeMinutes: endEntry?.relativeMinutes ?? null },
    dayQualifiers,
    interruptions,
    annotations,
    dutyActivities,
    timeline
  };
}
