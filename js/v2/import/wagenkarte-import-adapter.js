/**
 * Wagenkarte import adapter (Phase 3D – safe split).
 *
 * It reuses the EXISTING recognition signal (`B1 === "Dienst-Nr.:"`, the same per-sheet
 * gate the inline engine applies) on the already-read plain-object workbook and returns
 * a recognition/metadata result. Phase 9.7A additionally projects the existing,
 * explicitly labelled Wagenkarten observations into `VehicleCardSchedule`. The
 * Phase-9.7B Block-7 projection consumes this contract separately; the adapter
 * itself stays pure and contains no calculation or renderer.
 *
 * No SheetJS, no DOM, no storage, no network, no matching. Pure and error-isolated.
 */

import { isWagenkarteDienstSheet, projectWagenkarteWorkbook } from './wagenkarte-data-projector.js';

const LIMITATION = 'WAGENKARTE_FULL_ANALYSIS_IN_INLINE_ENGINE';

const warning = (code) => ({ code, severity: 'warning', message: '', scope: 'document' });

// Mirrors the inline engine's per-sheet gate: a Dienst sheet has B1 === "Dienst-Nr.:".
function isDienstSheet(sheet) {
  return isWagenkarteDienstSheet(sheet);
}

/**
 * @param {{ sheets?: Array<{ name?: string, rows?: unknown[][] }> }} workbook plain workbook
 * @returns {{ ok: boolean, documentType: 'wagenkarte', data: object, warnings: Array<{code:string}>, limitation: string }}
 */
export function analyzeWagenkarteWorkbook(workbook, options = {}) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const dienstSheetCount = sheets.filter(isDienstSheet).length;

  if (dienstSheetCount === 0) {
    return {
      ok: false,
      documentType: 'wagenkarte',
      data: { recognized: false, sheetCount: sheets.length, dienstSheetCount: 0, fullAnalysisAvailable: false },
      warnings: [warning('WAGENKARTE_UNSUPPORTED_LAYOUT')],
      limitation: LIMITATION
    };
  }

  const projection = projectWagenkarteWorkbook(workbook, options);

  return {
    ok: true,
    documentType: 'wagenkarte',
    data: {
      ...projection,
      recognized: true,
      sheetCount: sheets.length,
      dienstSheetCount,
      // Block 7 is available through the separate migrated projection. Other
      // Wagenkarten blocks intentionally remain outside the V2 migration scope.
      block7AnalysisAvailable: true,
      fullAnalysisAvailable: false
    },
    warnings: [],
    limitation: LIMITATION
  };
}
