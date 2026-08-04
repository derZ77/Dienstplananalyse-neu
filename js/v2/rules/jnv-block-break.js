/**
 * JNV block break with walking time (Phase 3I.29) — PURE, and about break length only.
 *
 * A block break must last at least 30 minutes. If it BEGINS or ENDS at one of three stops, the
 * driver has to walk to or from the vehicle, and six minutes of walking time are needed on top:
 *
 *     Teichgraben (TGR) · Löbdergraben (LGR) · Holzmarkt (HLZ)   →   36 minutes  (+6)
 *     Burgaupark (BUP)                                           →   34 minutes  (+4)
 *     every other stop                                           →   30 minutes
 *
 * The six minutes are NOT driving time. They raise the REQUIRED break length and nothing else —
 * this module returns no driving minutes and never touches a quota.
 *
 * DECISION (Phase 3I.29) — a break with only ONE end at such a stop:
 *   Walking time arises as soon as EITHER end lies at one of the three stops; the driver has to
 *   walk there or back either way. The stricter reading is deliberate: it demands MORE break,
 *   never less, and therefore never shortens a driver's rest. The surcharge is added ONCE, even
 *   when both ends are walking-time stops — the walk happens twice, but the six minutes are the
 *   agreed flat amount, not a per-end charge.
 *
 * THE SECOND TIER (Phase 3I.31) — measured, not assumed:
 *   Comparing every declared Blockpause of the real Mo–Fr plan against the gap it sits in gives
 *   the walking time directly. At TGR/LGR/HLZ the difference is 6 minutes in 30 of 30 cases,
 *   without exception. At Burgaupark it is 4 minutes in 6 of 8 cases and 5 in the other two, so
 *   4 is taken: it is the confirmed floor, and the two 5-minute cases are recorded as a known
 *   limit rather than smoothed away.
 *
 *   Only measured stops carry a surcharge. The depot Burgau (BBU) hosts no measurable break in
 *   the plan, so it gets NOTHING — an unmeasured stop is not a stop with a small surcharge.
 *
 * Pure: no I/O, no mutation, no current time, no random.
 */

/** The base requirement — the same value BV010 uses for a Blockpause. */
export const BLOCK_BREAK_MINIMUM_MINUTES = 30;
/** The flat walking-time surcharge, added once when a walking-time stop is involved. */
export const WALKING_TIME_MINUTES = 6;

/**
 * The three stops that require walking time, with the abbreviations and the full names a plan may
 * carry. A location is matched when it CONTAINS one of these tokens — a plan writes
 * `Teichgraben (TGR)` as readily as `TGR`.
 */
export const WALKING_TIME_STOPS = Object.freeze(['TGR', 'LGR', 'HLZ']);

/** The second, shorter tier — a nearer stand, and therefore a shorter walk. */
export const SHORT_WALKING_TIME_MINUTES = 4;
export const SHORT_WALKING_TIME_STOPS = Object.freeze(['BUP']);

/** Every walking-time stop with the minutes it costs. The single source for both tiers. */
const STOP_MINUTES = Object.freeze({
  TGR: WALKING_TIME_MINUTES, LGR: WALKING_TIME_MINUTES, HLZ: WALKING_TIME_MINUTES,
  BUP: SHORT_WALKING_TIME_MINUTES
});

const STOP_ALIASES = Object.freeze({
  TGR: Object.freeze(['TGR', 'TEICHGRABEN']),
  LGR: Object.freeze(['LGR', 'LÖBDERGRABEN', 'LOEBDERGRABEN']),
  HLZ: Object.freeze(['HLZ', 'HOLZMARKT']),
  BUP: Object.freeze(['BUP', 'BURGAUPARK'])
});

/** The walking-time stop a location denotes, or `null`. Nothing is guessed: no match, no stop. */
function walkingTimeStopOf(location) {
  if (typeof location !== 'string') return null;               // a non-string is never a stop
  const text = location.trim().toUpperCase();
  if (text === '') return null;
  for (const stop of Object.keys(STOP_MINUTES)) {
    if (STOP_ALIASES[stop].some(alias => text.includes(alias))) return stop;
  }
  return null;
}

/** The walking-time stops among the two ends of a break, in the order start → end, without repeats. */
export function walkingTimeStopsOf(startLocation, endLocation) {
  const stops = [walkingTimeStopOf(startLocation), walkingTimeStopOf(endLocation)].filter(s => s !== null);
  return [...new Set(stops)];
}

/**
 * The walking time a break between these two locations costs. Added ONCE, and where the two ends
 * belong to different tiers the LONGER walk governs — the driver still has to make it.
 */
export function walkingTimeMinutesOf(startLocation, endLocation) {
  return walkingTimeStopsOf(startLocation, endLocation)
    .reduce((longest, stop) => Math.max(longest, STOP_MINUTES[stop]), 0);
}

/**
 * How long a block break has to be between these two locations: 30 minutes, plus the walking
 * time of the stops involved.
 */
export function requiredBlockBreakMinutes(startLocation, endLocation) {
  return BLOCK_BREAK_MINIMUM_MINUTES + walkingTimeMinutesOf(startLocation, endLocation);
}

/**
 * Assesses one break.
 *
 * @param {{durationMinutes: number|null, startLocation?: string|null, endLocation?: string|null}} input
 * @returns {{satisfied: boolean|null, durationMinutes: number|null, requiredMinutes: number,
 *            walkingTimeMinutes: number, walkingTimeStops: string[], deficitMinutes: number|null}}
 *   `satisfied: null` means undecidable — an unusable duration is never read as a pass.
 */
export function evaluateBlockBreak({ durationMinutes, startLocation = null, endLocation = null } = {}) {
  const walkingTimeStops = walkingTimeStopsOf(startLocation, endLocation);
  const walkingTimeMinutes = walkingTimeMinutesOf(startLocation, endLocation);
  const requiredMinutes = BLOCK_BREAK_MINIMUM_MINUTES + walkingTimeMinutes;
  const minutes = (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes >= 0)
    ? durationMinutes
    : null;

  if (minutes === null) {
    return { satisfied: null, durationMinutes: null, requiredMinutes, walkingTimeMinutes, walkingTimeStops, deficitMinutes: null };
  }
  return {
    satisfied: minutes >= requiredMinutes,
    durationMinutes: minutes,
    requiredMinutes,
    walkingTimeMinutes,
    walkingTimeStops,
    deficitMinutes: Math.max(0, requiredMinutes - minutes)
  };
}
