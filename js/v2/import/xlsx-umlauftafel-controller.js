/**
 * Productive XLSX Umlauftafel import handler (Phase 3C.2).
 *
 * Recognizes an `.xlsx` selection and routes it to the isolated Umlauftafel loader
 * (single analysis). It produces ONLY the frozen Umlauftafel document contract, keeps
 * the result in memory, and drives the existing status element. No storage, no new UI,
 * no matching, no PDF mixing. SheetJS lives solely inside the loader's adapter — this
 * controller never touches it directly.
 */

import { loadUmlauftafelDocumentFromXlsx } from '../umlauftafel/xlsx-loader.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// NOTE (Phase 3C.2): this is an EXTENSION/type-based route only. Every `.xlsx` is
// treated as a JNV Umlauftafel; distinguishing legacy Excel Dienstpläne / Wagenkarten /
// other Excel documents by CONTENT is a later phase (content-based classification).
export function isUmlauftafelXlsxFile(file) {
  return Boolean(file) && (/\.xlsx$/i.test(file.name || '') || file.type === XLSX_MIME);
}

function setStatus(element, message, hidden = false) {
  if (!element) return;
  element.hidden = hidden;
  element.textContent = message;
}

/**
 * Reads the workbook bytes exactly once and runs the isolated loader.
 * @param {{ name?: string, arrayBuffer: () => Promise<ArrayBuffer> }} file
 */
export async function analyzeUmlauftafelXlsx(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return loadUmlauftafelDocumentFromXlsx(bytes, { sourceName: file.name || null });
}

/**
 * Productive handler. Returns the parser result (kept in memory only); an invalid or
 * empty workbook yields a clean "not supported" status without throwing to the UI.
 */
export async function handleUmlauftafelXlsxImport(file, statusElement) {
  if (!isUmlauftafelXlsxFile(file)) {
    setStatus(statusElement, '', true);
    return null;
  }

  setStatus(statusElement, `XLSX-Umlauftafel wird geprüft: ${file.name}`);

  try {
    const result = await analyzeUmlauftafelXlsx(file);
    if (!result.ok || !result.document) {
      setStatus(statusElement, 'Diese Umlauftafel wird derzeit nicht unterstützt.');
      return result;
    }
    const modeLabel = result.document.mode === 'tram' ? 'Straßenbahn' : result.document.mode === 'bus' ? 'Bus' : 'unbekannt';
    const warningHint = result.warnings.length ? ` (${result.warnings.length} Hinweise)` : '';
    setStatus(
      statusElement,
      `Umlauftafel erkannt: ${modeLabel}, ${result.statistics.circulationCount} Umläufe${warningHint}. Noch keine Analyse durchgeführt.`
    );
    return result;
  } catch (error) {
    console.error('XLSX-Umlauftafel-Analyse fehlgeschlagen:', error);
    setStatus(statusElement, 'Diese Umlauftafel wird derzeit nicht unterstützt.');
    return null;
  }
}
