import { getDocument, GlobalWorkerOptions } from '../../../vendor/pdfjs/pdf.mjs';
import { detectPdfDocumentProfile } from '../pdf/document-profile-detector.js';
import { analyzePdfImport } from './pdf-analysis-controller.js';
import { handleExcelImport, isExcelFile } from './excel-import-controller.js';

GlobalWorkerOptions.workerSrc = new URL('../../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

function isPdfFile(file) {
  return Boolean(file) && (
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  );
}

function setStatus(element, message, hidden = false) {
  if (!element) return;
  element.hidden = hidden;
  element.textContent = message;
}

async function readDetectionText(pdf) {
  // Detection needs title, the repeated table header and profile-specific labels.
  // It deliberately creates neither activity records nor a schedule data model.
  const pagesToInspect = Math.min(pdf.numPages, 2);
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pagesToInspect; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pageTexts.push(textContent.items.map(item => item.str || '').join(' '));
  }

  return pageTexts.join('\n');
}

/**
 * Detection-only entry (title/header/label classification). Retained for internal
 * reuse; it is no longer the productive analysis endpoint (see analyzePdfImport).
 */
export async function inspectPdfImport(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data: bytes,
    disableWorker: true,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false
  });

  try {
    const pdf = await loadingTask.promise;
    const text = await readDetectionText(pdf);
    const detection = detectPdfDocumentProfile({ text, pageCount: pdf.numPages });
    await pdf.destroy();
    return detection;
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Productive PDF import handler. Runs the single central analysis orchestrator
 * (`analyzePdfImport`) — detection + canonical pipeline + JNV-only hardening — and
 * drives the existing status element. The analysis result (including an optional
 * `canonicalSchedule.hardened` for JNV) is returned to the caller and otherwise
 * kept in memory only: no storage, no new UI, no DOM-contract change. The UI does
 * not know the JNV special logic; it only knows the central orchestrator.
 */
export async function handlePdfImport(file, statusElement) {
  if (!isPdfFile(file)) {
    setStatus(statusElement, '', true);
    return null;
  }

  setStatus(statusElement, `PDF wird auf ein unterstütztes Dokumentprofil geprüft: ${file.name}`);

  try {
    const analysis = await analyzePdfImport(file);
    const { detection } = analysis;

    if (detection.status !== 'supported') {
      setStatus(statusElement, 'Dieses PDF wird derzeit nicht unterstützt.');
      return analysis;
    }

    const pageHint = detection.pageCount > 0 ? ` (${detection.pageCount} Seiten)` : '';
    setStatus(
      statusElement,
      `Unterstütztes PDF erkannt: ${detection.profile.label}${pageHint}. Noch keine Analyse durchgeführt.`
    );
    return analysis;
  } catch (error) {
    console.error('PDF-Profilerkennung fehlgeschlagen:', error);
    setStatus(statusElement, 'Dieses PDF wird derzeit nicht unterstützt.');
    return null;
  }
}

/**
 * Routes a selected file to the correct single-analysis handler by file type: PDFs go
 * to the unchanged PDF path (`handlePdfImport`); `.xlsx` files go to the content-based
 * Excel classifier (`handleExcelImport`), which decides Umlauftafel vs Wagenkarte vs
 * Legacy-Excel-Dienstplan vs unknown. No PDF/XLSX mixing, no conversion.
 */
export async function handleImport(file, statusElement) {
  if (isPdfFile(file)) return handlePdfImport(file, statusElement);
  if (isExcelFile(file)) return handleExcelImport(file, statusElement);
  setStatus(statusElement, '', true);
  return null;
}

export function initializePdfImport({ fileInput, statusElement, onResult }) {
  if (!fileInput || !statusElement) return;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    const result = await handleImport(file, statusElement);
    // Optional observer: lets a multi-document session capture the primary result from
    // this single existing import (no second read, no new listener on the file input).
    if (typeof onResult === 'function') onResult(result, file);
  });
}
