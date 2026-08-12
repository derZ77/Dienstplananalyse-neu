/**
 * Productive JNV structural matching orchestrator (Phase 3G.3).
 *
 * Wires the frozen 3G.1/3G.2 pieces behind strict execution gates: it resolves validity,
 * builds + validates the extended schedule match view, validates the match input, and only
 * then runs the unchanged `matchJnvBundle`. It performs NO operational rule evaluation, no
 * scoring, no storage, no network. Pure and non-mutating.
 *
 * The controller status (idle | blocked | completed | failed) is DISTINCT from the frozen
 * match status. `matchResult` is exclusively the return of `matchJnvBundle`; the full
 * CanonicalSchedule and Umlauftafel document remain inputs only (never copied out).
 */

import { resolveJnvScheduleValidity } from './jnv-schedule-validity.js';
import { buildExtendedScheduleMatchView } from './jnv-schedule-match-view.js';
import { validateExtendedScheduleMatchView } from './jnv-schedule-match-view-validation.js';
import { matchJnvBundle } from './jnv-bundle-matcher.js';
import { validateJnvMatchInput } from './jnv-match-validation.js';

const warn = (code) => ({ code });

function blocked(reason, { validity = null, scheduleViewValid = false } = {}) {
  return { attempted: false, status: 'blocked', reason, validity, scheduleViewValid, matchResult: null, warnings: [warn(reason)] };
}

/**
 * @param {{ bundle:object, primaryImport:object, companionImport:object, metadata?:object }} input
 * @param {{ resolveValidity?, buildView?, validateView?, validateInput?, runMatch? }} [deps] test seams; defaults are the frozen modules
 * @returns {{ attempted, status, reason, validity, scheduleViewValid, matchResult, warnings }}
 */
export function runJnvStructuralMatching({ bundle, primaryImport, companionImport, metadata = {} } = {}, deps = {}) {
  const {
    resolveValidity = resolveJnvScheduleValidity,
    buildView = buildExtendedScheduleMatchView,
    validateView = validateExtendedScheduleMatchView,
    validateInput = validateJnvMatchInput,
    runMatch = matchJnvBundle
  } = deps;

  try {
    // Gate 1: bundle present.
    if (!bundle || typeof bundle !== 'object') return blocked('JNV_MATCHING_NOT_APPLICABLE');
    // Gate 2: bundle compatibility exact.
    if (bundle.compatibility?.status !== 'exact') return blocked('BUNDLE_NOT_EXACT');
    // Gate 3/4: JNV schedule primary + Umlaufkarte companion.
    if (bundle.primary?.documentType !== 'jnv_schedule_pdf' || bundle.companion?.documentType !== 'umlaufkarte') return blocked('INVALID_DOCUMENT_PAIR');
    // Gate 5: usable CanonicalSchedule.
    const canonicalSchedule = primaryImport?.canonicalSchedule;
    if (!canonicalSchedule || typeof canonicalSchedule !== 'object') return blocked('MISSING_CANONICAL_SCHEDULE');
    // Gate 6: validated Umlauftafel document.
    const umlauftafel = companionImport?.document;
    if (!umlauftafel || typeof umlauftafel !== 'object') return blocked('MISSING_UMLAUFTAFEL_DOCUMENT');

    // Validity: the controller only ASSEMBLES sources; the frozen resolver decides.
    const title = typeof primaryImport?.detection?.title === 'string' && primaryImport.detection.title
      ? primaryImport.detection.title
      : (typeof metadata.title === 'string' ? metadata.title : null);
    const canonicalValidity = canonicalSchedule.validity && typeof canonicalSchedule.validity === 'object'
      ? canonicalSchedule.validity
      : null;
    // The primary document remains authoritative. A user-selected UNKNOWN must
    // not silently fall back to a companion/title-derived weekday for matching.
    if (canonicalValidity?.dayTypeSource === 'MANUAL' && canonicalValidity.dayType === 'unknown') {
      return blocked('VALIDITY_NOT_EXACT', {
        validity: {
          serviceRegime: canonicalValidity.serviceRegime ?? 'unknown',
          dayType: 'unknown',
          confidence: 'unknown'
        }
      });
    }
    const validity = resolveValidity({
      canonicalSchedule,
      hardened: canonicalSchedule.hardened ?? null,
      detection: primaryImport?.detection ?? null,
      profile: primaryImport?.detection?.profile ?? null,
      sourceName: typeof metadata.sourceName === 'string' ? metadata.sourceName : null,
      metadata: { title },
      manualDayType: canonicalValidity?.dayTypeSource === 'MANUAL' ? canonicalValidity.dayType : null
    });
    const validitySummary = { serviceRegime: validity.serviceRegime, dayType: validity.dayType, confidence: validity.confidence };

    // Gate 7: validity must be exact (ambiguous/probable/unknown never auto-matches).
    if (validity.confidence !== 'exact') return blocked('VALIDITY_NOT_EXACT', { validity: validitySummary });

    // Extended view + Gate 8.
    const view = buildView({ canonicalSchedule, validity });
    if (!validateView(view).valid) return blocked('INVALID_SCHEDULE_MATCH_VIEW', { validity: validitySummary });

    // Gate 9: match input valid.
    if (!validateInput({ bundle, schedule: view, umlauftafel }).valid) return blocked('INVALID_JNV_MATCH_INPUT', { validity: validitySummary, scheduleViewValid: true });

    // Frozen matcher — the only place a match is produced.
    const matchResult = runMatch({ bundle, schedule: view, umlauftafel });
    return { attempted: true, status: 'completed', reason: null, validity: validitySummary, scheduleViewValid: true, matchResult, warnings: [] };
  } catch (error) {
    // A programmer/unexpected error is isolated from the productive UI path.
    return { attempted: true, status: 'failed', reason: 'JNV_MATCHING_FAILED', validity: null, scheduleViewValid: false, matchResult: null, warnings: [warn('JNV_MATCHING_FAILED')] };
  }
}
