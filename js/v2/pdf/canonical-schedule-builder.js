import { attachCircuitIdentities } from '../identity/identity-normalization.js';

/**
 * Builds the document-independent CanonicalSchedule without document-profile
 * rules, activity classification, or timetable analysis.
 */
export function buildCanonicalSchedule(scheduleDocument) {
  if (scheduleDocument?.type !== 'ScheduleDocument') {
    throw new TypeError('Expected a ScheduleDocument.');
  }

  const services = scheduleDocument.services.map(buildService);
  const activities = services.flatMap(service => service.activities);
  const interruptions = [];

  const schedule = {
    type: 'CanonicalSchedule',
    document: {
      sourceType: 'pdf',
      pageCount: scheduleDocument.pageCount,
      source: scheduleDocument.source
    },
    services,
    activities,
    interruptions,
    warnings: [],
    metadata: {
      schemaVersion: '1.0',
      serviceCount: services.length,
      activityCount: activities.length,
      interruptionCount: interruptions.length
    }
  };
  // WP24: enrich the finished CanonicalSchedule with RouteIdentity/ServiceIdentity
  // exactly once, at the point the schedule is complete. Additive only.
  return attachCircuitIdentities(schedule);
}

function buildService(service) {
  const id = `service:${service.source.pageNumber}:${service.source.tableIndex}`;
  const activities = service.activities.map(activity => buildActivity(activity, id));

  return {
    id,
    serviceNumber: service.serviceNumber,
    begin: normalizeClockTime(service.begin),
    end: normalizeClockTime(service.end),
    paidTime: normalizeDuration(service.paidTime),
    activities,
    interruptions: [],
    originalText: service.originalText,
    boundingBox: service.boundingBox,
    source: service.source
  };
}

function buildActivity(activity, serviceId) {
  return {
    id: `activity:${serviceId}:${activity.index}`,
    serviceId,
    serviceNumber: activity.serviceNumber,
    circuitNumber: activity.circuitNumber,
    rawActivity: activity.rawActivity,
    departureTime: normalizeClockTime(activity.departureTime),
    arrivalTime: normalizeClockTime(activity.arrivalTime),
    departureLocation: activity.departureLocation,
    arrivalLocation: activity.arrivalLocation,
    originalText: activity.originalText,
    boundingBox: activity.boundingBox,
    source: activity.source
  };
}

function normalizeClockTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { raw, value: null, minutesSinceStartOfDay: null };

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { raw, value: null, minutesSinceStartOfDay: null };
  return {
    raw,
    value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    minutesSinceStartOfDay: hours * 60 + minutes
  };
}

function normalizeDuration(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,3}):(\d{2})$/);
  if (!match) return { raw, value: null, minutes: null };

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return { raw, value: null, minutes: null };
  return {
    raw,
    value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    minutes: hours * 60 + minutes
  };
}

/** Debug-only serialization without UI or persistence side effects. */
export function toCanonicalScheduleDebugJson(canonicalSchedule, spacing = 2) {
  return JSON.stringify(canonicalSchedule, null, spacing);
}
