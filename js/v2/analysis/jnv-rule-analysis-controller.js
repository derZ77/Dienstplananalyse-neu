/**
 * Productive JNV rule-analysis orchestrator (Phase 3H.5, extended in Phase 3I.6) — INTEGRATION ONLY.
 *
 * A thin controller between the structural match and the EXISTING check runner. For a
 * `completed` + `exact` JNV bundle it produces the joint timeline, projects the driving data,
 * detects turnaround candidates with the EXISTING detector, builds the two EXISTING CheckModules
 * (BV008 and the turnaround-quota rule), and runs BOTH in ONE call of the EXISTING
 * `runCheckModules` to obtain ONE EXISTING CheckReport. It owns NO rule logic, NO thresholds, NO
 * outcome of its own, no new engine, no new report, no storage, no network. Every threshold lives
 * in the passed rule configs; the frozen modules do the work. Pure and non-mutating apart from
 * delegating to the async runner.
 *
 * Controller status (distinct from any check status): completed | not_applicable | blocked |
 * failed. `checkReport` is exclusively the return of the existing runner (null when a gate blocks).
 */

import { createJointTimeline } from './joint-timeline.js';
import { validateJointTimeline } from './joint-timeline-validation.js';
import { createDrivingProjection } from './driving-projection.js';
import { validateDrivingProjection } from './driving-projection-validation.js';
import { createDrivingTimeLimitCheck } from './driving-time-limit-check.js';
import { createOneSixthCheck } from './one-sixth-check.js';
import { detectTurnaroundCandidates } from '../rules/one-sixth-turnaround-candidates.js';
import { resolveDutyOperationalDays } from '../schedule/duty-operational-day.js';
import { documentTypeOrganization } from '../documents/document-types.js';
import { runCheckModules } from '../checks/check-runner.js';
import { createBv001Check } from '../checks/bv/bv001.js';
import { createBv002Check } from '../checks/bv/bv002.js';
import { createBv003Check } from '../checks/bv/bv003.js';
import { createBv005Check } from '../checks/bv/bv005.js';
import { createBv007Check } from '../checks/bv/bv007.js';
import { createBv010Check } from '../checks/bv/bv010.js';
import { createBv012Check } from '../checks/bv/bv012.js';
import { createBv014Check } from '../checks/bv/bv014.js';

// The eight BV modules were finished long ago and wired to nothing but their own tests
// (Phase 3I.28). They are connected here as they are — no rule of theirs is reinterpreted.
const BV_CHECK_FACTORIES = Object.freeze([
  createBv001Check, createBv002Check, createBv003Check, createBv005Check,
  createBv007Check, createBv010Check, createBv012Check, createBv014Check
]);

/**
 * Some BV modules read a FLAT `activities` list, others read `services[]`. The Excel path produces
 * only the latter, so the flat list is DERIVED here — a view, never a second source. The imported
 * schedule is left untouched; the derived list is added only when it is absent.
 */
function withFlatActivities(canonicalSchedule) {
  if (Array.isArray(canonicalSchedule?.activities)) return canonicalSchedule;
  const services = Array.isArray(canonicalSchedule?.services) ? canonicalSchedule.services : [];
  return { ...canonicalSchedule, activities: services.flatMap(service => (service?.activities || [])) };
}

function createBvModules(canonicalSchedule, warnings) {
  const bvSchedule = withFlatActivities(canonicalSchedule);
  if (bvSchedule?.type !== 'CanonicalSchedule') {
    warnings.push({ code: 'BV_CHECKS_SKIPPED_UNTYPED_SCHEDULE' });
    return [];
  }
  const modules = [];
  for (const factory of BV_CHECK_FACTORIES) {
    try {
      modules.push(factory({ canonicalSchedule: bvSchedule }));
    } catch (error) {
      warnings.push({ code: 'BV_CHECK_UNAVAILABLE' });
    }
  }
  return modules;
}

// Productive BV008 parameters. Mirrors the frozen `rules/config/shared/driving-time-limit.v1.json`;
// in the browser-only, connect-src 'none' runtime the JSON cannot be fetched, so the productive
// default is embedded here and kept in sync (thresholds still flow through the rule, not the code).
export const DEFAULT_DRIVING_TIME_RULE_CONFIG = Object.freeze({
  ruleId: 'BV008',
  enabled: true,
  maxContinuousDrivingMinutes: 270,
  qualifyingInterruption: Object.freeze({ singleMinimumMinutes: 45, splitSequence: Object.freeze([15, 30]) })
});

// Productive turnaround-quota parameters, mirroring the CONFIRMED values of
// `rules/config/organizations/jnv-one-sixth.v1.json` for the same CSP reason as above. The rule set
// is still `draft` with mandatory parameters open, so it is registered but NOT activated: the rule
// itself reports this regularly as its disabled determination. Activation is a configuration
// decision, never a code decision — nothing here may set this flag to true.
export const DEFAULT_ONE_SIXTH_RULE_CONFIG = Object.freeze({
  ruleId: 'BV015_BV018',
  enabled: false,
  organizations: Object.freeze(['JNV']),
  modes: Object.freeze(['bus', 'tram']),
  requiredRatioNumerator: 1,
  requiredRatioDenominator: 6,
  roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11,
  belowMinimumCreditedMinutes: 0,
  creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: Object.freeze(['exact', 'probable']),
  locationMismatchBlocksCrediting: false,
  sourcePriority: Object.freeze(['umlauftafel', 'schedule_structured', 'schedule_fallback']),
  // Eligibility parameters (Phase 3I.10b), mirroring the same confirmed rule set. Without them the
  // now-live chain would treat every duty as out of scope once the rule set is enabled.
  allowedDayTypes: Object.freeze(['SATURDAY', 'SUNDAY_HOLIDAY']),
  nightShiftIsException: true,
  nightShiftStart: '19:20',
  nightShiftStartInclusive: true,
  nightShiftStartBasis: 'duty_start_time',
  // Phase 3I.15b: line 18 admits a duty to the check, it never reduces its calculation.
  admissionLines: Object.freeze(['18']),
  admissionLineRequiresPureDuty: true
});

/**
 * The duty start the schedule already carries (Phase 3I.10) in absolute minutes, or `null`.
 *
 * Read strictly from the existing `service.begin` of the hardened schedule (with its day offset) —
 * never from a trip, a first movement, a file name, a line, a circulation code or a shift number.
 * The projection metadata holds ONE duty start, so a document whose duties start at different times
 * stays ambiguous and resolves to `null` instead of picking one.
 */
function resolveDutyStartMinutes(canonicalSchedule) {
  const map = resolveServiceStarts(canonicalSchedule);
  const hardened = Array.isArray(canonicalSchedule?.hardened?.services) ? canonicalSchedule.hardened.services : [];
  const services = hardened.length > 0 ? hardened : (Array.isArray(canonicalSchedule?.services) ? canonicalSchedule.services : []);
  // Every duty must contribute a known start, and all of them must agree.
  if (Object.keys(map).length !== services.length) return null;
  const starts = new Set(Object.values(map));
  return starts.size === 1 ? [...starts][0] : null;
}

/**
 * A small `{ serviceNumber: dutyStartMinutes }` map (Phase 3I.10b) so each evaluated circulation can
 * resolve ITS OWN duty start via the service numbers its driving segments already carry. Only
 * numbers — no service objects, no activities, no documents. A duty without a known start is simply
 * absent from the map.
 */
function resolveServiceStarts(canonicalSchedule) {
  // Phase 3I.19: the Excel import produces no `hardened` block, but its plain services carry the
  // very same `begin`. The value is READ, never derived — a duty without one stays absent.
  const hardened = Array.isArray(canonicalSchedule?.hardened?.services) ? canonicalSchedule.hardened.services : [];
  const services = hardened.length > 0 ? hardened : (Array.isArray(canonicalSchedule?.services) ? canonicalSchedule.services : []);
  const map = {};
  for (const service of services) {
    const minutes = service?.begin?.minutesSinceStartOfDay;
    const serviceNumber = service?.serviceNumber;
    if (serviceNumber == null) continue;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) continue;
    map[String(serviceNumber)] = (service.begin.dayOffset ?? 0) * 1440 + minutes;
  }
  return map;
}

/**
 * Organisation and mode for the turnaround-quota rule, taken ONLY from existing, cross-checked
 * metadata: the central document-type → organisation mapping of the already gated primary
 * document, and the Umlauftafel document's own validated mode. Never derived from a file name, a
 * line, a circulation-code length or a vehicle type. A missing or contradictory value stays `null`
 * — the rule's own gates then report it as not applicable instead of guessing an outcome.
 */
function resolveRuleContext(bundle, umlauftafelDocument) {
  const bundleOrganization = documentTypeOrganization(bundle?.primary?.documentType);
  const documentOrganization = typeof umlauftafelDocument?.organization === 'string' ? umlauftafelDocument.organization : null;
  // Phase 3I.19: `legacy_excel_schedule` names a FILE FORMAT, not an operator — it maps to
  // `LEGACY`, which claims nothing about who runs the plan. Where the roster is unattributed this
  // way, the companion's explicit organization decides instead of counting as a contradiction.
  // Two genuinely different claims remain a contradiction and still yield `null`.
  const rosterClaims = bundleOrganization !== UNATTRIBUTED_ORGANIZATIONS_BY_TYPE
    && !UNATTRIBUTED_ORGANIZATIONS.has(bundleOrganization);
  const contradictory = rosterClaims && documentOrganization !== null && documentOrganization !== bundleOrganization;
  const mode = umlauftafelDocument?.mode;
  return {
    organization: contradictory ? null : (rosterClaims ? bundleOrganization : (documentOrganization ?? bundleOrganization)),
    mode: typeof mode === 'string' && mode ? mode : null
  };
}

// The duty-roster document types the import really produces (Phase 3I.19).
const SCHEDULE_DOCUMENT_TYPES = new Set(['jnv_schedule_pdf', 'legacy_excel_schedule']);

// Organizations that name no operator: they must not overrule an explicit one on the companion.
const UNATTRIBUTED_ORGANIZATIONS = new Set(['LEGACY', 'UNKNOWN']);
const UNATTRIBUTED_ORGANIZATIONS_BY_TYPE = Symbol('unattributed');

const controlled = (status, reason, extra = {}) => ({
  attempted: false,
  status,
  reason,
  jointTimeline: null,
  drivingProjection: null,
  checkReport: null,
  warnings: reason ? [{ code: reason }] : [],
  ...extra
});

/**
 * Runs the already registered schedule-only BV modules for a supported JNV PDF
 * without a companion document; Umlauf-dependent checks (BV008 and the
 * eins-zu-sechs rule) stay
 * exclusively in the exact-bundle orchestration below.
 */
export async function runJnvBaseAnalysis({ primaryImport } = {}, deps = {}) {
  const { runChecks = runCheckModules } = deps;
  try {
    const canonicalSchedule = primaryImport?.canonicalSchedule;
    if (!canonicalSchedule || typeof canonicalSchedule !== 'object') {
      return controlled('not_applicable', 'MISSING_CANONICAL_SCHEDULE');
    }
    const warnings = [];
    const modules = createBvModules(canonicalSchedule, warnings);
    if (modules.length === 0) {
      return controlled('not_applicable', 'BV_CHECKS_NOT_AVAILABLE', { warnings });
    }
    const checkReport = await runChecks({
      type: 'AnalysisResult',
      metadata: { source: 'jnv-base-analysis' }
    }, modules);
    return {
      attempted: true,
      status: 'completed',
      reason: null,
      jointTimeline: null,
      drivingProjection: null,
      checkReport,
      warnings
    };
  } catch (error) {
    return controlled('failed', 'JNV_BASE_ANALYSIS_FAILED');
  }
}

/**
 * Creates the existing CheckReport envelope for a supported JES schedule without
 * attaching any JNV-specific CheckModule. The empty module list is intentional:
 * JES has no registered single-schedule rule module in this scope.
 */
export async function runJesBaseAnalysis({ primaryImport } = {}, deps = {}) {
  const { runChecks = runCheckModules } = deps;
  try {
    const canonicalSchedule = primaryImport?.canonicalSchedule;
    if (canonicalSchedule?.type !== 'CanonicalSchedule') {
      return controlled('not_applicable', 'MISSING_CANONICAL_SCHEDULE');
    }
    const checkReport = await runChecks({
      type: 'AnalysisResult',
      metadata: { source: 'jes-base-analysis' }
    }, []);
    return {
      attempted: true,
      status: 'completed',
      reason: null,
      jointTimeline: null,
      drivingProjection: null,
      checkReport,
      warnings: []
    };
  } catch (error) {
    return controlled('failed', 'JES_BASE_ANALYSIS_FAILED');
  }
}

/**
 * @param {{ bundle, primaryImport, companionImport, matching, ruleConfig?, oneSixthConfig? }} input
 * @param {{ buildJointTimeline?, validateTimeline?, buildProjection?, validateProjection?,
 *           buildCheck?, buildOneSixthCheck?, detectTurnarounds?, runChecks? }} [deps]
 * @returns {Promise<{ attempted, status, reason, jointTimeline, drivingProjection, checkReport, warnings }>}
 */
export async function runJnvRuleAnalysis({ bundle, primaryImport, companionImport, matching, ruleConfig = DEFAULT_DRIVING_TIME_RULE_CONFIG, oneSixthConfig = DEFAULT_ONE_SIXTH_RULE_CONFIG } = {}, deps = {}) {
  const {
    buildJointTimeline = createJointTimeline,
    validateTimeline = validateJointTimeline,
    buildProjection = createDrivingProjection,
    validateProjection = validateDrivingProjection,
    buildCheck = createDrivingTimeLimitCheck,
    buildOneSixthCheck = createOneSixthCheck,
    detectTurnarounds = detectTurnaroundCandidates,
    runChecks = runCheckModules
  } = deps;

  try {
    // Gates 1-4: an exact JNV schedule + Umlaufkarte bundle.
    if (!bundle || typeof bundle !== 'object') return controlled('not_applicable', 'NO_BUNDLE');
    if (bundle.compatibility?.status !== 'exact') return controlled('not_applicable', 'BUNDLE_NOT_EXACT');
    // Phase 3I.19: both duty-roster types the import really produces — the Excel roster yields an
    // equally complete CanonicalSchedule and was refused for its label alone.
    if (!SCHEDULE_DOCUMENT_TYPES.has(bundle.primary?.documentType) || bundle.companion?.documentType !== 'umlaufkarte') return controlled('not_applicable', 'INVALID_DOCUMENT_PAIR');

    // Gates 5-7: a completed structural match that is not a proven contradiction. Phase 3I.19: the
    // per-circulation filter inside the joint timeline is the automation gate — one ambiguous
    // circulation must not silence every other one. A weaker aggregate is carried as a warning.
    if (!matching || typeof matching !== 'object') return controlled('not_applicable', 'NO_MATCHING');
    if (matching.status !== 'completed') return controlled('not_applicable', 'MATCHING_NOT_COMPLETED');
    if (!matching.matchResult || typeof matching.matchResult !== 'object') return controlled('not_applicable', 'MATCH_NOT_EXACT');
    if (matching.matchResult.status === 'conflicting') return controlled('not_applicable', 'MATCH_CONFLICTING');

    // Gates 8-9: usable schedule + Umlauftafel sources (inputs only, never copied out).
    const importedSchedule = primaryImport?.canonicalSchedule;
    if (!importedSchedule || typeof importedSchedule !== 'object') return controlled('not_applicable', 'MISSING_CANONICAL_SCHEDULE');
    // Phase 3I.23: the roster states clock times without a day, so a night duty runs backwards and
    // nothing can ever fall inside its window. The resolver adds the day offsets the duty itself
    // implies — the imported schedule stays untouched, this is a resolved COPY.
    const dutyDays = resolveDutyOperationalDays(importedSchedule);
    const canonicalSchedule = dutyDays.schedule;
    const umlauftafelDocument = companionImport?.document;
    if (!umlauftafelDocument || typeof umlauftafelDocument !== 'object') return controlled('not_applicable', 'MISSING_UMLAUFTAFEL_DOCUMENT');

    // Gate 10: joint timeline (frozen builder), applicable + structurally valid.
    const jointTimeline = buildJointTimeline({ bundle, canonicalSchedule, umlauftafelDocument, matchResult: matching.matchResult });
    if (!jointTimeline || jointTimeline.metadata == null) return controlled('not_applicable', 'JOINT_TIMELINE_NOT_APPLICABLE');
    if (!validateTimeline(jointTimeline).valid) return controlled('blocked', 'INVALID_JOINT_TIMELINE', { jointTimeline });

    // Gate 11: driving projection (frozen builder), applicable + structurally valid. Only the
    // already-explicit interruptions carried by the projection are used — no new interpretation.
    // The duty start is resolved from the already-read schedule and forwarded to the projection
    // (Phase 3I.10); the projection only carries it, it computes nothing.
    const drivingProjection = buildProjection({ jointTimeline, dutyStartMinutes: resolveDutyStartMinutes(canonicalSchedule) });
    if (!drivingProjection || drivingProjection.metadata == null) return controlled('not_applicable', 'DRIVING_PROJECTION_NOT_APPLICABLE', { jointTimeline });
    if (!validateProjection(drivingProjection).valid) return controlled('blocked', 'INVALID_DRIVING_PROJECTION', { jointTimeline, drivingProjection });

    // Turnaround candidates from the EXISTING detector, fed exclusively from the Umlauftafel
    // document that was already loaded above — no second read, no second workbook, no schedule
    // fallback of its own (no `scheduleView` is passed on purpose). A detector failure is isolated:
    // the rule then reports it as its own non-committal determination, and BV008 stays unaffected.
    const warnings = [...dutyDays.warnings];
    if (matching.matchResult.status !== 'exact') warnings.push({ code: 'MATCH_NOT_FULLY_EXACT', matchStatus: matching.matchResult.status });
    let turnaroundDetection = null;
    try {
      turnaroundDetection = detectTurnarounds({
        umlauftafelDocument,
        sourcePriority: oneSixthConfig?.sourcePriority,
        crediting: {
          minimumObservedSpanMinutes: oneSixthConfig?.minimumObservedSpanMinutes,
          belowMinimumCreditedMinutes: oneSixthConfig?.belowMinimumCreditedMinutes
        }
      });
    } catch (error) {
      turnaroundDetection = null;
      warnings.push({ code: 'TURNAROUND_DETECTION_FAILED' });
    }

    // Existing infrastructure only: both CheckModules built by their existing factories and run by
    // ONE call of the existing runner, in one existing CheckReport. Each rule maps an
    // invalid/disabled config or missing data to its own controlled result — no throw here, and no
    // status, severity or outcome is decided or rewritten in this controller.
    // The BV modules read the schedule only; a failing one must never take the others with it, so
    // each is built inside its own boundary and the runner reports it as its own error.
    // The BV modules insist on a typed CanonicalSchedule. A schedule without that type would make
    // ALL of them throw at run time and fill the report with eight identical errors — so they are
    // attached only when the input is one, and their absence is stated once.
    const bvModules = createBvModules(canonicalSchedule, warnings);

    const modules = [
      ...bvModules,
      buildCheck({ drivingProjection, ruleConfig }),
      // The eligibility input carries the duty start only; organisation, mode, day type and the
      // segment lines already travel through the context and the projection (Phase 3I.10).
      buildOneSixthCheck({ drivingProjection, turnaroundDetection, ruleConfig: oneSixthConfig, context: resolveRuleContext(bundle, umlauftafelDocument), eligibility: { dutyStartMinutes: drivingProjection.metadata.dutyStartTime ?? null, serviceStarts: resolveServiceStarts(canonicalSchedule) } })
    ];
    const analysisResult = {
      type: 'AnalysisResult',
      metadata: { source: 'jnv-rule-analysis', serviceRegime: drivingProjection.metadata.serviceRegime ?? null, dayType: drivingProjection.metadata.dayType ?? null }
    };
    const checkReport = await runChecks(analysisResult, modules);
    return { attempted: true, status: 'completed', reason: null, jointTimeline, drivingProjection, checkReport, warnings };
  } catch (error) {
    // Any unexpected error is isolated from the productive UI path.
    return controlled('failed', 'JNV_RULE_ANALYSIS_FAILED');
  }
}
