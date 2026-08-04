/**
 * Extended structural ScheduleMatchView (Phase 3G.2).
 *
 * Additive companion to `buildScheduleMatchView` (3G.1, unchanged): projects a JNV
 * CanonicalSchedule (+ its hardening) into a privacy-safe structural view per Umlauf —
 * services, lines, courses, trips, start/end, time window, small source refs — using ONLY
 * existing fields (exact-string `circuitNumber`, existing RouteIdentity, hardened dayOffset).
 * No heuristics, no scoring, no interpretation, no new time normalization, no full schedule
 * copy. Pure and non-mutating. This view is a later matcher input; it evaluates nothing.
 */

const warn = (code, detail = {}) => ({ code, severity: 'warning', ...detail });

// Prefer the hardened duty activities (they carry dayOffset); fall back to base activities.
function scheduleServices(canonicalSchedule) {
  const hardened = canonicalSchedule?.hardened;
  if (hardened?.applied && Array.isArray(hardened.services)) {
    return hardened.services.map(s => ({ serviceNumber: s.serviceNumber, activities: s.dutyActivities || [] }));
  }
  return (Array.isArray(canonicalSchedule?.services) ? canonicalSchedule.services : [])
    .map(s => ({ serviceNumber: s.serviceNumber, activities: s.activities || [] }));
}

const pushDistinct = (arr, value) => { const v = value == null ? '' : String(value); if (v && !arr.includes(v)) arr.push(v); };
const depKey = (a) => (a.departureTime?.dayOffset ?? 0) * 100000 + (a.departureTime?.minutesSinceStartOfDay ?? 0);
const arrKey = (a) => (a.arrivalTime?.dayOffset ?? 0) * 100000 + (a.arrivalTime?.minutesSinceStartOfDay ?? 0);

function boundaryTimes(activities, sourceType) {
  const dep = activities.filter(a => a.departureTime?.minutesSinceStartOfDay != null).sort((x, y) => depKey(x) - depKey(y));
  const arr = activities.filter(a => a.arrivalTime?.minutesSinceStartOfDay != null).sort((x, y) => arrKey(x) - arrKey(y));
  const first = dep[0] || null;
  const last = arr[arr.length - 1] || null;
  const warnings = [];
  if (first && last && arrKey(last) < depKey(first)) warnings.push(warn('TIME_WINDOW_INCONSISTENT'));
  return {
    start: { time: first?.departureTime?.value ?? null, location: first?.departureLocation ?? null },
    end: { time: last?.arrivalTime?.value ?? null, location: last?.arrivalLocation ?? null },
    timeWindow: {
      startMinutes: first?.departureTime?.minutesSinceStartOfDay ?? null,
      endMinutes: last?.arrivalTime?.minutesSinceStartOfDay ?? null,
      dayOffsetEnd: last?.arrivalTime?.dayOffset ?? 0
    },
    warnings
  };
}

/**
 * @param {{ canonicalSchedule: object, validity: object }} input
 * @returns {{ serviceRegime, dayType, validityConfidence, validityEvidence, umlaeufe, warnings }}
 */
export function buildExtendedScheduleMatchView({ canonicalSchedule, validity = {} } = {}) {
  const warnings = [];
  const groups = new Map(); // code → { services:Set, activities:[], sourceRefs:[] }

  for (const service of scheduleServices(canonicalSchedule)) {
    (service.activities || []).forEach((activity, activityIndex) => {
      const code = activity?.circuitNumber == null ? '' : String(activity.circuitNumber).trim(); // exact string
      if (!code) {
        warnings.push(warn('SERVICE_WITHOUT_UMLAUF_CODE', { serviceNumber: service.serviceNumber ?? null, activityIndex }));
        return;
      }
      if (!groups.has(code)) groups.set(code, { services: new Set(), activities: [], sourceRefs: [] });
      const group = groups.get(code);
      if (service.serviceNumber != null) group.services.add(String(service.serviceNumber));
      group.activities.push(activity);
      group.sourceRefs.push({ serviceNumber: service.serviceNumber ?? null, activityIndex, sourceType: activity.source?.sourceType ?? canonicalSchedule?.document?.sourceType ?? 'pdf' });
    });
  }

  const umlaeufe = [...groups.entries()].map(([code, group]) => {
    const lines = [], courses = [], trips = [];
    for (const activity of group.activities) {
      const identity = activity.routeIdentity;
      if (!identity || identity.kind === 'UNKNOWN') continue;
      pushDistinct(lines, identity.line);
      pushDistinct(courses, identity.course);
      pushDistinct(trips, identity.trip);
    }
    const boundary = boundaryTimes(group.activities, canonicalSchedule?.document?.sourceType);
    return {
      code,
      services: [...group.services].sort(),
      lines, courses, trips,
      start: boundary.start,
      end: boundary.end,
      timeWindow: boundary.timeWindow,
      sourceRefs: group.sourceRefs,
      warnings: boundary.warnings
    };
  });

  return {
    serviceRegime: validity.serviceRegime ?? 'unknown',
    dayType: validity.dayType ?? 'unknown',
    validityConfidence: validity.confidence ?? 'unknown',
    validityEvidence: Array.isArray(validity.evidence) ? validity.evidence : [],
    umlaeufe,
    warnings
  };
}
