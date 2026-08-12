/**
 * Content-based Excel document classifier (Phase 3C.3).
 *
 * Given already-read workbook plain objects (from the adapter — no SheetJS here),
 * it decides which known Excel document a workbook is, from CONTENT signals only
 * (never from the file extension, a single sheet name, code length or a single
 * vehicle type). It maps the result onto the frozen canonical document types.
 *
 * Pure, deterministic, no mutation, no I/O, no SheetJS. Automatic routing is allowed
 * only for `exact`; `probable`/`ambiguous`/`unknown` must not be routed to a parser.
 */

import { detectMode } from '../umlauftafel/xlsx-loader.js';

export const EXCEL_CLASSIFICATION_CONFIDENCE = Object.freeze({ EXACT: 'exact', PROBABLE: 'probable', AMBIGUOUS: 'ambiguous', UNKNOWN: 'unknown' });

export const EXCEL_CLASSIFICATION_WARNING_CODES = Object.freeze([
  'UNKNOWN_EXCEL_DOCUMENT', 'AMBIGUOUS_EXCEL_DOCUMENT', 'CONFLICTING_EXCEL_DOCUMENT_SIGNALS',
  'MISSING_UMLAUFTAFEL_HEADER', 'MISSING_WAGENKARTE_HEADER', 'MISSING_LEGACY_SCHEDULE_HEADER',
  'UNSUPPORTED_EXCEL_LAYOUT', 'EXCEL_CLASSIFICATION_FAILED'
]);

const UMLAUF_LABELS = ['Beginn:', 'Ende:', 'Startpunkt:', 'Endpunkt:', 'Fahrzeugtyp:', 'Seite:'];
const VEHICLE_RE = /^(TLV\d*|GT\d*|NGT\d*|SL|SG|GN|EN|EG)$/i;
const CODE_SHEET_RE = /^\d{4,5}$/;
const TEN_COLUMN_SCHEDULE_HEADER = Object.freeze([
  'Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort',
  'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'
]);

function forEachCell(sheets, visit) {
  for (const sheet of sheets) {
    for (const row of sheet.rows || []) {
      for (const cell of row || []) visit(String(cell).trim(), sheet);
    }
  }
}

/**
 * @param {{ sheetNames?: string[], sheets?: Array<{ name:string, rows:string[][] }> }} workbook
 */
export function classifyExcelDocument(workbook) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const sheetNames = Array.isArray(workbook?.sheetNames) ? workbook.sheetNames : sheets.map(s => s.name);

  let umlaufHeader = false;
  let tripSignals = false;
  let stopMarkers = false;
  let dienstNr = false;
  let vehicleType = null;
  const labels = new Set();

  forEachCell(sheets, (value) => {
    if (value === 'Umlauf:') umlaufHeader = true;
    else if (UMLAUF_LABELS.includes(value)) labels.add(value);
    if (/^Linie:/i.test(value) || value === 'Leerfahrt' || /^Dienst:/i.test(value)) tripSignals = true;
    if (value === 'ab' || value === 'an') stopMarkers = true;
    if (value === 'Dienst-Nr.:') dienstNr = true;
    if (!vehicleType && VEHICLE_RE.test(value)) vehicleType = value;
  });

  // Wagenkarte's strongest signal (legacy detectWorkbookFormat): B1 of the first sheet.
  const firstB1 = sheets[0]?.rows?.[0]?.[1] != null ? String(sheets[0].rows[0][1]).trim() : '';
  if (firstB1 === 'Dienst-Nr.:') dienstNr = true;

  const codeSheets = sheetNames.filter(name => CODE_SHEET_RE.test(String(name))).length;
  const labelCount = labels.size;

  // The real JES export carries a title row ABOVE the full, fixed ten-column
  // schedule header. Match every row, but only the complete ordered signature —
  // three generic words anywhere in a workbook never unlock automatic routing.
  const jesTenColumnHeader = sheets.some(sheet => (sheet.rows || []).some(row =>
    TEN_COLUMN_SCHEDULE_HEADER.every((label, index) => String(row?.[index] ?? '').trim() === label)
  ));
  const jnvLegacyHeader = sheets.some(sheet => (sheet.rows || []).some(row => {
    const values = row.map(cell => String(cell).trim().toLocaleLowerCase('de'));
    // Historical JNV files split their 17-column heading over two rows and
    // may put a title above it. Require four fixed-position labels so generic
    // notes with words such as "Dienst" cannot unlock a parser.
    return values[2] === 'dienst-' && values[3] === 'linie' && values[4] === 'umlauf' && values[5] === 'ausf.' && values[16] === 'bez.';
  }));
  const legacyHeader = jesTenColumnHeader || jnvLegacyHeader || sheets.some(sheet => {
    const first = (sheet.rows?.[0] || []).map(c => String(c).trim());
    return first.includes('Dienst') && first.includes('Umlauf') && first.includes('Tätigkeit');
  });

  const signals = [
    { code: 'UMLAUF_HEADER', matched: umlaufHeader },
    { code: 'UMLAUFTAFEL_LABELS', matched: labelCount >= 2 },
    { code: 'TRIP_SIGNALS', matched: tripSignals },
    { code: 'STOP_MARKERS', matched: stopMarkers },
    { code: 'CODE_SHEETS', matched: codeSheets >= 2 },
    { code: 'WAGENKARTE_DIENSTNR', matched: dienstNr },
    { code: 'LEGACY_SCHEDULE_HEADER', matched: legacyHeader }
  ];

  // Strong = multiple independent signals; never extension/single-name/code-length/single-vehicle alone.
  const umlaufStrong = umlaufHeader && labelCount >= 2 && tripSignals && codeSheets >= 2;
  const wagenkarteStrong = dienstNr;
  const legacyStrong = legacyHeader;

  const strongTypes = [];
  if (umlaufStrong) strongTypes.push('umlaufkarte');
  if (wagenkarteStrong) strongTypes.push('wagenkarte');
  if (legacyStrong) strongTypes.push('legacy_excel_schedule');

  const base = { signals, conflicts: [], candidates: [] };

  if (strongTypes.length >= 2) {
    return { type: 'unknown', subtype: null, mode: null, confidence: EXCEL_CLASSIFICATION_CONFIDENCE.AMBIGUOUS, ...base, conflicts: ['CONFLICTING_EXCEL_DOCUMENT_SIGNALS'], candidates: strongTypes };
  }
  if (umlaufStrong) {
    const code = sheetNames.find(name => CODE_SHEET_RE.test(String(name)));
    return { type: 'umlaufkarte', subtype: 'jnv_umlauftafel', mode: detectMode(vehicleType, code), confidence: EXCEL_CLASSIFICATION_CONFIDENCE.EXACT, ...base };
  }
  if (wagenkarteStrong) {
    return { type: 'wagenkarte', subtype: null, mode: null, confidence: EXCEL_CLASSIFICATION_CONFIDENCE.EXACT, ...base };
  }
  if (legacyStrong) {
    // The fixed ten-column signature is JES. The older, structurally distinct
    // 17-column Dienstübersicht is the established JNV roster family; this is a
    // content distinction, not a filename fallback.
    return {
      type: 'legacy_excel_schedule',
      subtype: jesTenColumnHeader ? 'jes_schedule_excel' : jnvLegacyHeader ? 'jnv_legacy_schedule' : null,
      organization: jesTenColumnHeader ? 'JES' : jnvLegacyHeader ? 'JNV' : null,
      mode: null,
      confidence: EXCEL_CLASSIFICATION_CONFIDENCE.EXACT,
      ...base
    };
  }

  // Several supporting Umlauftafel signals but a required one missing → probable (not routed).
  const umlaufSupport = [umlaufHeader, labelCount >= 2, tripSignals, codeSheets >= 2].filter(Boolean).length;
  if (umlaufSupport >= 2) {
    return { type: 'unknown', subtype: null, mode: null, confidence: EXCEL_CLASSIFICATION_CONFIDENCE.PROBABLE, ...base, conflicts: ['MISSING_UMLAUFTAFEL_HEADER'], candidates: ['umlaufkarte'] };
  }

  return { type: 'unknown', subtype: null, mode: null, confidence: EXCEL_CLASSIFICATION_CONFIDENCE.UNKNOWN, ...base };
}
