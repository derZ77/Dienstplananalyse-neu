/**
 * JNV turnaround CANDIDATE detection (Phase 3I.3) — DATA PROJECTION ONLY.
 *
 * Finds trip-to-trip transitions inside one circulation and projects the agreed crediting
 * contract onto them (below the minimum span nothing is credited, from the minimum span the full
 * observed span counts, the technical minute is never deducted). It evaluates NO operational rule:
 * it computes no quota, no sum, no required amount and no outcome — a candidate only states that a
 * transition exists, how long it lasted and how confident the detection is.
 *
 * Times come from the stop events of a segment (`stops[].time.normalizedMinutes`, already carrying
 * the day offset); the segment-level departure/arrival fields are not populated by the productive
 * loader. Only DIRECTLY adjacent service trips form a transition, so a deadhead, depot move or
 * unknown segment in between prevents a candidate instead of silently bridging it.
 *
 * Pure, dependency-free, non-mutating: no storage, no network, no current time, no random.
 */

export const TURNAROUND_STATUSES = Object.freeze(['complete', 'partial', 'inconclusive', 'not_applicable']);
export const TURNAROUND_SOURCES = Object.freeze(['umlauftafel', 'schedule_structured', 'schedule_fallback']);
export const TURNAROUND_CONFIDENCE = Object.freeze(['exact', 'probable', 'ambiguous']);
export const TURNAROUND_ELIGIBILITY = Object.freeze(['qualified', 'below_minimum', 'unresolved']);

export const TURNAROUND_WARNINGS = Object.freeze([
  'INVALID_TURNAROUND_INPUT',
  'MISSING_SEGMENT_TIME',
  'OVERLAPPING_TRIPS',
  'AMBIGUOUS_NEXT_TRIP',
  'LOCATION_MISMATCH',
  'DEPOT_TRANSITION_NOT_CREDITABLE',
  'DEADHEAD_BETWEEN_TRIPS',
  'DUPLICATE_TURNAROUND_CANDIDATE',
  'FALLBACK_DATA_INSUFFICIENT'
]);

// The crediting contract of the confirmed JNV rule set (jnv-one-sixth.v1.json). Passed in so the
// detector never hard-codes an operational threshold.
export const DEFAULT_TURNAROUND_CREDITING = Object.freeze({ minimumObservedSpanMinutes: 11, belowMinimumCreditedMinutes: 0 });

const SERVICE_TRIP = 'service_trip';
const DEADHEAD = 'deadhead';

const minutesOf = (time) => (time && typeof time.normalizedMinutes === 'number') ? time.normalizedMinutes : null;
const isRollover = (time) => time?.confidence === 'inferred_rollover';
const stopsOf = (segment) => (Array.isArray(segment?.stops) ? segment.stops : []);
// The transition anchors are the trip's OWN end and the next trip's OWN start. If that stop
// carries no time the transition stays unknown — an earlier/later stop is never substituted,
// because that would invent a start or end of the turnaround.
const arrivalStopOf = (segment) => { const stops = stopsOf(segment); const stop = stops.length ? stops[stops.length - 1] : null; return minutesOf(stop?.time) == null ? null : stop; };
const departureStopOf = (segment) => { const stop = stopsOf(segment)[0] ?? null; return minutesOf(stop?.time) == null ? null : stop; };
const segmentRef = (segment, circulationCode) => ({ circulationCode, sequence: segment?.sequence ?? null, type: segment?.type ?? null, line: segment?.line ?? null });

const emptyResult = (status, warnings = []) => ({
  status,
  candidates: [],
  warnings,
  statistics: { candidateCount: 0, qualifiedCount: 0, belowMinimumCount: 0, unresolvedCount: 0, circulationCount: 0, inspectedTransitionCount: 0 }
});

/**
 * @param {{ umlauftafelDocument?: object, scheduleView?: object, sourcePriority?: string[],
 *           crediting?: {minimumObservedSpanMinutes:number, belowMinimumCreditedMinutes:number} }} input
 * @returns {{ status: string, candidates: object[], warnings: object[], statistics: object }}
 */
export function detectTurnaroundCandidates({ umlauftafelDocument, scheduleView, sourcePriority, crediting = DEFAULT_TURNAROUND_CREDITING } = {}) {
  const priority = Array.isArray(sourcePriority) && sourcePriority.length ? sourcePriority : TURNAROUND_SOURCES;

  // Source priority: the Umlauftafel wins; the schedule is only consulted when no usable
  // Umlauftafel exists, so the same transition is never counted twice.
  const umlauftafelUsable = priority.includes('umlauftafel')
    && umlauftafelDocument && typeof umlauftafelDocument === 'object'
    && Array.isArray(umlauftafelDocument.circulations) && umlauftafelDocument.circulations.length > 0;

  if (umlauftafelUsable) return detectFromUmlauftafel(umlauftafelDocument, crediting);
  if (scheduleView && typeof scheduleView === 'object') {
    // The schedule fallback needs structured driving activities; that contract is not established
    // yet (see the phase report), so it reports insufficient data instead of guessing.
    return emptyResult('inconclusive', [{ code: 'FALLBACK_DATA_INSUFFICIENT' }]);
  }
  return emptyResult('not_applicable', [{ code: 'INVALID_TURNAROUND_INPUT' }]);
}

function detectFromUmlauftafel(document, crediting) {
  const minimum = crediting?.minimumObservedSpanMinutes ?? DEFAULT_TURNAROUND_CREDITING.minimumObservedSpanMinutes;
  const belowCredit = crediting?.belowMinimumCreditedMinutes ?? DEFAULT_TURNAROUND_CREDITING.belowMinimumCreditedMinutes;

  const candidates = [];
  const warnings = [];
  const seenIds = new Set();
  let inspected = 0;
  let missingTime = 0;

  for (const circulation of document.circulations) {
    const code = circulation?.code == null ? '' : String(circulation.code);
    const segments = Array.isArray(circulation?.segments) ? circulation.segments : [];

    for (let i = 1; i < segments.length; i += 1) {
      const previous = segments[i - 1];
      const next = segments[i];

      // A non-trip segment between two trips is NOT bridged: it breaks the transition.
      if (previous?.type === DEADHEAD || next?.type === DEADHEAD) {
        warnings.push({ code: previous?.type === DEADHEAD && next?.type !== DEADHEAD ? 'DEPOT_TRANSITION_NOT_CREDITABLE' : 'DEADHEAD_BETWEEN_TRIPS', circulationCode: code });
        continue;
      }
      if (previous?.type !== SERVICE_TRIP || next?.type !== SERVICE_TRIP) continue;

      inspected += 1;
      const arrival = arrivalStopOf(previous);
      const departure = departureStopOf(next);
      if (!arrival || !departure) {
        missingTime += 1;
        warnings.push({ code: 'MISSING_SEGMENT_TIME', circulationCode: code });
        continue;
      }

      const startMinutes = minutesOf(arrival.time);
      const endMinutes = minutesOf(departure.time);
      if (endMinutes < startMinutes) {
        warnings.push({ code: 'OVERLAPPING_TRIPS', circulationCode: code });
        continue;
      }

      const id = `${code}#${previous.sequence ?? i - 1}->${next.sequence ?? i}`;
      if (seenIds.has(id)) {
        warnings.push({ code: 'DUPLICATE_TURNAROUND_CANDIDATE', circulationCode: code });
        continue;
      }
      seenIds.add(id);

      const observedSpanMinutes = endMinutes - startMinutes;
      const qualified = observedSpanMinutes >= minimum;
      const candidateWarnings = [];

      // Confidence: an identical endpoint plus an inferred-free time sequence is exact; a
      // differing or unknown location, or an inferred day rollover, only reaches probable.
      let confidence = 'exact';
      const sameLocation = Boolean(arrival.name) && Boolean(departure.name) && arrival.name === departure.name;
      if (!sameLocation) {
        confidence = 'probable';
        candidateWarnings.push('LOCATION_MISMATCH');
        warnings.push({ code: 'LOCATION_MISMATCH', circulationCode: code });
      }
      if (isRollover(arrival.time) || isRollover(departure.time)) confidence = 'probable';

      candidates.push({
        id,
        circulationCode: code,
        previousSegmentRef: segmentRef(previous, code),
        nextSegmentRef: segmentRef(next, code),
        startMinutes,
        endMinutes,
        observedSpanMinutes,
        creditedMinutes: qualified ? observedSpanMinutes : belowCredit,
        source: 'umlauftafel',
        confidence,
        eligibility: qualified ? 'qualified' : 'below_minimum',
        warnings: candidateWarnings
      });
    }
  }

  const qualifiedCount = candidates.filter(c => c.eligibility === 'qualified').length;
  const belowMinimumCount = candidates.filter(c => c.eligibility === 'below_minimum').length;
  const unresolvedCount = candidates.filter(c => c.eligibility === 'unresolved').length;

  let status = 'complete';
  if (!candidates.length && missingTime > 0) status = 'inconclusive';
  else if (missingTime > 0 || warnings.length > 0) status = 'partial';
  if (!candidates.length && !missingTime && !inspected) status = 'not_applicable';

  return {
    status,
    candidates,
    warnings,
    statistics: {
      candidateCount: candidates.length,
      qualifiedCount,
      belowMinimumCount,
      unresolvedCount,
      circulationCount: document.circulations.length,
      inspectedTransitionCount: inspected
    }
  };
}
