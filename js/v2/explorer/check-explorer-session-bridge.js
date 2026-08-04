/**
 * Session → CheckExplorer bridge (Phase 3H.6) — HANDOVER ONLY.
 *
 * Hands the CheckReport that already lives in the memory-only multi-document session to the
 * EXISTING explorer controller (the one the existing explorer bootstrap initializes). It creates
 * no second report, no second controller, no presentation model, no DOM, no aggregation, no new
 * status or severity, and no check-specific interpretation. It exists only because the existing
 * `setCheckReport` rejects a missing report by throwing: the bridge maps "no report" onto the
 * controller's own `clear()`, skips redundant updates, and isolates errors from the import UI.
 *
 * No storage, no network, no current time, no random.
 */

const outcome = (applied, reason = null) => ({ applied, reason });

/**
 * @param {{ explorerController?: object|(()=>object|null) }} [input] the existing controller, or a
 *   resolver for it (the explorer bootstrap may initialize after this module is imported)
 * @returns {{ setCheckReport: (report:any)=>{applied:boolean,reason:string|null},
 *             clearCheckReport: ()=>{applied:boolean,reason:string|null}, dispose: ()=>void }}
 */
export function createCheckExplorerSessionBridge({ explorerController } = {}) {
  let applied = null;      // the report currently handed to the explorer (null = cleared)
  let disposed = false;

  const resolve = () => {
    const controller = typeof explorerController === 'function' ? explorerController() : explorerController;
    return (controller && typeof controller.setCheckReport === 'function' && typeof controller.clear === 'function')
      ? controller
      : null;
  };

  function clearCheckReport() {
    if (disposed) return outcome(false, 'DISPOSED');
    if (applied === null) return outcome(true, 'UNCHANGED');    // already empty — no re-render
    const controller = resolve();
    if (!controller) return outcome(false, 'NO_EXPLORER_CONTROLLER');
    try {
      controller.clear();
    } catch (error) {
      return outcome(false, 'EXPLORER_UPDATE_FAILED');
    }
    applied = null;
    return outcome(true, null);
  }

  function setCheckReport(checkReport) {
    if (disposed) return outcome(false, 'DISPOSED');
    if (checkReport == null) return clearCheckReport();          // no report → the explorer's empty state
    // Anything that is not the existing CheckReport is refused in a controlled way; the previously
    // applied report stays visible (a broken update must not destroy a valid result view).
    if (checkReport.type !== 'CheckReport') return outcome(false, 'INVALID_CHECK_REPORT');
    if (checkReport === applied) return outcome(true, 'UNCHANGED');
    const controller = resolve();
    if (!controller) return outcome(false, 'NO_EXPLORER_CONTROLLER');
    try {
      controller.setCheckReport(checkReport);                    // the very same object, unchanged
    } catch (error) {
      return outcome(false, 'EXPLORER_UPDATE_FAILED');
    }
    applied = checkReport;
    return outcome(true, null);
  }

  return {
    setCheckReport,
    clearCheckReport,
    dispose() { disposed = true; }
  };
}
