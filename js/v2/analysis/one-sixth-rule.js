/**
 * JNV 1/6 rule (BV015–BV018, Phase 3I.4) — RULE MODULE ONLY.
 *
 * Compares, per circulation, the required creditable turnaround time
 * `ceil(drivingMinutes * numerator / denominator)` with the sum of the credited turnarounds taken
 * from the Phase 3I.3 candidate detection. Architecture strictly mirrors the BV008 rule: config
 * gate → applicability gate → per-unit evaluation → aggregated status, reusing the frozen
 * `VIOLATION` severity and the same five-value determination vocabulary.
 *
 * It performs NO check integration: no CheckModule, no runner registration, no orchestrator, no
 * session, no UI. Every threshold and ratio comes from the passed rule config; nothing is
 * hard-coded. Driving time is taken from the neutral driving projection (non-driving time is
 * already excluded there), so no interval is deducted twice and no gap is interpreted.
 *
 * Pure, deterministic, JSON-compatible, non-mutating: no storage, no network, no current time,
 * no random, no DOM.
 */

import { validateOneSixthRuleConfig, requiredTurnaroundMinutes } from './one-sixth-validation.js';

export const ONE_SIXTH_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  DISABLED: 'DISABLED'
});

export const ONE_SIXTH_WARNINGS = Object.freeze([
  'INVALID_ONE_SIXTH_INPUT',
  'RULE_CONFIG_INVALID',
  'RULE_DISABLED',
  'NOT_JNV',
  'UNSUPPORTED_MODE',
  'DRIVING_TIME_UNAVAILABLE',
  'TURNAROUND_DATA_UNAVAILABLE',
  'SERVICE_ASSIGNMENT_AMBIGUOUS',
  'DUPLICATE_TURNAROUND',
  'LOCATION_MISMATCH_ACCEPTED',
  'SOURCE_PRIORITY_CONFLICT',
  'INSUFFICIENT_DATA',
  'DAY_TYPE_NOT_ELIGIBLE',
  'DAY_TYPE_UNKNOWN',
  'SEGMENT_LINE_AMBIGUOUS',
  'SEGMENT_LINE_UNAVAILABLE'
]);

/** The eligibility chain never produces a compliance verdict — only these three outcomes. */
export const ELIGIBILITY_STATUS = Object.freeze({
  PASS: 'PASS',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  INCONCLUSIVE: 'INCONCLUSIVE'
});

/** The mandated order of the eligibility steps (Phase 3I.9, admission grounds since 3I.15b). */
export const ELIGIBILITY_STEPS = Object.freeze(['organization', 'mode', 'blockBreak', 'dayType', 'nightShift', 'admissionLine', 'segments']);

/**
 * A duty with a block break is NOT a 1/6 duty (Phase 3I.27). The threshold is the one BV010 already
 * uses for a Blockpause; it is stated here because the gate must be able to decide before any rule
 * parameter is consulted.
 */
export const BLOCK_BREAK_MINIMUM_MINUTES = 30;

/**
 * WHY a unit may (or may not) be assessed (Phase 3I.15b). The weekend admits every duty; on a
 * weekday only a night shift or a duty running exclusively on the admission line is admitted.
 */
export const ELIGIBILITY_REASON = Object.freeze({
  WEEKEND: 'WEEKEND',
  NIGHT_SHIFT: 'NIGHT_SHIFT',
  PURE_LINE_18: 'PURE_LINE_18',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  NOT_JNV: 'NOT_JNV',
  UNSUPPORTED_MODE: 'UNSUPPORTED_MODE',
  DAY_TYPE_UNKNOWN: 'DAY_TYPE_UNKNOWN',
  SEGMENT_LINE_AMBIGUOUS: 'SEGMENT_LINE_AMBIGUOUS',
  // Phase 3I.27 — the duty carries a block break and is therefore outside the rule altogether.
  BLOCKPAUSE_PRESENT: 'BLOCKPAUSE_PRESENT'
});

/**
 * The block break of a duty in minutes, or `null` when none is known. Read verbatim from what the
 * caller supplies per service number — nothing is derived, and an unusable value is not a break.
 */
function blockBreakMinutesOf(serviceNumber, eligibility) {
  if (serviceNumber == null) return null;                      // an unattributed unit has no duty
  const value = eligibility?.blockBreaks?.[String(serviceNumber)];
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : null;
}

/** How the admission line appears in a unit — a description, never a calculation instruction. */
export const LINE_18_CLASSIFICATION = Object.freeze({
  PURE_LINE_18_ONLY: 'PURE_LINE_18_ONLY',
  MIXED_WITH_OTHER_LINES: 'MIXED_WITH_OTHER_LINES',
  NO_LINE_INFORMATION: 'NO_LINE_INFORMATION'
});

// The projection's day-type vocabulary mapped onto the rule set's vocabulary. Pure translation
// between two existing closed vocabularies; nothing is derived or guessed from any other source.
const DAY_TYPE_TRANSLATION = Object.freeze({
  mo_fr: 'MON_FRI', mo_do: 'MON_FRI', friday: 'MON_FRI', school_days: 'MON_FRI',
  saturday: 'SATURDAY', sunday: 'SUNDAY_HOLIDAY', holidays: 'SUNDAY_HOLIDAY'
  // `weekend` and `unknown` are deliberately absent: neither identifies one allowed day type.
});

const asMinutes = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const asLine = (value) => {
  if (value === undefined) return undefined;                 // the field is absent entirely
  const text = value == null ? '' : String(value).trim();
  return text === '' ? null : text;                          // present but unusable → null
};

/** Threshold of the night-shift exception in minutes, taken from the configuration. */
function nightShiftThreshold(ruleConfig) {
  const raw = typeof ruleConfig?.nightShiftStart === 'string' ? ruleConfig.nightShiftStart : '';
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return (hours > 23 || minutes > 59) ? null : hours * 60 + minutes;
}

/**
 * Does the night-shift exception apply? `true` / `false` when the duty start is known, `null` when
 * it is not — an unknown start is never turned into a yes or a no.
 */
function resolveNightShift(ruleConfig, dutyStartMinutes) {
  if (ruleConfig?.nightShiftIsException !== true) return false;
  const threshold = nightShiftThreshold(ruleConfig);
  const dutyStart = asMinutes(dutyStartMinutes);
  if (threshold === null || dutyStart === null) return null;
  return ruleConfig.nightShiftStartInclusive === false ? dutyStart > threshold : dutyStart >= threshold;
}

/**
 * The duty start of ONE circulation (Phase 3I.10b): resolved from the service numbers its driving
 * segments already carry against the small `serviceStarts` map. Falls back to the document-wide
 * value when no per-service value exists. Services with different starts stay ambiguous (`null`),
 * and nothing is derived from a trip, an earliest segment, a file name, a line or a code.
 * @returns {{ minutes: number|null, ambiguous: boolean }}
 */
function circulationDutyStart(circulation, eligibility) {
  const starts = (eligibility?.serviceStarts && typeof eligibility.serviceStarts === 'object') ? eligibility.serviceStarts : null;
  if (starts) {
    const serviceNumbers = [...new Set((Array.isArray(circulation?.drivingSegments) ? circulation.drivingSegments : [])
      .map(segment => segment?.serviceNumber).filter(value => value != null).map(String))];
    const resolved = new Set();
    let missing = false;
    for (const serviceNumber of serviceNumbers) {
      const minutes = asMinutes(starts[serviceNumber]);
      if (minutes === null) missing = true; else resolved.add(minutes);
    }
    if (resolved.size > 1) return { minutes: null, ambiguous: true };
    if (resolved.size === 1 && !missing) return { minutes: [...resolved][0], ambiguous: false };
    if (serviceNumbers.length > 0) return { minutes: null, ambiguous: false };
  }
  return { minutes: asMinutes(eligibility?.dutyStartMinutes), ambiguous: false };
}

// The existing segment kind of a deadhead run (Phase 3I.13). It is the ONLY kind whose missing line
// is not an information gap: a deadhead run is classified precisely because it carries neither a
// circuit code nor a route identity, so it can never be an exception-line trip.
const DEADHEAD_KIND = 'deadhead';

/**
 * How does the admission line (line 18) appear in ONE unit (Phase 3I.15b)?
 *
 * The admission line is NOT a calculation exception: it never removes a segment, a minute or a
 * turnaround. It only decides whether a duty that the day type alone would exclude may be assessed
 * at all — and only when the WHOLE driving performance of the duty runs on it.
 *
 * The attribution reads the two fields the segment already carries — `line` and `kind` — and nothing
 * else (Phase 3I.13): a known line always decides, whatever the kind; a MISSING line is neutral for
 * a deadhead run (it carries no line by construction, so it neither proves nor breaks purity) and
 * undecidable for anything else. Nothing is derived from a circulation code, a depot, a stop, a
 * service number or a vehicle, and an unknown kind is never assumed to be a deadhead run.
 *
 * @returns {{ circulationCode, segmentCount, line18Classification, lineAttributionComplete, warnings }}
 */
function classifyCirculationLines(circulation, admissionLines) {
  const circulationCode = String(circulation?.code ?? '');
  const segments = Array.isArray(circulation?.drivingSegments) ? circulation.drivingSegments : [];
  const warnings = [];
  let admissionSegments = 0;
  let otherLineSegments = 0;
  let unattributed = 0;

  for (const segment of segments) {
    const line = asLine(segment?.line);
    if (line === undefined || line === null) {
      if (segment?.kind !== DEADHEAD_KIND) unattributed += 1;   // a deadhead run stays neutral
      continue;
    }
    if (admissionLines.includes(line)) admissionSegments += 1;
    else otherLineSegments += 1;
  }

  let line18Classification = LINE_18_CLASSIFICATION.NO_LINE_INFORMATION;
  if (otherLineSegments > 0) line18Classification = LINE_18_CLASSIFICATION.MIXED_WITH_OTHER_LINES;
  else if (admissionSegments > 0 && unattributed === 0) line18Classification = LINE_18_CLASSIFICATION.PURE_LINE_18_ONLY;

  // The existing distinction is kept (Phase 3I.9): NO line information at all is a reported gap,
  // a PARTLY known attribution is ambiguous — only the latter can hide a non-admission line.
  const anyKnownLine = admissionSegments > 0 || otherLineSegments > 0;
  if (unattributed > 0 && anyKnownLine) warnings.push({ code: 'SEGMENT_LINE_AMBIGUOUS', circulationCode });
  else if (!anyKnownLine && segments.length > 0) warnings.push({ code: 'SEGMENT_LINE_UNAVAILABLE', circulationCode });

  return {
    circulationCode,
    segmentCount: segments.length,
    line18Classification,
    lineAttributionComplete: unattributed === 0,
    warnings
  };
}

const admissionLinesOf = (ruleConfig) => (Array.isArray(ruleConfig?.admissionLines) ? ruleConfig.admissionLines : []).map(String);

const eligibilityResult = (over) => ({
  status: ELIGIBILITY_STATUS.PASS,
  reason: null,
  steps: [...ELIGIBILITY_STEPS],
  organization: null,
  mode: null,
  dayType: null,
  nightShift: null,
  circulations: [],
  warnings: [],
  ...over
});

/**
 * The eligibility chain that runs BEFORE the quota evaluation (Phase 3I.9), in the mandated order:
 * organisation → mode → day type → night shift → exception line → segment-based exceptions.
 * It performs NO quota arithmetic and yields only PASS / NOT_APPLICABLE / INCONCLUSIVE.
 *
 * @param {{ drivingProjection, ruleConfig, context, eligibility? }} input
 *   `eligibility.dutyStartMinutes` carries the duty start the night-shift exception needs; it is
 *   optional because the productive projection does not carry it yet (see the phase report).
 */
export function evaluateOneSixthEligibility({ drivingProjection, ruleConfig, context = {}, eligibility = {} } = {}) {
  // 1 — organisation
  const organization = context?.organization ?? null;
  const organizations = Array.isArray(ruleConfig?.organizations) ? ruleConfig.organizations : [];
  if (!organization || !organizations.includes(organization)) {
    return eligibilityResult({ status: ELIGIBILITY_STATUS.NOT_APPLICABLE, reason: 'NOT_JNV', warnings: [{ code: 'NOT_JNV' }] });
  }

  // 2 — mode (bus and tram are treated identically)
  const mode = context?.mode ?? null;
  const modes = Array.isArray(ruleConfig?.modes) ? ruleConfig.modes : [];
  if (!mode || !modes.includes(mode)) {
    return eligibilityResult({ status: ELIGIBILITY_STATUS.NOT_APPLICABLE, reason: 'UNSUPPORTED_MODE', organization, warnings: [{ code: 'UNSUPPORTED_MODE' }] });
  }

  // 3 — day type, exclusively from the existing projection metadata
  const rawDayType = drivingProjection?.metadata?.dayType;
  const dayType = DAY_TYPE_TRANSLATION[typeof rawDayType === 'string' ? rawDayType : ''] ?? null;
  const allowedDayTypes = Array.isArray(ruleConfig?.allowedDayTypes) ? ruleConfig.allowedDayTypes : [];
  const partial = { organization, mode, dayType };
  if (dayType === null) {
    return eligibilityResult({ ...partial, status: ELIGIBILITY_STATUS.INCONCLUSIVE, reason: 'DAY_TYPE_UNKNOWN', warnings: [{ code: 'DAY_TYPE_UNKNOWN' }] });
  }

  // 4/5 — the two admission grounds beside the day type. The duty start is resolved PER CIRCULATION
  // (Phase 3I.10b), so duties with different starts are judged separately.
  const dayTypeAllowed = allowedDayTypes.includes(dayType);
  const documentNightShift = resolveNightShift(ruleConfig, eligibility?.dutyStartMinutes);
  const admissionLines = admissionLinesOf(ruleConfig);
  const requiresPureDuty = ruleConfig?.admissionLineRequiresPureDuty !== false;

  const circulations = (Array.isArray(drivingProjection?.circulations) ? drivingProjection.circulations : [])
    .flatMap(splitIntoDutyUnits).map(circulation => {
    const classified = classifyCirculationLines(circulation, admissionLines);
    const { minutes, ambiguous } = circulationDutyStart(circulation, eligibility);
    const nightShift = ambiguous ? null : resolveNightShift(ruleConfig, minutes);
    const warnings = [...classified.warnings];

    // Phase 3I.27 — the BLOCK BREAK gate, before every other question about this unit. A duty with
    // a block break is not a 1/6 duty at all: no admission ground is even considered, and no quota
    // follows. The break belongs to the DUTY, so every unit of that duty is closed alike.
    const blockBreak = blockBreakMinutesOf(circulation?.dutyServiceNumber, eligibility);
    if (blockBreak !== null && blockBreak >= BLOCK_BREAK_MINIMUM_MINUTES) {
      return {
        ...classified, unitKey: unitKeyOf(circulation), nightShift,
        status: ELIGIBILITY_STATUS.NOT_APPLICABLE, eligibilityReason: ELIGIBILITY_REASON.BLOCKPAUSE_PRESENT,
        warnings: [...warnings, { code: 'BLOCKPAUSE_PRESENT', circulationCode: classified.circulationCode, blockBreakMinutes: blockBreak }]
      };
    }

    // The weekend admits every duty; nothing else needs to be shown.
    if (dayTypeAllowed) {
      return { ...classified, unitKey: unitKeyOf(circulation), nightShift, warnings, status: ELIGIBILITY_STATUS.PASS, eligibilityReason: ELIGIBILITY_REASON.WEEKEND };
    }

    // A duty running EXCLUSIVELY on the admission line is admitted (Phase 3I.15b) — independently of
    // the duty start, and without removing anything from its later calculation.
    const pure = classified.line18Classification === LINE_18_CLASSIFICATION.PURE_LINE_18_ONLY;
    if (pure && (requiresPureDuty || admissionLines.length > 0)) {
      return { ...classified, unitKey: unitKeyOf(circulation), nightShift, warnings, status: ELIGIBILITY_STATUS.PASS, eligibilityReason: ELIGIBILITY_REASON.PURE_LINE_18 };
    }
    if (ambiguous) warnings.push({ code: 'DUTY_START_AMBIGUOUS', circulationCode: classified.circulationCode });
    if (nightShift === true) {
      return { ...classified, unitKey: unitKeyOf(circulation), nightShift, warnings, status: ELIGIBILITY_STATUS.PASS, eligibilityReason: ELIGIBILITY_REASON.NIGHT_SHIFT };
    }

    // Neither ground applies. An incomplete line attribution or an unknown duty start leaves the
    // question open — it is never resolved against the duty.
    if (!classified.lineAttributionComplete) {
      return { ...classified, unitKey: unitKeyOf(circulation), nightShift, warnings, status: ELIGIBILITY_STATUS.INCONCLUSIVE, eligibilityReason: ELIGIBILITY_REASON.SEGMENT_LINE_AMBIGUOUS };
    }
    if (nightShift === null) {
      return {
        ...classified, unitKey: unitKeyOf(circulation), nightShift, status: ELIGIBILITY_STATUS.INCONCLUSIVE, eligibilityReason: ELIGIBILITY_REASON.DAY_TYPE_UNKNOWN,
        warnings: [...warnings, { code: 'DAY_TYPE_NOT_ELIGIBLE', circulationCode: classified.circulationCode }]
      };
    }
    return {
      ...classified, unitKey: unitKeyOf(circulation), nightShift, status: ELIGIBILITY_STATUS.NOT_APPLICABLE, eligibilityReason: ELIGIBILITY_REASON.NOT_ELIGIBLE,
      warnings: [...warnings, { code: 'DAY_TYPE_NOT_ELIGIBLE', circulationCode: classified.circulationCode }]
    };
  });
  const warnings = circulations.flatMap(c => c.warnings);

  // An inconclusive circulation is never hidden behind a passing one.
  let status = ELIGIBILITY_STATUS.PASS;
  let reason = null;
  const inconclusive = circulations.find(c => c.status === ELIGIBILITY_STATUS.INCONCLUSIVE);
  if (inconclusive) {
    status = ELIGIBILITY_STATUS.INCONCLUSIVE;
    reason = inconclusive.eligibilityReason;
  } else if (circulations.length > 0 && circulations.every(c => c.status === ELIGIBILITY_STATUS.NOT_APPLICABLE)) {
    status = ELIGIBILITY_STATUS.NOT_APPLICABLE;
    reason = ELIGIBILITY_REASON.NOT_ELIGIBLE;
  }
  // The document-level `nightShift` stays the aggregate view when every circulation agrees.
  const distinct = new Set(circulations.map(c => c.nightShift));
  const nightShift = circulations.length === 0 ? documentNightShift : (distinct.size === 1 ? [...distinct][0] : null);
  return eligibilityResult({ ...partial, status, reason, nightShift, circulations, warnings });
}

const VIOLATION_SEVERITY = 'VIOLATION';   // reuse of the existing frozen severity vocabulary
const APPLICABLE_DETECTION_STATUSES = new Set(['complete', 'partial']);

/**
 * The driving time of a circulation, or `null` when it is not reliably known (Phase 3I.7).
 *
 * The projection aggregates only the KNOWN segment durations, so a single segment without a
 * duration silently lowers the total instead of marking it unknown. Taking that partial sum at face
 * value would derive a requirement from data the rule does not have — and an aggregate of 0 would
 * always be satisfiable. The total therefore counts only when EVERY driving segment contributed a
 * duration. A genuinely known 0 (all durations present, or no driving segment at all) stays a
 * normal, assessable value.
 */
// NB (Phase 3I.15b): there is no longer a second, "evaluable" driving time. The admission line
// never removes a segment, so the basis of an admitted duty is always its whole driving time.
function knownDrivingMinutes(circulation) {
  const statistics = circulation?.statistics;
  if (!statistics || typeof statistics !== 'object') return null;
  const total = statistics.drivingMinutes;
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null;
  const segments = Array.isArray(circulation?.drivingSegments) ? circulation.drivingSegments : [];
  if (segments.some(segment => !Number.isFinite(segment?.durationMinutes))) return null;
  return total;
}

/**
 * Splits a projection circulation into its DUTY UNITS (Phase 3I.24). The 1/6 rule is a rule about a
 * driver's duty, and a circulation is a vehicle day that two drivers may share. Each unit carries
 * only its OWN driving segments; the circulation reference stays visible for every one of them.
 *
 * A circulation driven by a single duty yields exactly one unit with the identical numbers — the
 * split changes nothing where there was nothing to split. Segments without a duty form their own
 * unit with `serviceNumber: null`, so an unattributable stretch is reported instead of being
 * silently added to somebody's driving time.
 */
function splitIntoDutyUnits(circulation) {
  const segments = Array.isArray(circulation?.drivingSegments) ? circulation.drivingSegments : [];
  const byService = new Map();
  for (const segment of segments) {
    const key = segment?.serviceNumber == null ? null : String(segment.serviceNumber);
    if (!byService.has(key)) byService.set(key, []);
    byService.get(key).push(segment);
  }
  if (byService.size <= 1) return [{ ...circulation, dutyServiceNumber: byService.size === 1 ? [...byService.keys()][0] : null }];

  return [...byService.entries()].map(([serviceNumber, drivingSegments]) => {
    const known = drivingSegments.every(s => Number.isFinite(s?.durationMinutes));
    return {
      ...circulation,
      dutyServiceNumber: serviceNumber,
      drivingSegments,
      services: serviceNumber === null ? [] : [serviceNumber],
      statistics: { ...circulation.statistics, drivingSegmentCount: drivingSegments.length,
        drivingMinutes: known ? drivingSegments.reduce((total, s) => total + s.durationMinutes, 0) : NaN }
    };
  });
}

/** The absolute span a duty unit occupies, or `null` when its segments carry no usable time. */
function unitSpan(unit) {
  const starts = (unit?.drivingSegments || []).map(s => s?.startMinutes).filter(v => typeof v === 'number');
  const ends = (unit?.drivingSegments || []).map(s => s?.endMinutes).filter(v => typeof v === 'number');
  return starts.length && ends.length ? { from: Math.min(...starts), to: Math.max(...ends) } : null;
}

const unitKeyOf = (unit) => `${String(unit?.code ?? '')}#${unit?.dutyServiceNumber ?? ''}`;

const emptyStatistics = () => ({
  evaluatedServices: 0, passedServices: 0, failedServices: 0, inconclusiveServices: 0, notApplicableServices: 0,
  totalDrivingMinutes: 0, totalRequiredMinutes: 0, totalCreditedMinutes: 0, totalDeficitMinutes: 0,
  turnaroundCandidateCount: 0, creditedTurnaroundCount: 0
});

const shell = (ruleId, status, warnings) => ({ ruleId, status, services: [], violations: [], warnings, statistics: emptyStatistics() });

/**
 * @param {{ drivingProjection: object, turnaroundDetection: object, ruleConfig: object,
 *           context?: object, eligibility?: object }} input
 *   Passing `eligibility` runs the Phase 3I.9 eligibility chain before the quota evaluation.
 *   Omitting it keeps the previous behaviour exactly (the productive orchestrator does not supply
 *   it yet — see the phase report).
 * @returns {{ ruleId, status, services, violations, warnings, statistics }}
 */
export function evaluateOneSixthRule({ drivingProjection, turnaroundDetection, ruleConfig, context = {}, eligibility } = {}) {
  const ruleId = (typeof ruleConfig?.ruleId === 'string' && ruleConfig.ruleId) ? ruleConfig.ruleId : 'BV015_BV018';

  // Gate 1 — the configuration must be structurally usable.
  const configCheck = validateOneSixthRuleConfig(ruleConfig);
  if (!configCheck.valid) return shell(ruleId, ONE_SIXTH_STATUS.DISABLED, [{ code: 'RULE_CONFIG_INVALID', details: configCheck.errors }]);
  if (ruleConfig.enabled === false) return shell(ruleId, ONE_SIXTH_STATUS.DISABLED, [{ code: 'RULE_DISABLED' }]);

  // Gate 2 — organisation and mode.
  const organization = context?.organization ?? null;
  if (!organization || !ruleConfig.organizations.includes(organization)) return shell(ruleId, ONE_SIXTH_STATUS.NOT_APPLICABLE, [{ code: 'NOT_JNV' }]);
  const mode = context?.mode ?? null;
  if (!mode || !ruleConfig.modes.includes(mode)) return shell(ruleId, ONE_SIXTH_STATUS.NOT_APPLICABLE, [{ code: 'UNSUPPORTED_MODE' }]);

  // Gate 3 — an applicable driving projection (its own gate guarantees an exact joint view).
  if (!drivingProjection || typeof drivingProjection !== 'object' || drivingProjection.metadata == null || !Array.isArray(drivingProjection.circulations) || drivingProjection.circulations.length === 0) {
    return shell(ruleId, ONE_SIXTH_STATUS.NOT_APPLICABLE, [{ code: 'INVALID_ONE_SIXTH_INPUT' }]);
  }

  // Gate 3b (Phase 3I.9) — the eligibility chain runs BEFORE any quota arithmetic. Without a
  // decisive PASS no requirement is derived, so an ineligible or undecidable duty never reaches a
  // verdict. Only requested when the caller supplies the eligibility inputs.
  // Phase 3I.24: the chain no longer SHORT-CIRCUITS. Its verdict is carried PER DUTY UNIT, so an
  // undecidable unit stays undecidable and every assessable one keeps its own result. Discarding
  // them all because of one open question was never a professional statement, only a data one.
  let eligibilityByUnit = null;
  if (eligibility) {
    const verdict = evaluateOneSixthEligibility({ drivingProjection, ruleConfig, context, eligibility });
    // A DOCUMENT-level refusal — not JNV, an unsupported mode, an unknown day type — reaches no
    // unit at all and therefore leaves nothing to report per duty. That short circuit stays.
    if (verdict.circulations.length === 0 && verdict.status !== ELIGIBILITY_STATUS.PASS) {
      const status = verdict.status === ELIGIBILITY_STATUS.NOT_APPLICABLE ? ONE_SIXTH_STATUS.NOT_APPLICABLE : ONE_SIXTH_STATUS.INCONCLUSIVE;
      return shell(ruleId, status, verdict.warnings.length ? [...verdict.warnings] : [{ code: verdict.reason || 'INSUFFICIENT_DATA' }]);
    }
    eligibilityByUnit = new Map(verdict.circulations.map(c => [c.unitKey, c]));
  }

  // Gate 4 — usable turnaround detection. Missing or inconclusive detection is never treated as
  // "no turnarounds"; it is an unknown and therefore inconclusive.
  if (!turnaroundDetection || typeof turnaroundDetection !== 'object' || !Array.isArray(turnaroundDetection.candidates)
      || !APPLICABLE_DETECTION_STATUSES.has(turnaroundDetection.status)) {
    return shell(ruleId, ONE_SIXTH_STATUS.INCONCLUSIVE, [{ code: 'TURNAROUND_DATA_UNAVAILABLE' }]);
  }

  const warnings = [];
  const accepted = new Set(ruleConfig.acceptedTurnaroundConfidence);
  const blocksOnMismatch = ruleConfig.locationMismatchBlocksCrediting === true;

  // Decide per candidate whether it is creditable; WHICH duty it belongs to is resolved below, once
  // the duty units are known. A duplicate id is counted once.
  const creditedCandidates = [];
  const seenIds = new Set();
  let creditedTurnaroundCount = 0;
  let locationMismatchAccepted = 0;

  for (const candidate of turnaroundDetection.candidates) {
    const code = typeof candidate?.circulationCode === 'string' ? candidate.circulationCode : '';

    if (typeof candidate?.id === 'string' && candidate.id) {
      if (seenIds.has(candidate.id)) { warnings.push({ code: 'DUPLICATE_TURNAROUND', circulationCode: code }); continue; }
      seenIds.add(candidate.id);
    }
    let credited = true;
    if (candidate?.eligibility !== 'qualified') credited = false;
    else if (!accepted.has(candidate.confidence)) credited = false;
    else if (!Number.isFinite(candidate.creditedMinutes) || candidate.creditedMinutes < 0) credited = false;
    else if (Array.isArray(candidate.warnings) && candidate.warnings.includes('LOCATION_MISMATCH')) {
      if (blocksOnMismatch) credited = false;
      else locationMismatchAccepted += 1;
    }

    // Phase 3I.15b: a turnaround on the admission line is an ORDINARY turnaround. There is no
    // segment class left to assign it to, so nothing is discarded and nothing becomes ambiguous.
    creditedCandidates.push([candidate, credited]);
    if (credited) creditedTurnaroundCount += 1;
  }
  if (locationMismatchAccepted > 0) warnings.push({ code: 'LOCATION_MISMATCH_ACCEPTED', count: locationMismatchAccepted });

  const dutyUnits = drivingProjection.circulations.flatMap(splitIntoDutyUnits);
  // Credits belong to the duty whose own segments enclose them. Where a circulation has a single
  // duty unit, that unit simply keeps all of them — the pre-3I.24 behaviour, unchanged.
  const unitsByCode = new Map();
  for (const unit of dutyUnits) {
    const code = String(unit?.code ?? '');
    if (!unitsByCode.has(code)) unitsByCode.set(code, []);
    unitsByCode.get(code).push(unit);
  }
  const creditOwner = (candidate) => {
    const siblings = unitsByCode.get(String(candidate?.circulationCode ?? '')) || [];
    if (siblings.length === 0) return null;
    if (siblings.length === 1) return unitKeyOf(siblings[0]);
    const owner = siblings.find(unit => {
      const span = unitSpan(unit);
      return span !== null && Number.isFinite(candidate?.startMinutes) && Number.isFinite(candidate?.endMinutes)
        && candidate.startMinutes >= span.from && candidate.endMinutes <= span.to;
    });
    return owner ? unitKeyOf(owner) : null;                    // between two duties → credited to none
  };

  const creditedByUnit = new Map();
  const creditedCountByUnit = new Map();
  const countByUnit = new Map();
  for (const [candidate, credited] of creditedCandidates) {
    const key = creditOwner(candidate);
    if (key === null) { warnings.push({ code: 'TURNAROUND_BETWEEN_DUTIES', circulationCode: String(candidate?.circulationCode ?? '') }); continue; }
    countByUnit.set(key, (countByUnit.get(key) || 0) + 1);
    if (!credited) continue;
    creditedByUnit.set(key, (creditedByUnit.get(key) || 0) + candidate.creditedMinutes);
    creditedCountByUnit.set(key, (creditedCountByUnit.get(key) || 0) + 1);
  }

  const services = dutyUnits.map(unit => evaluateCirculation(unit, {
    ruleId,
    numerator: ruleConfig.requiredRatioNumerator,
    denominator: ruleConfig.requiredRatioDenominator,
    creditedMinutes: creditedByUnit.get(unitKeyOf(unit)) || 0,
    creditedTurnaroundCount: creditedCountByUnit.get(unitKeyOf(unit)) || 0,
    turnaroundCount: countByUnit.get(unitKeyOf(unit)) || 0,
    // The verdict the eligibility chain already reached for THIS unit (Phase 3I.11/3I.24). A unit it
    // ruled out keeps that verdict instead of being pushed through the quota arithmetic.
    eligibilityStatus: eligibilityByUnit?.get(unitKeyOf(unit))?.status ?? null,
    eligibilityReason: eligibilityByUnit?.get(unitKeyOf(unit))?.eligibilityReason ?? null,
    warnings
  }));

  const violations = services.flatMap(service => service.violations);
  const failed = services.filter(s => s.status === ONE_SIXTH_STATUS.FAIL).length;
  const inconclusive = services.filter(s => s.status === ONE_SIXTH_STATUS.INCONCLUSIVE).length;
  const passed = services.filter(s => s.status === ONE_SIXTH_STATUS.PASS).length;
  const notApplicable = services.filter(s => s.status === ONE_SIXTH_STATUS.NOT_APPLICABLE).length;

  // Existing priority, unchanged: FAIL > INCONCLUSIVE > PASS. A run in which every unit is outside
  // the scope is not a pass — it is not applicable (Phase 3I.11).
  let status = ONE_SIXTH_STATUS.PASS;
  if (failed > 0) status = ONE_SIXTH_STATUS.FAIL;
  else if (inconclusive > 0) status = ONE_SIXTH_STATUS.INCONCLUSIVE;
  else if (passed === 0 && notApplicable > 0) status = ONE_SIXTH_STATUS.NOT_APPLICABLE;

  const sum = (key) => services.reduce((total, service) => total + (Number.isFinite(service[key]) ? service[key] : 0), 0);

  return {
    ruleId,
    status,
    services,
    violations,
    warnings,
    statistics: {
      // `evaluatedServices` counts the units that actually reached an assessment; a unit outside
      // the scope is reported separately and never inflates the assessed count (Phase 3I.11).
      evaluatedServices: services.length - notApplicable,
      passedServices: passed,
      failedServices: failed,
      inconclusiveServices: inconclusive,
      notApplicableServices: notApplicable,
      totalDrivingMinutes: sum('drivingMinutes'),
      totalRequiredMinutes: sum('requiredMinutes'),
      totalCreditedMinutes: sum('creditedMinutes'),
      totalDeficitMinutes: sum('deficitMinutes'),
      turnaroundCandidateCount: turnaroundDetection.candidates.length,
      creditedTurnaroundCount
    }
  };
}

function evaluateCirculation(circulation, cfg) {
  const circulationCode = String(circulation?.code ?? '');
  const serviceWarnings = [];

  // Service assignment strictly from existing references: a circulation whose driving segments all
  // belong to ONE service resolves that service; otherwise the evaluation stays on the circulation.
  const serviceNumbers = [...new Set((Array.isArray(circulation?.drivingSegments) ? circulation.drivingSegments : [])
    .map(segment => segment?.serviceNumber).filter(value => value != null).map(String))];
  let serviceNumber = circulation?.dutyServiceNumber ?? null;    // the unit IS a duty (Phase 3I.24)
  if (serviceNumber === null && serviceNumbers.length === 1) serviceNumber = serviceNumbers[0];
  else if (serviceNumber === null && serviceNumbers.length > 1) {
    serviceWarnings.push('SERVICE_ASSIGNMENT_AMBIGUOUS');
    cfg.warnings.push({ code: 'SERVICE_ASSIGNMENT_AMBIGUOUS', circulationCode });
  }

  // The basis of an ADMITTED duty is always its whole driving time (Phase 3I.15b): the admission
  // line removes nothing, so there is only one driving time left.
  const drivingMinutes = knownDrivingMinutes(circulation);
  const base = {
    serviceNumber, circulationCode,
    turnaroundCount: cfg.turnaroundCount,
    creditedTurnaroundCount: cfg.creditedTurnaroundCount,
    eligibilityReason: cfg.eligibilityReason ?? null,
    warnings: serviceWarnings,
    violations: []
  };

  // A unit the eligibility chain already ruled out never receives a quota (Phase 3I.11): no basis,
  // no requirement, no deficit and no verdict. A basis of 0 would otherwise be read as a satisfied
  // quota and reported as PASS, although the unit was never in scope.
  if (cfg.eligibilityStatus === ELIGIBILITY_STATUS.NOT_APPLICABLE) {
    cfg.warnings.push({ code: 'DAY_TYPE_NOT_ELIGIBLE', circulationCode });
    return {
      ...base, status: ONE_SIXTH_STATUS.NOT_APPLICABLE,
      drivingMinutes: null, requiredMinutes: null, creditedMinutes: 0, deficitMinutes: null,
      warnings: [...serviceWarnings, 'DAY_TYPE_NOT_ELIGIBLE']
    };
  }

  // A unit the chain could not decide keeps THAT verdict — it is an open question, not a pass and
  // not a violation, and it no longer takes any other duty with it (Phase 3I.24).
  if (cfg.eligibilityStatus === ELIGIBILITY_STATUS.INCONCLUSIVE) {
    return {
      ...base, status: ONE_SIXTH_STATUS.INCONCLUSIVE,
      drivingMinutes: null, requiredMinutes: null, creditedMinutes: cfg.creditedMinutes, deficitMinutes: null,
      warnings: [...serviceWarnings, String(cfg.eligibilityReason || 'INSUFFICIENT_DATA')]
    };
  }

  // Without a usable driving time no requirement can be derived — inconclusive, never a verdict.
  // Requirement and deficit stay unknown (`null`); substituting 0 would assert a satisfied quota.
  if (drivingMinutes === null) {
    cfg.warnings.push({ code: 'DRIVING_TIME_UNAVAILABLE', circulationCode });
    return { ...base, status: ONE_SIXTH_STATUS.INCONCLUSIVE, drivingMinutes: null, requiredMinutes: null, creditedMinutes: cfg.creditedMinutes, deficitMinutes: null, warnings: [...serviceWarnings, 'DRIVING_TIME_UNAVAILABLE'] };
  }

  const requiredMinutes = requiredTurnaroundMinutes(drivingMinutes, cfg.numerator, cfg.denominator);
  const creditedMinutes = cfg.creditedMinutes;
  const deficitMinutes = Math.max(0, requiredMinutes - creditedMinutes);
  const status = creditedMinutes >= requiredMinutes ? ONE_SIXTH_STATUS.PASS : ONE_SIXTH_STATUS.FAIL;

  const violations = status === ONE_SIXTH_STATUS.FAIL ? [{
    ruleId: cfg.ruleId,
    serviceNumber,
    circulationCode,
    severity: VIOLATION_SEVERITY,
    drivingMinutes,
    requiredMinutes,
    creditedMinutes,
    deficitMinutes,
    sourceRefs: [{ circulationCode, serviceNumber, sourceType: 'driving-projection' }]
  }] : [];

  return { ...base, status, drivingMinutes, requiredMinutes, creditedMinutes, deficitMinutes, violations };
}
