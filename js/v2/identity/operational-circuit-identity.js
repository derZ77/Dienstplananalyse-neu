/**
 * Operational Circuit Identity (Phase 3I.21) — a PURE NORMALISATION LAYER.
 *
 * The JNV operational day begins at 03:00 and ends at 03:00 of the following calendar day. A night
 * circulation may run across that boundary, and the timetable documentation then breaks it onto two
 * sheets:
 *
 *     10901   21:46 → 03:13 (+1)          10902   03:14 (+1) → 04:23 (+1)
 *
 * Both describe ONE operational circuit. That is documentation, not two courses. This module states
 * it — above the raw data, never inside it:
 *
 *   - the raw circulations are neither mutated nor copied; a circuit REFERENCES them,
 *   - the route identity comes from the CENTRAL normalisation (`identity-normalization.js`);
 *     nothing is interpreted here,
 *   - times are read from what the Umlauftafel loader already normalised.
 *
 * One more thing has to happen first. The loader normalises every sheet ON ITS OWN, so the
 * continuation sheet — read alone, `03:14` is simply an early morning — carries no day offset and
 * appears to lie BEFORE its predecessor. This layer reconstructs that offset: a sheet is lifted by
 * exactly ONE calendar day when, and only when, that produces a seamless connection to a sheet of
 * the same identity that runs across the operational-day boundary. Nothing is shifted on a guess,
 * and never by anything other than a full day.
 *
 * Two sheets are merged ONLY when all four conditions hold at once:
 *
 *   1. the same normalised line/course identity,
 *   2. sheet A's end connects to sheet B's start (B never begins before A ends),
 *   3. the gap is at most MAX_CONNECTION_GAP_MINUTES,
 *   4. the pair crosses an operational-day boundary.
 *
 * Condition 4 is what separates a documentation break from an ordinary follow-on. Without it, a
 * reinforcement duty or any two sheets that merely happen to abut would be swallowed. There is no
 * heuristic, no tolerance and no nearest-match: a pair that fails any condition stays two circuits.
 *
 * Pure: no I/O, no mutation, no current time, no random.
 */

import { normalizeCircuitIdentity } from './identity-normalization.js';

/** 03:00 — the minute of a calendar day at which a new operational day begins. */
export const OPERATIONAL_DAY_START_MINUTES = 180;
export const OPERATIONAL_DAY_LENGTH_MINUTES = 1440;
/** A seamless connection: at most one minute between the end of one sheet and the start of the next. */
export const MAX_CONNECTION_GAP_MINUTES = 1;

/**
 * Which operational day an absolute minute falls into, counted from the operational day that began
 * at 03:00 of calendar day 0. A time before 03:00 belongs to the PREVIOUS operational day.
 */
export function operationalDayIndexOf(absoluteMinutes) {
  return Math.floor((absoluteMinutes - OPERATIONAL_DAY_START_MINUTES) / OPERATIONAL_DAY_LENGTH_MINUTES);
}

/** The minute inside its own operational day, 0 (03:00) … 1439 (02:59 of the next calendar day). */
export function operationalMinuteOf(absoluteMinutes) {
  const offset = (absoluteMinutes - OPERATIONAL_DAY_START_MINUTES) % OPERATIONAL_DAY_LENGTH_MINUTES;
  return offset < 0 ? offset + OPERATIONAL_DAY_LENGTH_MINUTES : offset;
}

/**
 * The span of one board sheet in absolute minutes, or `null` when it carries no usable time. Both
 * places the loader may put a time are read — the segment itself and its stop events — and neither
 * is recomputed.
 */
function sheetSpan(circulation) {
  const minutes = [];
  for (const segment of (Array.isArray(circulation?.segments) ? circulation.segments : [])) {
    for (const value of [segment?.departure?.normalizedMinutes, segment?.arrival?.normalizedMinutes]) {
      if (typeof value === 'number') minutes.push(value);
    }
    for (const stop of (Array.isArray(segment?.stops) ? segment.stops : [])) {
      const value = stop?.time?.normalizedMinutes;
      if (typeof value === 'number') minutes.push(value);
    }
  }
  if (minutes.length < 2) return null;
  return { from: Math.min(...minutes), to: Math.max(...minutes) };
}

/** The notation-independent route key of a sheet code, or `null` when the notation is unattributable. */
function routeIdentityOf(code) {
  if (typeof code !== 'string' || code.trim() === '') return null;
  try {
    const identity = normalizeCircuitIdentity(code, {})?.routeIdentity ?? null;
    return identity && identity.normalizedKey ? identity : null;
  } catch {
    return null;                                              // an unusable code is never guessed
  }
}

// The span a sheet occupies AFTER the operational-day reconstruction. The raw span is untouched.
function spanOf(entry) {
  return { from: entry.span.from + entry.dayShiftMinutes, to: entry.span.to + entry.dayShiftMinutes };
}

// Conditions 2 + 3: B continues A without a gap worth mentioning and without overlapping it.
function connects(previous, next) {
  const gap = spanOf(next).from - spanOf(previous).to;
  return gap >= 0 && gap <= MAX_CONNECTION_GAP_MINUTES;
}

// Condition 4: the two sheets together cross an operational-day boundary. Inside one operational
// day a seamless follow-on is an ordinary sequence, not a documentation break.
function crossesOperationalDayBoundary(previous, next) {
  return operationalDayIndexOf(spanOf(previous).from) < operationalDayIndexOf(spanOf(next).to);
}

/**
 * Reconstructs the missing day offset of a continuation sheet. The loader reads every sheet on its
 * own, so `03:14` after a circulation that ended at `03:13 (+1)` looks like the early morning of the
 * SAME calendar day and therefore appears to come first.
 *
 * A sheet is lifted by exactly one calendar day only when all of this holds:
 *   - another sheet of the same identity runs ACROSS the operational-day boundary, and
 *   - lifting the candidate makes it connect to that sheet seamlessly (0 or 1 minute).
 *
 * Nothing else is shifted, and never by anything other than a full day.
 */
function reconstructDayShifts(group, warnings) {
  for (const candidate of group) {
    if (candidate.dayShiftMinutes !== 0) continue;
    for (const predecessor of group) {
      if (predecessor === candidate) continue;
      const before = spanOf(predecessor);
      if (operationalDayIndexOf(before.from) >= operationalDayIndexOf(before.to)) continue;   // A stays inside its day
      const gap = candidate.span.from + OPERATIONAL_DAY_LENGTH_MINUTES - before.to;
      if (gap < 0 || gap > MAX_CONNECTION_GAP_MINUTES) continue;
      candidate.dayShiftMinutes = OPERATIONAL_DAY_LENGTH_MINUTES;
      warnings.push({
        code: 'OPERATIONAL_DAY_SHEET_SHIFTED', sheetCode: candidate.code,
        continuationOf: predecessor.code, shiftMinutes: OPERATIONAL_DAY_LENGTH_MINUTES
      });
      break;
    }
  }
}

/**
 * Groups raw Umlauftafel circulations into operational circuits.
 *
 * @param {Array<object>} circulations raw sheets, passed through untouched
 * @returns {{ circuits: Array<{key:string, operationalDay:number, routeIdentity:object,
 *             sheetCodes:string[], sheets:object[], startMinutes:number|null, endMinutes:number|null}>,
 *            warnings: Array<object> }}
 */
export function resolveOperationalCircuits(circulations) {
  const list = Array.isArray(circulations) ? circulations : [];
  const warnings = [];

  // Describe every sheet once: its code, its route identity and its span. Nothing is decided yet.
  const described = list.map((circulation) => {
    const code = circulation?.code == null ? '' : String(circulation.code);
    const span = sheetSpan(circulation);
    const routeIdentity = routeIdentityOf(code);
    const dayShiftMinutes = 0;                                  // reconstructed below, never in the raw data
    if (span === null) warnings.push({ code: 'OPERATIONAL_DAY_TIMES_UNAVAILABLE', sheetCode: code });
    if (routeIdentity === null) warnings.push({ code: 'OPERATIONAL_DAY_IDENTITY_UNAVAILABLE', sheetCode: code });
    return { circulation, code, span, routeIdentity, dayShiftMinutes };
  });

  // A sheet that cannot be described stands alone — it is never a merge candidate.
  const mergeable = described.filter(s => s.span !== null && s.routeIdentity !== null);
  const solitary = described.filter(s => s.span === null || s.routeIdentity === null);

  // Candidates share condition 1. Inside a group, the sheets are read in time order so a
  // continuation can only ever follow its predecessor.
  const byRouteKey = new Map();
  for (const entry of mergeable) {
    const key = entry.routeIdentity.normalizedKey;
    if (!byRouteKey.has(key)) byRouteKey.set(key, []);
    byRouteKey.get(key).push(entry);
  }

  const chains = [];
  for (const group of byRouteKey.values()) {
    reconstructDayShifts(group, warnings);
    const ordered = group.slice().sort((a, b) => spanOf(a).from - spanOf(b).from || a.code.localeCompare(b.code));
    let chain = [ordered[0]];
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = chain[chain.length - 1];
      const next = ordered[i];
      if (connects(previous, next) && crossesOperationalDayBoundary(previous, next)) {
        chain.push(next);
        continue;
      }
      chains.push(chain);
      chain = [next];
    }
    chains.push(chain);
  }

  const circuits = [...chains.map(chain => {
    const startMinutes = spanOf(chain[0]).from;
    const endMinutes = spanOf(chain[chain.length - 1]).to;
    const operationalDay = operationalDayIndexOf(startMinutes);   // a night duty belongs to the day it began on
    if (chain.length > 1) {
      warnings.push({ code: 'OPERATIONAL_DAY_MERGE', sheetCodes: chain.map(s => s.code), operationalDay });
    }
    return {
      key: `OD:${operationalDay}|${chain[0].routeIdentity.normalizedKey}`,
      operationalDay,
      routeIdentity: chain[0].routeIdentity,
      sheetCodes: chain.map(s => s.code),
      sheets: chain.map(s => s.circulation),
      startMinutes,
      endMinutes
    };
  }), ...solitary.map(entry => ({
    key: null,                                                   // no key, no comparability
    operationalDay: entry.span === null ? null : operationalDayIndexOf(entry.span.from),
    routeIdentity: entry.routeIdentity,
    sheetCodes: [entry.code],
    sheets: [entry.circulation],
    startMinutes: entry.span?.from ?? null,
    endMinutes: entry.span?.to ?? null
  }))];

  // Stable, input-independent order: by start, then by the first sheet code.
  circuits.sort((a, b) => (a.startMinutes ?? Infinity) - (b.startMinutes ?? Infinity)
    || String(a.sheetCodes[0]).localeCompare(String(b.sheetCodes[0])));

  return { circuits, warnings };
}
