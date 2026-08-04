/**
 * Controlled live wiring of the JNV parser hardening (Phase 3A.2).
 *
 * This is the ONLY seam that connects the additive hardening layer to a produced
 * CanonicalSchedule. It runs AFTER the (unchanged) canonical builder and attaches
 * a single new `hardened` field — but ONLY for the JNV profile. Every other
 * profile is returned completely unchanged (same object reference). The base
 * CanonicalSchedule shape, keys and the builder itself are never modified.
 *
 * A hardening failure is isolated: the schedule is returned intact with a
 * structured warning instead of the enriched view; no exception reaches callers.
 *
 * Pure, deterministic, local. No new dependency, no network, no storage.
 */

import { buildCanonicalSchedule } from './canonical-schedule-builder.js';
import { enrichJnvSchedule } from './jnv-schedule-hardening.js';

// Activation is bound to the JNV profile only (technical id + fachlicher type).
const JNV_PROFILE_ID = 'beu-stadtbus-v1';
const JNV_DOCUMENT_TYPE = 'jnv_schedule_pdf';

/** True only for the JNV schedule profile. */
export function isJnvHardeningTarget(context = {}) {
  return context.profileId === JNV_PROFILE_ID || context.documentType === JNV_DOCUMENT_TYPE;
}

function hardenedView(hardened) {
  return {
    applied: true,
    services: hardened.services,
    interruptions: hardened.interruptions,
    dayQualifiers: hardened.services.flatMap(service =>
      service.dayQualifiers.map(qualifier => ({ ...qualifier, serviceNumber: service.serviceNumber }))),
    warnings: hardened.warnings,
    timeline: { normalized: true },
    metadata: hardened.metadata
  };
}

function failedView(error) {
  return {
    applied: false,
    services: [],
    interruptions: [],
    dayQualifiers: [],
    // Machine-readable; no raw message / no sensitive full line is embedded.
    warnings: [{ code: 'HARDENING_FAILED', message: 'JNV hardening failed and was skipped', errorName: error?.name ?? 'Error' }],
    timeline: { normalized: false }
  };
}

/**
 * Attaches `canonicalSchedule.hardened` for JNV; returns the schedule untouched
 * otherwise. Never mutates the input and never throws.
 * @param options.enrich injectable enricher (defaults to enrichJnvSchedule) — for tests
 */
export function attachJnvHardening(canonicalSchedule, context = {}, { enrich = enrichJnvSchedule } = {}) {
  if (!isJnvHardeningTarget(context)) return canonicalSchedule;

  let hardened;
  try {
    hardened = hardenedView(enrich(canonicalSchedule));
  } catch (error) {
    hardened = failedView(error);
  }
  return { ...canonicalSchedule, hardened };
}

/**
 * Composition of the existing canonical builder with the JNV hardening seam.
 * For non-JNV contexts this is byte-identical to buildCanonicalSchedule.
 */
export function buildHardenedCanonicalSchedule(scheduleDocument, context = {}, options = {}) {
  return attachJnvHardening(buildCanonicalSchedule(scheduleDocument), context, options);
}
