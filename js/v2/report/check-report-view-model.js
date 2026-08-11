/**
 * Presentation projection of the existing CheckReport (Phase 3I.34) — A PURE CONSUMER.
 *
 * It reads one CheckReport and produces what a works council needs to read it. It runs no check,
 * moves no threshold, rewrites no status, computes no hit count of its own, and never mutates the
 * report it was handed. There is exactly ONE report in the system; this is a view of it.
 *
 * WORDING IS PART OF THE CONTRACT
 * -------------------------------
 * A FAIL is the outcome of one rule module against one plan. It is presented as a
 * "Prüfauffälligkeit" — something to look at — never as a proven breach of law. The frozen status
 * and severity values travel through untouched; only a readable label is added beside them.
 *
 * RELIEF CHAINS (Variante B)
 * --------------------------
 * Where a rule names duties and a schedule is available, the documented relief chain is attached
 * AS INFORMATION next to the finding. It changes no status, hides nothing, and is never phrased as
 * proven compliance. A missing or one-sided chain is shown as exactly that.
 *
 * Pure: no I/O, no storage, no network, no current time, no random, no DOM.
 */

import { classifyBv003Findings } from '../excel/excel-handover-chain.js';
import { getProfile } from '../documents/document-profiles.js';

/**
 * Reads the report's context out of the EXISTING session snapshot (Phase 3I.35).
 *
 * The productive path already holds this state when it hands the CheckReport over; nothing is
 * re-analysed, nothing is copied, and the schedule is passed on as the SAME reference. Only fields
 * the session demonstrably carries are used — a file name is never a source, and an absent field
 * stays `null` rather than becoming a guess.
 *
 * @param {object} state the multi-document session snapshot
 * @returns {{canonicalSchedule: object|null, metadata: {organization: string|null,
 *   documentType: string|null, dayType: string|null, serviceCount: number|null}}}
 */
export function deriveReportContext(state) {
  const primary = state && typeof state === 'object' ? state.primaryImport : null;
  const candidate = primary && typeof primary === 'object' ? primary.canonicalSchedule : null;
  const canonicalSchedule = candidate?.type === 'CanonicalSchedule' ? candidate : null;
  const profile = getProfile(primary?.detection?.profile?.id);

  return {
    canonicalSchedule,
    metadata: {
      organization: text(state?.ruleAnalysis?.ruleSet?.organization) || text(profile?.organization) || null,
      documentType: canonicalSchedule ? (text(primary?.documentType) || text(profile?.documentType) || null) : null,
      // The matcher exposes the resolved day type as `dayType`; older callers used
      // `scheduleDayType`. Both are already present session fields, so this is a direct
      // hand-over rather than a title/file-name inference.
      dayType: text(state?.matching?.validity?.dayType)
        || text(state?.matching?.validity?.scheduleDayType)
        || null,
      serviceCount: canonicalSchedule && Array.isArray(canonicalSchedule.services)
        ? canonicalSchedule.services.length
        : null
    }
  };
}

/** Readable labels for the frozen status vocabulary. The values themselves are never replaced. */
export const REPORT_STATUS_LABELS = Object.freeze({
  PASS: 'Bestanden',
  FAIL: 'Prüfauffälligkeit',
  SKIP: 'Übersprungen',
  NOT_APPLICABLE: 'Nicht anwendbar'
});

export const REPORT_SEVERITY_LABELS = Object.freeze({
  INFO: 'Hinweis',
  WARNING: 'Warnung',
  VIOLATION: 'Regel nicht erfüllt',
  ERROR: 'Technischer Fehler'
});

/** A decorative symbol per status; the meaning always travels in the text label beside it. */
export const REPORT_STATUS_SYMBOLS = Object.freeze({
  PASS: '✓', FAIL: '!', SKIP: '–', NOT_APPLICABLE: '·'
});

const UNKNOWN_LABEL = 'Unbekannt';
const text = (value) => String(value ?? '').trim();
const known = (map, value) => Object.prototype.hasOwnProperty.call(map, value);

/** Small scalars only — a nested document must never travel into a view. */
function projectDetails(details) {
  const projected = {};
  if (!details || typeof details !== 'object') return projected;
  for (const [key, value] of Object.entries(details)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      projected[key] = value;
    } else if (Array.isArray(value) && value.every(entry => entry === null || ['string', 'number', 'boolean'].includes(typeof entry))) {
      projected[key] = [...value];
    }
    // Anything else — objects, arrays of objects, buffers, workbooks — is deliberately dropped.
  }
  return projected;
}

/**
 * A technical runner error, reduced to what a reader may see: which module, which code, one short
 * message. No stack trace, no path, no Error object — those never leave the runner.
 */
function projectRunnerError(error) {
  return {
    module: text(error?.module?.id) || text(error?.module?.name) || 'unbekannt',
    code: text(error?.code) || 'UNBEKANNT',
    message: text(error?.message)
  };
}

/** A source reference names WHERE, never WHAT. */
function projectSourceReference(reference) {
  const projected = {};
  if (text(reference?.sheetName)) projected.sheetName = text(reference.sheetName);
  if (Number.isInteger(reference?.rowNumber)) projected.rowNumber = reference.rowNumber;
  return projected;
}

const NOTE_DISABLED_APPROVED = 'Fachlich freigegeben, derzeit nicht aktiviert.';
const NOTE_DISABLED_MEANING = 'Diese Regel wurde nicht ausgewertet und gilt weder als bestanden noch als auffällig.';

const HANDOVER_NOTES = Object.freeze({
  consistent: 'Der Ortswechsel ist laut Dienstplan durch eine dokumentierte Ablösung erklärt. '
    + 'Die Bewertung wurde entsprechend der festgelegten Variante B nicht automatisch verändert.',
  partial: 'Die Ablösekette ist unvollständig: die Gegenseite bestätigt sie im Dienstplan nicht. '
    + 'Die Angabe ist als Hinweis zu lesen, nicht als Nachweis.',
  conflicting: 'Die Ablöseangaben beider Seiten widersprechen sich. '
    + 'Der Ortswechsel ist damit nicht erklärt; eine manuelle Prüfung ist erforderlich.',
  missing: 'Für diesen Dienst ist keine Ablösung dokumentiert. '
    + 'Der abweichende Ort ist damit nicht erklärt; eine manuelle Prüfung ist erforderlich.'
});

/** `2217 → 2211 → 2273`, or the part of it the plan actually declares. */
function chainOf(finding) {
  const parts = [finding.previousServiceNumber, finding.serviceNumber, finding.nextServiceNumber].filter(Boolean);
  return parts.length > 1 ? parts.join(' → ') : null;
}

/**
 * The relief information for the duties a rule NAMES — not for the whole plan. Derived from the
 * existing chain module, so there is one interpretation site and not two.
 */
function handoverFor(result, canonicalSchedule) {
  const affected = Array.isArray(result?.affectedServices) ? result.affectedServices : [];
  if (!affected.length || canonicalSchedule?.type !== 'CanonicalSchedule') return [];

  const numbers = new Set((canonicalSchedule.services || [])
    .filter(service => affected.includes(service.id))
    .map(service => text(service.serviceNumber)));
  if (!numbers.size) return [];

  let findings;
  try {
    findings = classifyBv003Findings(canonicalSchedule);
  } catch (error) {
    return [];                                     // the report must render even without the audit
  }

  return findings
    .filter(finding => numbers.has(finding.serviceNumber))
    .map(finding => ({
      serviceNumber: finding.serviceNumber,
      startLocation: finding.startLocation,
      endLocation: finding.endLocation,
      previousServiceNumber: finding.previousServiceNumber,
      nextServiceNumber: finding.nextServiceNumber,
      chain: chainOf(finding),
      evidence: finding.handoverEvidence,
      classification: finding.auditClassification,
      note: HANDOVER_NOTES[finding.handoverEvidence] ?? HANDOVER_NOTES.missing
    }));
}

/**
 * The duty NUMBERS behind the ids a check reports — so a reader can act on them. Only numbers the
 * schedule really carries are listed; an id without a match is left out rather than invented.
 */
function affectedServiceNumbers(affected, canonicalSchedule) {
  if (!affected.length || canonicalSchedule?.type !== 'CanonicalSchedule') return [];
  const byId = new Map((canonicalSchedule.services || []).map(service => [service.id, text(service.serviceNumber)]));
  return affected.map(id => byId.get(id)).filter(number => Boolean(number));
}

function projectResult(result, canonicalSchedule) {
  const status = text(result?.status);
  const severity = text(result?.severity);
  const originalStatus = text(result?.details?.originalStatus) || null;
  const isDisabled = originalStatus === 'DISABLED';
  const notes = [];
  if (isDisabled) notes.push(NOTE_DISABLED_APPROVED, NOTE_DISABLED_MEANING);

  const handover = handoverFor(result, canonicalSchedule);
  const affectedServices = Array.isArray(result?.affectedServices) ? [...result.affectedServices] : [];
  const affectedActivities = Array.isArray(result?.affectedActivities) ? [...result.affectedActivities] : [];

  return {
    id: text(result?.id),
    name: text(result?.name),
    category: text(result?.category),
    status,
    statusLabel: known(REPORT_STATUS_LABELS, status) ? REPORT_STATUS_LABELS[status] : UNKNOWN_LABEL,
    statusSymbol: known(REPORT_STATUS_SYMBOLS, status) ? REPORT_STATUS_SYMBOLS[status] : '?',
    severity,
    severityLabel: known(REPORT_SEVERITY_LABELS, severity) ? REPORT_SEVERITY_LABELS[severity] : UNKNOWN_LABEL,
    message: text(result?.message),
    isFinding: status === 'FAIL',
    originalStatus,
    isDisabled,
    notes,
    affectedServices,
    affectedServiceCount: affectedServices.length,
    affectedServiceNumbers: affectedServiceNumbers(affectedServices, canonicalSchedule),
    affectedActivityCount: affectedActivities.length,
    sourceReferences: (Array.isArray(result?.sourceReferences) ? result.sourceReferences : [])
      .map(projectSourceReference).filter(reference => Object.keys(reference).length > 0),
    details: projectDetails(result?.details),
    handover,
    handoverAvailable: handover.length > 0,
    serviceNumbers: handover.map(entry => entry.serviceNumber)
  };
}

function summarise(rows, runnerErrors) {
  const status = { PASS: 0, FAIL: 0, SKIP: 0, NOT_APPLICABLE: 0 };
  const severity = { INFO: 0, WARNING: 0, VIOLATION: 0, ERROR: 0 };
  let unknownStatusCount = 0;

  for (const row of rows) {
    if (known(status, row.status)) status[row.status] += 1; else unknownStatusCount += 1;
    if (known(severity, row.severity)) severity[row.severity] += 1;
  }
  return {
    status,
    severity,
    unknownStatusCount,
    runnerErrors,
    // Only PASS and FAIL mean a rule actually reached a verdict; SKIP and NOT_APPLICABLE do not.
    assessedCount: status.PASS + status.FAIL
  };
}

function matches(row, state) {
  if (state.status && row.status !== state.status) return false;
  if (state.severity && row.severity !== state.severity) return false;
  if (state.findingsOnly && !row.isFinding) return false;
  if (state.handoverOnly && !row.handoverAvailable) return false;
  if (state.search) {
    const needle = state.search.toLocaleLowerCase('de');
    const haystack = [row.id, row.name, ...row.affectedServiceNumbers, ...row.serviceNumbers]
      .join(' ').toLocaleLowerCase('de');
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function normaliseState(state) {
  return {
    search: text(state?.search),
    status: text(state?.status),
    severity: text(state?.severity),
    findingsOnly: state?.findingsOnly === true,
    handoverOnly: state?.handoverOnly === true
  };
}

/**
 * @param {object} checkReport the EXISTING report — never modified
 * @param {{canonicalSchedule?: object, document?: object, servicesEvaluated?: number, state?: object}} [options]
 * @returns {object} the presentation projection
 */
export function buildCheckReportViewModel(checkReport, options = {}) {
  const state = normaliseState(options.state);
  const available = checkReport?.type === 'CheckReport';
  const rawResults = available && Array.isArray(checkReport.results) ? checkReport.results : [];
  const rawErrors = available && Array.isArray(checkReport.errors) ? checkReport.errors : [];
  const runnerErrorDetails = rawErrors.map(projectRunnerError);
  const runnerErrors = runnerErrorDetails.length;

  // The report order is the reading order; it is never re-sorted here.
  const results = rawResults.map(result => projectResult(result, options.canonicalSchedule));
  const summary = summarise(results, runnerErrors);
  const visibleResults = results.filter(row => matches(row, state));

  let emptyReason = null;
  if (!available) emptyReason = 'NO_REPORT';
  else if (results.length === 0) emptyReason = 'NO_RESULTS';
  else if (summary.assessedCount === 0) emptyReason = 'NOTHING_ASSESSED';

  return {
    available,
    emptyReason,
    header: {
      documentTitle: 'Prüfbericht',                       // never a file name, never a path
      documentType: text(options.document?.documentType) || null,
      organization: text(options.document?.organization) || null,
      dayType: text(options.document?.dayType) || null,
      servicesEvaluated: Number.isInteger(options.servicesEvaluated) ? options.servicesEvaluated : null,
      resultCount: results.length,
      findingCount: summary.status.FAIL,
      warningCount: summary.severity.WARNING,
      skippedCount: summary.status.SKIP,
      notApplicableCount: summary.status.NOT_APPLICABLE,
      errorCount: runnerErrors
    },
    summary,
    runnerErrorDetails,
    results,
    visibleResults,
    filteredEmpty: results.length > 0 && visibleResults.length === 0,
    state
  };
}
