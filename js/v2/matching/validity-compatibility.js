/**
 * JNV validity compatibility (Phase 3I.18) — day RANGES, not strings.
 *
 * A Mon–Fri duty roster may legitimately carry Mon–Thu Umlauftafeln: in school and holiday
 * timetables Monday to Thursday share one set of circulations while Friday differs. String
 * equality reads that as a contradiction; it is not one. The board simply describes a valid
 * SUB-RANGE of the roster.
 *
 * The question this module answers is therefore:
 *
 *     Can the Umlauftafel be a valid sub-range of the duty roster?
 *
 *   COMPATIBLE   proven — every day the board describes is a day the roster covers.
 *   INCOMPATIBLE proven otherwise — the two day ranges share no day at all.
 *   UNKNOWN      not decidable — a side names no day range, or the board reaches beyond the
 *                roster. Never silently promoted to either of the other two.
 *
 * Deliberately asymmetric: roster ⊇ board is compatible, roster ⊆ board is not. The board may
 * describe less than the roster (Friday is missing), never more than it.
 *
 * Pure: no I/O, no mutation, no current time. It decides nothing about matching itself — the
 * matcher owns what to do with the verdict.
 */

export const VALIDITY_COMPATIBILITY = Object.freeze({
  COMPATIBLE: 'COMPATIBLE', INCOMPATIBLE: 'INCOMPATIBLE', UNKNOWN: 'UNKNOWN'
});

export const VALIDITY_REASONS = Object.freeze({
  DAY_TYPE_EQUAL: 'DAY_TYPE_EQUAL',
  DAY_TYPE_COMPANION_IS_SUBSET: 'DAY_TYPE_COMPANION_IS_SUBSET',
  DAY_TYPE_COMPANION_EXCEEDS_SCHEDULE: 'DAY_TYPE_COMPANION_EXCEEDS_SCHEDULE',
  DAY_TYPE_DISJOINT: 'DAY_TYPE_DISJOINT',
  DAY_TYPE_NO_DAY_RANGE: 'DAY_TYPE_NO_DAY_RANGE',
  REGIME_EQUAL: 'REGIME_EQUAL',
  REGIME_DIFFERENT: 'REGIME_DIFFERENT',
  REGIME_UNKNOWN: 'REGIME_UNKNOWN'
});

export const WEEKDAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

/**
 * The weekday set behind each day type. `unknown`, `school_days` and `holidays` are absent ON
 * PURPOSE: they name a service regime, not a range of days, and inventing a set for them would
 * be a guess.
 */
export const DAY_TYPE_DAYS = Object.freeze({
  mo_fr: Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  mo_do: Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday']),
  friday: Object.freeze(['friday']),
  saturday: Object.freeze(['saturday']),
  sunday: Object.freeze(['sunday']),
  weekend: Object.freeze(['saturday', 'sunday'])
});

const KNOWN_REGIMES = Object.freeze(['school', 'holidays', 'regular', 'special']);

const { COMPATIBLE, INCOMPATIBLE, UNKNOWN } = VALIDITY_COMPATIBILITY;
const R = VALIDITY_REASONS;

/** The weekday set of a day type, or `null` when it names no range of days. */
export function dayTypeDays(dayType) {
  const days = typeof dayType === 'string' ? DAY_TYPE_DAYS[dayType] : undefined;
  return days ? [...days] : null;
}

/**
 * Can a companion day type be a valid sub-range of a schedule day type?
 * @returns {{status: string, reason: string}}
 */
export function compareDayTypes(scheduleDayType, companionDayType) {
  const scheduleDays = dayTypeDays(scheduleDayType);
  const companionDays = dayTypeDays(companionDayType);
  if (scheduleDays === null || companionDays === null) return { status: UNKNOWN, reason: R.DAY_TYPE_NO_DAY_RANGE };

  const shared = companionDays.filter(day => scheduleDays.includes(day));
  if (shared.length === 0) return { status: INCOMPATIBLE, reason: R.DAY_TYPE_DISJOINT };
  if (shared.length < companionDays.length) return { status: UNKNOWN, reason: R.DAY_TYPE_COMPANION_EXCEEDS_SCHEDULE };
  // Every companion day is covered by the schedule.
  return {
    status: COMPATIBLE,
    reason: companionDays.length === scheduleDays.length ? R.DAY_TYPE_EQUAL : R.DAY_TYPE_COMPANION_IS_SUBSET
  };
}

/**
 * Service regimes carry no range semantics: two known regimes either agree or contradict, and an
 * absent one is an open question rather than a mismatch.
 * @returns {{status: string, reason: string}}
 */
export function compareServiceRegimes(scheduleRegime, companionRegime) {
  const scheduleKnown = KNOWN_REGIMES.includes(scheduleRegime);
  const companionKnown = KNOWN_REGIMES.includes(companionRegime);
  if (!scheduleKnown || !companionKnown) return { status: UNKNOWN, reason: R.REGIME_UNKNOWN };
  return scheduleRegime === companionRegime
    ? { status: COMPATIBLE, reason: R.REGIME_EQUAL }
    : { status: INCOMPATIBLE, reason: R.REGIME_DIFFERENT };
}

// A proven contradiction is never softened by an open question, and an open question is never
// promoted by a proven agreement elsewhere.
function weakest(...statuses) {
  if (statuses.includes(INCOMPATIBLE)) return INCOMPATIBLE;
  if (statuses.includes(UNKNOWN)) return UNKNOWN;
  return COMPATIBLE;
}

/**
 * Full Level-1 verdict over both validity fields.
 * @param {{ schedule?: {serviceRegime?:string, dayType?:string},
 *           companion?: {serviceRegime?:string, dayType?:string} }} [input]
 * @returns {{status:string, serviceRegime:{status:string,reason:string}, dayType:{status:string,reason:string}, reasons:string[]}}
 */
export function assessValidityCompatibility({ schedule = {}, companion = {} } = {}) {
  const serviceRegime = compareServiceRegimes(schedule?.serviceRegime, companion?.serviceRegime);
  const dayType = compareDayTypes(schedule?.dayType, companion?.dayType);
  return {
    status: weakest(serviceRegime.status, dayType.status),
    serviceRegime,
    dayType,
    reasons: [serviceRegime.reason, dayType.reason]
  };
}
