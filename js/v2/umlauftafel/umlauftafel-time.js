/**
 * Pure Umlauftafel time-sequence normalization (Phase 3B.2).
 *
 * Operates on ALREADY-extracted clock strings (no file access). The input order is
 * the professional sequence. A clock value smaller than the previous one is treated
 * as a midnight crossing ONLY when the apparent backward jump is large enough to be
 * a real day change; a small backward step is a likely data error and is flagged
 * (IMPLAUSIBLE_TIME_SEQUENCE) instead of being rolled. Multiple crossings supported.
 *
 * Pure, deterministic, no mutation of inputs, no Date.now()/Math.random(), no I/O.
 */

import { createNormalizedTime, createUmlauftafelWarning, TIME_CONFIDENCE, WARNING_CODES, WARNING_SEVERITIES, WARNING_SCOPES } from './umlauftafel-contract.js';

// A real midnight crossing produces a large apparent backward jump (e.g. 23:45→00:12
// ≈ 1413 min back). A small backward step (e.g. 08:00→07:59) would imply a ~24h jump
// and is therefore treated as implausible rather than a day change. Documented,
// conservative threshold (12 h); can be tuned once real layouts are wired (Phase 3C).
export const ROLLOVER_THRESHOLD_MINUTES = 720;

const CLOCK_RE = /^(\d{1,2}):(\d{2})$/;

function parseClock(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(CLOCK_RE);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, clock: hour * 60 + minute };
}

/**
 * @param {Array<{raw:string, role?:string}>} entries
 * @returns {{times: object[], warnings: object[]}}
 */
export function normalizeUmlauftafelTimeSequence(entries) {
  const times = [];
  const warnings = [];
  const list = Array.isArray(entries) ? entries : [];

  let dayOffset = 0;
  let previousClock = null;

  list.forEach((entry, index) => {
    const raw = entry && typeof entry === 'object' ? entry.raw : entry;
    const role = entry && typeof entry === 'object' && entry.role ? entry.role : undefined;
    const parsed = parseClock(raw);

    if (!parsed) {
      times.push(createNormalizedTime({ raw, hour: null, minute: null, dayOffset, role, confidence: TIME_CONFIDENCE.UNKNOWN }));
      warnings.push(createUmlauftafelWarning({ code: WARNING_CODES.INVALID_TIME, severity: WARNING_SEVERITIES.WARNING, scope: WARNING_SCOPES.TIME, source: { row: index } }));
      return; // do not advance previousClock on an unreadable value
    }

    let confidence = TIME_CONFIDENCE.EXACT;
    if (previousClock !== null && parsed.clock < previousClock) {
      const apparentBackward = previousClock - parsed.clock;
      if (apparentBackward >= ROLLOVER_THRESHOLD_MINUTES) {
        dayOffset += 1;
        confidence = TIME_CONFIDENCE.INFERRED_ROLLOVER;
      } else {
        // small backward step: do NOT roll a whole day; flag as implausible
        warnings.push(createUmlauftafelWarning({ code: WARNING_CODES.IMPLAUSIBLE_TIME_SEQUENCE, severity: WARNING_SEVERITIES.WARNING, scope: WARNING_SCOPES.TIME, source: { row: index } }));
      }
    }

    times.push(createNormalizedTime({ raw, hour: parsed.hour, minute: parsed.minute, dayOffset, role, confidence }));
    previousClock = parsed.clock;
  });

  return { times, warnings };
}
