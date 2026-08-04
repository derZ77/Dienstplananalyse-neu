import { prepareCanonicalScheduleForAnalysis } from './analysis-adapter.js';

const RESERVE_SERVICE_NUMBERS = new Set([
  1, 100, 190, 90,
  1101, 1102, 1201, 1202,
  1301, 1302, 1401, 1402,
  2101, 2102, 2201, 2202,
  2301, 2302, 2401, 2402
]);
const EQUIVALENT_LOCATIONS = new Set(['BBU', 'BUP', 'BBN', 'NSL']);

/**
 * CanonicalSchedule implementation of the legacy tabular checks 1–8.
 * Constants, boundaries and classifications intentionally retain their legacy
 * values. This module contains no new rules and no output formatting.
 */
export function analyzeMigratedLegacyChecks(canonicalSchedule) {
  const schedule = prepareCanonicalScheduleForAnalysis(canonicalSchedule);
  const services = schedule.services.slice().sort(compareServiceNumber);
  const plan = detectLegacyPlan(services);
  const sharedServices = findSharedServices(services);
  const reserveServices = services.filter(service => RESERVE_SERVICE_NUMBERS.has(toNumber(service.serviceNumber)));

  return {
    type: 'MigratedLegacyAnalysisResult',
    plan,
    serviceCount: services.length,
    sharedServices,
    reserveServices: reserveServices.map(service => service.serviceNumber),
    longPaidServices: services
      .filter(service => service.paidTime?.minutes > 510)
      .map(service => service.serviceNumber),
    differentLocationServices: findDifferentLocationServices(services),
    longServiceParts: findLongServiceParts(services, new Set(reserveServices.map(service => service.id))),
    shifts: assignLegacyShifts(services, plan.timeframe, new Set(sharedServices.map(service => service.id))),
    routes: groupLegacyRoutes(services),
    metadata: {
      sourceType: schedule.document.sourceType,
      migratedLegacyBlocks: [1, 2, 3, 4, 5, 6, 7, 8]
    }
  };
}

export function toMigratedLegacyAnalysisDebugJson(result, spacing = 2) {
  if (result?.type !== 'MigratedLegacyAnalysisResult') {
    throw new TypeError('Expected a MigratedLegacyAnalysisResult.');
  }
  return JSON.stringify(result, null, spacing);
}

function detectLegacyPlan(services) {
  const ids = services.map(service => toNumber(service.serviceNumber)).filter(Number.isInteger);
  const hasAnyInRange = (min, max) => ids.some(id => id >= min && id <= max);
  let vehicle = null;
  let timeframe = null;
  if (hasAnyInRange(1101, 1499)) {
    vehicle = 'Straßenbahn';
    timeframe = timeframeForRange(ids, 1101);
  } else if (hasAnyInRange(2101, 2499)) {
    vehicle = 'Bus';
    timeframe = timeframeForRange(ids, 2101);
  }
  const label = vehicle && timeframe
    ? `${vehicle} – ${timeframe}`
    : vehicle
      ? `${vehicle} (Zeitraum nicht eindeutig erkennbar)`
      : 'Dienstplan-Typ anhand der Nummern nicht eindeutig erkennbar (vermutlich ältere Struktur).';
  return { vehicle, timeframe, label };
}

function timeframeForRange(ids, start) {
  if (ids.some(id => id >= start && id <= start + 98)) return 'Mo–Fr Schule';
  if (ids.some(id => id >= start + 100 && id <= start + 198)) return 'Mo–Fr Ferien';
  if (ids.some(id => id >= start + 200 && id <= start + 298)) return 'Samstag';
  if (ids.some(id => id >= start + 300 && id <= start + 398)) return 'Sonntag';
  return null;
}

function findSharedServices(services) {
  return services
    .filter(service => isLegacySharedService(toNumber(service.serviceNumber)))
    .map(service => {
      const duration = durationBetween(service.begin, service.end);
      return {
        id: service.id,
        serviceNumber: service.serviceNumber,
        shiftDuration: duration,
        exceedsTwelveHours: duration.minutes !== null && duration.minutes > 720
      };
    });
}

function findDifferentLocationServices(services) {
  return services.flatMap(service => {
    const activities = service.activities.filter(hasDepartureAndArrivalLocation);
    if (!activities.length) return [];
    const startLocation = normalized(activities[0].departureLocation);
    const endLocation = normalized(activities.at(-1).arrivalLocation);
    if (!startLocation || !endLocation || startLocation === endLocation) return [];
    if (EQUIVALENT_LOCATIONS.has(startLocation) && EQUIVALENT_LOCATIONS.has(endLocation)) return [];
    return [{ serviceNumber: service.serviceNumber, startLocation, endLocation }];
  });
}

function findLongServiceParts(services, reserveServiceIds) {
  return services
    .filter(service => !reserveServiceIds.has(service.id))
    .flatMap(service => {
      const segments = service.activities
        .map(activity => ({
          circuitNumber: normalized(activity.circuitNumber),
          start: activity.departureTime,
          end: activity.arrivalTime,
          duration: durationBetween(activity.departureTime, activity.arrivalTime)
        }))
        .filter(segment => segment.duration.minutes !== null);
      const findings = [];
      segments.forEach(segment => {
        if (segment.duration.minutes > 270) {
          findings.push({ type: 'single', ...segment, exceedsSixHours: segment.duration.minutes > 360 });
        }
      });
      for (let index = 0; index < segments.length - 1; index += 1) {
        const current = segments[index];
        const next = segments[index + 1];
        const gap = durationBetween(current.end, next.start);
        const combined = durationBetween(current.start, next.end);
        if (gap.minutes !== null && combined.minutes > 270 && gap.minutes < 30) {
          findings.push({
            type: 'combined',
            first: current,
            second: next,
            gap,
            duration: combined,
            exceedsSixHours: combined.minutes > 360
          });
        }
      }
      return findings.length ? [{ serviceNumber: service.serviceNumber, findings }] : [];
    });
}

function assignLegacyShifts(services, timeframe, sharedServiceIds) {
  const weekend = timeframe === 'Samstag' || timeframe === 'Sonntag';
  const ranges = weekend
    ? [['WE-F1', 170, 360], ['WE-F2', 360, 615], ['S1', 615, 779], ['S2', 780, 1159], ['N', 1160, 1440]]
    : [['F1', 170, 270], ['F2', 271, 371], ['F3', 372, 614], ['S1', 615, 779], ['S2', 780, 1159], ['N', 1160, 1440]];
  const assignments = services.flatMap(service => {
    const minute = service.begin?.minutesSinceStartOfDay;
    if (!Number.isInteger(minute)) return [];
    const range = ranges.find(([, start, end]) => minute >= start && minute < end);
    const baseShift = range?.[0] || 'Unbekannte';
    const shared = sharedServiceIds.has(service.id);
    return [{
      serviceNumber: service.serviceNumber,
      shift: shared && baseShift !== 'Unbekannte' ? `G${baseShift}` : baseShift,
      isShared: shared
    }];
  });
  const counts = assignments.reduce((result, assignment) => {
    result[assignment.shift] = (result[assignment.shift] || 0) + 1;
    return result;
  }, {});
  return { weekend, counts, assignments };
}

function groupLegacyRoutes(services) {
  const routes = new Map();
  services.forEach(service => service.activities.forEach(activity => {
    const routeKey = legacyRouteKey(activity);
    if (routeKey === null) return;
    const entries = routes.get(routeKey) || [];
    entries.push({
      serviceNumber: service.serviceNumber,
      departureTime: structuredClone(activity.departureTime),
      arrivalTime: structuredClone(activity.arrivalTime),
      departureLocation: normalized(activity.departureLocation),
      arrivalLocation: normalized(activity.arrivalLocation)
    });
    routes.set(routeKey, entries);
  }));
  return Object.fromEntries([...routes.entries()]
    .sort(([left], [right]) => compareRoute(left, right))
    .map(([route, entries]) => [route, entries.sort((left, right) => (left.departureTime.minutesSinceStartOfDay ?? Infinity) - (right.departureTime.minutesSinceStartOfDay ?? Infinity))]));
}

// WP25: Block 9 (Linie/Kurs) prefers RouteIdentity, so 12/1 and 12100 group
// under one derived Linie/Kurs key. Only LINE_COURSE forms a Linie/Kurs group;
// JES Dienst/Umlauf (ServiceIdentity, no RouteIdentity) is never grouped as a
// route. When no RouteIdentity is present the legacy circuitNumber regex remains
// as fallback and behaves exactly as before.
function legacyRouteKey(activity) {
  const route = activity.routeIdentity;
  if (route) {
    return route.kind === 'LINE_COURSE' && route.line != null && route.course != null
      ? `${Number(route.line)}/${Number(route.course)}`
      : null;
  }
  const circuitNumber = normalized(activity.circuitNumber);
  return /^\d{1,2}\/\d{1,2}$/.test(circuitNumber) ? circuitNumber : null;
}

function isLegacySharedService(id) {
  return (id >= 40 && id <= 59) || (id >= 140 && id <= 159) ||
    (id >= 1140 && id <= 1159) || (id >= 1240 && id <= 1259) ||
    (id >= 2140 && id <= 2159) || (id >= 2240 && id <= 2259);
}

function durationBetween(start, end) {
  const startMinute = start?.minutesSinceStartOfDay;
  const endMinute = end?.minutesSinceStartOfDay;
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) return { minutes: null, value: null };
  const minutes = endMinute >= startMinute ? endMinute - startMinute : (24 * 60) - startMinute + endMinute;
  return { minutes, value: formatDuration(minutes) };
}

function hasDepartureAndArrivalLocation(activity) {
  return normalized(activity.departureLocation) && normalized(activity.arrivalLocation);
}

function compareServiceNumber(left, right) {
  return toNumber(left.serviceNumber) - toNumber(right.serviceNumber);
}

function compareRoute(left, right) {
  const [leftLine, leftCourse] = left.split('/').map(Number);
  const [rightLine, rightCourse] = right.split('/').map(Number);
  return leftLine - rightLine || leftCourse - rightCourse;
}

function toNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? null : number;
}

function normalized(value) {
  return String(value || '').trim();
}

function formatDuration(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
