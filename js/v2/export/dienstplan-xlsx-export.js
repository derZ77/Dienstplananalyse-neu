/**
 * Writing and downloading the Dienstplan export (Phase 4.4).
 *
 * This module is the LAST step of the chain and the dumbest one on purpose: it takes the finished
 * projection model of Phase 4.3 and turns it into bytes. It re-projects nothing, re-parses
 * nothing, reads no CanonicalSchedule and no analysis result, and adds not a single value of its
 * own. Whatever the model says is what the file says.
 *
 * SHEETJS
 * -------
 * The workbook is written with the SheetJS build the app ALREADY vendors and loads
 * (`vendor/xlsx/xlsx.full.min.js` → `window.XLSX`). Nothing is installed, nothing is fetched.
 * Where that library is missing or fails, the export falls back to CSV rather than offering a
 * half-written file.
 *
 * TIMES STAY TEXT
 * ---------------
 * Phase 4.3 writes `00:57 (+1)` because a bare `00:57` would silently claim a duty ended before it
 * began. Handing such a value to a date parser would undo exactly that, so every time is written
 * as a string and no cell ever gets a number format. Measured on the vendored build: a string is
 * stored as `{t:'s'}` and is not coerced into a date.
 *
 * The download is purely local: a Blob, an object URL, a click, and the URL is released again —
 * on every path, including the failing ones. No storage, no network, no telemetry.
 */

export const DIENSTPLAN_EXPORT_STATUS = Object.freeze({
  READY: 'ready',
  NOT_APPLICABLE: 'not_applicable',
  ERROR: 'error'
});

export const EXPORT_FORMATS = Object.freeze({ XLSX: 'xlsx', CSV: 'csv' });

export const EXPORT_WARNING_CODES = Object.freeze({
  MODELL_NICHT_EXPORTIERBAR: 'MODELL_NICHT_EXPORTIERBAR',
  MODELL_UNGUELTIG: 'MODELL_UNGUELTIG',
  XLSX_RUNTIME_UNAVAILABLE: 'XLSX_RUNTIME_UNAVAILABLE',
  XLSX_WRITE_FAILED: 'XLSX_WRITE_FAILED',
  CSV_WRITE_FAILED: 'CSV_WRITE_FAILED',
  KEIN_BROWSERKONTEXT: 'KEIN_BROWSERKONTEXT',
  DOWNLOAD_FEHLGESCHLAGEN: 'DOWNLOAD_FEHLGESCHLAGEN'
});

const WARNING_MESSAGES = Object.freeze({
  MODELL_NICHT_EXPORTIERBAR: 'Für dieses Dokument kann keine Excel-Datei erzeugt werden.',
  MODELL_UNGUELTIG: 'Die Daten haben nicht die erwartete Form. Es wurde keine Datei erzeugt.',
  XLSX_RUNTIME_UNAVAILABLE: 'Die Tabellenbibliothek ist nicht verfügbar. Es wurde eine CSV-Datei erzeugt.',
  XLSX_WRITE_FAILED: 'Die Excel-Datei konnte nicht geschrieben werden. Es wurde eine CSV-Datei erzeugt.',
  CSV_WRITE_FAILED: 'Es konnte keine Datei erzeugt werden.',
  KEIN_BROWSERKONTEXT: 'Der Download ist in dieser Umgebung nicht möglich.',
  DOWNLOAD_FEHLGESCHLAGEN: 'Der Download konnte nicht gestartet werden.'
});

/** The sheet names the file must carry — exactly these, in exactly this order. */
export const EXPECTED_SHEET_NAMES = Object.freeze(['Dienstplan', 'Dienste', 'Importhinweise']);

/** `JNV-Dienstplan-Export-2026-08-04` — operator, purpose, day. Never a path, never a source name. */
export const DIENSTPLAN_FILE_NAME_PATTERN = /^(JNV|JES)-Dienstplan-Export-\d{4}-\d{2}-\d{2}$/;

const MIME = Object.freeze({
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8'
});

export const CSV_SECTION_PREFIX = '### ';

/** Column widths in characters: a readable base per heading, clamped on both ends. */
export const COLUMN_WIDTH_LIMITS = Object.freeze({ min: 8, max: 60, padding: 2 });

const BASE_WIDTHS = Object.freeze({
  Dienstnummer: 12, Zeile: 9, Linie: 10, Umlauf: 14, 'Tätigkeit': 22,
  Beginn: 13, Anfangsort: 24, Richtung: 20, Ende: 13, Endort: 24,
  'Vorheriger Dienst': 18, 'Nachfolgender Dienst': 18,
  Dienstbeginn: 14, Dienstende: 14, 'Bezahlte Zeit': 16,
  'Pause/Unterbrechung': 26, Quellenstatus: 15, 'Unsichere Felder': 28, Seite: 9,
  Abschnitte: 16, Pausen: 16, Dokumenttyp: 22, Organisation: 18, Tagesart: 18,
  Warncode: 30, Bereich: 18, Meldung: 60
});
const DEFAULT_WIDTH = 16;

// =====================================================================================
// small pure helpers
// =====================================================================================

const warning = (code) => ({ code, message: WARNING_MESSAGES[code] ?? '' });

const refusal = (status, warnings) => ({
  status, format: null, fileName: null, mimeType: null, bytes: null, warnings
});

const clamp = (value) => Math.max(COLUMN_WIDTH_LIMITS.min, Math.min(COLUMN_WIDTH_LIMITS.max, Math.round(value)));

/** Only scalars may become a cell. Anything else means the model is not what it claims to be. */
const isScalarCell = (value) =>
  value === null || value === '' || typeof value === 'string' || typeof value === 'number'
  || typeof value === 'boolean';

/**
 * A small boundary check — NOT a second implementation of the Phase 4.3 validation. It answers one
 * question: may these three sheets become a file?
 */
function exportable(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return DIENSTPLAN_EXPORT_STATUS.NOT_APPLICABLE;
  if (model.status !== 'ready') return DIENSTPLAN_EXPORT_STATUS.NOT_APPLICABLE;
  if (!Array.isArray(model.sheets) || model.sheets.length !== EXPECTED_SHEET_NAMES.length) {
    return DIENSTPLAN_EXPORT_STATUS.ERROR;
  }
  for (const [index, sheet] of model.sheets.entries()) {
    if (!sheet || sheet.name !== EXPECTED_SHEET_NAMES[index]) return DIENSTPLAN_EXPORT_STATUS.ERROR;
    if (!Array.isArray(sheet.columns) || !Array.isArray(sheet.rows)) return DIENSTPLAN_EXPORT_STATUS.ERROR;
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length !== sheet.columns.length) return DIENSTPLAN_EXPORT_STATUS.ERROR;
      for (const cell of row) if (!isScalarCell(cell)) return DIENSTPLAN_EXPORT_STATUS.ERROR;
    }
  }
  return DIENSTPLAN_EXPORT_STATUS.READY;
}

/** `JNV-Dienstplan-Export-2026-08-04`, from the organization and a local date. */
function fileNameBase(organization, now) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  const operator = organization === 'JES' ? 'JES' : 'JNV';
  return `${operator}-Dienstplan-Export-${date}`;
}

/**
 * Deterministic column widths: the readable base for the heading, widened by the longest value in
 * that column, clamped on both ends. Counted in characters — no DOM, no canvas, no font metrics.
 */
function columnWidths(sheet) {
  return sheet.columns.map((heading, index) => {
    const base = BASE_WIDTHS[heading] ?? DEFAULT_WIDTH;
    let longest = String(heading).length;
    for (const row of sheet.rows) {
      const length = row[index] === null ? 0 : String(row[index]).length;
      if (length > longest) longest = length;
    }
    return { wch: clamp(Math.max(base, longest + COLUMN_WIDTH_LIMITS.padding)) };
  });
}

/** An empty model value becomes a genuinely EMPTY cell, never the text "null" or "undefined". */
const toCell = (value) => (value === '' || value === null || value === undefined ? null : value);

const sheetMatrix = (sheet) => [[...sheet.columns], ...sheet.rows.map(row => row.map(toCell))];

// =====================================================================================
// the workbook
// =====================================================================================

/**
 * Builds the SheetJS workbook. Exposed because a written-and-read-back file loses `!cols`, so the
 * column widths can only be observed here.
 *
 * @param {object} model the Phase 4.3 projection model
 * @param {{xlsx?: object}} [options]
 * @returns {object|null} the workbook, or null if the model may not be written
 */
export function createDienstplanWorkbook(model, options = {}) {
  if (exportable(model) !== DIENSTPLAN_EXPORT_STATUS.READY) return null;
  const xlsx = resolveXlsx(options);
  if (!xlsx) return null;

  const book = xlsx.utils.book_new();
  for (const sheet of model.sheets) {
    // `aoa_to_sheet` stores a string as a string: the apostrophe guard from the projection model
    // survives, a spreadsheet reads the value as text, and a time never becomes a date.
    const worksheet = xlsx.utils.aoa_to_sheet(sheetMatrix(sheet));
    worksheet['!cols'] = columnWidths(sheet);
    xlsx.utils.book_append_sheet(book, worksheet, sheet.name);
  }
  // Sparse metadata: what the file is and which operator it belongs to. No user, no machine, no
  // path, no source document, and deliberately no precise creation timestamp.
  book.Props = { Title: 'Dienstplan-Export', Company: model.organization ?? '', Author: 'Dienstplananalyse' };
  return book;
}

function resolveXlsx(options) {
  const candidate = options.xlsx ?? (typeof globalThis !== 'undefined' ? globalThis.XLSX : null);
  return candidate && candidate.utils && typeof candidate.write === 'function' ? candidate : null;
}

const resolveNow = (options) => (options.now instanceof Date ? options.now : new Date());

// =====================================================================================
// the files
// =====================================================================================

/**
 * Writes the model as XLSX. A missing or failing spreadsheet library is not an error — it falls
 * back to CSV and says so.
 *
 * @returns {{status: string, format: string|null, fileName: string|null, mimeType: string|null,
 *            bytes: Uint8Array|null, warnings: Array<{code: string, message: string}>}}
 */
export function writeDienstplanXlsx(model, options = {}) {
  const status = exportable(model);
  if (status !== DIENSTPLAN_EXPORT_STATUS.READY) {
    return refusal(status, [warning(status === DIENSTPLAN_EXPORT_STATUS.ERROR
      ? EXPORT_WARNING_CODES.MODELL_UNGUELTIG
      : EXPORT_WARNING_CODES.MODELL_NICHT_EXPORTIERBAR)]);
  }

  const xlsx = resolveXlsx(options);
  if (!xlsx) return fallbackToCsv(model, options, EXPORT_WARNING_CODES.XLSX_RUNTIME_UNAVAILABLE);

  try {
    const book = createDienstplanWorkbook(model, { ...options, xlsx });
    const written = xlsx.write(book, { bookType: 'xlsx', type: 'array' });
    return {
      status: DIENSTPLAN_EXPORT_STATUS.READY,
      format: EXPORT_FORMATS.XLSX,
      fileName: `${fileNameBase(model.organization, resolveNow(options))}.${EXPORT_FORMATS.XLSX}`,
      mimeType: MIME.xlsx,
      bytes: written instanceof Uint8Array ? written : new Uint8Array(written),
      warnings: []
    };
  } catch (error) {
    // The internal message never travels on — only that the XLSX path failed.
    return fallbackToCsv(model, options, EXPORT_WARNING_CODES.XLSX_WRITE_FAILED);
  }
}

function fallbackToCsv(model, options, code) {
  const csv = createDienstplanCsv(model, options);
  if (csv.status !== DIENSTPLAN_EXPORT_STATUS.READY) {
    return refusal(DIENSTPLAN_EXPORT_STATUS.ERROR, [warning(code), warning(EXPORT_WARNING_CODES.CSV_WRITE_FAILED)]);
  }
  return { ...csv, warnings: [warning(code)] };
}

/** One CSV cell: quoted, inner quotes doubled, line breaks kept inside the quotes. */
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * All three sheets in one CSV, each behind a section marker — the honest limitation of a flat
 * format. UTF-8 with a BOM, semicolon separated, so Excel opens it correctly in a German locale.
 */
export function createDienstplanCsv(model, options = {}) {
  const status = exportable(model);
  if (status !== DIENSTPLAN_EXPORT_STATUS.READY) {
    return refusal(status, [warning(status === DIENSTPLAN_EXPORT_STATUS.ERROR
      ? EXPORT_WARNING_CODES.MODELL_UNGUELTIG
      : EXPORT_WARNING_CODES.MODELL_NICHT_EXPORTIERBAR)]);
  }

  try {
    const blocks = model.sheets.map(sheet => [
      `${CSV_SECTION_PREFIX}${sheet.name}`,
      sheet.columns.map(csvCell).join(';'),
      ...sheet.rows.map(row => row.map(csvCell).join(';'))
    ].join('\r\n'));
    return {
      status: DIENSTPLAN_EXPORT_STATUS.READY,
      format: EXPORT_FORMATS.CSV,
      fileName: `${fileNameBase(model.organization, resolveNow(options))}.${EXPORT_FORMATS.CSV}`,
      mimeType: MIME.csv,
      bytes: new TextEncoder().encode(`﻿${blocks.join('\r\n\r\n')}\r\n`),
      warnings: []
    };
  } catch (error) {
    return refusal(DIENSTPLAN_EXPORT_STATUS.ERROR, [warning(EXPORT_WARNING_CODES.CSV_WRITE_FAILED)]);
  }
}

// =====================================================================================
// the download
// =====================================================================================

/**
 * Hands the file to the browser as a local download. Everything it touches is injectable, so the
 * behaviour is observable without a DOM. It runs only when called — nothing happens on import.
 *
 * @param {object} model the Phase 4.3 projection model
 * @param {{xlsx?: object, now?: Date, format?: string,
 *          document?: object, url?: object, blobFactory?: Function}} [options]
 * @returns {object} the file result plus `downloaded`
 */
export function downloadDienstplanExport(model, options = {}) {
  const file = options.format === EXPORT_FORMATS.CSV
    ? createDienstplanCsv(model, options)
    : writeDienstplanXlsx(model, options);
  if (file.status !== DIENSTPLAN_EXPORT_STATUS.READY) return { ...file, downloaded: false };

  const doc = options.document ?? (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const url = options.url ?? (typeof globalThis !== 'undefined' ? globalThis.URL : null);
  const makeBlob = options.blobFactory ?? ((parts, init) => new globalThis.Blob(parts, init));
  if (!doc || !url || typeof url.createObjectURL !== 'function' || typeof doc.createElement !== 'function') {
    return { ...file, downloaded: false, warnings: [...file.warnings, warning(EXPORT_WARNING_CODES.KEIN_BROWSERKONTEXT)] };
  }

  let objectUrl = null;
  let anchor = null;
  try {
    objectUrl = url.createObjectURL(makeBlob([file.bytes], { type: file.mimeType }));
    anchor = doc.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.fileName;
    doc.body?.appendChild?.(anchor);
    anchor.click();
    return { ...file, downloaded: true };
  } catch (error) {
    return { ...file, downloaded: false, warnings: [...file.warnings, warning(EXPORT_WARNING_CODES.DOWNLOAD_FEHLGESCHLAGEN)] };
  } finally {
    // Both are cleaned up on every path: nothing lingers in memory and no node stays behind.
    if (anchor) doc.body?.removeChild?.(anchor);
    if (objectUrl && typeof url.revokeObjectURL === 'function') url.revokeObjectURL(objectUrl);
  }
}
