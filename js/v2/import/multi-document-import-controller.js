/**
 * Multi-document import session controller (Phase 3F) — memory-only, DOM-free.
 *
 * Holds a mandatory primary document and an OPTIONAL companion document, assembles a
 * structural AnalysisBundle when both are present, and — for an exact JNV bundle — runs the
 * structural matcher via the orchestrator. It performs NO operational rule work (no
 * driving-time, no 1-in-6, no deviation analysis). The primary ImportResult is captured from
 * the unchanged single-import path (passed in, never re-analysed); the companion is imported
 * through the existing Excel import and accepted only when it is an exact Wagenkarte or
 * Umlauftafel. Bundle formation delegates to createBundleFromImports; matching to the
 * injectable orchestrator (default runJnvStructuralMatching).
 *
 * State lives only in this closure — no browser storage (Local/Session Storage, IndexedDB,
 * cookies), no network, no global. It resets on reload and on file changes.
 * `id`/`createdAt` are injectable for deterministic tests; the productive default stamps a
 * timestamp once per bundle build here in the controller (documented in the phase report).
 */

import { analyzeExcelImport } from './excel-import-controller.js';
import { createBundleFromImports } from './analysis-bundle-controller.js';
import { runJnvStructuralMatching } from '../matching/jnv-matching-controller.js';
import { runJesBaseAnalysis, runJnvBaseAnalysis, runJnvRuleAnalysis } from '../analysis/jnv-rule-analysis-controller.js';
import { withManualCanonicalDayType } from '../schedule/canonical-validity.js';

const COMPANION_TYPES = new Set(['wagenkarte', 'umlaufkarte']);

let idCounter = 0;
const defaultBundleId = () => `bundle-${++idCounter}`;
const defaultTimestamp = () => new Date().toISOString();

function companionAcceptedStatus(result) {
  if (result.classification.type === 'wagenkarte') return 'Begleitdokument erkannt: Wagenkarte.';
  const mode = result.document?.mode;
  const label = mode === 'tram' ? 'Straßenbahn' : mode === 'bus' ? 'Bus' : 'unbekannt';
  return `Begleitdokument erkannt: Umlauftafel (${label}).`;
}

function combinationStatus(state) {
  if (!state.companionImport) return '';
  if (!state.primaryImport) return 'Bitte zuerst ein Hauptdokument laden.';
  switch (state.bundle?.compatibility?.status) {
    case 'exact': return 'Dokumente können gemeinsam analysiert werden. Die fachliche Zuordnung wurde noch nicht durchgeführt.';
    case 'conflicting': return 'Diese Dokumenttypen gehören nicht als Haupt- und Begleitdokument zusammen.';
    default: return 'Diese Kombination wird derzeit nicht unterstützt.';
  }
}

// Neutral, structural-only status derived from the matching orchestrator result. It never
// reveals per-trip or per-Umlauf detail, individual times, or any operational evaluation.
function matchingStatus(matching) {
  if (!matching) return '';
  if (matching.status === 'blocked') {
    return matching.reason === 'VALIDITY_NOT_EXACT'
      ? 'Die Gültigkeit des Dienstplans konnte nicht eindeutig bestimmt werden. Eine automatische Zuordnung wurde nicht durchgeführt.'
      : 'Für die strukturelle Zuordnung werden ein JNV-Dienstplan und eine passende Umlauftafel benötigt.';
  }
  if (matching.status === 'failed') return 'Die strukturelle Zuordnung konnte nicht durchgeführt werden.';
  switch (matching.matchResult?.status) {
    case 'exact': return 'Die Umläufe wurden strukturell eindeutig zugeordnet. Eine fachliche Bewertung wurde noch nicht durchgeführt.';
    case 'unmatched': return 'Nicht alle Umläufe konnten strukturell zugeordnet werden.';
    case 'ambiguous': return 'Die Umlaufzuordnung ist mehrdeutig und muss geprüft werden.';
    case 'conflicting': return 'Die Dokumente weisen widersprüchliche Gültigkeits- oder Zuordnungsmerkmale auf.';
    default: return 'Die strukturelle Zuordnung wurde durchgeführt.';
  }
}

// Neutral rule-analysis status. Never reveals service numbers, individual times, trips, stops,
// scores, or recommendations — only whether the rule check ran, could not conclude, or found a
// confirmed deviation. The detailed CheckReport lives in the session state for a later view.
function ruleAnalysisStatus(ruleAnalysis) {
  if (!ruleAnalysis) return '';
  if (ruleAnalysis.status === 'blocked') return 'Die Prüfung konnte wegen unvollständiger Daten nicht abschließend durchgeführt werden.';
  if (ruleAnalysis.status === 'completed' && ruleAnalysis.checkReport) return 'Die regelbasierte Prüfung wurde durchgeführt.';
  return '';
}

function isStandaloneJnvSchedule(primaryImport, companionImport) {
  return !companionImport
    && primaryImport?.detection?.status === 'supported'
    && primaryImport?.detection?.profile?.id === 'beu-stadtbus-v1'
    && primaryImport?.canonicalSchedule?.type === 'CanonicalSchedule';
}

function isStandaloneJesSchedule(primaryImport, companionImport) {
  return !companionImport
    && primaryImport?.canonicalSchedule?.type === 'CanonicalSchedule'
    && (
      (primaryImport?.detection?.status === 'supported'
        && primaryImport?.detection?.profile?.id === 'jes-regionalbus-v1')
      || primaryImport?.documentType === 'legacy_excel_schedule'
    );
}

// PDF imports already expose `canonicalSchedule` at their top level. The existing
// Excel adapter deliberately keeps its payload under `importResult.data`; normalize
// that transport difference at the session boundary so every downstream consumer
// receives one source-neutral primary shape.
function normalizePrimaryImport(result) {
  if (result?.canonicalSchedule?.type === 'CanonicalSchedule') return result;
  const schedule = result?.importResult?.data;
  return schedule?.type === 'CanonicalSchedule'
    ? {
      ...result,
      canonicalSchedule: schedule,
      documentType: result.documentType ?? result.importResult?.documentType ?? result.classification?.type ?? null
    }
    : result;
}

/**
 * @param {{ importCompanion?: (file:any)=>Promise<any>, buildBundle?: (args:any)=>any,
 *           runBaseAnalysis?: (args:any)=>Promise<any>, runJesBaseAnalysis?: (args:any)=>Promise<any>, generateBundleId?: ()=>string,
 *           generateTimestamp?: ()=>string }} [deps]
 */
export function createMultiDocumentSession({
  importCompanion = analyzeExcelImport,
  buildBundle = createBundleFromImports,
  runMatching = runJnvStructuralMatching,
  runRuleAnalysis = runJnvRuleAnalysis,
  runBaseAnalysis = runJnvBaseAnalysis,
  runJesBaseAnalysis: runJesBase = runJesBaseAnalysis,
  generateBundleId = defaultBundleId,
  generateTimestamp = defaultTimestamp
} = {}) {
  const state = { primaryImport: null, automaticCanonicalSchedule: null, companionImport: null, primaryFileName: null, companionFileName: null, bundle: null, matching: null, companionStatus: '', combinationStatus: '', matchingStatus: '', ruleAnalysis: null, checkReport: null, ruleAnalysisStatus: '' };

  // A monotonically increasing generation identifies the current match state. Each rebuild bumps
  // it; `analyzeRules()` runs at most once per generation and discards stale async results.
  let generation = 0;
  let analyzedGeneration = -1;

  const snapshot = () => ({ ...state });

  function rebuild() {
    state.bundle = (state.primaryImport && state.companionImport)
      ? buildBundle({ id: generateBundleId(), createdAt: generateTimestamp(), primaryImport: state.primaryImport, companionImport: state.companionImport })
      : null;
    // Run the structural matcher once per new bundle; the orchestrator gates internally.
    state.matching = state.bundle
      ? runMatching({ bundle: state.bundle, primaryImport: state.primaryImport, companionImport: state.companionImport, metadata: { sourceName: state.primaryFileName } })
      : null;
    state.matchingStatus = matchingStatus(state.matching);
    state.combinationStatus = combinationStatus(state);
    // A new match state invalidates any prior rule analysis; it re-runs on demand via analyzeRules().
    generation += 1;
    state.ruleAnalysis = null;
    state.checkReport = null;
    state.ruleAnalysisStatus = '';
    return snapshot();
  }

  // Run the existing check infrastructure at most once per state. An exact bundle adds its
  // Umlauf-dependent checks; a supported standalone JNV PDF runs only the schedule-only BV checks.
  async function analyzeRules() {
    const gen = generation;
    if (analyzedGeneration === gen) return snapshot();          // already analyzed this state — no double-run
    analyzedGeneration = gen;
    let result;
    try {
      if (state.matching?.status === 'completed' && state.matching.matchResult?.status === 'exact') {
        result = await runRuleAnalysis({ bundle: state.bundle, primaryImport: state.primaryImport, companionImport: state.companionImport, matching: state.matching });
      } else if (isStandaloneJnvSchedule(state.primaryImport, state.companionImport)) {
        result = await runBaseAnalysis({ primaryImport: state.primaryImport });
      } else if (isStandaloneJesSchedule(state.primaryImport, state.companionImport)) {
        result = await runJesBase({ primaryImport: state.primaryImport });
      } else {
        return snapshot();
      }
    } catch (error) {
      result = { attempted: false, status: 'failed', reason: 'JNV_RULE_ANALYSIS_FAILED', jointTimeline: null, drivingProjection: null, checkReport: null, warnings: [{ code: 'JNV_RULE_ANALYSIS_FAILED' }] };
    }
    if (gen !== generation) return snapshot();                  // a newer state arrived → discard stale result
    state.ruleAnalysis = result;
    state.checkReport = result.checkReport ?? null;
    state.ruleAnalysisStatus = ruleAnalysisStatus(result);
    return snapshot();
  }

  /** Store the primary result captured from the unchanged single-import path. */
  function setPrimaryResult(result, file) {
    if (!file) { state.primaryImport = null; state.automaticCanonicalSchedule = null; state.primaryFileName = null; return rebuild(); } // deselected → clear
    if (result == null) return snapshot();                                // failed/unsupported → keep previous valid primary
    state.primaryImport = normalizePrimaryImport(result);
    state.automaticCanonicalSchedule = state.primaryImport?.canonicalSchedule?.type === 'CanonicalSchedule'
      ? state.primaryImport.canonicalSchedule
      : null;
    state.primaryFileName = typeof file.name === 'string' ? file.name : null;
    return rebuild();
  }

  /**
   * Replaces only the primary schedule's active day type with an explicit user
   * choice. Rebuild invalidates every dependent analysis result; callers then
   * use the existing `analyzeRules()` path. A new file always replaces this
   * copied schedule and therefore cannot inherit an old override.
   */
  function setManualDayType(dayType) {
    const canonicalSchedule = state.primaryImport?.canonicalSchedule;
    if (!canonicalSchedule) return snapshot();
    if (dayType === 'automatic') {
      if (!state.automaticCanonicalSchedule) return snapshot();
      state.primaryImport = { ...state.primaryImport, canonicalSchedule: state.automaticCanonicalSchedule };
      return rebuild();
    }
    state.primaryImport = {
      ...state.primaryImport,
      canonicalSchedule: withManualCanonicalDayType(canonicalSchedule, dayType)
    };
    return rebuild();
  }

  /** Import + validate an optional companion (only exact Wagenkarte / Umlauftafel). */
  async function setCompanionFile(file) {
    if (!file) { state.companionImport = null; state.companionFileName = null; state.companionStatus = ''; return rebuild(); } // removed → clear
    let result;
    try {
      result = await importCompanion(file);
    } catch (error) {
      state.companionStatus = 'Das Begleitdokument konnte nicht gelesen werden.';
      return snapshot();                                                  // keep previous valid companion
    }
    const { type, confidence } = result?.classification || {};
    if (COMPANION_TYPES.has(type) && confidence === 'exact') {
      state.companionImport = result;
      state.companionFileName = typeof file.name === 'string' ? file.name : null;
      state.companionStatus = companionAcceptedStatus(result);
      return rebuild();
    }
    state.companionStatus = 'Diese Datei ist als Begleitdokument nicht geeignet (nur Wagenkarte oder Umlauftafel).';
    return snapshot();                                                    // reject → keep previous valid companion
  }

  function clearPrimary() { state.primaryImport = null; state.automaticCanonicalSchedule = null; return rebuild(); }
  function clearCompanion() { state.companionImport = null; state.companionStatus = ''; return rebuild(); }

  return { setPrimaryResult, setManualDayType, setCompanionFile, clearPrimary, clearCompanion, getState: snapshot, analyzeRules };
}
