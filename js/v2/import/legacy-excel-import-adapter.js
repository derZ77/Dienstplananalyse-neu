/**
 * Legacy-Excel import adapter (Phase 3D).
 *
 * Thin modular attachment (Variante A): it consumes the already-read plain-object
 * workbook (from the SheetJS adapter) and delegates to the EXISTING, tested canonical
 * adapter `adaptExcelRowsToCanonicalSchedule`. It neither re-reads the file nor invents
 * new schedule interpretation, and it reuses the existing 10-/17-column layout contract
 * via `detectExcelLayout` inside that adapter.
 *
 * No SheetJS, no DOM, no storage, no network, no matching. Pure and error-isolated.
 */

import { adaptExcelRowsToCanonicalSchedule } from '../excel/excel-canonical-adapter.js';
import { attachExcelBreakData } from '../excel/excel-break-import.js';
import { attachExcelHandoverData } from '../excel/excel-handover-chain.js';

// Phase 3I.30: the operator's own Dienstübersicht lives in a further sheet of the SAME workbook
// and is the only place that DECLARES a Blockpause. It is looked up by name, never by position.
const DIENSTUEBERSICHT_SHEETS = Object.freeze(['due', 'dienstübersicht', 'dienstuebersicht']);

function findDienstuebersichtRows(workbook) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const match = sheets.find(sheet => DIENSTUEBERSICHT_SHEETS.includes(String(sheet?.name ?? '').trim().toLocaleLowerCase('de')));
  return Array.isArray(match?.rows) ? match.rows : null;
}

const warning = (code) => ({ code, severity: 'warning', message: '', scope: 'document' });

/**
 * @param {{ sheets?: Array<{ name?: string, rows?: unknown[][] }> }} workbook plain workbook
 * @param {{ sourceName?: string, organization?: string|null, subtype?: string|null }} [options]
 * @returns {{ ok: boolean, documentType: 'legacy_excel_schedule', data: object|null, warnings: Array<{code:string}> }}
 */
export function analyzeLegacyExcelWorkbook(workbook, options = {}) {
  const firstSheet = Array.isArray(workbook?.sheets) ? workbook.sheets[0] : null;
  const rows = firstSheet?.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, documentType: 'legacy_excel_schedule', data: null, warnings: [warning('LEGACY_EXCEL_UNSUPPORTED_LAYOUT')] };
  }

  try {
    const canonical = adaptExcelRowsToCanonicalSchedule(rows, {
      fileName: options.sourceName || '',
      sheetName: firstSheet.name || ''
    });
    // Classification establishes the document family; the canonical adapter
    // remains responsible for all actual timetable fields.
    const schedule = {
      ...canonical,
      document: { ...canonical.document, organization: options.organization || null, subtype: options.subtype || null },
      metadata: { ...canonical.metadata, organization: options.organization || null, documentSubtype: options.subtype || null }
    };
    // Additive, in this order: the relief chain first, over the plain duty legs, then the breaks —
    // so a derived break activity is never mistaken for a leg carrying a handover.
    const withHandover = attachExcelHandoverData(schedule);
    const enriched = attachExcelBreakData(withHandover, { dienstuebersichtRows: findDienstuebersichtRows(workbook) });
    return { ok: true, documentType: 'legacy_excel_schedule', data: enriched, warnings: [] };
  } catch (error) {
    // Expected fachlicher/Adapter error → controlled, privacy-safe warning (no raw cells).
    return { ok: false, documentType: 'legacy_excel_schedule', data: null, warnings: [warning('LEGACY_EXCEL_IMPORT_FAILED')] };
  }
}
