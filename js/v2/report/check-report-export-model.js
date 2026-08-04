/**
 * The export projection of the check report (Phase 3I.36) — A PURE CONSUMER.
 *
 * It turns the EXISTING view model into four flat sheets. It computes no rule value, re-counts
 * nothing, and never mutates the report: every figure it emits is already on screen.
 *
 * FILTER INDEPENDENCE
 * -------------------
 * The export always carries the WHOLE report. A filter is a reading aid on screen; it must never
 * quietly remove a result from an official export.
 *
 * FORMULA INJECTION
 * -----------------
 * A spreadsheet treats a cell starting with `=`, `+`, `-` or `@` as a formula. Every text cell is
 * therefore prefixed with an apostrophe — the content stays readable, the spreadsheet stops
 * executing it. Numbers pass through as numbers.
 *
 * Pure: no I/O, no storage, no network, no DOM. The only clock reading is the date handed in.
 */

const text = (value) => String(value ?? '').trim();
const FORMULA_START = /^[=+\-@]/;

/**
 * Neutralises a cell against spreadsheet formula injection.
 * Numbers and booleans are returned unchanged; text that could be read as a formula is prefixed.
 */
export function neutraliseCell(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const cell = value === null || value === undefined ? '' : String(value);
  return FORMULA_START.test(cell) ? `'${cell}` : cell;
}

const row = (...cells) => cells.map(neutraliseCell);

/** `JNV-Pruefbericht-2026-08-03` — safe characters only, never a path, never the source name. */
function fileNameBaseOf(organization, now) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  const cleaned = text(organization)
    .replace(/[^A-Za-z0-9]+/g, '-')       // everything else becomes a separator
    .replace(/^-+|-+$/g, '');
  return `${cleaned || 'Dienstplan'}-Pruefbericht-${date}`;
}

function summarySheet(model) {
  const { header, summary } = model;
  return {
    name: 'Zusammenfassung',
    rows: [
      row('Angabe', 'Wert'),
      row('Organisation', header.organization ?? 'unbekannt'),
      row('Dokumenttyp', header.documentType ?? 'unbekannt'),
      row('Tagesart', header.dayType ?? 'unbekannt'),
      row('Dienste', header.servicesEvaluated ?? 'unbekannt'),
      row('Regelergebnisse', header.resultCount),
      row('PASS', summary.status.PASS),
      row('FAIL', summary.status.FAIL),
      row('SKIP', summary.status.SKIP),
      row('NOT_APPLICABLE', summary.status.NOT_APPLICABLE),
      row('INFO', summary.severity.INFO),
      row('WARNING', summary.severity.WARNING),
      row('VIOLATION', summary.severity.VIOLATION),
      row('Technische Fehler', summary.runnerErrors)
    ]
  };
}

function resultSheet(model) {
  return {
    name: 'Regelergebnisse',
    rows: [
      row('Reihenfolge', 'Regel-ID', 'Regelname', 'Kategorie', 'Status', 'Severity',
        'Meldung', 'Betroffene Dienste', 'Originalstatus', 'Hinweis'),
      // The report order is the reading order — and the FULL list, whatever the screen shows.
      ...model.results.map((result, index) => row(
        index + 1, result.id, result.name, result.category,
        result.status, result.severity, result.message,
        result.affectedServiceCount, result.originalStatus ?? '', result.notes.join(' ')
      ))
    ]
  };
}

function serviceSheet(model) {
  const rows = [row('Regel-ID', 'Dienstnummer', 'Status', 'Severity', 'Anfangsort', 'Endort',
    'Vorheriger Dienst', 'Nachfolgender Dienst', 'Ablösekette vorhanden', 'Einordnungshinweis')];

  for (const result of model.results) {
    const byNumber = new Map(result.handover.map(entry => [entry.serviceNumber, entry]));
    const numbers = result.affectedServiceNumbers.length
      ? result.affectedServiceNumbers
      : result.handover.map(entry => entry.serviceNumber);

    for (const number of numbers) {
      const entry = byNumber.get(number) ?? null;
      rows.push(row(
        result.id, number, result.status, result.severity,
        entry?.startLocation ?? '', entry?.endLocation ?? '',
        entry?.previousServiceNumber ?? '', entry?.nextServiceNumber ?? '',
        entry?.chain ? 'ja' : 'nein',
        entry?.note ?? ''
      ));
    }
  }
  if (rows.length === 1) rows.push(row('Keine betroffenen Dienste', '', '', '', '', '', '', '', '', ''));
  return { name: 'Betroffene Dienste', rows };
}

/** Technical errors, reduced to what a reader may see: module, code, short message. */
function errorSheet(model) {
  const rows = [row('Modul', 'Fehlercode', 'Meldung')];
  for (const error of model.runnerErrorDetails) {
    rows.push(row(error.module, error.code, error.message));
  }
  if (rows.length === 1) rows.push(row('Keine technischen Fehler', '', ''));
  return { name: 'Technische Fehler', rows };
}

/**
 * @param {object} viewModel from `buildCheckReportViewModel`
 * @param {{now?: Date}} [options] the local date for the file name — read, never stored
 * @returns {{exportable: boolean, reason: string|null, fileNameBase: string, sheets: Array}}
 */
export function buildCheckReportExportModel(viewModel, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const model = (viewModel && Array.isArray(viewModel.results) && viewModel.header && viewModel.summary)
    ? viewModel
    : null;

  if (!model || !model.available) {
    return { exportable: false, reason: 'NO_REPORT', fileNameBase: fileNameBaseOf('', now), sheets: [] };
  }
  if (model.results.length === 0) {
    return { exportable: false, reason: 'NO_RESULTS', fileNameBase: fileNameBaseOf(model.header.organization, now), sheets: [] };
  }

  return {
    exportable: true,
    reason: null,
    fileNameBase: fileNameBaseOf(model.header.organization, now),
    sheets: [summarySheet(model), resultSheet(model), serviceSheet(model), errorSheet(model)]
  };
}
