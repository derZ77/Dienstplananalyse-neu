/**
 * Production import-analysis orchestrator (Phase 3A.2 / 3A.2b).
 *
 * The single fachlicher entry point for productive PDF analysis. It composes the
 * existing, unchanged pipeline
 *   extractPdfLayoutDocument → normalize → map → buildCanonicalSchedule
 * with the JNV hardening seam. Hardening is applied ONLY for the JNV profile;
 * every other supported profile yields an unchanged CanonicalSchedule.
 *
 * The PDF is read exactly once: detection is derived from the already-extracted
 * layout, so there is no second PDF.js extraction just for detection or hardening.
 * Since Phase 4.2 the detection text is the reconstructed LINE text of that layout
 * (see `buildDetectionText`); the legacy, non-productive `inspectPdfImport` still
 * reads its own raw item text and is unaffected by this module.
 *
 * Local only: no network, no storage, no new dependency.
 */

import { extractPdfLayoutDocument } from '../pdf/pdf-core.js';
import { normalizePdfLayoutDocument } from '../pdf/document-normalizer.js';
import { mapPdfDocumentToSchedule } from '../pdf/schedule-mapper.js';
import { detectPdfDocumentProfile } from '../pdf/document-profile-detector.js';
import { buildHardenedCanonicalSchedule } from '../pdf/hardened-schedule.js';

const DETECTION_PAGES = 2;

/**
 * Detection text = the RECONSTRUCTED LINES of the first two pages (Phase 4.2).
 *
 * PDF.js splits a printed line into several text items, and whether two neighbours belong to the
 * same word is decided by their horizontal distance — a measurement the layout reconstruction has
 * already made: it inserts a space only where the gap exceeds `max(1.5, fontSize * 0.15)`.
 *
 * This projection previously joined the raw items with a blank and therefore discarded that
 * measurement. Where a heading arrives as several fragments that abut each other — measured gaps
 * of 0.00 pt against a 2.10 pt threshold on a 14 pt heading — the blank tore words apart and a
 * valid document was refused. Reading `line.text` reproduces exactly what is printed: a space
 * that was typed survives, a gap that never existed is not invented. No document, operator or
 * heading is named here; the correction is layout-generic.
 *
 * The window of two pages, the detector and its signal combination are unchanged.
 *
 * @param {object} layout a PdfLayoutDocument
 * @returns {string} never throws — an unusable layout yields an empty string
 */
export function buildDetectionText(layout) {
  const pages = Array.isArray(layout?.pages) ? layout.pages.slice(0, DETECTION_PAGES) : [];
  return pages
    .flatMap(page => (Array.isArray(page?.lines) ? page.lines : []).map(line => line?.text ?? ''))
    .join('\n');
}

/**
 * Runs profile detection and, for supported profiles, the full canonical
 * pipeline plus (JNV-only) hardening. Returns `{ detection, canonicalSchedule }`;
 * unsupported PDFs return a null schedule and keep the existing detection result.
 */
export async function analyzePdfImport(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const layout = await extractPdfLayoutDocument(bytes);
  const detection = detectPdfDocumentProfile({ text: buildDetectionText(layout), pageCount: layout.pageCount });

  if (detection.status !== 'supported') {
    return { detection, canonicalSchedule: null };
  }

  const scheduleDocument = mapPdfDocumentToSchedule(normalizePdfLayoutDocument(layout));
  const canonicalSchedule = buildHardenedCanonicalSchedule(scheduleDocument, { profileId: detection.profile.id });
  return { detection, canonicalSchedule };
}
