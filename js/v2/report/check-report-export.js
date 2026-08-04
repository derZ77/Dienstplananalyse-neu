/**
 * Writing and downloading the report export (Phase 3I.36).
 *
 * The workbook is written with the SheetJS build the app ALREADY vendors and loads
 * (`vendor/xlsx/xlsx.full.min.js` → `window.XLSX`). Nothing is installed, nothing is fetched.
 * Where that library is unavailable the export falls back to CSV rather than failing.
 *
 * The download is purely local: a Blob, an object URL, a click, and the URL is released again.
 * No storage, no network, no telemetry.
 *
 * Every cell has already been neutralised against formula injection by the export model; the CSV
 * writer additionally quotes and escapes, so a line break or a quote cannot break the file.
 */

export const EXPORT_FORMATS = Object.freeze({ XLSX: 'xlsx', CSV: 'csv' });

const MIME = Object.freeze({
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8'
});

const refusal = (reason) => ({ ok: false, reason, format: null, fileName: null, mimeType: null, data: null });

/** One CSV cell: quoted, inner quotes doubled, line breaks kept inside the quotes. */
function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * All sheets in one CSV, each preceded by its name — the honest limitation of a flat format.
 * UTF-8 with a BOM, semicolon separated, so Excel opens it correctly in a German locale.
 */
function writeCsv(model) {
  const blocks = model.sheets.map(sheet => [
    csvCell(sheet.name),
    ...sheet.rows.map(row => row.map(csvCell).join(';'))
  ].join('\r\n'));
  return new TextEncoder().encode(`\uFEFF${blocks.join('\r\n\r\n')}\r\n`);
}

function writeXlsx(model, xlsx) {
  const book = xlsx.utils.book_new();
  for (const sheet of model.sheets) {
    // `aoa_to_sheet` writes the cells exactly as given — the apostrophe prefix from the export
    // model survives, so a spreadsheet reads the value as text and never as a formula.
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  const written = xlsx.write(book, { bookType: 'xlsx', type: 'array' });
  return written instanceof Uint8Array ? written : new Uint8Array(written);
}

/**
 * Produces the export file from the export model.
 *
 * @param {object} exportModel from `buildCheckReportExportModel`
 * @param {{xlsx?: object, format?: string}} [options]
 * @returns {{ok: boolean, reason: string|null, format: string|null, fileName: string|null,
 *            mimeType: string|null, data: Uint8Array|null}}
 */
export function createReportExportFile(exportModel, options = {}) {
  if (!exportModel || exportModel.exportable !== true) {
    return refusal(exportModel?.reason ?? 'NO_REPORT');
  }
  const xlsx = options.xlsx ?? (typeof globalThis !== 'undefined' ? globalThis.XLSX : null);
  const wantsCsv = options.format === EXPORT_FORMATS.CSV;
  const canWriteXlsx = !wantsCsv && xlsx && xlsx.utils && typeof xlsx.write === 'function';

  try {
    const format = canWriteXlsx ? EXPORT_FORMATS.XLSX : EXPORT_FORMATS.CSV;
    const data = canWriteXlsx ? writeXlsx(exportModel, xlsx) : writeCsv(exportModel);
    return {
      ok: true,
      // Only a missing library is worth naming; an explicit CSV choice is not a fallback.
      reason: (!canWriteXlsx && !wantsCsv) ? 'XLSX_UNAVAILABLE' : null,
      format,
      fileName: `${exportModel.fileNameBase}.${format}`,
      mimeType: MIME[format],
      data
    };
  } catch (error) {
    // The internal message never reaches the caller — only that it failed.
    return refusal('EXPORT_FAILED');
  }
}

const outcome = (applied, reason = null) => ({ applied, reason });

/**
 * Hands the file to the browser as a local download. Everything it touches is injectable, so the
 * behaviour is observable without a DOM.
 *
 * @param {object} file from `createReportExportFile`
 * @param {{document?: object, url?: object, blobFactory?: Function}} [environment]
 */
export function downloadReportExport(file, environment = {}) {
  if (!file || file.ok !== true) return outcome(false, file?.reason ?? 'NO_REPORT');

  const doc = environment.document ?? (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const url = environment.url ?? (typeof globalThis !== 'undefined' ? globalThis.URL : null);
  const makeBlob = environment.blobFactory
    ?? ((parts, init) => new globalThis.Blob(parts, init));
  if (!doc || !url || typeof url.createObjectURL !== 'function') return outcome(false, 'NO_BROWSER_CONTEXT');

  let objectUrl = null;
  try {
    objectUrl = url.createObjectURL(makeBlob([file.data], { type: file.mimeType }));
    const anchor = doc.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.fileName;
    doc.body?.appendChild?.(anchor);
    anchor.click();
    doc.body?.removeChild?.(anchor);
    return outcome(true);
  } catch (error) {
    return outcome(false, 'DOWNLOAD_FAILED');
  } finally {
    // The object URL is released in every case — nothing lingers in memory.
    if (objectUrl && typeof url.revokeObjectURL === 'function') url.revokeObjectURL(objectUrl);
  }
}
