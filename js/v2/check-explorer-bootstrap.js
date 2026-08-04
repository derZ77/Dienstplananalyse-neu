import { createCheckExplorerController } from './ui/check-explorer.js';
import { createReviewDashboardController } from './ui/review-dashboard.js';
import { createCheckReportController } from './report/check-report-view.js';

function initializeCheckExplorer() {
  const root = document.getElementById('check-explorer');
  const dashboardRoot = document.getElementById('review-dashboard');
  if (!root || !dashboardRoot) return;
  const explorerController = createCheckExplorerController(root);
  const dashboardController = createReviewDashboardController(dashboardRoot);
  // Phase 3I.34: the readable report joins the EXISTING fan-out. It is optional — a page without
  // the section keeps working exactly as before — and it consumes the very same report object.
  const reportRoot = document.getElementById('pruefbericht');
  const reportController = reportRoot ? createCheckReportController(reportRoot) : null;
  const setCheckReport = checkReport => {
    explorerController.setCheckReport(checkReport);
    dashboardController.setCheckReport(checkReport);
    reportController?.setCheckReport(checkReport);
  };
  const clear = () => {
    explorerController.clear();
    dashboardController.clear();
    reportController?.clear();
  };

  window.addEventListener('dienstplan:v2-check-report', event => setCheckReport(event.detail));
  window.DienstplanV2CheckExplorer = Object.freeze({
    setCheckReport,
    clear
  });
  window.DienstplanV2ReviewDashboard = Object.freeze({
    setCheckReport,
    clear
  });
  window.DienstplanV2CheckReport = Object.freeze({
    setCheckReport,
    clear,
    setCanonicalSchedule: schedule => reportController?.setCanonicalSchedule(schedule),
    // Phase 3I.35: the live context (schedule + small header metadata) from the existing session.
    setReportContext: context => reportController?.setReportContext(context),
    setState: state => reportController?.setState(state)
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCheckExplorer, { once: true });
} else {
  initializeCheckExplorer();
}
