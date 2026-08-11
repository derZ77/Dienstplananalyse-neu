/**
 * The Dienstplan export action in the import block (Phase 4.5) — A THIN ADAPTER.
 *
 * It answers two questions and then gets out of the way:
 *   VISIBLE  does the current profile hold `xlsxExport`, and is the current import a successful
 *            JNV/JES Dienstplan-PDF context?
 *   ENABLED  does the Phase 4.3 projection model additionally say `status === 'ready'`?
 *
 * FOUR GATES, ALL OF THEM
 * -----------------------
 * capability · document type · successful import · model status. A single positive signal is never
 * enough, and nothing is decided from a file name, a file extension or the mere existence of an
 * import. Every decision runs through the structured contracts that already exist.
 *
 * IT BUILDS NOTHING
 * -----------------
 * No workbook, no CSV, no blob, no object URL, no re-parsing. A click delegates exactly once to
 * `downloadDienstplanExport` and turns its documented result into a neutral sentence. No bytes and
 * no blob are ever kept in the UI state.
 *
 * The model is rebuilt from the CURRENT session state on every update and again on every click, so
 * a stale model from a previous import can never be exported.
 *
 * Text is written with `textContent` only — a warning message can never become markup.
 */

import { DOCUMENT_PROFILES, profileHasCapability } from '../documents/document-profiles.js';
import { DOCUMENT_TYPES } from '../documents/document-types.js';
import { buildDienstplanXlsxModel } from './dienstplan-xlsx-model.js';
import { downloadDienstplanExport } from './dienstplan-xlsx-export.js';

/** The capability the profile contract already reserved for exactly this. */
export const DIENSTPLAN_EXPORT_CAPABILITY = 'xlsxExport';

/** Only these two document types may ever be offered as a Dienstplan export. */
export const EXPORTABLE_DOCUMENT_TYPES = Object.freeze([
  DOCUMENT_TYPES.JNV_SCHEDULE_PDF,
  DOCUMENT_TYPES.JES_SCHEDULE_PDF
]);

export const EXPORT_BUTTON_LABEL = 'Dienstplan als Excel exportieren';

/** Why the action looks the way it does. Neutral, closed, never a professional diagnosis. */
export const EXPORT_UI_REASONS = Object.freeze({
  KEIN_IMPORT: 'kein_import',
  KEIN_DIENSTPLAN_PDF: 'kein_dienstplan_pdf',
  KEINE_BERECHTIGUNG: 'keine_berechtigung',
  NICHT_EXPORTIERBAR: 'nicht_exportierbar',
  READY: 'ready'
});

const REASON_TEXT = Object.freeze({
  kein_import: '',
  kein_dienstplan_pdf: '',
  keine_berechtigung: '',
  nicht_exportierbar: 'Aus diesem Import lässt sich keine Excel-Datei erzeugen.',
  ready: 'Die Datei wird lokal auf diesem Gerät erzeugt.'
});

const RESULT_TEXT = Object.freeze({
  xlsx: 'Die Excel-Datei wurde lokal erzeugt.',
  csv: 'Es wurde eine CSV-Datei erzeugt.',
  not_applicable: 'Für diesen Import wurde keine Datei erzeugt.',
  error: 'Es konnte keine Datei erzeugt werden.',
  not_downloaded: 'Die Datei konnte nicht bereitgestellt werden.'
});

// =====================================================================================
// the decision
// =====================================================================================

/** A PDF import result carries a `detection`; an Excel import result carries a `classification`. */
const pdfImportOf = (sessionState) => {
  const primary = sessionState && typeof sessionState === 'object' ? sessionState.primaryImport : null;
  if (!primary || typeof primary !== 'object') return null;
  return primary.detection && typeof primary.detection === 'object' ? primary : null;
};

const decision = (visible, enabled, reason, extra = {}) => ({
  visible, enabled, reason,
  documentType: null, organization: null, modelStatus: null, model: null,
  ...extra
});

/**
 * Decides visibility and enablement from the session state alone. Pure: it reads, it builds the
 * projection model, it returns — it touches no DOM and stores nothing.
 *
 * @param {object} sessionState the multi-document session snapshot
 * @returns {{visible: boolean, enabled: boolean, reason: string, documentType: string|null,
 *            organization: string|null, modelStatus: string|null, model: object|null}}
 */
export function resolveDienstplanExportState(sessionState) {
  const primary = pdfImportOf(sessionState);
  if (!primary) {
    // No import at all, or an import that is not a PDF analysis result (Excel, Umlauftafel,
    // Wagenkarte, unknown). Neither case may show a Dienstplan export.
    const hasSomething = Boolean(sessionState && typeof sessionState === 'object' && sessionState.primaryImport);
    return decision(false, false,
      hasSomething ? EXPORT_UI_REASONS.KEIN_DIENSTPLAN_PDF : EXPORT_UI_REASONS.KEIN_IMPORT);
  }

  const profileId = primary.detection?.profile?.id ?? null;
  const profile = profileId ? DOCUMENT_PROFILES[profileId] : null;
  if (primary.detection?.status !== 'supported' || !profile) {
    return decision(false, false, EXPORT_UI_REASONS.KEIN_DIENSTPLAN_PDF);
  }
  if (!EXPORTABLE_DOCUMENT_TYPES.includes(profile.documentType)) {
    return decision(false, false, EXPORT_UI_REASONS.KEIN_DIENSTPLAN_PDF);
  }
  if (!profileHasCapability(profileId, DIENSTPLAN_EXPORT_CAPABILITY)) {
    return decision(false, false, EXPORT_UI_REASONS.KEINE_BERECHTIGUNG);
  }

  // The document qualifies — from here the action is shown. Whether it can be clicked is the
  // projection model's word, never a guess of this adapter.
  const model = buildDienstplanXlsxModel(primary);
  const ready = model.status === 'ready';
  return decision(true, ready, ready ? EXPORT_UI_REASONS.READY : EXPORT_UI_REASONS.NICHT_EXPORTIERBAR, {
    documentType: profile.documentType,
    organization: profile.organization,
    modelStatus: model.status,
    model: ready ? model : null
  });
}

// =====================================================================================
// the controller
// =====================================================================================

/**
 * Mounts the export action into the import block and keeps it in step with the session.
 *
 * @param {object|null} root the mount element; a page without it simply has no export action
 * @param {{document?: object, download?: Function}} [options] injectable for tests
 * @returns {{update: Function, triggerExport: Function, getState: Function}}
 */
export function createDienstplanExportController(root, options = {}) {
  const doc = options.document ?? (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const download = options.download ?? downloadDienstplanExport;

  let sessionState = null;
  let current = decision(false, false, EXPORT_UI_REASONS.KEIN_IMPORT);
  let lastResult = null;
  let busy = false;

  const view = root && doc && typeof doc.createElement === 'function' ? buildView(doc, root) : null;
  view?.button.addEventListener('click', () => triggerExport());

  function render() {
    if (!view) return;
    view.container.hidden = !current.visible;
    // A hidden action must not stay clickable or focusable.
    view.button.disabled = !current.enabled;
    view.button.setAttribute('aria-disabled', String(!current.enabled));
    view.button.setAttribute('tabindex', current.visible && current.enabled ? '0' : '-1');
    view.status.textContent = statusText();
  }

  function statusText() {
    if (busy) return 'Die Datei wird erzeugt …';
    if (lastResult) return resultText(lastResult);
    return REASON_TEXT[current.reason] ?? '';
  }

  /** Recomputes the decision from the CURRENT session — no earlier model survives this. */
  function update(nextState) {
    sessionState = nextState ?? null;
    lastResult = null;
    try {
      current = resolveDienstplanExportState(sessionState);
    } catch (error) {
      current = decision(false, false, EXPORT_UI_REASONS.KEIN_IMPORT);
    }
    render();
    return getState();
  }

  /**
   * The one user action. It rebuilds the model from the current session, hands it to the existing
   * exporter exactly once, and translates the documented result into a sentence.
   */
  function triggerExport() {
    if (busy) return getState();                       // a running export is never started twice
    const fresh = resolveDienstplanExportState(sessionState);
    current = fresh;
    if (!fresh.enabled || !fresh.model) { render(); return getState(); }

    busy = true;
    if (view) view.button.disabled = true;
    render();
    try {
      lastResult = download(fresh.model);
    } catch (error) {
      // A programming error must not reach the page as a raw failure.
      lastResult = { status: 'error', format: null, downloaded: false, warnings: [] };
    } finally {
      busy = false;
      render();
    }
    return getState();
  }

  function getState() {
    return {
      visible: current.visible,
      enabled: current.enabled,
      reason: current.reason,
      documentType: current.documentType,
      organization: current.organization,
      modelStatus: current.modelStatus,
      model: current.model,
      busy,
      lastResult
    };
  }

  return { update, triggerExport, getState };
}

/** Builds the controls once. They are afterwards only updated, never rebuilt. */
function buildView(doc, root) {
  const container = doc.createElement('div');
  container.id = 'dienstplan-export-actions';
  container.className = 'export-actions dienstplan-export-actions';
  container.hidden = true;

  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'dienstplan-export-button';
  button.textContent = EXPORT_BUTTON_LABEL;
  button.disabled = true;
  button.setAttribute('aria-disabled', 'true');
  button.setAttribute('tabindex', '-1');

  const status = doc.createElement('p');
  status.id = 'dienstplan-export-status';
  status.className = 'result';
  status.setAttribute('aria-live', 'polite');
  status.textContent = '';

  container.appendChild(button);
  container.appendChild(status);
  root.appendChild(container);
  return { container, button, status };
}

/**
 * The exporter's own neutral sentence wins where it exists; otherwise a short, format-aware line.
 * A CSV result is a result, not a failure, and is never phrased as one.
 */
function resultText(result) {
  const message = result?.warnings?.[0]?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (result?.status === 'ready' && result.downloaded === true) {
    return RESULT_TEXT[result.format] ?? RESULT_TEXT.xlsx;
  }
  if (result?.status === 'ready') return RESULT_TEXT.not_downloaded;
  return RESULT_TEXT[result?.status] ?? RESULT_TEXT.error;
}
