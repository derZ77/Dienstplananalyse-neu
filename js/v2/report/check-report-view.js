/**
 * The rendered check report (Phase 3I.34) — GENERIC, one shape for every rule.
 *
 * Renders the view model to an HTML string and hands it to a root element. There is no renderer
 * per rule: BV001 and BV015_BV018 go through exactly the same code path, and a rule the system
 * gains tomorrow renders without a line of change here.
 *
 * Accessibility: status travels as TEXT, never as colour alone; the symbol beside it is marked
 * decorative. Detail areas are native `<details>/<summary>`, so they are keyboard-operable without
 * a single line of script. No external UI dependency.
 *
 * Print preparation: a clear header, a summary block and one block per result, no wide table.
 * The print step itself belongs to a later phase.
 *
 * No storage, no network, no current time, no random.
 */

import { buildCheckReportViewModel } from './check-report-view-model.js';
import { buildCheckReportExportModel } from './check-report-export-model.js';
import { createReportExportFile, downloadReportExport } from './check-report-export.js';

const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

/** Everything that reaches the markup goes through here — a report can never inject markup. */
function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ESCAPES[character]);
}

const EMPTY_MESSAGES = Object.freeze({
  NO_REPORT: 'Es wurde noch kein Dokument ausgewertet. Importieren Sie einen Dienstplan, um den Prüfbericht zu sehen.',
  NO_RESULTS: 'Der Prüflauf hat keine Regelergebnisse geliefert.',
  NOTHING_ASSESSED: 'Keine Regel wurde auf diesen Daten abschließend bewertet — alle Prüfungen wurden übersprungen oder waren nicht anwendbar.'
});

function renderFigure(label, value) {
  return `<div class="report-figure"><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
}

function renderHeader(header) {
  const figures = [
    ['Dokumentart', header.documentType ?? 'unbekannt'],
    ['Organisation', header.organization ?? 'unbekannt'],
    ['Tagesart', header.dayType ?? 'unbekannt'],
    ['Ausgewertete Dienste', header.servicesEvaluated ?? 'unbekannt'],
    ['Regelergebnisse', header.resultCount],
    ['Prüfauffälligkeiten', header.findingCount],
    ['Warnungen', header.warningCount],
    ['Übersprungen', header.skippedCount],
    ['Nicht anwendbar', header.notApplicableCount],
    ['Technische Fehler', header.errorCount]
  ];
  return `<header class="report-header">
      <h2 id="pruefbericht-title">${escape(header.documentTitle)}</h2>
      <dl class="report-summary">${figures.map(([label, value]) => renderFigure(label, value)).join('')}</dl>
    </header>`;
}

/** Technical runner errors are material, but must not interrupt the normal rule-reading flow. */
function renderTechnicalErrors(entries) {
  if (!entries.length) return '';
  const items = entries.map(entry => `<li><strong>${escape(entry.module)}</strong> (${escape(entry.code)}): ${escape(entry.message || 'Keine weitere Beschreibung.')}</li>`).join('');
  return `<details class="report-technical"><summary>Technische Details (${entries.length})</summary><ul>${items}</ul></details>`;
}

function renderHandover(entries) {
  if (!entries.length) return '';
  const items = entries.map(entry => `<li class="report-handover-entry">
        <p class="report-handover-line"><strong>Dienst ${escape(entry.serviceNumber)}</strong>
          — Anfang: ${escape(entry.startLocation ?? 'unbekannt')},
          Ende: ${escape(entry.endLocation ?? 'unbekannt')}</p>
        <p class="report-handover-chain">${entry.chain
    ? `Dokumentierte Ablösekette: ${escape(entry.chain)}`
    : 'Keine Ablösekette im Dienstplan dokumentiert.'}</p>
        <p class="report-handover-note">${escape(entry.note)}</p>
      </li>`).join('');
  return `<section class="report-handover" aria-label="Hinweise zur Einordnung">
      <h4>Zusatzinformation: Ablösung</h4>
      <ul>${items}</ul>
    </section>`;
}

/**
 * The affected duties as a usable list, not as a bare number. A long list is collapsed into its own
 * `<details>` — everything stays in the document and nothing is truncated.
 */
function renderAffected(row) {
  if (!row.affectedServiceNumbers.length) {
    return row.affectedServiceCount
      ? `<p class="report-detail-line"><strong>Betroffene Dienste:</strong> ${escape(row.affectedServiceCount)} (Dienstnummern nicht verfügbar)</p>`
      : '';
  }
  const numbers = row.affectedServiceNumbers
    .map(number => `<li class="report-affected-service">${escape(number)}</li>`).join('');
  const caption = `Betroffene Dienste (${row.affectedServiceCount})`;
  return row.affectedServiceNumbers.length > 12
    ? `<details class="report-affected"><summary>${escape(caption)}</summary><ul class="report-affected-list">${numbers}</ul></details>`
    : `<div class="report-affected"><p class="report-detail-line"><strong>${escape(caption)}</strong></p><ul class="report-affected-list">${numbers}</ul></div>`;
}

function renderList(title, values) {
  if (!values.length) return '';
  return `<p class="report-detail-line"><strong>${escape(title)}:</strong> ${values.map(escape).join(', ')}</p>`;
}

function renderDetails(row) {
  const parts = [];
  parts.push(renderAffected(row));
  if (row.affectedActivityCount) parts.push(`<p class="report-detail-line"><strong>Betroffene Tätigkeiten:</strong> ${row.affectedActivityCount}</p>`);
  if (row.notes.length) parts.push(`<ul class="report-notes">${row.notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul>`);

  const detailEntries = Object.entries(row.details);
  if (detailEntries.length) {
    parts.push(`<dl class="report-detail-values">${detailEntries
      .map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(Array.isArray(value) ? value.join(', ') : value)}</dd></div>`)
      .join('')}</dl>`);
  }
  if (row.sourceReferences.length) {
    parts.push(renderList('Fundstellen', row.sourceReferences
      .map(reference => [reference.sheetName, reference.rowNumber && `Zeile ${reference.rowNumber}`].filter(Boolean).join(' '))));
  }
  parts.push(renderHandover(row.handover));
  if (!parts.join('').trim()) parts.push('<p class="report-detail-line">Keine weiteren Angaben.</p>');
  return parts.join('');
}

function renderResult(row) {
  return `<article class="report-result ${statusClass(row.status)}" data-result-id="${escape(row.id)}" data-status="${escape(row.status)}">
      <details>
        <summary>
          <span class="report-status ${statusClass(row.status)}" data-status="${escape(row.status)}">
            <span class="report-status-symbol" aria-hidden="true">${escape(row.statusSymbol)}</span>
            <span class="report-status-label">${escape(row.statusLabel)}</span>
          </span>
          <span class="report-result-id">${escape(row.id)}</span>
          <span class="report-result-name">${escape(row.name)}</span>
          <span class="report-result-severity">${escape(row.severityLabel)}</span>
        </summary>
        <div class="report-result-body">
          <h3 class="report-result-heading">${escape(row.id)} — ${escape(row.name)}</h3>
          <p class="report-result-message">${escape(row.message)}</p>
          ${renderDetails(row)}
        </div>
      </details>
    </article>`;
}

function statusClass(status) {
  if (status === 'FAIL') return 'status-fail';
  if (status === 'PASS') return 'status-pass';
  if (status === 'SKIP' || status === 'NOT_APPLICABLE') return 'status-neutral';
  return 'status-info';
}

/**
 * @param {object} viewModel from `buildCheckReportViewModel`
 * @returns {string} the report as markup — never throws, whatever it is handed
 */
export function renderCheckReportHtml(viewModel) {
  const model = (viewModel && Array.isArray(viewModel.results) && viewModel.header)
    ? viewModel
    : buildCheckReportViewModel(null);

  const body = model.results.length === 0
    ? `<p class="report-empty">${escape(EMPTY_MESSAGES[model.emptyReason] ?? EMPTY_MESSAGES.NO_REPORT)}</p>`
    : [
      model.emptyReason === 'NOTHING_ASSESSED'
        ? `<p class="report-empty">${escape(EMPTY_MESSAGES.NOTHING_ASSESSED)}</p>` : '',
      model.filteredEmpty
        ? '<p class="report-empty">Kein Ergebnis entspricht der aktuellen Auswahl.</p>'
        : `<div class="report-results">${model.visibleResults.map(renderResult).join('')}</div>`
    ].join('');

  // The print projection carries the COMPLETE report. A screen filter is a reading aid; it must
  // never quietly remove a result from an official printout. Hidden on screen, shown on paper.
  const printAll = model.results.length
    ? `<div class="report-print-all">${model.results.map(renderResult).join('')}</div>`
    : '';

  return `<section class="report" role="region" aria-labelledby="pruefbericht-title">
      ${renderHeader(model.header)}
      ${renderTechnicalErrors(model.runnerErrorDetails || [])}
      ${renderActions(model)}
      ${renderFilters(model)}
      ${body}
      ${printAll}
    </section>`;
}

/**
 * Print and export. Both are plain buttons: no inline handler, disabled while there is nothing to
 * act on, excluded from the printout, and answered in a polite live region.
 */
function renderActions(model) {
  const printDisabled = model.available ? '' : ' disabled';
  const exportDisabled = model.results.length === 0 ? ' disabled' : '';
  return `<div class="report-actions no-print">
      <button id="report-print" type="button"${printDisabled}>Prüfbericht drucken</button>
      <button id="report-export" type="button"${exportDisabled}>Ergebnisse exportieren</button>
      <p id="report-action-status" class="report-action-status" aria-live="polite">${escape(model.actionMessage ?? '')}</p>
    </div>`;
}

const STATUS_OPTIONS = Object.freeze([['', 'Alle'], ['PASS', 'Bestanden'], ['FAIL', 'Prüfauffälligkeit'], ['SKIP', 'Übersprungen'], ['NOT_APPLICABLE', 'Nicht anwendbar']]);
const SEVERITY_OPTIONS = Object.freeze([['', 'Alle'], ['INFO', 'Hinweis'], ['WARNING', 'Warnung'], ['VIOLATION', 'Regel nicht erfüllt'], ['ERROR', 'Technischer Fehler']]);

function renderOptions(options, selected) {
  return options.map(([value, label]) =>
    `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('');
}

/**
 * The controls for the filter model. They are native elements with visible labels; the wiring lives
 * in the controller, so there is no inline handler and no external dependency. The whole block is
 * marked `no-print` — a filter is a reading aid, not part of the report.
 */
function renderFilters(model) {
  const state = model.state;
  return `<form class="report-filters no-print" onsubmit="return false">
      <fieldset>
        <legend>Filter</legend>
        <div class="report-filter-row">
          <label for="report-filter-search">Suche (Regel, Name oder Dienstnummer)</label>
          <input id="report-filter-search" type="search" value="${escape(state.search)}" />
        </div>
        <div class="report-filter-row">
          <label for="report-filter-status">Status</label>
          <select id="report-filter-status">${renderOptions(STATUS_OPTIONS, state.status)}</select>
        </div>
        <div class="report-filter-row">
          <label for="report-filter-severity">Schwere</label>
          <select id="report-filter-severity">${renderOptions(SEVERITY_OPTIONS, state.severity)}</select>
        </div>
        <div class="report-filter-row report-filter-check">
          <input id="report-filter-findings" type="checkbox"${state.findingsOnly ? ' checked' : ''} />
          <label for="report-filter-findings">Nur Auffälligkeiten</label>
        </div>
        <div class="report-filter-row report-filter-check">
          <input id="report-filter-handover" type="checkbox"${state.handoverOnly ? ' checked' : ''} />
          <label for="report-filter-handover">Nur mit Ablösehinweis</label>
        </div>
        <div class="report-filter-row">
          <button id="report-filter-reset" type="button">Filter zurücksetzen</button>
        </div>
      </fieldset>
      <p class="report-filter-count" aria-live="polite">${escape(model.visibleResults.length)} von ${escape(model.results.length)} Regelergebnissen angezeigt</p>
    </form>`;
}

const outcome = (applied, reason = null) => ({ applied, reason });

/**
 * Mounts the report into a root element. It holds the SAME report object it was handed — no copy,
 * no second store, no recomputation.
 *
 * @param {{innerHTML: string}} root
 */
export function createCheckReportController(root, options = {}) {
  if (!root) throw new TypeError('Der Prüfbericht benötigt ein Wurzelelement.');
  const printer = options.printer
    ?? (() => { if (typeof globalThis !== 'undefined' && typeof globalThis.print === 'function') globalThis.print(); });
  const exporter = options.exporter
    ?? (exportModel => downloadReportExport(createReportExportFile(exportModel), {}));
  let actionMessage = '';
  let report = null;
  let canonicalSchedule = options.canonicalSchedule ?? null;
  let metadata = options.document ?? null;
  let serviceCount = options.servicesEvaluated ?? null;
  let state = {};

  /** Re-attaches the control listeners after each render; without a DOM this is simply skipped. */
  const bindControls = () => {
    if (typeof root.querySelector !== 'function') return;
    const on = (id, event, handler) => root.querySelector(`#${id}`)?.addEventListener(event, handler);
    const read = () => {
      const value = (id) => root.querySelector(`#${id}`)?.value ?? '';
      const checked = (id) => root.querySelector(`#${id}`)?.checked === true;
      state = {
        search: value('report-filter-search'),
        status: value('report-filter-status'),
        severity: value('report-filter-severity'),
        findingsOnly: checked('report-filter-findings'),
        handoverOnly: checked('report-filter-handover')
      };
      render();
    };
    on('report-filter-search', 'input', read);
    on('report-filter-status', 'change', read);
    on('report-filter-severity', 'change', read);
    on('report-filter-findings', 'change', read);
    on('report-filter-handover', 'change', read);
    on('report-filter-reset', 'click', () => { state = {}; actionMessage = ''; render(); });
    on('report-print', 'click', () => {
      // Only from this explicit user action, and never on import. Nothing is recalculated, the
      // screen and the filter stay exactly as they are — the print stylesheet does the rest.
      if (!report) { actionMessage = 'Kein Prüfbericht zum Drucken vorhanden.'; render(); return; }
      printer();
    });
    on('report-export', 'click', () => {
      if (!report) { actionMessage = 'Kein Prüfbericht zum Export vorhanden.'; render(); return; }
      try {
        // The export always covers the WHOLE report — the screen filter is deliberately ignored.
        const outcome = exporter(buildCheckReportExportModel(buildCheckReportViewModel(report, {
          canonicalSchedule, document: metadata,
          servicesEvaluated: Number.isInteger(serviceCount) ? serviceCount : undefined
        })));
        actionMessage = outcome && outcome.applied === false
          ? 'Export konnte nicht erstellt werden.'
          : 'Export wurde erstellt.';
      } catch (error) {
        actionMessage = 'Export konnte nicht erstellt werden.';   // no internal message reaches the user
      }
      render();
    });
  };

  const render = () => {
    const model = buildCheckReportViewModel(report, {
      canonicalSchedule,
      document: metadata,
      servicesEvaluated: Number.isInteger(serviceCount) ? serviceCount : undefined,
      state
    });
    root.innerHTML = renderCheckReportHtml({ ...model, actionMessage });
    bindControls();
  };
  render();

  return {
    setCheckReport(nextReport) {
      if (nextReport == null) return this.clear();
      // A broken update must not destroy a valid view: the previous report stays on screen.
      if (nextReport.type !== 'CheckReport') return outcome(false, 'INVALID_CHECK_REPORT');
      report = nextReport;
      render();
      return outcome(true);
    },
    setCanonicalSchedule(nextSchedule) {
      canonicalSchedule = nextSchedule ?? null;
      render();
      return outcome(true);
    },
    /**
     * The live context from the existing session: the schedule (same reference, read-only) and the
     * small header metadata. Anything unusable simply clears that part — never a throw.
     */
    setReportContext(context) {
      const schedule = context?.canonicalSchedule;
      canonicalSchedule = schedule?.type === 'CanonicalSchedule' ? schedule : null;
      metadata = context?.metadata && typeof context.metadata === 'object' ? context.metadata : null;
      const count = context?.metadata?.serviceCount;
      serviceCount = Number.isInteger(count) ? count : null;
      render();
      return outcome(true);
    },
    setState(nextState) {
      state = nextState ?? {};
      render();
      return outcome(true);
    },
    getCheckReport() {
      return report;
    },
    clear() {
      report = null;
      render();
      return outcome(true);
    }
  };
}
