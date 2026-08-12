/**
 * Conservative JNV Umlauftafel PDF reader (Phase 9.5).
 *
 * It consumes the neutral PDF layout only and creates the same Umlauftafel
 * document contract as the existing XLSX loader. It intentionally does not
 * create a Dienstplan, calculate driving time, or assign a service reference
 * to an individual trip: a circulation can contain several services.
 */

import {
  createUmlauftafelDocument, createCirculation, createSegment, createNormalizedTime,
  createValidity, createUmlauftafelWarning, createParserResult,
  UMLAUFTAFEL_MODES, UMLAUFTAFEL_SOURCE_FORMATS, SEGMENT_TYPES,
  TIME_ROLES, TIME_CONFIDENCE, WARNING_CODES, WARNING_SEVERITIES, WARNING_SCOPES
} from './umlauftafel-contract.js';
import { validateUmlauftafelDocument } from './umlauftafel-validation.js';
import { resolveCanonicalValidity } from '../schedule/canonical-validity.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const timeRe = /\b(\d{1,2}):(\d{2})\b/;
const modeFor = vehicleType => /^(SL|SG|GN|EN|EG|KB)/i.test(vehicleType || '') ? UMLAUFTAFEL_MODES.BUS : null;

function clock(raw, role) {
  const match = text(raw).match(timeRe);
  if (!match) return createNormalizedTime({ raw: text(raw), role, confidence: TIME_CONFIDENCE.UNKNOWN });
  return createNormalizedTime({ raw: `${match[1].padStart(2, '0')}:${match[2]}`, hour: Number(match[1]), minute: Number(match[2]), role });
}

function pageHeader(page) {
  const header = (page?.lines || []).slice(0, 5).map(line => line.text).join(' ');
  const get = re => header.match(re)?.[1] ?? null;
  const pageValue = get(/Seite:\s*(\d+)\/(\d+)/i);
  const pageTotal = header.match(/Seite:\s*\d+\/(\d+)/i)?.[1] ?? null;
  return {
    code: get(/Umlauf:\s*([A-Za-z0-9_-]+)/i),
    begin: get(/Beginn:\s*(\d{1,2}:\d{2})/i),
    end: get(/Ende:\s*(\d{1,2}:\d{2})/i),
    vehicleType: get(/Fahrzeugtyp:\s*([^\s]+)/i),
    start: get(/Startpunkt:\s*([^\s]+)/i),
    endPoint: get(/Endpunkt:\s*([^\s]+)/i),
    page: pageValue ? Number(pageValue) : null,
    pageTotal: pageTotal ? Number(pageTotal) : null,
    header
  };
}

function references(lines) {
  const labels = [];
  for (const line of lines) {
    for (const match of line.matchAll(/Dienst:\s*([0-9]+(?:\/[0-9]+)?)/g)) labels.push(match[1]);
  }
  const rawServiceLabels = [...new Set(labels)];
  const serviceRefs = [...new Set(rawServiceLabels.flatMap(label => label.split('/')))].filter(Boolean);
  return { rawServiceLabels, serviceRefs };
}

function segments(lines, pageNumber) {
  const result = [];
  for (const line of lines) {
    for (const match of line.matchAll(/Linie:\s*([^\s]+)\s+Route:\s*([^\s]+)/g)) {
      result.push(createSegment({
        type: SEGMENT_TYPES.SERVICE_TRIP,
        sequence: result.length + 1,
        line: match[1],
        route: match[2],
        source: { sourceFormat: UMLAUFTAFEL_SOURCE_FORMATS.PDF, page: pageNumber }
      }));
    }
    if (/\bLeerfahrt\b/i.test(line)) {
      result.push(createSegment({
        type: SEGMENT_TYPES.DEADHEAD,
        sequence: result.length + 1,
        source: { sourceFormat: UMLAUFTAFEL_SOURCE_FORMATS.PDF, page: pageNumber }
      }));
    }
  }
  return result;
}

function headerValidity(headerText) {
  const resolved = resolveCanonicalValidity({ headerText });
  return createValidity({
    dayType: resolved.dayType,
    serviceRegime: resolved.serviceRegime,
    validFrom: resolved.validFrom,
    rawLabel: resolved.rawLabel
  });
}

function mergePages(records) {
  const byCode = new Map();
  for (const record of records) {
    const previous = byCode.get(record.header.code);
    if (!previous) {
      byCode.set(record.header.code, record);
      continue;
    }
    previous.lines.push(...record.lines);
    previous.pages.push(...record.pages);
    previous.header.pageTotal = Math.max(previous.header.pageTotal || 0, record.header.pageTotal || 0) || null;
    previous.header.end = record.header.end || previous.header.end;
    previous.header.endPoint = record.header.endPoint || previous.header.endPoint;
  }
  return [...byCode.values()];
}

/** @param {{type?:string, pages?:Array}} layout */
export function loadJnvUmlauftafelFromPdfLayout(layout, { sourceName = null } = {}) {
  const records = [];
  for (const page of Array.isArray(layout?.pages) ? layout.pages : []) {
    const header = pageHeader(page);
    if (!header.code || !header.begin || !header.end || !header.vehicleType) continue;
    records.push({ header, lines: (page.lines || []).map(line => text(line.text)).filter(Boolean), pages: [page.number] });
  }
  const merged = mergePages(records);
  if (!merged.length) {
    return createParserResult({
      ok: false,
      warnings: [createUmlauftafelWarning({ code: WARNING_CODES.UNSUPPORTED_LAYOUT, severity: WARNING_SEVERITIES.ERROR, scope: WARNING_SCOPES.DOCUMENT, message: 'Es wurden keine strukturierten Umläufe erkannt.' })]
    });
  }

  const circulations = merged.map((record, index) => {
    const { header, lines, pages } = record;
    const refs = references(lines);
    const parsedSegments = segments(lines, pages[0]);
    const end = clock(header.end, TIME_ROLES.END);
    const begin = clock(header.begin, TIME_ROLES.BEGIN);
    if (end.normalizedMinutes !== null && begin.normalizedMinutes !== null && end.normalizedMinutes < begin.normalizedMinutes) {
      end.dayOffset = 1;
      end.normalizedMinutes += 1440;
      end.confidence = TIME_CONFIDENCE.INFERRED_ROLLOVER;
    }
    return {
      ...createCirculation({
        code: header.code,
        mode: modeFor(header.vehicleType),
        sequence: index + 1,
        begin: { time: begin, location: header.start },
        end: { time: end, location: header.endPoint },
        depot: { start: header.start, end: header.endPoint },
        vehicle: { type: header.vehicleType, number: null },
        page: { current: header.page, total: header.pageTotal },
        segments: parsedSegments,
        source: { sourceFormat: UMLAUFTAFEL_SOURCE_FORMATS.PDF, page: pages[0] }
      }),
      rawServiceLabels: refs.rawServiceLabels,
      serviceRefs: refs.serviceRefs,
      sourcePages: pages
    };
  });
  const validity = headerValidity(merged[0].header.header);
  const document = createUmlauftafelDocument({
    mode: circulations[0].mode,
    sourceFormat: UMLAUFTAFEL_SOURCE_FORMATS.PDF,
    sourceName,
    validity,
    circulations,
    metadata: { sourcePageCount: layout?.pageCount ?? null }
  });
  const validation = validateUmlauftafelDocument(document);
  const warnings = validation.valid ? [] : validation.errors.map(() => createUmlauftafelWarning({
    code: WARNING_CODES.MISSING_REQUIRED_FIELD,
    severity: WARNING_SEVERITIES.WARNING,
    scope: WARNING_SCOPES.DOCUMENT,
    message: 'Validierungsproblem im erzeugten Umlauftafel-Dokument.'
  }));
  const complete = { ...document, warnings };
  return createParserResult({
    ok: validation.valid,
    document: complete,
    warnings,
    statistics: {
      circulationCount: circulations.length,
      segmentCount: circulations.reduce((sum, circulation) => sum + circulation.segments.length, 0),
      stopEventCount: 0
    }
  });
}
