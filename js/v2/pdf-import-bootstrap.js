import { initializePdfImport } from './import/pdf-import-controller.js';
import { createMultiDocumentSession } from './import/multi-document-import-controller.js';
import { createCheckExplorerSessionBridge } from './explorer/check-explorer-session-bridge.js';
import { deriveReportContext } from './report/check-report-view-model.js';
import { createDienstplanExportController } from './export/dienstplan-export-ui.js';
import { createDienstuebersichtExportController } from './export/dienstuebersicht-export-ui.js';
import { createOriginalBlockViewModel } from './blocks/block-orchestrator.js';
import { clearOriginalBlocks, renderOriginalBlocks } from './blocks/block-renderer.js';
import { buildImportWorkflowSummary } from './ui/import-workflow-view.js';
import { initializeAnalysisSearch } from './ui/analysis-search-controller.js';

// Phase 3F: one memory-only session holds the primary (captured from the unchanged
// single import) and an optional companion. No storage, no network, no matching.
const session = createMultiDocumentSession();

// Phase 3H.6: hand the session's CheckReport to the EXISTING explorer. The explorer bootstrap
// stays the single initialization authority, so the controller is resolved lazily from the facade
// it publishes (this module is evaluated before it).
const explorerBridge = createCheckExplorerSessionBridge({
  explorerController: () => globalThis.DienstplanV2CheckExplorer ?? null
});

// Phase 4.5: the local Dienstplan export in the import block. It is optional — a page without the
// mount point keeps working exactly as before — and it decides visibility and enablement itself
// from the session state. Nothing is exported here; the adapter delegates to the Phase 4.4 writer.
const dienstplanExportRoot = document.getElementById('dienstplan-export');
const dienstplanExport = dienstplanExportRoot
  ? createDienstplanExportController(dienstplanExportRoot)
  : null;
const dienstuebersichtExport = dienstplanExportRoot
  ? createDienstuebersichtExportController(dienstplanExportRoot)
  : null;

const companionStatusEl = document.getElementById('companion-import-result');
const combinationStatusEl = document.getElementById('combination-result');
const matchingStatusEl = document.getElementById('match-result');
const ruleAnalysisStatusEl = document.getElementById('rule-analysis-result');
const primaryStatusEl = document.getElementById('pdf-import-result');
const fileResultEl = document.getElementById('file-result');

function setStatus(element, message) {
  if (!element) return;
  element.textContent = message || '';
  element.hidden = !message;
}

function primaryAnalysisStatus(state) {
  const detection = state?.primaryImport?.detection;
  if (detection?.status !== 'supported' || !detection.profile) return null;
  const pageHint = detection.pageCount > 0 ? ` (${detection.pageCount} Seiten)` : '';
  const analysisHint = state.checkReport
    ? 'Die regelbasierte Prüfung wurde durchgeführt.'
    : 'Noch keine Analyse durchgeführt.';
  return `Unterstütztes PDF erkannt: ${detection.profile.label}${pageHint}. ${analysisHint}`;
}

function render(state) {
  if (fileResultEl) fileResultEl.textContent = buildImportWorkflowSummary(state);
  const primaryStatus = primaryAnalysisStatus(state);
  if (primaryStatus) setStatus(primaryStatusEl, primaryStatus);
  setStatus(companionStatusEl, state.companionStatus);
  setStatus(combinationStatusEl, state.combinationStatus);
  setStatus(matchingStatusEl, state.matchingStatus);
  setStatus(ruleAnalysisStatusEl, state.ruleAnalysisStatus);
  const canonicalSchedule = state?.primaryImport?.canonicalSchedule;
  if (canonicalSchedule?.type === 'CanonicalSchedule') {
    renderOriginalBlocks(createOriginalBlockViewModel(canonicalSchedule, { checkReport: state.checkReport }));
  } else if (!state?.primaryImport) {
    clearOriginalBlocks();
  }
  // The existing CheckReport is handed over unchanged; a missing one leaves the explorer empty.
  explorerBridge.setCheckReport(state.checkReport);
  // Phase 3I.35: the report also gets the context the session ALREADY holds — the schedule as the
  // same reference plus small header metadata. No second analysis, no second store; a page without
  // the report section simply has no facade to call.
  globalThis.DienstplanV2CheckReport?.setReportContext(deriveReportContext(state));
  // Phase 4.5: the export action follows the SAME session state. A new import replaces the
  // decision — and with it any earlier projection model — so nothing stale can be exported.
  dienstplanExport?.update(state);
  dienstuebersichtExport?.update(state);
  return state;
}

// The productive rule analysis runs through the session (which delegates to the orchestrator and
// the existing check runner); the UI never touches the rule logic directly. It re-renders once the
// asynchronous check completes.
function renderAndAnalyze(state) {
  render(state);
  session.analyzeRules().then(render);
}

// Primary path stays exactly as before (status → #pdf-import-result); onResult only
// observes the already-produced result so the session can form a bundle when a companion exists.
initializePdfImport({
  fileInput: document.getElementById('file-input'),
  statusElement: primaryStatusEl,
  onResult: (result, file) => renderAndAnalyze(session.setPrimaryResult(result, file))
});

const companionInput = document.getElementById('companion-file-input');
if (companionInput) {
  companionInput.addEventListener('change', async () => {
    const file = companionInput.files && companionInput.files[0];
    renderAndAnalyze(await session.setCompanionFile(file));
  });
}

initializeAnalysisSearch({ document });
