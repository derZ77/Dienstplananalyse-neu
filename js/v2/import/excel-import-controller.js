/**
 * Productive Excel import controller (Phase 3C.3).
 *
 * Reads a selected workbook EXACTLY ONCE, turns it into plain objects ONCE via the
 * shared SheetJS adapter, classifies it by content, and — only for an `exact`
 * JNV-Umlauftafel — runs the isolated loader on the already-read workbook (no second
 * read). Wagenkarte and Legacy-Excel-Dienstplan are recognized but their productive
 * processing stays in the existing (inline) path; `probable`/`ambiguous`/`unknown`
 * are never routed to a professional parser.
 *
 * SheetJS lives only inside the adapter — this controller never touches it directly.
 * No storage, no network, no matching, no new UI.
 */

import { readWorkbookSheets } from '../umlauftafel/xlsx-sheet-reader.js';
import { loadUmlauftafelFromWorkbook } from '../umlauftafel/xlsx-loader.js';
import { classifyExcelDocument, EXCEL_CLASSIFICATION_CONFIDENCE } from './excel-document-classifier.js';
import { analyzeWagenkarteWorkbook } from './wagenkarte-import-adapter.js';
import { analyzeLegacyExcelWorkbook } from './legacy-excel-import-adapter.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isExcelFile(file) {
  return Boolean(file) && (/\.xlsx$/i.test(file.name || '') || file.type === XLSX_MIME);
}

function setStatus(element, message, hidden = false) {
  if (!element) return;
  element.hidden = hidden;
  element.textContent = message;
}

const warning = (code) => ({ code, severity: 'warning', message: '', scope: 'document' });

function classificationWarnings(classification) {
  if (classification.confidence === EXCEL_CLASSIFICATION_CONFIDENCE.AMBIGUOUS) return [warning('AMBIGUOUS_EXCEL_DOCUMENT'), warning('CONFLICTING_EXCEL_DOCUMENT_SIGNALS')];
  if (classification.confidence === EXCEL_CLASSIFICATION_CONFIDENCE.PROBABLE) return [warning('AMBIGUOUS_EXCEL_DOCUMENT')];
  if (classification.type === 'unknown') return [warning('UNKNOWN_EXCEL_DOCUMENT')];
  return [];
}

const UNKNOWN_CLASSIFICATION = { type: 'unknown', subtype: null, mode: null, confidence: 'unknown', signals: [], conflicts: [], candidates: [] };

// Runs exactly one fach-adapter and isolates unexpected errors into a controlled,
// privacy-safe result (no throw reaches the productive caller, no raw cell content).
function runFachAdapter(fn, failCode) {
  try {
    return fn();
  } catch (error) {
    return { documentType: null, ok: false, data: null, warnings: [warning(failCode)] };
  }
}

/**
 * Reads the file once, builds the workbook once, classifies it, and routes EXACTLY ONE
 * fach-adapter by classified type — all sharing the same already-read workbook (no second
 * read/parse): exact Umlauftafel → the isolated Umlauftafel loader; exact Wagenkarte → the
 * Wagenkarte adapter; exact Legacy-Excel → the Legacy adapter (existing canonical mapping).
 * `probable`/`ambiguous`/`unknown` reach no adapter. The fachliche Ergebnis is carried under
 * the neutral `importResult` field; `document`/`result` keep their Umlauftafel-only meaning
 * for backward compatibility. Never throws for expected errors.
 */
export async function analyzeExcelImport(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); // single file read
  let workbook;
  try {
    workbook = readWorkbookSheets(bytes); // single workbook creation
  } catch (error) {
    return { classification: { ...UNKNOWN_CLASSIFICATION }, document: null, result: null, importResult: null, warnings: [warning('EXCEL_CLASSIFICATION_FAILED')] };
  }

  const classification = classifyExcelDocument(workbook);
  const isExact = classification.confidence === EXCEL_CLASSIFICATION_CONFIDENCE.EXACT;

  if (classification.type === 'umlaufkarte' && isExact) {
    const result = loadUmlauftafelFromWorkbook(workbook, { sourceName: file.name || null }); // no second read
    const importResult = { documentType: 'umlaufkarte', ok: result.ok, data: result.document, warnings: result.warnings };
    return { classification, document: result.document, result, importResult, warnings: result.warnings };
  }
  if (classification.type === 'wagenkarte' && isExact) {
    // The Wagenkarte is a JES companion document. Preserve its file-derived
    // validity evidence in the dedicated vehicle-card contract; it does not
    // replace the primary CanonicalSchedule.
    const importResult = runFachAdapter(() => analyzeWagenkarteWorkbook(workbook, {
      sourceName: file.name || null,
      organization: 'JES'
    }), 'WAGENKARTE_IMPORT_FAILED');
    return { classification, document: null, result: null, importResult, warnings: importResult.warnings };
  }
  if (classification.type === 'legacy_excel_schedule' && isExact) {
    const importResult = runFachAdapter(() => analyzeLegacyExcelWorkbook(workbook, {
      sourceName: file.name || null,
      organization: classification.organization ?? null,
      subtype: classification.subtype ?? null
    }), 'LEGACY_EXCEL_IMPORT_FAILED');
    return { classification, document: null, result: null, importResult, warnings: importResult.warnings };
  }

  // probable / ambiguous / unknown: no fach-adapter is invoked.
  return { classification, document: null, result: null, importResult: null, warnings: classificationWarnings(classification) };
}

function statusMessage(analysis) {
  const { classification, result } = analysis;
  if (classification.type === 'umlaufkarte' && classification.confidence === 'exact' && result?.document) {
    const modeLabel = result.document.mode === 'tram' ? 'Straßenbahn' : result.document.mode === 'bus' ? 'Bus' : 'unbekannt';
    return `Umlauftafel erkannt: ${modeLabel}, ${result.statistics.circulationCount} Umläufe.`;
  }
  if (classification.type === 'wagenkarte' && classification.confidence === 'exact') {
    return analysis.importResult?.ok ? 'Wagenkarte erkannt.' : 'Die Excel-Datei wurde erkannt, konnte aber nicht verarbeitet werden.';
  }
  if (classification.type === 'legacy_excel_schedule' && classification.confidence === 'exact') {
    return analysis.importResult?.ok ? 'Legacy-Excel-Dienstplan erkannt.' : 'Die Excel-Datei wurde erkannt, konnte aber nicht verarbeitet werden.';
  }
  if (classification.confidence === 'ambiguous') return 'Der Excel-Dokumenttyp ist nicht eindeutig. Eine manuelle Auswahl ist erforderlich.';
  return 'Die Excel-Datei konnte keinem unterstützten Dokumenttyp zugeordnet werden.';
}

/**
 * Productive handler: classifies the workbook once and drives the status element.
 * The analysis result is kept in memory only (no storage, no rendering).
 */
export async function handleExcelImport(file, statusElement) {
  if (!isExcelFile(file)) {
    setStatus(statusElement, '', true);
    return null;
  }
  setStatus(statusElement, `Excel-Datei wird klassifiziert: ${file.name}`);
  try {
    const analysis = await analyzeExcelImport(file);
    setStatus(statusElement, statusMessage(analysis));
    return analysis;
  } catch (error) {
    console.error('Excel-Klassifikation fehlgeschlagen:', error);
    setStatus(statusElement, 'Die Excel-Datei konnte keinem unterstützten Dokumenttyp zugeordnet werden.');
    return null;
  }
}
