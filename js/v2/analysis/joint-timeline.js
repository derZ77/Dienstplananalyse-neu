/**
 * Deterministic joint timeline (Phase 3H.1) — DATA ONLY.
 *
 * Given a JNV structural match, it produces a joint view between the CanonicalSchedule and the
 * Umlauftafel. It computes NO operational rule evaluation of any kind, no scores, no
 * recommendations, and no thresholds — only structural data and neutral counts. Pure,
 * non-mutating, no storage, no network, no current time, no random.
 *
 * Phase 3I.19 — the DATA BRIDGE. Three things kept the real JNV chain from ever arriving here:
 *
 *   1. only a PDF duty roster was admitted, although the Excel import produces an equally
 *      complete CanonicalSchedule;
 *   2. a document-level `exact` match was demanded, although the per-circulation filter below
 *      already is that gate — one ambiguous circulation must not silence twenty-five good ones;
 *   3. the circulation was looked up by the SCHEDULE's code, so a match found through the
 *      notation normalisation (`18/1` ↔ `18100`) never found its board sheet, and
 *      the segments were taken from the schedule's activities while the Umlauftafel — the only
 *      place the individual trips exist — served merely as an existence check.
 *
 * Phase 3I.22 — the entry is an OPERATIONAL CIRCUIT, not a board sheet. A night circulation that
 * the documentation broke across the 03:00 boundary onto two sheets is ONE entry here, carrying the
 * segments of both sheets in one time order. Nothing is normalised here either: the grouping comes
 * from the layer that Phase 3I.21 already proved, and the raw sheets stay untouched.
 *
 * The bridge adds NO professional logic: segment kinds are a closed projection of the existing
 * segment vocabulary, times are read from what the loader already normalised, and a board sheet
 * without usable times still falls back to the schedule exactly as before.
 */

import { resolveOperationalCircuits } from '../identity/operational-circuit-identity.js';

const KIND = Object.freeze({ SERVICE: 'service', DEADHEAD: 'deadhead', LAYOVER: 'layover', BREAK: 'break', UNKNOWN: 'unknown' });

// Both duty-roster document types the import really produces. The Umlauftafel side is unchanged.
const SCHEDULE_DOCUMENT_TYPES = new Set(['jnv_schedule_pdf', 'legacy_excel_schedule']);

// Closed projection of the FROZEN Umlauftafel segment vocabulary onto the segment kinds — a
// rename of an existing classification, not a new one. Everything else stays `unknown`.
const SEGMENT_TYPE_TO_KIND = Object.freeze({ service_trip: KIND.SERVICE, deadhead: KIND.DEADHEAD });

// Closed, deterministic projection of the FROZEN hardening `dutyKind` onto the segment kind
// vocabulary — a rename/projection of an already-computed classification, no new heuristic.
// `layover`/`break` remain reserved (not derived here).
const DUTY_KIND_TO_KIND = Object.freeze({ serviceDrive: KIND.SERVICE, depotDuty: KIND.DEADHEAD });
const kindOf = (dutyKind) => DUTY_KIND_TO_KIND[dutyKind] || KIND.UNKNOWN;

const notApplicable = (code) => ({ metadata: null, circulations: [], warnings: [{ code }] });

// Prefer the hardened duty activities (they carry dayOffset + dutyKind); fall back to base.
function scheduleServices(canonicalSchedule) {
  const hardened = canonicalSchedule?.hardened;
  if (hardened?.applied && Array.isArray(hardened.services)) {
    return hardened.services.map(s => ({ serviceNumber: s.serviceNumber, activities: s.dutyActivities || [] }));
  }
  return (Array.isArray(canonicalSchedule?.services) ? canonicalSchedule.services : [])
    .map(s => ({ serviceNumber: s.serviceNumber, activities: s.activities || [] }));
}

const absMinutes = (t) => (t && typeof t.minutesSinceStartOfDay === 'number') ? (t.dayOffset ?? 0) * 1440 + t.minutesSinceStartOfDay : null;

function toSegment(activity, serviceNumber, activityIndex) {
  const dep = activity.departureTime || {};
  const arr = activity.arrivalTime || {};
  const depAbs = absMinutes(dep), arrAbs = absMinutes(arr);
  const identity = activity.routeIdentity || {};
  return {
    serviceNumber: serviceNumber == null ? null : String(serviceNumber),
    line: identity.line ?? null,
    course: identity.course ?? null,
    trip: identity.trip ?? null,
    departure: dep.value ?? null,
    arrival: arr.value ?? null,
    dayOffset: typeof dep.dayOffset === 'number' ? dep.dayOffset : 0,
    durationMinutes: (depAbs != null && arrAbs != null && arrAbs >= depAbs) ? arrAbs - depAbs : null,
    source: { serviceNumber: serviceNumber == null ? null : String(serviceNumber), activityIndex, sourceType: activity.source?.sourceType ?? 'pdf' },
    kind: kindOf(activity.dutyKind)
  };
}

const hhmm = (minutes) => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * The board's operational circuits plus, per sheet, the day offset the layer reconstructed. The
 * offset is derived from the circuit's own span — the layer already resolved it, this only reads
 * back which sheet had to move.
 */
function operationalIndex(circulations) {
  const { circuits } = resolveOperationalCircuits(circulations);
  const shiftBySheetCode = new Map();
  for (const circuit of circuits) {
    for (const [index, sheetCode] of circuit.sheetCodes.entries()) {
      const raw = rawSheetSpan(circuit.sheets[index]);
      // A merged continuation starts after its predecessor; the difference to its raw start is the
      // whole-day offset the layer applied. A sheet that was not moved yields 0.
      let shift = 0;
      if (raw !== null && index > 0) {
        const previousRaw = rawSheetSpan(circuit.sheets[index - 1]);
        if (previousRaw !== null && raw.from < previousRaw.to) shift = 1440 * Math.ceil((previousRaw.to - raw.from) / 1440);
      }
      shiftBySheetCode.set(String(sheetCode), shift);
    }
  }
  return { circuits, shiftBySheetCode };
}

/** The raw span of a board sheet, read exactly as the operational-day layer reads it. */
function rawSheetSpan(circulation) {
  const minutes = [];
  for (const segment of (Array.isArray(circulation?.segments) ? circulation.segments : [])) {
    for (const value of [segment?.departure?.normalizedMinutes, segment?.arrival?.normalizedMinutes]) {
      if (typeof value === 'number') minutes.push(value);
    }
    for (const stop of (Array.isArray(segment?.stops) ? segment.stops : [])) {
      if (typeof stop?.time?.normalizedMinutes === 'number') minutes.push(stop.time.normalizedMinutes);
    }
  }
  return minutes.length < 2 ? null : { from: Math.min(...minutes), to: Math.max(...minutes) };
}

/**
 * The span of an Umlauftafel segment in absolute minutes, or `null` when it carries no usable
 * pair of times. The loader normalises the times either onto the segment itself or onto its stop
 * events — both are read, neither is recomputed.
 */
function boardSegmentSpan(segment) {
  const direct = [segment?.departure?.normalizedMinutes, segment?.arrival?.normalizedMinutes].filter(v => typeof v === 'number');
  const times = direct.length === 2 ? direct : (segment?.stops || []).map(s => s?.time?.normalizedMinutes).filter(v => typeof v === 'number');
  if (times.length < 2) return null;
  const from = Math.min(...times), to = Math.max(...times);
  return to >= from ? { from, to } : null;
}

/**
 * The duty that drives a board segment: the ONE roster activity whose window contains it. No
 * tolerance and no nearest-match — an unattributable segment simply keeps `null`.
 */
function attributeService(span, entries) {
  const hits = entries.filter(e => {
    const from = absMinutes(e.activity.departureTime), to = absMinutes(e.activity.arrivalTime);
    return from != null && to != null && span.from >= from && span.to <= to;
  });
  return hits.length === 1 ? (hits[0].serviceNumber == null ? null : String(hits[0].serviceNumber)) : null;
}

/**
 * The individual trips of the matched Umlauftafel circulation, in the joint-timeline segment
 * shape and ordered by departure. Empty when the board sheet carries no usable times — the
 * caller then falls back to the schedule's activities (the pre-3I.19 behaviour). `dayShiftMinutes`
 * is the offset the operational-day layer reconstructed for a continuation sheet (Phase 3I.22);
 * it is applied to the projection here and never written back into the document.
 */
function umlauftafelSegments(circulation, scheduleEntries, dayShiftMinutes = 0) {
  const segments = [];
  for (const segment of (Array.isArray(circulation?.segments) ? circulation.segments : [])) {
    const raw = boardSegmentSpan(segment);
    if (raw === null) continue;
    const span = { from: raw.from + dayShiftMinutes, to: raw.to + dayShiftMinutes };
    const serviceNumber = attributeService(span, scheduleEntries);
    segments.push({
      serviceNumber,
      line: segment?.line ?? null,
      course: null,
      trip: segment?.tripId ?? null,
      departure: hhmm(span.from),
      arrival: hhmm(span.to),
      dayOffset: Math.floor(span.from / 1440),
      durationMinutes: span.to - span.from,
      source: { serviceNumber, activityIndex: null, sourceType: 'umlauftafel', sequence: segment?.sequence ?? null },
      kind: SEGMENT_TYPE_TO_KIND[segment?.type] || KIND.UNKNOWN
    });
  }
  return segments.sort((a, b) => (a.dayOffset * 1440 + toMinutes(a.departure)) - (b.dayOffset * 1440 + toMinutes(b.departure)));
}

const toMinutes = (value) => { const m = /^(\d{2}):(\d{2})$/.exec(value || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

function statistics(servicesSet, segments) {
  const sum = (predicate) => segments.filter(predicate).reduce((total, s) => total + (s.durationMinutes || 0), 0);
  const drivingMinutes = sum(s => s.kind === KIND.SERVICE);
  const nonDrivingMinutes = sum(s => s.kind !== KIND.SERVICE);
  return { serviceCount: servicesSet.size, segmentCount: segments.length, drivingMinutes, nonDrivingMinutes, totalMinutes: drivingMinutes + nonDrivingMinutes };
}

/**
 * @param {{ bundle:object, canonicalSchedule:object, umlauftafelDocument:object, matchResult:object }} input
 * @returns {{ metadata:object|null, circulations:object[], warnings:object[] }}
 */
export function createJointTimeline({ bundle, canonicalSchedule, umlauftafelDocument, matchResult } = {}) {
  // Gate — an exact JNV duty roster + Umlaufkarte bundle whose match is not a proven contradiction.
  if (bundle?.compatibility?.status !== 'exact') return notApplicable('BUNDLE_NOT_EXACT');
  if (!SCHEDULE_DOCUMENT_TYPES.has(bundle?.primary?.documentType) || bundle?.companion?.documentType !== 'umlaufkarte') return notApplicable('JOINT_TIMELINE_NOT_APPLICABLE');
  if (matchResult?.status === 'conflicting') return notApplicable('MATCH_CONFLICTING');
  if (!matchResult || typeof matchResult !== 'object' || !Array.isArray(matchResult.matches)) return notApplicable('MATCH_NOT_EXACT');
  if (!canonicalSchedule || typeof canonicalSchedule !== 'object') return notApplicable('MISSING_CANONICAL_SCHEDULE');
  if (!umlauftafelDocument || typeof umlauftafelDocument !== 'object') return notApplicable('MISSING_UMLAUFTAFEL_DOCUMENT');

  const warnings = [];
  // Only an individually EXACT match contributes data (see the loop below) — but a document whose
  // aggregate is weaker still says so, so nobody reads the result as fully confirmed.
  if (matchResult.status !== 'exact') warnings.push({ code: 'MATCH_NOT_FULLY_EXACT', matchStatus: matchResult.status });

  // Group the schedule's activities by exact-string Umlauf code.
  const byCode = new Map(); // code → { services:Set, entries:[{activity, serviceNumber, activityIndex}] }
  for (const service of scheduleServices(canonicalSchedule)) {
    (service.activities || []).forEach((activity, activityIndex) => {
      const code = activity?.circuitNumber == null ? '' : String(activity.circuitNumber).trim();
      if (!code) return;
      if (!byCode.has(code)) byCode.set(code, { services: new Set(), entries: [] });
      const group = byCode.get(code);
      if (service.serviceNumber != null) group.services.add(String(service.serviceNumber));
      group.entries.push({ activity, serviceNumber: service.serviceNumber, activityIndex });
    });
  }

  const circulationsByCode = new Map();
  for (const circulation of (umlauftafelDocument.circulations || [])) {
    circulationsByCode.set(circulation?.code == null ? '' : String(circulation.code), circulation);
  }
  // The operational circuits of the board. Every sheet belongs to exactly one of them; a sheet that
  // was never merged is a circuit of its own, so the single-sheet case is unchanged.
  const { circuits: operationalCircuits, shiftBySheetCode } = operationalIndex(umlauftafelDocument.circulations);
  const circuitBySheetCode = new Map();
  for (const circuit of operationalCircuits) {
    for (const sheetCode of circuit.sheetCodes) circuitBySheetCode.set(String(sheetCode), circuit);
  }
  const seen = new Set();

  const circulations = [];
  for (const match of (matchResult.matches || [])) {
    if (match.status !== 'exact') continue;
    for (const scheduleCode of (match.primaryRefs || [])) {
      // The board is reached through the COMPANION reference — with a normalised match the two
      // sides carry different notations (`18/1` on the roster, `18100` on the board), and a merged
      // night circulation names ALL its sheets.
      const boardCode = (match.companionRefs || []).map(String).find(ref => circulationsByCode.has(ref))
        ?? (circulationsByCode.has(scheduleCode) ? scheduleCode : null);
      if (boardCode === null) { warnings.push({ code: 'MATCHED_CODE_NOT_IN_UMLAUFTAFEL', umlaufCode: scheduleCode }); continue; }
      const circuit = circuitBySheetCode.get(boardCode) ?? { sheetCodes: [boardCode], sheets: [circulationsByCode.get(boardCode)] };
      if (seen.has(circuit.sheetCodes[0])) continue;
      seen.add(circuit.sheetCodes[0]);
      const group = byCode.get(scheduleCode);
      if (!group) { warnings.push({ code: 'MATCHED_CODE_NOT_IN_SCHEDULE', umlaufCode: scheduleCode }); continue; }

      const orderedByDep = group.entries.slice().sort((a, b) => (absMinutes(a.activity.departureTime) ?? Infinity) - (absMinutes(b.activity.departureTime) ?? Infinity));
      // The segments of EVERY sheet of the circuit, in one time order. The day offset a continuation
      // sheet is missing comes from the layer — it is applied here, never written back.
      const boardSegments = circuit.sheets
        .flatMap((s, i) => umlauftafelSegments(s, orderedByDep, shiftBySheetCode.get(String(circuit.sheetCodes[i])) ?? 0))
        .sort((a, b) => (a.dayOffset * 1440 + toMinutes(a.departure)) - (b.dayOffset * 1440 + toMinutes(b.departure)));
      const fromBoard = boardSegments.length > 0;
      const segments = fromBoard ? boardSegments : orderedByDep.map(e => toSegment(e.activity, e.serviceNumber, e.activityIndex));
      const code = String(circuit.sheetCodes[0]);
      warnings.push({ code: fromBoard ? 'SEGMENTS_FROM_UMLAUFTAFEL' : 'SEGMENTS_FROM_SCHEDULE', umlaufCode: code, segmentCount: segments.length });
      if (circuit.sheetCodes.length > 1) warnings.push({ code: 'OPERATIONAL_CIRCUIT_SEGMENTS_JOINED', umlaufCode: code, sheetCodes: circuit.sheetCodes.map(String) });

      const first = orderedByDep[0]?.activity;
      const last = group.entries.slice().sort((a, b) => (absMinutes(a.activity.arrivalTime) ?? -Infinity) - (absMinutes(b.activity.arrivalTime) ?? -Infinity)).pop()?.activity;

      circulations.push({
        code,
        scheduleCode,
        boardCodes: circuit.sheetCodes.map(String),
        services: [...group.services].sort(),
        segments,
        start: fromBoard ? { time: segments[0].departure, dayOffset: segments[0].dayOffset } : { time: first?.departureTime?.value ?? null, dayOffset: first?.departureTime?.dayOffset ?? 0 },
        end: fromBoard ? { time: segments[segments.length - 1].arrival, dayOffset: segments[segments.length - 1].dayOffset } : { time: last?.arrivalTime?.value ?? null, dayOffset: last?.arrivalTime?.dayOffset ?? 0 },
        statistics: statistics(group.services, segments)
      });
    }
  }

  const validity = umlauftafelDocument.validity || {};
  return {
    metadata: {
      serviceRegime: typeof validity.serviceRegime === 'string' ? validity.serviceRegime : 'unknown',
      dayType: typeof validity.dayType === 'string' ? validity.dayType : 'unknown',
      generatedFrom: 'jnv-structural-exact-match',
      circulationCount: circulations.length
    },
    circulations,
    warnings
  };
}
