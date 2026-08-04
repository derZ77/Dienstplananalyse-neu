/**
 * The relief chain (Ablösekette) of the legacy Excel plan (Phase 3I.32) — IMPORT AND AUDIT ONLY.
 *
 * The plan prints two columns next to every duty leg:
 *
 *     [12] "vorher. Dienst"   the duty this leg was taken over FROM
 *     [13] "nächst. Dienst"   the duty this leg is handed over TO
 *
 * They sit on the LEG, not on the duty: a duty running three circuits carries up to three
 * takeovers and three handovers. Reading them per duty would invent contradictions that the plan
 * does not contain — on the real Mo–Fr plan a duty-level reading produced 21 apparent conflicts,
 * while the leg-level reading finds NONE.
 *
 * This module does three things, and nothing else:
 *   1. it reads those two columns into a small, explicit structure,
 *   2. it describes whether both sides of a handover agree,
 *   3. it classifies today's BV003 findings against that description.
 *
 * IT DECIDES NOTHING. BV003 is not called, not changed and not suppressed; whether a confirmed
 * relief chain should excuse a differing end location is a business decision, not a code one.
 *
 * Only values the plan actually prints are taken. Nothing is derived from proximity, from the
 * clock, from a line or circuit number, from the file name, or from the order of the rows. An
 * empty cell stays null; a broken cell yields a warning, never a relation.
 *
 * Pure: no I/O, no mutation of its input, no current time, no network, no storage.
 */

const text = (value) => String(value ?? '').trim();

/**
 * Reads one handover cell. A duty number is a plain sequence of digits — nothing else qualifies.
 *
 * @returns {{value: string|null, valid: boolean}} `valid: false` marks a cell that HAS content but
 *   is not a duty number; an empty cell is valid and simply declares nothing.
 */
export function parseHandoverReference(raw) {
  const value = text(raw);
  if (value === '') return { value: null, valid: true };
  return /^\d+$/.test(value) ? { value, valid: true } : { value: null, valid: false };
}

const EMPTY_HANDOVER = Object.freeze({
  previousServiceNumber: null, nextServiceNumber: null,
  takeoverLocation: null, takeoverTime: null, takeoverCircuit: null,
  handoverLocation: null, handoverTime: null, handoverCircuit: null,
  sourceRefs: []
});

const nullable = (value) => text(value) === '' ? null : text(value);

/** The per-leg references, with invalid cells reported rather than silently dropped. */
function legHandover(activity) {
  const previous = parseHandoverReference(activity?.handoverSource?.previous);
  const next = parseHandoverReference(activity?.handoverSource?.next);
  return {
    previousServiceNumber: previous.value,
    nextServiceNumber: next.value,
    invalid: (previous.valid ? 0 : 1) + (next.valid ? 0 : 1)
  };
}

/**
 * Summarises a duty: the FIRST leg that was taken over, and the LAST leg that is handed on.
 * Those two are what a duty's start and end location depend on.
 */
function serviceHandover(activities) {
  const legs = activities.map(activity => ({ activity, ...legHandover(activity) }));
  const takeover = legs.find(leg => leg.previousServiceNumber);
  const handover = [...legs].reverse().find(leg => leg.nextServiceNumber);
  const sourceRefs = [];
  if (takeover) sourceRefs.push({ activityId: takeover.activity.id, rowNumber: takeover.activity.source?.rowNumber ?? null, role: 'takeover' });
  if (handover) sourceRefs.push({ activityId: handover.activity.id, rowNumber: handover.activity.source?.rowNumber ?? null, role: 'handover' });

  return {
    handover: {
      previousServiceNumber: takeover?.previousServiceNumber ?? null,
      nextServiceNumber: handover?.nextServiceNumber ?? null,
      takeoverLocation: takeover ? nullable(takeover.activity.departureLocation) : null,
      takeoverTime: takeover ? (takeover.activity.departureTime?.value ?? null) : null,
      takeoverCircuit: takeover ? nullable(takeover.activity.circuitNumber) : null,
      handoverLocation: handover ? nullable(handover.activity.arrivalLocation) : null,
      handoverTime: handover ? (handover.activity.arrivalTime?.value ?? null) : null,
      handoverCircuit: handover ? nullable(handover.activity.circuitNumber) : null,
      sourceRefs
    },
    invalid: legs.reduce((sum, leg) => sum + leg.invalid, 0),
    legs
  };
}

/**
 * Attaches the relief chain to a CanonicalSchedule: per activity and, summarised, per service.
 * ADDITIVE and non-mutating — a new schedule is returned.
 */
export function attachExcelHandoverData(schedule) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');
  const warnings = [...(schedule.warnings || [])];

  const services = (schedule.services || []).map(service => {
    const activities = (service.activities || []).map(activity => {
      const { previousServiceNumber, nextServiceNumber } = legHandover(activity);
      return { ...activity, handover: { previousServiceNumber, nextServiceNumber } };
    });
    const summary = serviceHandover(service.activities || []);
    for (let i = 0; i < summary.invalid; i++) {
      // Privacy-safe: the code names the problem, never the offending cell content.
      warnings.push({ code: 'EXCEL_HANDOVER_REFERENCE_INVALID', severity: 'warning', message: '', scope: 'service' });
    }
    return { ...service, activities, handover: summary.handover };
  });

  return { ...schedule, services, activities: services.flatMap(service => service.activities), warnings };
}

/** Every leg of `service` that declares it was taken over from `fromServiceNumber`. */
function counterparts(service, fromServiceNumber) {
  return (service.activities || []).filter(activity => activity.handover?.previousServiceNumber === fromServiceNumber);
}

/**
 * Describes the relief chain of a whole schedule. It REPORTS; it never repairs, completes or
 * removes a relation.
 *
 * @returns {{links: Array<object>, summary: object}}
 */
export function auditHandoverChain(schedule) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');
  const services = schedule.services || [];
  const byNumber = new Map(services.map(service => [text(service.serviceNumber), service]));
  const links = [];

  for (const service of services) {
    const from = text(service.serviceNumber);
    for (const activity of service.activities || []) {
      const to = activity.handover?.nextServiceNumber;
      if (!to) continue;
      const other = byNumber.get(to);
      const matches = other ? counterparts(other, from) : [];
      const counterpart = matches[0] ?? null;

      let evidence;
      if (!other) evidence = 'missing';                                        // names a duty the plan does not contain
      else if (counterpart) evidence = 'consistent';                           // both sides agree
      else if ((other.activities || []).some(a => a.handover?.previousServiceNumber)) evidence = 'conflicting';
      else evidence = 'partial';                                               // the other side says nothing

      links.push({
        fromServiceNumber: from,
        toServiceNumber: to,
        location: nullable(activity.arrivalLocation),
        time: activity.arrivalTime?.value ?? null,
        counterpartLocation: counterpart ? nullable(counterpart.departureLocation) : null,
        locationMatches: counterpart ? nullable(counterpart.departureLocation) === nullable(activity.arrivalLocation) : null,
        evidence
      });
    }
  }

  const count = (value) => links.filter(link => link.evidence === value).length;
  return {
    links,
    summary: {
      servicesWithPrevious: services.filter(s => s.handover?.previousServiceNumber).length,
      servicesWithNext: services.filter(s => s.handover?.nextServiceNumber).length,
      declaredHandovers: links.length,
      mutual: count('consistent'),
      oneSided: count('partial'),
      conflicting: count('conflicting'),
      dangling: count('missing')
    }
  };
}

/**
 * The first departure and the last arrival location of the duty's actual LEGS.
 *
 * Derived break activities are excluded on purpose. Phase 3I.30 appends them to the end of the
 * activity list, so a plain "last activity with an arrival location" lands on the break rather
 * than on the leg the duty really ends with. BV003 has no such exclusion today — which is exactly
 * why the two can disagree, and why that disagreement is reported instead of hidden.
 */
function endpointsOf(service) {
  const activities = (service.activities || []).filter(activity => activity.activityType !== 'unpaidBreak');
  const first = activities.find(activity => text(activity.departureLocation));
  const last = [...activities].reverse().find(activity => text(activity.arrivalLocation));
  return {
    first, last,
    startLocation: first ? text(first.departureLocation) : null,
    endLocation: last ? text(last.arrivalLocation) : null
  };
}

/**
 * Classifies the duties BV003 flags today against the plan's own relief chain.
 *
 * The result is an AUDIT ARTEFACT. It changes no verdict and touches no frozen contract:
 * `currentBv003Status` records what BV003 says TODAY, and `auditClassification` says only whether
 * the chain explains it.
 *
 * @param {object} schedule
 * @param {{bv003AffectedServiceIds?: string[]|null}} [options] the duties BV003 actually flags on
 *   this schedule; pass them so `currentBv003Status` is the check's own answer rather than an
 *   assumption. Without them every classified duty is recorded as FAIL.
 * @returns {Array<{serviceNumber: string, currentBv003Status: string, startLocation: string|null,
 *   endLocation: string|null, previousServiceNumber: string|null, nextServiceNumber: string|null,
 *   handoverEvidence: 'consistent'|'partial'|'conflicting'|'missing',
 *   auditClassification: 'explained_by_handover'|'unexplained'|'inconclusive'}>}
 */
export function classifyBv003Findings(schedule, { bv003AffectedServiceIds = null } = {}) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');
  const flagged = bv003AffectedServiceIds === null ? null : new Set(bv003AffectedServiceIds);
  const services = schedule.services || [];
  const byNumber = new Map(services.map(service => [text(service.serviceNumber), service]));
  const findings = [];

  for (const service of services) {
    const { first, last, startLocation, endLocation } = endpointsOf(service);
    // BV003 compares only where BOTH endpoints exist; an unknown one is no deviation.
    const bothKnown = startLocation !== null && endLocation !== null;
    if (bothKnown && startLocation === endLocation) continue;
    if (!bothKnown && startLocation === null && endLocation === null) continue;

    const from = text(service.serviceNumber);
    // The BOUNDARY legs, not the duty summary: BV003 compares the first departure against the last
    // arrival, so only a takeover on the first leg can explain the start location and only a
    // handover on the last leg can explain the end. A duty that leaves the depot on its own and
    // takes over another circuit mid-shift has no takeover to explain its start — and needs none.
    const previousServiceNumber = first?.handover?.previousServiceNumber ?? null;
    const nextServiceNumber = last?.handover?.nextServiceNumber ?? null;

    // Does the named counterpart confirm the handover, AT the location in question?
    const confirms = (otherNumber, role) => {
      const other = byNumber.get(otherNumber);
      if (!other) return false;
      return (other.activities || []).some(activity => role === 'next'
        ? activity.handover?.previousServiceNumber === from && text(activity.departureLocation) === endLocation
        : activity.handover?.nextServiceNumber === from && text(activity.arrivalLocation) === startLocation);
    };

    let handoverEvidence;
    if (!previousServiceNumber && !nextServiceNumber) handoverEvidence = 'missing';
    else {
      const okNext = !nextServiceNumber || confirms(nextServiceNumber, 'next');
      const okPrevious = !previousServiceNumber || confirms(previousServiceNumber, 'previous');
      if (okNext && okPrevious) handoverEvidence = 'consistent';
      else if (okNext || okPrevious) handoverEvidence = 'partial';
      else handoverEvidence = 'conflicting';
    }

    let auditClassification;
    if (!bothKnown) auditClassification = 'inconclusive';                      // a missing endpoint decides nothing
    else if (handoverEvidence === 'consistent') auditClassification = 'explained_by_handover';
    else if (handoverEvidence === 'missing') auditClassification = 'unexplained';
    else auditClassification = 'inconclusive';

    findings.push({
      serviceNumber: from,
      currentBv003Status: flagged === null || flagged.has(service.id) ? 'FAIL' : 'PASS',
      startLocation, endLocation,
      previousServiceNumber, nextServiceNumber,
      handoverEvidence, auditClassification
    });
  }
  return findings;
}
