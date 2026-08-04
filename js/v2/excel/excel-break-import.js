/**
 * Break and interruption data from the legacy Excel plan (Phase 3I.30) — IMPORT ONLY.
 *
 * The rules were already there; the data was not. The Excel path produced no `activityType`
 * and an empty `interruptions` list, so BV010, BV012 and the JNV block-break rule ran blind.
 * This module fills exactly that gap and interprets no rule of its own.
 *
 * TWO DIFFERENT THINGS, DELIBERATELY KEPT APART
 * ---------------------------------------------
 * 1. A SERVICE INTERRUPTION is the gap between one duty leg arriving and the next departing.
 *    It is a structural fact of the plan — no text is parsed, nothing is guessed — and it is
 *    recorded GROSS, exactly as long as the driver is actually interrupted.
 *
 * 2. An UNPAID BREAK (Blockpause) is what the operator DECLARES in the Dienstübersicht's
 *    "Block-pause" column. It is created only from that declaration.
 *
 * WHY THE GROSS GAP IS NOT USED AS THE BREAK (measured, not assumed):
 *   On the real Mo–Fr plan the declared break is consistently SHORTER than the gap it sits in —
 *   by 6 minutes at Teichgraben/Löbdergraben/Holzmarkt and by 4 minutes at Burgaupark. That
 *   difference is walking time. Feeding the gross gap to BV010 would credit the driver with a
 *   break they never had: a 34-minute gap at Holzmarkt is a 28-minute break and must FAIL, but
 *   read gross it would pass. So the gap is reported as an interruption and never as a break.
 *
 * The walking-time surcharge itself stays where Phase 3I.29 put it, in the block-break rule.
 * This module does not know about TGR/LGR/HLZ/BUP and must not.
 *
 * Pure: no I/O, no mutation of its input, no current time, no network, no storage.
 */

/** Headers of the operator's own Dienstübersicht, matched on their real spelling. */
const DECLARED_COLUMNS = Object.freeze({
  serviceNumber: ['dienst-nr.', 'dienst-nr', 'dienstnummer'],
  breakMinutes: ['block-pause', 'blockpause'],
  pauseRule: ['p.-regel', 'p-regel', 'pausenregel'],
  deductionMinutes: ['ab-zug', 'abzug']
});

const text = (value) => String(value ?? '').trim();
const headerKey = (value) => text(value).toLocaleLowerCase('de').replace(/\s+/g, '');

/**
 * Reads a duration in the real `H:MM` form of the Dienstübersicht.
 * An empty cell, a zero and any free text all declare NOTHING — they never become a break.
 *
 * @returns {number|null} minutes, or null when nothing is declared
 */
export function parseDeclaredBreakMinutes(value) {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(text(value));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > 0 ? minutes : null;
}

/** Locates the columns by their HEADER text, so a shifted layout cannot silently misread. */
function locateColumns(rows) {
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const found = {};
    row.forEach((cell, index) => {
      const key = headerKey(cell);
      for (const [field, aliases] of Object.entries(DECLARED_COLUMNS)) {
        if (found[field] === undefined && aliases.includes(key)) found[field] = index;
      }
    });
    if (found.serviceNumber !== undefined && found.breakMinutes !== undefined) return found;
  }
  return null;
}

/**
 * Indexes the declared break data of a Dienstübersicht sheet by service number.
 *
 * @param {unknown[][]} rows the sheet as a row matrix
 * @returns {Map<string, {breakMinutes: number|null, pauseRule: string, deductionMinutes: number|null}>}
 */
export function buildDeclaredBreakIndex(rows) {
  const index = new Map();
  if (!Array.isArray(rows)) return index;
  const columns = locateColumns(rows);
  if (!columns) return index;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const serviceNumber = text(row[columns.serviceNumber]);
    if (!/^\d+$/.test(serviceNumber) || index.has(serviceNumber)) continue;
    const deduction = Number(text(row[columns.deductionMinutes]));
    index.set(serviceNumber, {
      breakMinutes: parseDeclaredBreakMinutes(row[columns.breakMinutes]),
      // Phase 3I.31: the break's OWN evidence — the cell it was read from and the row it sits in.
      // Without it the break would carry the plan row as its source, which is not where it came from.
      rawValue: text(row[columns.breakMinutes]),
      sourceRow: row.map(cell => text(cell)),
      pauseRule: columns.pauseRule === undefined ? '' : text(row[columns.pauseRule]),
      deductionMinutes: Number.isFinite(deduction) && text(row[columns.deductionMinutes]) !== '' ? deduction : null
    });
  }
  return index;
}

const minutesOf = (time) => Number.isInteger(time?.minutesSinceStartOfDay) ? time.minutesSinceStartOfDay : null;

/** Builds the same clock shape the Excel adapter produces, so consumers see one model. */
function clock(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const value = `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  return { raw: value, value, minutesSinceStartOfDay: wrapped };
}

/**
 * Derives the gaps between consecutive legs of one duty. Structural only — a gap exists when
 * the next leg departs after the previous one arrived. Incomplete times yield no interruption
 * rather than a guessed one.
 *
 * @returns {Array<object>} gross service interruptions, in duty order
 */
export function deriveServiceInterruptions(service) {
  const activities = Array.isArray(service?.activities) ? service.activities : [];
  const interruptions = [];

  for (let i = 1; i < activities.length; i++) {
    const previous = activities[i - 1];
    const next = activities[i];
    const from = minutesOf(previous.arrivalTime);
    const to = minutesOf(next.departureTime);
    if (from === null || to === null) continue;

    // A duty may cross midnight; a large negative step is the next operational day, not a
    // negative gap. Anything else that does not move forward is simply no interruption.
    let duration = to - from;
    if (duration < -720) duration += 1440;
    if (duration <= 0) continue;

    interruptions.push({
      id: `excel-interruption:${service.id}:${interruptions.length + 1}`,
      serviceId: service.id,
      serviceNumber: service.serviceNumber,
      start: clock(from),
      end: clock(to),
      durationMinutes: duration,
      startLocation: text(previous.arrivalLocation),
      endLocation: text(next.departureLocation),
      precedingActivityId: previous.id,
      followingActivityId: next.id,
      source: previous.source || null
    });
  }
  return interruptions;
}

/**
 * A duty is worked in one continuous stretch, but the plan prints wall-clock times that wrap at
 * midnight. This walks the legs in printed order and turns their clock values into a strictly
 * rising minute scale, adding a day whenever the clock jumps far backwards. There is no stored
 * `dayOffset` on an Excel activity, so the rollover is derived here — from the SAME rule the
 * interruption derivation above already uses, and nowhere else.
 *
 * @returns {Array<{start: number|null, end: number|null}>} absolute minutes per activity
 */
function absoluteTimeline(activities) {
  let offset = 0;
  let previousStart = null;
  return activities.map(activity => {
    const start = minutesOf(activity.departureTime);
    const end = minutesOf(activity.arrivalTime);
    if (start === null) return { start: null, end: null };
    if (previousStart !== null && start - previousStart < -720) offset += 1440;
    previousStart = start;
    const absoluteStart = start + offset;
    // An arrival before its own departure means the leg itself crosses midnight.
    const absoluteEnd = end === null ? null : (end >= start ? end + offset : end + offset + 1440);
    return { start: absoluteStart, end: absoluteEnd };
  });
}

/**
 * Where the break belongs in the sequence: after every activity that has already ENDED when it
 * begins. Boundary times are shared on purpose — a leg ending at 08:00 and a break beginning at
 * 08:00 must read leg → break, so an end exactly equal to the break's start counts as earlier.
 *
 * @returns {number|null} the insertion index, or null when the times cannot decide
 */
function chronologicalIndex(activities, breakStart) {
  if (!Number.isInteger(breakStart)) return null;
  const timeline = absoluteTimeline(activities);
  if (timeline.some(entry => entry.end === null)) return null;
  return timeline.filter(entry => entry.end <= breakStart).length;
}

/** Creates the unpaidBreak activity for a declared break inside its interruption window. */
function declaredBreakActivity(service, interruption, declared, ordinal) {
  const start = interruption.start.minutesSinceStartOfDay;
  return {
    id: `excel-break:${service.id}:${ordinal}`,
    serviceId: service.id,
    serviceNumber: service.serviceNumber,
    activityType: 'unpaidBreak',
    circuitNumber: '',
    departureTime: clock(start),
    arrivalTime: clock(start + declared.breakMinutes),
    departureLocation: interruption.startLocation,
    arrivalLocation: interruption.startLocation,
    rawActivity: declared.rawValue,
    declaredMinutes: declared.breakMinutes,
    declaredPauseRule: declared.pauseRule,
    declaredDeductionMinutes: declared.deductionMinutes,
    interruptionId: interruption.id,
    originalText: declared.rawValue,
    boundingBox: null,
    source: {
      sourceType: 'excel',
      fileName: interruption.source?.fileName || '',
      sheetName: 'Dienstübersicht',
      rowNumber: null,
      rawCells: declared.sourceRow || []
    }
  };
}

/**
 * Enriches a finished Excel CanonicalSchedule with its interruptions and, where the operator
 * declares one, an explicit unpaid break. ADDITIVE and non-mutating: the input schedule keeps
 * its own arrays and a new schedule is returned.
 *
 * @param {object} schedule a CanonicalSchedule from the Excel adapter
 * @param {{dienstuebersichtRows?: unknown[][]}} [options] the operator's Dienstübersicht sheet
 * @returns {object} a new CanonicalSchedule
 */
export function attachExcelBreakData(schedule, options = {}) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');

  const declaredBreaks = buildDeclaredBreakIndex(options.dienstuebersichtRows);
  const warnings = [...(schedule.warnings || [])];
  const interruptions = [];

  const services = (schedule.services || []).map(service => {
    const own = deriveServiceInterruptions(service);
    interruptions.push(...own);

    const declared = declaredBreaks.get(text(service.serviceNumber));
    const activities = [...(service.activities || [])];

    if (declared?.breakMinutes) {
      // The break belongs in the longest interruption of the duty — the only window that can
      // hold it. Without a window there is nowhere to place it, and none is invented.
      const window = own.reduce((longest, gap) => !longest || gap.durationMinutes > longest.durationMinutes ? gap : longest, null);
      if (!window) {
        warnings.push({ code: 'EXCEL_BREAK_WITHOUT_INTERRUPTION', severity: 'warning', message: '', scope: 'service' });
      } else {
        if (declared.breakMinutes > window.durationMinutes) {
          warnings.push({ code: 'EXCEL_BREAK_EXCEEDS_INTERRUPTION', severity: 'warning', message: '', scope: 'service' });
        }
        // Phase 3I.33: the break takes its place in TIME. Appending it left every duty ending with
        // its own break, which made BV003 read the break's location as the duty's end.
        const breakActivity = declaredBreakActivity(service, window, declared, 1);
        const timeline = absoluteTimeline(service.activities || []);
        const anchor = (service.activities || []).findIndex(a => a.id === window.precedingActivityId);
        const breakStart = anchor >= 0 ? timeline[anchor]?.end ?? null : null;
        const index = chronologicalIndex(service.activities || [], breakStart);
        if (index === null) {
          // No position may be invented. The break stays at the end — deterministic and
          // conservative — and the fact that it could not be placed is stated, not hidden.
          warnings.push({ code: 'EXCEL_BREAK_ORDER_UNRESOLVED', severity: 'warning', message: '', scope: 'service' });
          activities.push(breakActivity);
        } else {
          activities.splice(index, 0, breakActivity);
        }
      }
    }
    return { ...service, activities, interruptions: own };
  });

  const activities = services.flatMap(service => service.activities);
  return {
    ...schedule,
    services,
    activities,
    interruptions,
    warnings,
    metadata: {
      ...schedule.metadata,
      activityCount: activities.length,
      interruptionCount: interruptions.length
    }
  };
}
