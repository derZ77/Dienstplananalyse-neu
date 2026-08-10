/**
 * Shared CanonicalSchedule interruption contract.
 *
 * The import source may establish a pause, turnaround, service interruption or
 * walking time differently. Once it is known, consumers receive the same
 * source-neutral shape. This module contains no rule evaluation.
 */

export const CANONICAL_INTERRUPTION_KINDS = Object.freeze({
  PAUSE: 'pause',
  TURNAROUND: 'turnaround',
  INTERRUPTION: 'interruption',
  WALKING_TIME: 'walkingTime'
});

const text = value => String(value ?? '').trim();

/**
 * Produces the common time-event shape used in `schedule.interruptions` and
 * `service.interruptions`. Existing source details are intentionally retained.
 */
export function createCanonicalInterruption(input = {}) {
  const startLocation = text(input.startLocation ?? input.location?.start);
  const endLocation = text(input.endLocation ?? input.location?.end);
  return {
    ...input,
    type: input.type || 'serviceInterruption',
    kind: input.kind || CANONICAL_INTERRUPTION_KINDS.INTERRUPTION,
    start: input.start ?? null,
    end: input.end ?? null,
    durationMinutes: Number.isInteger(input.durationMinutes) ? input.durationMinutes : null,
    startLocation,
    endLocation,
    location: { start: startLocation, end: endLocation },
    source: input.source ?? null,
    serviceId: input.serviceId ?? null,
    serviceNumber: input.serviceNumber ?? null
  };
}

/**
 * Adds already established interruption records to the common CanonicalSchedule
 * arrays. It does not parse files or reinterpret rules and never mutates input.
 */
export function attachCanonicalInterruptions(schedule, additions = []) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');

  const existing = Array.isArray(schedule.interruptions) ? schedule.interruptions : [];
  const merged = uniqueById([...existing, ...additions].map(createCanonicalInterruption));
  const byService = new Map();
  merged.forEach(entry => {
    if (!entry.serviceId) return;
    const list = byService.get(entry.serviceId) || [];
    list.push(entry);
    byService.set(entry.serviceId, list);
  });

  const services = (schedule.services || []).map(service => {
    const own = byService.get(service.id) || [];
    if (!own.length) return service;
    return { ...service, interruptions: own };
  });

  return {
    ...schedule,
    services,
    interruptions: merged,
    metadata: { ...schedule.metadata, interruptionCount: merged.length }
  };
}

function uniqueById(entries) {
  const ids = new Set();
  return entries.filter((entry, index) => {
    const key = entry.id || `${entry.serviceId}|${entry.start?.value || ''}|${entry.end?.value || ''}|${index}`;
    if (ids.has(key)) return false;
    ids.add(key);
    return true;
  });
}
