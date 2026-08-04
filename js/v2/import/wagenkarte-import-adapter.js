/**
 * Wagenkarte import adapter (Phase 3D – safe split).
 *
 * It reuses the EXISTING recognition signal (`B1 === "Dienst-Nr.:"`, the same per-sheet
 * gate the inline engine applies) on the already-read plain-object workbook and returns
 * a recognition/metadata result. The deep per-Dienst analysis (Lenkzeit, Fahrten, Pausen,
 * Schichten) stays in the unchanged inline engine in `index.html` — a documented open
 * boundary carried forward to Phase 3E. This adapter invents NO new interpretation of
 * lines, trips, vehicles or driving times.
 *
 * No SheetJS, no DOM, no storage, no network, no matching. Pure and error-isolated.
 */

const WAGENKARTE_HEADER = 'Dienst-Nr.:';
const LIMITATION = 'WAGENKARTE_FULL_ANALYSIS_IN_INLINE_ENGINE';

const warning = (code) => ({ code, severity: 'warning', message: '', scope: 'document' });

// Mirrors the inline engine's per-sheet gate: a Dienst sheet has B1 === "Dienst-Nr.:".
function isDienstSheet(sheet) {
  const b1 = sheet?.rows?.[0]?.[1];
  return b1 != null && String(b1).trim() === WAGENKARTE_HEADER;
}

/**
 * @param {{ sheets?: Array<{ name?: string, rows?: unknown[][] }> }} workbook plain workbook
 * @returns {{ ok: boolean, documentType: 'wagenkarte', data: object, warnings: Array<{code:string}>, limitation: string }}
 */
export function analyzeWagenkarteWorkbook(workbook) {
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

  return {
    ok: true,
    documentType: 'wagenkarte',
    data: { recognized: true, sheetCount: sheets.length, dienstSheetCount, fullAnalysisAvailable: false },
    warnings: [],
    limitation: LIMITATION
  };
}
