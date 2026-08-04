import { createRouteIdentity } from './route-identity.js';
import { createServiceIdentity } from './service-identity.js';

/**
 * Central identity normalization — the SINGLE place where operational circuit
 * notations are interpreted. No downstream component (AnalysisCore, CheckRunner,
 * Legacy Migration, UI) may re-parse notations; they read the resulting
 * RouteIdentity / ServiceIdentity objects only.
 *
 * Interpretation is driven by Betrieb / Datenquelle / Notationsformat. The format
 * descriptors below are the only interpretation rules; `context` (operator,
 * source) may scope them in a later step. Today the four supported notations are
 * mutually distinguishable by format alone:
 *
 *   "12/1"   → RouteIdentity  LINE_COURSE line=12 course=1
 *   "12100"  → RouteIdentity  LINE_COURSE line=12 course=1  (key identical to 12/1)
 *   "412/16" → RouteIdentity  LINE_TRIP   line=412 trip=16
 *   "7511"   → ServiceIdentity dienst=751 umlauf=1  (no RouteIdentity)
 */
const FORMAT_DESCRIPTORS = Object.freeze([
  {
    id: 'jng-line-course-slash', // Alt JNG: Linie/Kurs, 1–2-stellige Linie
    pattern: /^(\d{1,2})\/(\d{1,2})$/,
    build: (raw, match) => ({ routeIdentity: createRouteIdentity({ raw, line: match[1], course: match[2], kind: 'LINE_COURSE' }) })
  },
  {
    id: 'jes-line-trip-slash', // JES: Linie/Fahrt, 3-stellige Linie
    pattern: /^(\d{3})\/(\d{1,2})$/,
    build: (raw, match) => ({ routeIdentity: createRouteIdentity({ raw, line: match[1], trip: match[2], kind: 'LINE_TRIP' }) })
  },
  {
    id: 'jng-line-course-packed', // Neu JNG/BEU: LLCPP (Linie 2, Kurs 1, Subteil 2)
    pattern: /^(\d{2})(\d)(\d{2})$/,
    build: (raw, match) => ({ routeIdentity: createRouteIdentity({ raw, line: match[1], course: match[2], kind: 'LINE_COURSE' }) })
  },
  {
    id: 'jes-dienst-umlauf', // JES Übergang: DDDU (Dienst 3, Umlauf 1) — keine Route
    pattern: /^(\d{3})(\d)$/,
    build: (raw, match) => ({ serviceIdentity: createServiceIdentity({ raw, dienst: match[1], umlauf: match[2] }) })
  }
]);

const EMPTY_RESULT = Object.freeze({ routeIdentity: null, serviceIdentity: null });

/**
 * Normalizes a single raw circuit string into at most one identity. A blank
 * value yields neither identity; an unrecognized non-blank value yields an
 * UNKNOWN RouteIdentity that preserves the raw text (nothing is silently lost).
 */
export function normalizeCircuitIdentity(rawInput, context = {}) {
  const raw = String(rawInput ?? '').trim();
  if (raw === '') return { ...EMPTY_RESULT };

  for (const descriptor of selectDescriptors(context)) {
    const match = raw.match(descriptor.pattern);
    if (!match) continue;
    const built = descriptor.build(raw, match);
    return {
      routeIdentity: built.routeIdentity ?? null,
      serviceIdentity: built.serviceIdentity ?? null
    };
  }

  return { routeIdentity: createRouteIdentity({ raw, kind: 'UNKNOWN' }), serviceIdentity: null };
}

/**
 * Additive enrichment: returns a NEW CanonicalSchedule whose activities carry
 * `routeIdentity` and `serviceIdentity`. The input is not mutated and no existing
 * field is removed — backward compatibility is preserved. This function is the
 * only bridge that provides the identity layer inside a CanonicalSchedule; it is
 * intentionally not wired into any existing builder or evaluation.
 */
export function attachCircuitIdentities(canonicalSchedule, context = {}) {
  if (canonicalSchedule?.type !== 'CanonicalSchedule') {
    throw new TypeError('attachCircuitIdentities expects a CanonicalSchedule.');
  }

  const schedule = structuredClone(canonicalSchedule);
  for (const service of schedule.services) {
    for (const activity of service.activities) {
      const { routeIdentity, serviceIdentity } = normalizeCircuitIdentity(activity.circuitNumber, context);
      activity.routeIdentity = routeIdentity;
      activity.serviceIdentity = serviceIdentity;
    }
  }
  // Keep schedule.activities pointing at the same enriched activity objects.
  schedule.activities = schedule.services.flatMap(service => service.activities);
  return schedule;
}

/**
 * Interpretation stays centralized here. `context.operator` / `context.source`
 * may later select an operator-specific descriptor subset; today every descriptor
 * applies and the notation format alone disambiguates the four supported cases.
 */
function selectDescriptors(_context) {
  return FORMAT_DESCRIPTORS;
}
