/**
 * Duty Operational Day Resolver (Phase 3I.23) — a PURE NORMALISATION LAYER for the DUTY ROSTER.
 *
 * The JNV operational day begins at 03:00, so a night duty runs past midnight into the next
 * calendar day. The Excel import reads a clock string and never asks which day it belongs to, so a
 * duty like
 *
 *     21:36  →  21:46 → 03:14  →  03:14 → 04:24  →  04:24
 *
 * arrives with `dayOffset` 0 throughout and therefore runs BACKWARDS. Every consumer that compares
 * times then fails silently: a duty window `21:46 → 03:14` reads as `1306 → 194`, contains nothing,
 * and the segments attributed to it keep `serviceNumber: null`.
 *
 * The rule is the one the roster itself implies, and nothing more:
 *
 *     Inside ONE duty, whenever a following time is SMALLER than the previous one, the day advances.
 *
 * That is all. No heuristic, no threshold, no clock value that shifts anything by itself: a duty
 * beginning at 03:14 is a morning duty, not a continuation. Duties are resolved independently of
 * one another, and an unreadable time is left alone rather than guessed.
 *
 * The input is never mutated: a NEW schedule is returned, and the original clock strings and raw
 * minutes survive verbatim — only `dayOffset` is added.
 *
 * Pure: no I/O, no mutation, no current time, no random. It decides nothing professional; it moves
 * days. The Umlauftafel side has its own layer (`identity/operational-circuit-identity.js`).
 */

const MINUTES_PER_DAY = 1440;

const rawMinutes = (time) => (time && typeof time.minutesSinceStartOfDay === 'number' && Number.isFinite(time.minutesSinceStartOfDay)
  ? time.minutesSinceStartOfDay
  : null);

/**
 * Walks one duty's chronological chain and hands back the day offset for each link. The chain is
 * `begin → (departure, arrival)* → end` in document order — the order the roster prints.
 */
function resolveChain(times) {
  const offsets = [];
  let dayOffset = 0;
  let previous = null;
  for (const time of times) {
    const minutes = rawMinutes(time);
    if (minutes === null) { offsets.push(dayOffset); continue; }   // unreadable → carried, never guessed
    if (previous !== null && minutes + dayOffset * MINUTES_PER_DAY < previous) dayOffset += 1;
    previous = minutes + dayOffset * MINUTES_PER_DAY;
    offsets.push(dayOffset);
  }
  return offsets;
}

/** A copy of a normalized time with its resolved day offset. Everything else is carried verbatim. */
const withOffset = (time, dayOffset) => (time && typeof time === 'object' ? { ...time, dayOffset } : time);

/**
 * @param {object} canonicalSchedule the imported schedule; never mutated
 * @returns {{ schedule: object, warnings: Array<{code:string, serviceNumber:string, dayOffsets:number}> }}
 */
export function resolveDutyOperationalDays(canonicalSchedule) {
  const services = Array.isArray(canonicalSchedule?.services) ? canonicalSchedule.services : [];
  const warnings = [];

  const resolvedServices = services.map((service) => {
    const activities = Array.isArray(service?.activities) ? service.activities : [];
    const chain = [service?.begin, ...activities.flatMap(a => [a?.departureTime, a?.arrivalTime]), service?.end];
    const offsets = resolveChain(chain);

    const highest = offsets.length ? Math.max(...offsets) : 0;
    if (highest > 0) {
      warnings.push({
        code: 'DUTY_CROSSES_OPERATIONAL_DAY',
        serviceNumber: service?.serviceNumber == null ? null : String(service.serviceNumber),
        dayOffsets: highest
      });
    }

    return {
      ...service,
      begin: withOffset(service?.begin, offsets[0] ?? 0),
      end: withOffset(service?.end, offsets[offsets.length - 1] ?? 0),
      activities: activities.map((activity, index) => ({
        ...activity,
        departureTime: withOffset(activity?.departureTime, offsets[1 + index * 2] ?? 0),
        arrivalTime: withOffset(activity?.arrivalTime, offsets[2 + index * 2] ?? 0)
      }))
    };
  });

  return {
    schedule: { ...(canonicalSchedule && typeof canonicalSchedule === 'object' ? canonicalSchedule : {}), services: resolvedServices },
    warnings
  };
}
