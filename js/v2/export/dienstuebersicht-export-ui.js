/** Source-neutral productive action for the original Dienstübersicht XLSX. */
import { buildDienstuebersichtExportModel, downloadDienstuebersichtExport } from './dienstuebersicht-xlsx-export.js';

export const DIENSTUEBERSICHT_EXPORT_BUTTON_LABEL = 'Dienstübersicht XLSX';

const scheduleOf = state => {
  const primary = state?.primaryImport;
  return primary?.canonicalSchedule?.type === 'CanonicalSchedule' ? primary.canonicalSchedule
    : primary?.importResult?.data?.type === 'CanonicalSchedule' ? primary.importResult.data : null;
};

// The primary import already holds the detector's document title. Passing it to the
// export model keeps it source-specific without adding or changing any parser data.
const titleOf = (state, schedule) => state?.primaryImport?.detection?.title
  || state?.primaryImport?.importResult?.detection?.title
  || schedule?.metadata?.title
  || schedule?.document?.source?.title
  || schedule?.document?.title
  || null;

export function resolveDienstuebersichtExportState(sessionState) {
  const schedule = scheduleOf(sessionState);
  if (!schedule) return { visible: false, enabled: false, label: DIENSTUEBERSICHT_EXPORT_BUTTON_LABEL, model: null };
  const model = buildDienstuebersichtExportModel(schedule, { title: titleOf(sessionState, schedule) });
  return { visible: true, enabled: true, label: DIENSTUEBERSICHT_EXPORT_BUTTON_LABEL, model };
}

export function createDienstuebersichtExportController(root, options = {}) {
  const doc = options.document ?? globalThis.document;
  const download = options.download ?? downloadDienstuebersichtExport;
  let sessionState = null; let current = resolveDienstuebersichtExportState(null); let lastResult = null;
  if (!root || !doc?.createElement) return { update: state => resolveDienstuebersichtExportState(state), triggerExport: () => null, getState: () => current };
  const container = doc.createElement('div'); container.id = 'dienstuebersicht-export-actions'; container.hidden = true;
  const button = doc.createElement('button'); button.type = 'button'; button.id = 'dienstuebersicht-export-button'; button.textContent = DIENSTUEBERSICHT_EXPORT_BUTTON_LABEL;
  const status = doc.createElement('p'); status.className = 'result'; status.setAttribute('aria-live', 'polite');
  container.append(button, status); root.appendChild(container);
  const render = () => { container.hidden = !current.visible; button.disabled = !current.enabled; status.textContent = lastResult?.downloaded ? 'Die Dienstübersicht wurde lokal als Excel-Datei erzeugt.' : lastResult ? 'Die Dienstübersicht konnte nicht bereitgestellt werden.' : ''; };
  const update = state => { sessionState = state; current = resolveDienstuebersichtExportState(state); lastResult = null; render(); return getState(); };
  const triggerExport = () => { current = resolveDienstuebersichtExportState(sessionState); if (!current.enabled) return getState(); try { lastResult = download(current.model); } catch { lastResult = { downloaded: false }; } render(); return getState(); };
  const getState = () => ({ ...current, lastResult });
  button.addEventListener('click', triggerExport); render();
  return { update, triggerExport, getState };
}
