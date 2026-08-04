/**
 * Productive JNV Bundle Matcher (Phase 3G.1) — PURE STRUCTURAL matching only.
 *
 * Determines structural correspondence between a JNV schedule (primary) and a JNV
 * Umlauftafel (companion) of an already-validated exact AnalysisBundle. It performs NO
 * operational analysis: no driving-time, no one-sixth rule, no labour rules, no deviations,
 * no scoring, no recommendations, no heuristic or approximate search, no OCR, no AI.
 *
 *   Level 1 (mandatory): the Umlauftafel must be able to describe a valid sub-range of the
 *                        schedule (Phase 3I.18 — day RANGES, not string equality). A proven
 *                        contradiction ends the match as `conflicting`; an unproven validity
 *                        is stated and caps the result at `probable`.
 *   Level 2:             Umlauf code correspondence — the EXACT string first; when it finds
 *                        nothing, the OPERATIONAL CIRCUIT of the Umlauftafel (Phase 3I.22), keyed
 *                        by the notation-independent key of the EXISTING circuit-identity
 *                        normalisation. A night circulation that the documentation broke across the
 *                        03:00 boundary is ONE circuit there, so it is one match here. The matcher
 *                        normalises nothing itself and never guesses: without a key there is no
 *                        match, and two genuinely separate circuits stay an ambiguity.
 *   Level 3:             consistency (line / time order / start-end location) — may only
 *                        raise warnings; it never creates or removes an exact match.
 *
 * Output is a pure match object `{ status, matches, warnings, statistics }`, reusing the
 * frozen match-status vocabulary and match-result descriptor. Only `exact` is automatable.
 */

import { MATCH_STATUSES, createMatchResult } from './match-contract.js';
import { validateJnvMatchInput } from './jnv-match-validation.js';
import { normalizeCircuitIdentity } from '../identity/identity-normalization.js';
import { assessValidityCompatibility, VALIDITY_COMPATIBILITY, VALIDITY_REASONS } from './validity-compatibility.js';
import { resolveOperationalCircuits } from '../identity/operational-circuit-identity.js';

const { COMPATIBLE, INCOMPATIBLE, UNKNOWN } = VALIDITY_COMPATIBILITY;

/**
 * The notation-independent key of a circuit code (Phase 3I.17), or `null` when the notation is not
 * attributable. The key comes from the CENTRAL identity normalisation — the matcher adds no
 * interpretation of its own, so `18/1` and `18100` meet exactly where they already agreed.
 */
function normalizedCircuitKey(code) {
  if (typeof code !== 'string' || code.trim() === '') return null;
  try {
    return normalizeCircuitIdentity(code, {})?.routeIdentity?.normalizedKey ?? null;
  } catch {
    return null;                                              // an unusable code is never guessed
  }
}

const warn = (code, detail = {}) => ({ code, severity: 'warning', ...detail });

const emptyStatistics = () => ({
  scheduleUmlaufCount: 0, umlauftafelCirculationCount: 0,
  exact: 0, unmatched: 0, ambiguous: 0, missingInSchedule: 0, level3Warnings: 0
});

const conflicting = (warnings, statistics) => ({ status: MATCH_STATUSES.CONFLICTING, matches: [], warnings, statistics });

// A bundle (when supplied) may only be matched if it is an exact JNV + Umlaufkarte bundle.
function bundleIsMatchable(bundle) {
  if (bundle === null || bundle === undefined) return true;
  return bundle?.compatibility?.status === 'exact'
    && bundle?.primary?.documentType === 'jnv_schedule_pdf'
    && bundle?.companion?.documentType === 'umlaufkarte';
}


/**
 * Structural projection of a CanonicalSchedule into a match view: distinct Umlauf codes
 * (exact strings from `activity.circuitNumber`) plus the caller-supplied validity. This
 * extraction performs NO interpretation; deriving the schedule's regime/dayType is the
 * caller's responsibility (a later phase), passed in via `validity`.
 */
export function buildScheduleMatchView(canonicalSchedule, validity = {}) {
  const services = Array.isArray(canonicalSchedule?.services) ? canonicalSchedule.services : [];
  const byCode = new Map();
  for (const service of services) {
    for (const activity of (service?.activities || [])) {
      const code = activity?.circuitNumber == null ? '' : String(activity.circuitNumber).trim();
      if (!code || byCode.has(code)) continue;
      byCode.set(code, {
        code,
        line: activity.line ?? null,
        startLocation: activity.departureLocation ?? null,
        endLocation: activity.arrivalLocation ?? null
      });
    }
  }
  return {
    serviceRegime: typeof validity.serviceRegime === 'string' ? validity.serviceRegime : 'unknown',
    dayType: typeof validity.dayType === 'string' ? validity.dayType : 'unknown',
    umlaeufe: [...byCode.values()]
  };
}

/**
 * @param {{ bundle?: object|null, schedule: {serviceRegime:string,dayType:string,umlaeufe:Array}, umlauftafel: object }} input
 * @returns {{ status: string, matches: object[], warnings: object[], statistics: object }}
 */
export function matchJnvBundle({ bundle = null, schedule, umlauftafel } = {}) {
  const statistics = emptyStatistics();

  if (!bundleIsMatchable(bundle)) return conflicting([warn('INVALID_BUNDLE')], statistics);

  const validation = validateJnvMatchInput({ bundle, schedule, umlauftafel });
  if (!validation.valid) return conflicting([warn('INVALID_MATCH_INPUT', { errors: validation.errors })], statistics);

  statistics.scheduleUmlaufCount = schedule.umlaeufe.length;
  statistics.umlauftafelCirculationCount = umlauftafel.circulations.length;

  // Level 1 (mandatory): can the Umlauftafel be a valid sub-range of the schedule (Phase 3I.18)?
  // A PROVEN contradiction still ends the match here. An open question does not — it is stated
  // and costs the result its automatability further down.
  const warnings = [];
  const validity = assessValidityCompatibility({ schedule, companion: umlauftafel.validity });
  if (validity.serviceRegime.status === INCOMPATIBLE) warnings.push(warn('REGIME_MISMATCH', { reason: validity.serviceRegime.reason }));
  if (validity.dayType.status === INCOMPATIBLE) warnings.push(warn('DAY_TYPE_MISMATCH', { reason: validity.dayType.reason }));
  if (validity.status === INCOMPATIBLE) return conflicting(warnings, statistics);
  if (validity.status === UNKNOWN) warnings.push(warn('VALIDITY_NOT_CONFIRMED', { reasons: validity.reasons }));
  // The board covers only part of the schedule's days (Mon–Thu of a Mon–Fri roster): a valid
  // sub-range, but the uncovered days carry no circulations and must not pass unmentioned.
  if (validity.dayType.reason === VALIDITY_REASONS.DAY_TYPE_COMPANION_IS_SUBSET) {
    warnings.push(warn('VALIDITY_PARTIAL_COVERAGE', { scheduleDayType: schedule.dayType, companionDayType: umlauftafel.validity.dayType }));
  }

  // Level 2: Umlauf code correspondence — the exact string first, then the operational circuit.
  const circulationsByCode = new Map();
  for (const circ of umlauftafel.circulations) {
    const code = circ?.code == null ? '' : String(circ.code); // exact string, no normalization
    if (!circulationsByCode.has(code)) circulationsByCode.set(code, []);
    circulationsByCode.get(code).push(circ);
  }
  for (const [code, list] of circulationsByCode) {
    if (list.length > 1) warnings.push(warn('DUPLICATE_UMLAUF_CODE', { umlaufCode: code }));
  }

  // The operational circuits of the board (Phase 3I.21/3I.22). Two sheets of ONE night circulation
  // are one circuit here, so a code that used to find two candidates now finds one. Two genuinely
  // separate circuits — the reinforcement duties — remain two and stay an ambiguity.
  const { circuits: operationalCircuits } = resolveOperationalCircuits(umlauftafel.circulations);
  const circuitsByKey = new Map();
  for (const circuit of operationalCircuits) {
    const key = circuit.routeIdentity?.normalizedKey ?? null;
    if (key === null) continue;                              // unattributable notation → no key
    if (!circuitsByKey.has(key)) circuitsByKey.set(key, []);
    circuitsByKey.get(key).push(circuit);
    if (circuit.sheetCodes.length > 1) warnings.push(warn('OPERATIONAL_CIRCUIT_MERGED', { sheetCodes: circuit.sheetCodes }));
  }

  const matchedCompanionCodes = new Set();
  const matches = schedule.umlaeufe.map((umlauf) => {
    const code = umlauf?.code == null ? '' : String(umlauf.code); // exact string, no normalization
    const rawCandidates = circulationsByCode.get(code) || [];
    // The raw string keeps precedence; the operational circuits only answer when it found nothing.
    const viaCircuit = rawCandidates.length === 0;
    const key = viaCircuit ? normalizedCircuitKey(code) : null;
    const circuitCandidates = viaCircuit ? (key === null ? [] : (circuitsByKey.get(key) || [])) : [];
    const candidateCount = viaCircuit ? circuitCandidates.length : rawCandidates.length;

    if (candidateCount === 0) {
      statistics.unmatched += 1;
      return createMatchResult({ status: MATCH_STATUSES.UNMATCHED, reasons: ['UMLAUF_NOT_IN_UMLAUFTAFEL'], primaryRefs: [code] });
    }
    if (candidateCount > 1) {
      statistics.ambiguous += 1;
      const refs = viaCircuit
        ? circuitCandidates.flatMap(c => c.sheetCodes.map(String))
        : rawCandidates.map(c => String(c.code ?? c.id ?? code));
      return createMatchResult({ status: MATCH_STATUSES.AMBIGUOUS, conflicts: ['MULTIPLE_CIRCULATIONS_FOR_CODE'], primaryRefs: [code], companionRefs: refs });
    }
    // Exactly one candidate → exact. Level 3 consistency may only ADD warnings.
    const sheets = viaCircuit ? circuitCandidates[0].sheets : rawCandidates;
    for (const consistencyWarning of level3Consistency(umlauf, sheets[0])) {
      warnings.push(consistencyWarning);
      statistics.level3Warnings += 1;
    }
    statistics.exact += 1;
    // A merged circuit names ALL its sheets — the joint timeline needs every one of them.
    const companionRefs = viaCircuit
      ? circuitCandidates[0].sheetCodes.map(String)
      : [String(sheets[0].id ?? code)];
    for (const ref of (viaCircuit ? companionRefs : [String(sheets[0]?.code ?? code)])) matchedCompanionCodes.add(ref);
    return createMatchResult({
      status: MATCH_STATUSES.EXACT,
      reasons: [viaCircuit ? 'NORMALIZED_UMLAUF_CODE' : 'EXACT_UMLAUF_CODE'],
      primaryRefs: [code],
      companionRefs
    });
  });

  // Umlauftafel circulations not referenced by any schedule Umlauf. A sheet reached through its
  // operational circuit is referenced just as much as one reached through its raw string.
  const scheduleCodes = new Set(schedule.umlaeufe.map(u => (u?.code == null ? '' : String(u.code))));
  statistics.missingInSchedule = [...circulationsByCode.keys()]
    .filter(code => !scheduleCodes.has(code) && !matchedCompanionCodes.has(code)).length;

  return { status: aggregateStatus(matches, statistics, validity), matches, warnings, statistics };
}

// Level 3 is consistency-only: it compares fields where BOTH sides carry them and returns
// warnings. It never changes a match status.
function level3Consistency(umlauf, circulation) {
  const warnings = [];
  const circulationLine = firstSegmentField(circulation, 'line');
  if (umlauf.line != null && circulationLine != null && String(umlauf.line) !== String(circulationLine)) {
    warnings.push(warn('LINE_CONSISTENCY_WARNING', { umlaufCode: String(umlauf.code) }));
  }
  return warnings;
}

function firstSegmentField(circulation, field) {
  const segment = (circulation?.segments || []).find(s => s?.[field] != null);
  return segment ? segment[field] : null;
}

function aggregateStatus(matches, statistics, validity) {
  if (statistics.ambiguous > 0 || matches.some(m => m.status === MATCH_STATUSES.AMBIGUOUS)) return MATCH_STATUSES.AMBIGUOUS;
  const allExact = matches.length > 0 && matches.every(m => m.status === MATCH_STATUSES.EXACT);
  if (!allExact || statistics.missingInSchedule !== 0) return MATCH_STATUSES.UNMATCHED;
  // Every circulation matched — but only a PROVEN validity may be automated. An unconfirmed one
  // becomes `probable`, which the contract defines as "requires explicit manual confirmation".
  return validity?.status === COMPATIBLE ? MATCH_STATUSES.EXACT : MATCH_STATUSES.PROBABLE;
}
