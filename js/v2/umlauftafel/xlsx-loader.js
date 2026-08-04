/**
 * Isolated JNV Umlauftafel XLSX loader (Phase 3C.1).
 *
 * Composes the SheetJS adapter (xlsx-sheet-reader) with the pure layout parser
 * (xlsx-layout), the frozen Phase-3B.2 contracts/factories (umlauftafel-contract),
 * the single time normalizer (umlauftafel-time) and the validators
 * (umlauftafel-validation). It produces ONLY the frozen contract model, validates
 * every document, and reports problems as structured warnings — it never throws for
 * expected data/validation problems (programmer errors may still throw).
 *
 * Not wired into any UI, import path, matching or PDF logic.
 */

import { readWorkbookSheets } from './xlsx-sheet-reader.js';
import { interpretUmlaufSheet } from './xlsx-layout.js';
import { normalizeUmlauftafelTimeSequence } from './umlauftafel-time.js';
import {
  createUmlauftafelDocument, createCirculation, createSegment, createStopEvent, createValidity,
  createUmlauftafelWarning, createParserResult,
  UMLAUFTAFEL_MODES, UMLAUFTAFEL_SOURCE_FORMATS, DAY_TYPES, SERVICE_REGIMES, WARNING_CODES, WARNING_CODE_VALUES
} from './umlauftafel-contract.js';
import { validateUmlauftafelDocument } from './umlauftafel-validation.js';

/** Determines the mode from the vehicle type, falling back to the code length. */
export function detectMode(vehicleType, code) {
  const vt = String(vehicleType || '').toUpperCase();
  if (/^(TLV|GT|NGT)/.test(vt)) return UMLAUFTAFEL_MODES.TRAM;
  if (/^(SL|SG|GN|EN|EG)/.test(vt)) return UMLAUFTAFEL_MODES.BUS;
  const c = String(code || '');
  if (c.length === 4) return UMLAUFTAFEL_MODES.TRAM;
  if (c.length === 5) return UMLAUFTAFEL_MODES.BUS;
  return null;
}

/** Derives validity from the in-sheet dataset tag (never from the file name). */
export function deriveValidity(datasetTag) {
  const tag = String(datasetTag || '');
  let dayType = DAY_TYPES.UNKNOWN;
  let serviceRegime = SERVICE_REGIMES.UNKNOWN;
  if (/MoDo/i.test(tag)) dayType = DAY_TYPES.MO_DO;
  else if (/MoFr/i.test(tag)) dayType = DAY_TYPES.MO_FR;
  if (/Ferien/i.test(tag)) serviceRegime = SERVICE_REGIMES.HOLIDAYS;
  else if (/Schule/i.test(tag)) serviceRegime = SERVICE_REGIMES.SCHOOL;
  return createValidity({ dayType, serviceRegime, rawLabel: tag || null });
}

const stopRole = (marker) => (marker === 'ab' ? 'departure' : marker === 'an' ? 'arrival' : 'pass');
const timeRole = (marker) => (marker === 'ab' ? 'departure' : marker === 'an' ? 'arrival' : 'event');

function buildCirculation(raw, sequence) {
  const mode = detectMode(raw.vehicleType, raw.code);
  const flatStops = raw.segments.flatMap(segment => segment.stops);
  const entries = [
    { raw: raw.begin, role: 'begin' },
    ...flatStops.map(stop => ({ raw: stop.rawTime, role: timeRole(stop.marker) })),
    { raw: raw.end, role: 'end' }
  ];
  const { times, warnings: timeWarnings } = normalizeUmlauftafelTimeSequence(entries);
  flatStops.forEach((stop, index) => { stop.time = times[index + 1]; });

  const circulation = createCirculation({
    code: raw.code, mode, sequence,
    begin: { time: times[0], location: flatStops[0]?.name ?? null },
    end: { time: times[times.length - 1], location: flatStops[flatStops.length - 1]?.name ?? null },
    depot: { start: raw.startDepot ?? null, end: raw.endDepot ?? null },
    vehicle: { type: raw.vehicleType ?? null, number: null },
    page: { current: 1, total: raw.pageTotal ?? 1 },
    segments: raw.segments.map((segment, si) => createSegment({
      type: segment.type, sequence: si + 1, line: segment.line, route: segment.route, dutyRef: segment.dutyRef,
      stops: segment.stops.map((stop, sj) => createStopEvent({ sequence: sj + 1, name: stop.name, role: stopRole(stop.marker), time: stop.time, rawMarker: stop.marker }))
    }))
  });
  return { circulation, mode, timeWarnings };
}

const mapWarningCode = (code) => (WARNING_CODE_VALUES.includes(code) ? code : WARNING_CODES.MISSING_REQUIRED_FIELD);

/**
 * @param {Uint8Array|ArrayBuffer} bytes raw XLSX bytes (browser: File.arrayBuffer; tests: fs)
 * @param {{ sourceName?: string }} [options]
 * @returns parser result { ok, document, warnings, statistics }
 */
/**
 * Loads the Umlauftafel document from an ALREADY-read workbook (plain objects from the
 * adapter). Used by the productive single-read Excel import path so the file/workbook
 * is read exactly once (classification + loading share the same workbook).
 * @param {{ sheets: Array<{ name:string, rows:string[][] }> }} workbook
 */
export function loadUmlauftafelFromWorkbook(workbook, options = {}) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];

  const warnings = [];
  const circulations = [];
  const modeVotes = {};
  let segmentCount = 0;
  let stopEventCount = 0;
  let datasetTag = null;

  for (const sheet of sheets) {
    let raw;
    try {
      raw = interpretUmlaufSheet(sheet.name, sheet.rows);
    } catch (error) {
      warnings.push(createUmlauftafelWarning({ code: WARNING_CODES.UNSUPPORTED_LAYOUT, severity: 'warning', message: 'Ein Tabellenblatt konnte nicht interpretiert werden.', scope: 'circulation', source: { sheet: sheet.name } }));
      continue;
    }
    if (!raw) continue; // empty / non-Umlauf sheet is skipped

    const { circulation, mode, timeWarnings } = buildCirculation(raw, circulations.length + 1);
    circulations.push(circulation);
    segmentCount += circulation.segments.length;
    stopEventCount += circulation.segments.reduce((sum, segment) => sum + segment.stops.length, 0);
    if (mode) modeVotes[mode] = (modeVotes[mode] || 0) + 1;
    else warnings.push(createUmlauftafelWarning({ code: WARNING_CODES.UNKNOWN_DOCUMENT_MODE, scope: 'circulation', source: { sheet: sheet.name } }));
    if (!datasetTag && raw.datasetTag) datasetTag = raw.datasetTag;
    for (const w of timeWarnings) warnings.push(createUmlauftafelWarning({ code: w.code, severity: w.severity, message: w.message, scope: w.scope, source: { sheet: sheet.name } }));
  }

  if (circulations.length === 0) {
    return createParserResult({
      ok: false, document: null,
      warnings: [...warnings, createUmlauftafelWarning({ code: WARNING_CODES.UNSUPPORTED_LAYOUT, severity: 'error', message: 'Es wurden keine Umläufe erkannt.', scope: 'document' })],
      statistics: { circulationCount: 0, segmentCount: 0, stopEventCount: 0 }
    });
  }

  const documentMode = Object.keys(modeVotes).sort((a, b) => modeVotes[b] - modeVotes[a])[0] || null;
  const validity = deriveValidity(datasetTag);
  if (validity.dayType === DAY_TYPES.UNKNOWN && validity.serviceRegime === SERVICE_REGIMES.UNKNOWN) {
    warnings.push(createUmlauftafelWarning({ code: WARNING_CODES.UNKNOWN_VALIDITY, scope: 'document' }));
  }

  const baseDocument = createUmlauftafelDocument({
    mode: documentMode, sourceFormat: UMLAUFTAFEL_SOURCE_FORMATS.XLSX, sourceName: options.sourceName ?? null, validity, circulations
  });
  const validation = validateUmlauftafelDocument(baseDocument);
  if (!validation.valid) {
    for (const error of validation.errors) {
      warnings.push(createUmlauftafelWarning({ code: mapWarningCode(error.code), severity: 'warning', message: 'Validierungsproblem im erzeugten Dokument.', scope: 'document' }));
    }
  }

  const document = { ...baseDocument, warnings: [...baseDocument.warnings, ...warnings] };
  return createParserResult({
    ok: circulations.length > 0 && validation.valid,
    document,
    warnings: document.warnings,
    statistics: { circulationCount: circulations.length, segmentCount, stopEventCount }
  });
}

/**
 * Backward-compatible byte entry point: reads the workbook once via the adapter and
 * delegates to loadUmlauftafelFromWorkbook.
 * @param {Uint8Array|ArrayBuffer} bytes
 */
export function loadUmlauftafelDocumentFromXlsx(bytes, options = {}) {
  let workbook;
  try {
    workbook = readWorkbookSheets(bytes);
  } catch (error) {
    return createParserResult({
      ok: false, document: null,
      warnings: [createUmlauftafelWarning({ code: WARNING_CODES.UNSUPPORTED_LAYOUT, severity: 'error', message: 'Die Umlauftafel konnte nicht gelesen werden.', scope: 'document' })],
      statistics: { circulationCount: 0, segmentCount: 0, stopEventCount: 0 }
    });
  }
  return loadUmlauftafelFromWorkbook(workbook, options);
}
