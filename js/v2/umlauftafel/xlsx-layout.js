/**
 * Pure layout interpretation for JNV Umlauftafel XLSX sheets (Phase 3C.1).
 *
 * Works exclusively on plain string cells (from xlsx-sheet-reader.js). It never
 * touches SheetJS and never accesses files. It extracts the header block(s) and the
 * parallel trip blocks into RAW structured data; the loader turns that into the
 * frozen contract objects and normalizes times. Deterministic, no mutation.
 *
 * A single sheet may STACK several page-blocks of the same circulation (each with its
 * own `Umlauf:`/`Beginn:` header and a `Seite: x/y`). Each page-block is parsed on its
 * own (its column strips are chronological); the blocks are then concatenated
 * (page 1 → page 2 → …) into one circulation so the time sequence stays monotone.
 *
 * Observed layout: header labels on rows 0–2 (Umlauf/Beginn/Ende/Fahrzeugtyp/
 * Startpunkt/Endpunkt/Seite) + Hinweise; trip TIME columns at 4, 12, 20, … (4 + 8*g),
 * with the stop name a few columns left, an ab/an marker between, and a
 * Linie:/Route:/Leerfahrt/Dienst: header left of the stop.
 */

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const HEADER_RE = /^(Linie:|Leerfahrt|Dienst:)/i;
const MARKER_RE = /^(ab|an)$/i;
const TIME_COL_START = 4;
const TIME_COL_STEP = 8;

const cellAt = (rows, r, c) => {
  const row = rows[r];
  return row && row[c] != null ? String(row[c]).trim() : '';
};

function findLabelIn(rows, label, start, end) {
  for (let r = start; r < end; r += 1) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      if (String(row[c]).trim() === label) return { r, c };
    }
  }
  return null;
}

function nonEmptyAfter(row, c) {
  const out = [];
  for (let i = c + 1; i < (row ? row.length : 0); i += 1) {
    const v = String(row[i]).trim();
    if (v) out.push(v);
  }
  return out;
}

const valueAfter = (row, c) => nonEmptyAfter(row, c)[0] ?? null;
const valueAtLabel = (rows, at) => (at ? valueAfter(rows[at.r] || [], at.c) : null);

function scanRight(row, from, to, predicate) {
  for (let c = Math.min(to, (row ? row.length : 0) - 1); c >= from; c -= 1) {
    const v = row && row[c] != null ? String(row[c]).trim() : '';
    if (v && predicate(v)) return { c, v };
  }
  return null;
}

function parseTripHeader(text) {
  const t = text.trim();
  if (/^Leerfahrt/i.test(t)) return { type: 'deadhead' };
  const lr = t.match(/^Linie:\s*(\S+)(?:\s+Route:\s*(\S+))?/i);
  if (lr) return { type: 'service_trip', line: lr[1], route: lr[2] || null };
  if (/^Dienst:/i.test(t)) return { type: 'duty_reference' };
  return null;
}

function maxColumn(rows) {
  let max = 0;
  for (const row of rows) if (row && row.length - 1 > max) max = row.length - 1;
  return max;
}

function parseGroup(rows, startRow, endRow, timeCol) {
  const from = Math.max(0, timeCol - 5);
  const segments = [];
  let current = null;
  let pendingDuty = null;

  for (let r = startRow; r < endRow; r += 1) {
    const row = rows[r] || [];
    const headerHit = scanRight(row, from, timeCol - 1, v => HEADER_RE.test(v));
    if (headerHit) {
      const parsed = parseTripHeader(headerHit.v);
      if (parsed && parsed.type === 'duty_reference') {
        pendingDuty = valueAfter(row, headerHit.c);
      } else if (parsed) {
        current = { type: parsed.type, line: parsed.line || null, route: parsed.route || null, dutyRef: pendingDuty, stops: [] };
        pendingDuty = null;
        segments.push(current);
      }
    }

    const timeCell = cellAt(rows, r, timeCol);
    if (TIME_RE.test(timeCell)) {
      if (!current) {
        current = { type: 'unknown', line: null, route: null, dutyRef: pendingDuty, stops: [] };
        pendingDuty = null;
        segments.push(current);
      }
      const nameHit = scanRight(row, from, timeCol - 1, v => !TIME_RE.test(v) && !MARKER_RE.test(v) && !HEADER_RE.test(v));
      const markerHit = scanRight(row, Math.max(0, timeCol - 3), timeCol - 1, v => MARKER_RE.test(v));
      current.stops.push({ name: nameHit ? nameHit.v : null, marker: markerHit ? markerHit.v.toLowerCase() : null, rawTime: timeCell });
    }
  }
  return segments;
}

function parsePageBlock(rows, start, end, maxCol) {
  const umlaufAt = findLabelIn(rows, 'Umlauf:', start, end);
  const tagAfter = umlaufAt ? nonEmptyAfter(rows[umlaufAt.r] || [], umlaufAt.c) : [];
  const beginAt = findLabelIn(rows, 'Beginn:', start, end);
  const startAt = findLabelIn(rows, 'Startpunkt:', start, end);
  const seiteAt = findLabelIn(rows, 'Seite:', start, end);
  const hinweiseAt = findLabelIn(rows, 'Hinweise:', start, end);
  const headerEndRow = Math.max(umlaufAt ? umlaufAt.r : start, beginAt?.r ?? start, startAt?.r ?? start, seiteAt?.r ?? start, hinweiseAt?.r ?? start);

  const segments = [];
  for (let timeCol = TIME_COL_START; timeCol <= maxCol; timeCol += TIME_COL_STEP) {
    segments.push(...parseGroup(rows, headerEndRow + 1, end, timeCol));
  }

  return {
    datasetTag: tagAfter[1] ?? null,
    begin: valueAtLabel(rows, beginAt),
    end: valueAtLabel(rows, findLabelIn(rows, 'Ende:', start, end)),
    startDepot: valueAtLabel(rows, startAt),
    endDepot: valueAtLabel(rows, findLabelIn(rows, 'Endpunkt:', start, end)),
    vehicleType: valueAtLabel(rows, findLabelIn(rows, 'Fahrzeugtyp:', start, end)),
    segments
  };
}

/**
 * Interprets a single sheet into raw circulation data (one circulation per sheet,
 * with page-blocks concatenated), or null when the sheet is empty or not an Umlauf
 * sheet (no `Umlauf:` header) — such sheets are skipped.
 */
export function interpretUmlaufSheet(name, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const umlaufRows = [];
  for (let r = 0; r < rows.length; r += 1) {
    if ((rows[r] || []).some(c => String(c).trim() === 'Umlauf:')) umlaufRows.push(r);
  }
  if (umlaufRows.length === 0) return null;

  const maxCol = maxColumn(rows);
  const blocks = umlaufRows.map((start, i) => parsePageBlock(rows, start, i + 1 < umlaufRows.length ? umlaufRows[i + 1] : rows.length, maxCol));
  const first = blocks[0];
  const last = blocks[blocks.length - 1];

  return {
    code: String(name),
    datasetTag: first.datasetTag,
    begin: first.begin,
    end: last.end,
    startDepot: first.startDepot,
    endDepot: last.endDepot,
    vehicleType: first.vehicleType,
    pageTotal: blocks.length,
    segments: blocks.flatMap(block => block.segments)
  };
}
