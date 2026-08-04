/**
 * Midnight-aware timeline normalization (Phase 3A hardening).
 *
 * Turns a sequence of "HH:MM" clock strings from ONE duty / activity sequence
 * into monotone relative minutes with an explicit day offset. A clock value that
 * is smaller than the previous one may indicate a single day change (crossing
 * midnight); a SECOND required rollover in the same sequence is treated as an
 * implausible data error and flagged rather than silently rolled another day.
 *
 * Pure, deterministic, no dependency, no global state across calls.
 */

const MINUTES_PER_DAY = 1440;

function parseClock(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * @param {Array<string|null>} times clock strings ("HH:MM") in document order
 * @returns {Array<{raw, clockMinutes, dayOffset, relativeMinutes, implausible}>}
 */
export function normalizeTimeline(times) {
  const entries = [];
  let dayOffset = 0;
  let rollovers = 0;
  let previousRelative = null;

  for (const raw of times ?? []) {
    const clockMinutes = parseClock(raw);
    if (clockMinutes === null) {
      entries.push({ raw: raw ?? null, clockMinutes: null, dayOffset, relativeMinutes: null, implausible: false });
      continue;
    }

    let relativeMinutes = dayOffset * MINUTES_PER_DAY + clockMinutes;
    let implausible = false;

    if (previousRelative !== null && relativeMinutes < previousRelative) {
      if (rollovers === 0) {
        // First backward step within the sequence: assume one midnight crossing.
        dayOffset += 1;
        rollovers += 1;
        relativeMinutes = dayOffset * MINUTES_PER_DAY + clockMinutes;
      } else {
        // A second required rollover is not a plausible second day change.
        implausible = true;
      }
    }

    entries.push({ raw, clockMinutes, dayOffset, relativeMinutes, implausible });
    previousRelative = implausible ? Math.max(previousRelative, relativeMinutes) : relativeMinutes;
  }

  return entries;
}
