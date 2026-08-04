/**
 * Neutral driving / interruption projection (Phase 3H.2) — DATA ONLY.
 *
 * Projects a valid joint timeline into driving segments, contiguous driving blocks,
 * interruption intervals, computed non-driving intervals (including plain temporal gaps),
 * and neutral statistics. It applies NO operational rule evaluation, no thresholds, no
 * violations, no recommendations, no scoring. A mere temporal gap is never treated as a
 * pause or interruption. Absolute minutes are read from the joint timeline's already-
 * normalized `departure` value + `dayOffset` + `durationMinutes` (no second normalization).
 * Pure, non-mutating, no storage, no network, no current time, no random.
 */

const DRIVING_KINDS = new Set(['service', 'deadhead']);
const NON_DRIVING_CLASSIFICATION = { break: 'break', layover: 'layover' };
const HHMM = /^(\d{1,2}):(\d{2})$/;

const notApplicable = (code) => ({ metadata: null, circulations: [], warnings: [{ code }] });
const smallRef = (source) => ({ serviceNumber: source?.serviceNumber ?? null, activityIndex: source?.activityIndex ?? null, sourceType: source?.sourceType ?? null });

function startMinutesOf(segment) {
  if (typeof segment.departure !== 'string') return null;
  const m = segment.departure.match(HHMM);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (typeof segment.dayOffset === 'number' ? segment.dayOffset : 0) * 1440;
}

// An already known duty start in absolute minutes, or `null`. Nothing is derived here: a value is
// either handed in as a non-negative finite number or it stays unknown (Phase 3I.10).
const knownDutyStart = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * @param {{ jointTimeline: object, interruptions?: Array<{serviceNumber, startMinutes?, endMinutes?, durationMinutes?}>,
 *           dutyStartMinutes?: number|null }} input
 *   `dutyStartMinutes` is the duty start the caller already knows (Phase 3I.10). It is only
 *   forwarded onto the metadata — never computed, and never taken from a trip.
 * @returns {{ metadata: object|null, circulations: object[], warnings: object[] }}
 */
export function createDrivingProjection({ jointTimeline, interruptions = [], dutyStartMinutes = null } = {}) {
  if (!jointTimeline || typeof jointTimeline !== 'object' || jointTimeline.metadata == null || !Array.isArray(jointTimeline.circulations)) {
    return notApplicable('INVALID_JOINT_TIMELINE');
  }

  const interruptionsByService = new Map();
  for (const it of (Array.isArray(interruptions) ? interruptions : [])) {
    const key = it?.serviceNumber == null ? '' : String(it.serviceNumber);
    if (!interruptionsByService.has(key)) interruptionsByService.set(key, []);
    interruptionsByService.get(key).push(it);
  }

  const circulations = jointTimeline.circulations.map(c => projectCirculation(c, interruptionsByService));
  const v = jointTimeline.metadata;
  return {
    metadata: { serviceRegime: v.serviceRegime, dayType: v.dayType, dutyStartTime: knownDutyStart(dutyStartMinutes), generatedFrom: 'driving-projection', circulationCount: circulations.length },
    circulations,
    warnings: []
  };
}

function projectCirculation(circulation, interruptionsByService) {
  const code = circulation?.code == null ? '' : String(circulation.code);
  const warnings = [];
  const rawSegments = Array.isArray(circulation?.segments) ? circulation.segments : [];

  // Enrich with absolute minutes (read from already-normalized value + dayOffset + durationMinutes).
  const enriched = rawSegments.map((segment, index) => {
    const startMinutes = startMinutesOf(segment);
    const dur = typeof segment.durationMinutes === 'number' ? segment.durationMinutes : null;
    const endMinutes = (startMinutes != null && dur != null) ? startMinutes + dur : null;
    if (startMinutes == null || endMinutes == null) warnings.push({ code: 'MISSING_SEGMENT_TIME', umlaufCode: code, index });
    if (segment.kind === 'unknown') warnings.push({ code: 'UNKNOWN_SEGMENT_KIND', umlaufCode: code, index });
    return { segment, index, startMinutes, endMinutes, durationMinutes: dur, driving: DRIVING_KINDS.has(segment.kind) };
  });

  // Order / overlap check (the joint timeline already orders segments by departure).
  for (let i = 1; i < enriched.length; i += 1) {
    const prev = enriched[i - 1], cur = enriched[i];
    if (prev.startMinutes != null && cur.startMinutes != null && cur.startMinutes < prev.startMinutes) warnings.push({ code: 'INCONSISTENT_SEGMENT_ORDER', umlaufCode: code, index: i });
    if (prev.endMinutes != null && cur.startMinutes != null && cur.startMinutes < prev.endMinutes) warnings.push({ code: 'OVERLAPPING_SEGMENTS', umlaufCode: code, index: i });
  }

  // `line` is forwarded verbatim from the joint timeline segment (Phase 3I.10) — never derived,
  // normalised or guessed; an absent line stays null.
  const drivingSegments = enriched.filter(e => e.driving).map(e => ({
    serviceNumber: e.segment.serviceNumber ?? null, kind: e.segment.kind, line: e.segment.line ?? null,
    startMinutes: e.startMinutes, endMinutes: e.endMinutes, durationMinutes: e.durationMinutes, source: smallRef(e.segment.source)
  }));

  // Driving blocks: maximal runs of adjacent driving segments; any explicit non-driving
  // segment ends a run (a plain temporal gap does NOT split a block).
  const drivingBlocks = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const starts = run.map(e => e.startMinutes).filter(x => x != null);
    const ends = run.map(e => e.endMinutes).filter(x => x != null);
    const startMinutes = starts.length ? Math.min(...starts) : null;
    const endMinutes = ends.length ? Math.max(...ends) : null;
    drivingBlocks.push({
      id: `${code}#${drivingBlocks.length}`,
      startMinutes, endMinutes,
      durationMinutes: (startMinutes != null && endMinutes != null) ? endMinutes - startMinutes : null,
      segmentCount: run.length,
      serviceNumbers: [...new Set(run.map(e => e.segment.serviceNumber).filter(x => x != null).map(String))].sort(),
      circulationCode: code,
      sourceRefs: run.map(e => smallRef(e.segment.source))
    });
    run = [];
  };
  for (const e of enriched) { if (e.driving) run.push(e); else flush(); }
  flush();

  const interruptionIntervals = [];
  const nonDrivingIntervals = [];

  // Explicit non-driving segments → non-driving intervals; break/layover also count as interruptions.
  for (const e of enriched) {
    if (e.driving) continue;
    const classification = NON_DRIVING_CLASSIFICATION[e.segment.kind] || 'unknown';
    const interval = { startMinutes: e.startMinutes, endMinutes: e.endMinutes, durationMinutes: e.durationMinutes, sourceType: e.segment.kind, explicit: true };
    nonDrivingIntervals.push({ ...interval, classification });
    if (e.segment.kind === 'break' || e.segment.kind === 'layover') interruptionIntervals.push({ ...interval, sourceRefs: [smallRef(e.segment.source)] });
  }

  // Structured service interruptions supplied for this circulation's services.
  for (const svc of (Array.isArray(circulation?.services) ? circulation.services : [])) {
    for (const it of (interruptionsByService.get(String(svc)) || [])) {
      const startMinutes = typeof it.startMinutes === 'number' ? it.startMinutes : null;
      const endMinutes = typeof it.endMinutes === 'number' ? it.endMinutes : null;
      const durationMinutes = typeof it.durationMinutes === 'number'
        ? it.durationMinutes
        : ((startMinutes != null && endMinutes != null && endMinutes >= startMinutes) ? endMinutes - startMinutes : null);
      if (startMinutes == null && durationMinutes == null) warnings.push({ code: 'UNRESOLVED_INTERRUPTION', umlaufCode: code });
      const base = { startMinutes, endMinutes, durationMinutes, sourceType: 'service_interruption', explicit: true };
      interruptionIntervals.push({ ...base, sourceRefs: [{ serviceNumber: String(svc), activityIndex: null, sourceType: 'service_interruption' }] });
      nonDrivingIntervals.push({ ...base, classification: 'service_interruption' });
    }
  }

  // Computed temporal gaps between consecutive segments — NEVER a pause/interruption.
  for (let i = 1; i < enriched.length; i += 1) {
    const prev = enriched[i - 1], cur = enriched[i];
    if (prev.endMinutes != null && cur.startMinutes != null && cur.startMinutes > prev.endMinutes) {
      nonDrivingIntervals.push({ startMinutes: prev.endMinutes, endMinutes: cur.startMinutes, durationMinutes: cur.startMinutes - prev.endMinutes, sourceType: 'gap', explicit: false, classification: 'gap' });
    }
  }

  const drivingMinutes = drivingSegments.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const nonDrivingMinutes = nonDrivingIntervals.reduce((sum, iv) => sum + (iv.durationMinutes || 0), 0);

  return {
    code,
    drivingSegments,
    drivingBlocks,
    interruptionIntervals,
    nonDrivingIntervals,
    statistics: {
      drivingSegmentCount: drivingSegments.length,
      drivingBlockCount: drivingBlocks.length,
      interruptionCount: interruptionIntervals.length,
      nonDrivingIntervalCount: nonDrivingIntervals.length,
      drivingMinutes,
      nonDrivingMinutes,
      knownTotalMinutes: drivingMinutes + nonDrivingMinutes
    },
    warnings
  };
}
