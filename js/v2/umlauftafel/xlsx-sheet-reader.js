/**
 * SheetJS adapter (Phase 3C.1) — the ONLY module that references the XLSX library.
 *
 * It turns raw workbook bytes into PLAIN OBJECTS: an array of sheets, each with its
 * name and a 2D array of string cells. No SheetJS/XLSX object ever leaves this module;
 * every downstream module works exclusively with these plain values.
 *
 * The XLSX library is taken from `globalThis.XLSX` — in the browser it is provided by
 * `vendor/xlsx/xlsx.full.min.js` (loaded via a <script> tag in index.html); in tests
 * it is bootstrapped onto the global before use. No file access, no network here.
 */

function getXlsx() {
  const xlsx = globalThis.XLSX;
  if (!xlsx || typeof xlsx.read !== 'function' || !xlsx.utils || typeof xlsx.utils.sheet_to_json !== 'function') {
    throw new Error('XLSX library is not available (vendor/xlsx must be loaded).');
  }
  return xlsx;
}

/** True when the XLSX library is loaded (browser script tag or test bootstrap). */
export function isXlsxAvailable() {
  const xlsx = globalThis.XLSX;
  return Boolean(xlsx && typeof xlsx.read === 'function' && xlsx.utils && typeof xlsx.utils.sheet_to_json === 'function');
}

/**
 * Reads workbook bytes into plain sheet data.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {{ sheetNames: string[], sheets: Array<{ name: string, ref: string|null, rows: string[][] }> }}
 */
export function readWorkbookSheets(bytes) {
  const XLSX = getXlsx();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames.slice() : [];

  const sheets = sheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) return { name, ref: null, rows: [] };
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' });
    return {
      name,
      ref: worksheet['!ref'] || null,
      rows: rows.map(row => (Array.isArray(row) ? row.map(cell => (cell == null ? '' : String(cell))) : []))
    };
  });

  return { sheetNames, sheets };
}
