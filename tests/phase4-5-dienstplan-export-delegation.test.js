/**
 * Phase 4.5 (6–9) — the click delegates, exactly once, to the Phase 4.4 exporter.
 *
 * The view builds no workbook, no CSV, no blob and no object URL. It calls the existing
 * `downloadDienstplanExport` and turns its documented result into a neutral status line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createDienstplanExportController, EXPORT_UI_REASONS
} from '../js/v2/export/dienstplan-export-ui.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const time = (value) => ({ raw: value ?? '', value: value ?? null,
  minutesSinceStartOfDay: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });
const duration = (value) => ({ raw: value ?? '', value: value ?? null,
  minutes: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });
let counter = 0;
const service = (serviceNumber) => {
  const id = `service:1:${serviceNumber}`;
  return {
    id, serviceNumber, begin: time('05:00'), end: time('12:00'), paidTime: duration('07:00'),
    activities: [{
      id: `activity:${id}:${counter++}`, serviceId: id, serviceNumber: '', circuitNumber: '',
      rawActivity: 'Dienst', departureTime: time('05:00'), arrivalTime: time('06:00'),
      departureLocation: ' Bth. Burgau', arrivalLocation: ' Teichgraben',
      originalText: 'ROH', boundingBox: {}, routeIdentity: null, serviceIdentity: null,
      source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 3, boundingBox: {}, originalText: 'ROH' }
    }],
    interruptions: [], originalText: 'ROH', boundingBox: {},
    source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineRange: { start: 1, end: 2 }, boundingBox: {}, originalText: 'ROH' }
  };
};
const pdfImport = (profileId, services = [service('2101')]) => ({
  detection: { status: 'supported', profile: { id: profileId }, title: '', pageCount: 1, signals: {} },
  canonicalSchedule: {
    type: 'CanonicalSchedule',
    document: { sourceType: 'pdf', pageCount: 1, source: { byteLength: 0, documentModelType: 'PdfDocumentModel' } },
    services, activities: services.flatMap(s => s.activities), interruptions: [], warnings: [],
    metadata: { schemaVersion: '1.0', serviceCount: services.length, activityCount: 1, interruptionCount: 0 }
  }
});
const session = (primaryImport) => ({ primaryImport, companionImport: null, primaryFileName: null });
const jnv = () => session(pdfImport('beu-stadtbus-v1'));

const makeElement = (tag) => ({
  tagName: tag.toUpperCase(), children: [], listeners: {},
  textContent: '', hidden: false, disabled: false, id: '', className: '', type: '', attributes: {},
  setAttribute(name, value) { this.attributes[name] = String(value); },
  getAttribute(name) { return this.attributes[name] ?? null; },
  appendChild(node) { this.children.push(node); return node; },
  addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); },
  click() { for (const handler of this.listeners.click ?? []) handler(); }
});
const makeDocument = () => ({ createElement: (tag) => makeElement(tag) });
const nodes = (root) => root.children.flatMap(node => [node, ...node.children]);
const buttonOf = (root) => nodes(root).find(node => node.tagName === 'BUTTON');
const statusOf = (root) => nodes(root).find(node => node.tagName === 'P');

/** A double for the Phase 4.4 exporter. It records what it was handed. */
const exporterDouble = (result) => {
  const calls = [];
  return {
    calls,
    download: (model, options) => { calls.push({ model, options }); return result; }
  };
};
const okResult = (extra = {}) => ({
  status: 'ready', format: 'xlsx', fileName: 'JNV-Dienstplan-Export-2026-08-04.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bytes: new Uint8Array([1, 2, 3]), warnings: [], downloaded: true, ...extra
});

const mount = (exporter, options = {}) => {
  const root = makeElement('div');
  const controller = createDienstplanExportController(root, {
    document: makeDocument(), download: exporter.download, ...options
  });
  return { root, controller };
};

// =====================================================================================
// 6 — exactly one delegation, and the view builds nothing itself
// =====================================================================================
test('6: an enabled click delegates once to the existing exporter', () => {
  const exporter = exporterDouble(okResult());
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();

  assert.equal(exporter.calls.length, 1, 'exactly one call');
  assert.equal(exporter.calls[0].model.status, 'ready', 'the Phase 4.3 model is handed over');
  assert.deepEqual(exporter.calls[0].model.sheets.map(s => s.name),
    ['Dienstplan', 'Dienste', 'Importhinweise']);
});

test('6: a disabled action does not delegate at all', () => {
  const exporter = exporterDouble(okResult());
  const { root, controller } = mount(exporter);
  controller.update(session(pdfImport('beu-stadtbus-v1', [])));   // inconclusive
  buttonOf(root).click();
  controller.update(session(null));                               // nothing imported
  buttonOf(root).click();
  assert.deepEqual(exporter.calls, [], 'no click reaches the exporter');
});

test('6: the view contains no spreadsheet, blob, object URL or download code of its own', () => {
  const adapter = src('../js/v2/export/dienstplan-export-ui.js');
  assert.doesNotMatch(adapter, /\bXLSX\.|book_new|aoa_to_sheet|SheetJS/, 'no workbook is built here');
  assert.doesNotMatch(adapter, /new Blob|createObjectURL|revokeObjectURL|\.download\s*=/, 'no blob, no URL');
  assert.doesNotMatch(adapter, /csvCell|;"|BOM|TextEncoder/, 'no CSV writer');
  assert.doesNotMatch(adapter, /extractPdfLayoutDocument|analyzePdfImport|getDocument\(/, 'no re-parsing');
  assert.match(adapter, /downloadDienstplanExport/, 'the existing exporter is what is called');
});

test('6: the export is a user action — nothing runs on update', () => {
  const exporter = exporterDouble(okResult());
  const { controller } = mount(exporter);
  controller.update(jnv());
  controller.update(jnv());
  assert.deepEqual(exporter.calls, [], 'rendering never downloads');
});

test('6: no bytes, blob or workbook are kept in the UI state', () => {
  const exporter = exporterDouble(okResult());
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();
  const state = controller.getState();
  assert.equal(state.bytes, undefined);
  assert.equal(state.blob, undefined);
  assert.equal(state.workbook, undefined);
  assert.ok(!JSON.stringify(Object.keys(state)).includes('byte'));
});

// =====================================================================================
// 7 — a CSV fallback is a result, not a failure
// =====================================================================================
test('7: a controlled CSV result is reported neutrally, not as an error', () => {
  const exporter = exporterDouble(okResult({
    format: 'csv', fileName: 'JNV-Dienstplan-Export-2026-08-04.csv', mimeType: 'text/csv;charset=utf-8',
    warnings: [{ code: 'XLSX_RUNTIME_UNAVAILABLE', message: 'Die Tabellenbibliothek ist nicht verfügbar. Es wurde eine CSV-Datei erzeugt.' }]
  }));
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();

  const status = statusOf(root).textContent;
  assert.ok(status.length > 0);
  assert.doesNotMatch(status, /Fehler|fehlgeschlagen|konnte nicht/i, 'a fallback is not a failure');
  assert.ok(status.includes('CSV'), 'but the user learns which format arrived');
  assert.equal(controller.getState().lastResult.format, 'csv');
});

test('7: the exporter is never asked for a format — the UI invents no CSV path', () => {
  const exporter = exporterDouble(okResult());
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();
  assert.equal(exporter.calls[0].options?.format, undefined, 'XLSX stays the regular target');
});

// =====================================================================================
// 8 — no double trigger
// =====================================================================================
test('8: a re-entrant click during a running export is ignored', () => {
  let controller;
  let root;
  const calls = [];
  const download = (model, options) => {
    calls.push({ model, options });
    buttonOf(root).click();          // the user clicks again while this one is still running
    controller.triggerExport();      // …and something else triggers it too
    return okResult();
  };
  root = makeElement('div');
  controller = createDienstplanExportController(root, { document: makeDocument(), download });
  controller.update(jnv());
  buttonOf(root).click();

  assert.equal(calls.length, 1, 'the guard holds — exactly one export');
});

test('8: the button is usable again after a finished export', () => {
  const exporter = exporterDouble(okResult());
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();
  assert.equal(buttonOf(root).disabled, false, 'and enabled again afterwards');
  buttonOf(root).click();
  assert.equal(exporter.calls.length, 2, 'a second, separate click works');
});

test('8: the state is consistent again after a thrown exporter', () => {
  const { root, controller } = mount({ download: () => { throw new Error('at /Users/x/a.js:1:1'); } });
  controller.update(jnv());
  assert.doesNotThrow(() => buttonOf(root).click());
  assert.equal(controller.getState().busy, false, 'the guard is released');
  assert.equal(buttonOf(root).disabled, false, 'and the button works again');
  assert.equal(statusOf(root).textContent, 'Es konnte keine Datei erzeugt werden.',
    'the user is told, neutrally — and the thrown message never surfaces');
  assert.ok(!statusOf(root).textContent.includes('/Users/'));
});

// =====================================================================================
// 9 — neutral messages, no raw data
// =====================================================================================
test('9: a successful export names the format, never the path or the blob', () => {
  const exporter = exporterDouble(okResult());
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();
  const status = statusOf(root).textContent;
  assert.ok(!status.includes('/Users/'));
  assert.ok(!status.includes('blob:'));
  assert.ok(!status.includes('.pdf'));
});

test('9: an exporter warning is shown as its own neutral sentence', () => {
  const exporter = exporterDouble(okResult({
    warnings: [{ code: 'XLSX_WRITE_FAILED', message: 'Die Excel-Datei konnte nicht geschrieben werden. Es wurde eine CSV-Datei erzeugt.' }],
    format: 'csv', fileName: 'JNV-Dienstplan-Export-2026-08-04.csv'
  }));
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();
  assert.match(statusOf(root).textContent, /CSV-Datei erzeugt/, 'the exporter message is passed through');
});

test('9: nothing raw ever reaches the status line', () => {
  const exporter = exporterDouble({
    status: 'error', format: null, fileName: null, mimeType: null, bytes: null, downloaded: false,
    warnings: [{ code: 'MODELL_UNGUELTIG', message: 'Die Daten haben nicht die erwartete Form. Es wurde keine Datei erzeugt.' }]
  });
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();
  const status = statusOf(root).textContent;
  for (const forbidden of ['/Users/', 'blob:', 'Uint8Array', '{', '[object', 'at Object', '.js:']) {
    assert.ok(!status.includes(forbidden), forbidden);
  }
});

test('9: a controlled not_applicable is no technical error', () => {
  const exporter = exporterDouble({
    status: 'not_applicable', format: null, fileName: null, mimeType: null, bytes: null,
    downloaded: false, warnings: [{ code: 'MODELL_NICHT_EXPORTIERBAR', message: 'Für dieses Dokument kann keine Excel-Datei erzeugt werden.' }]
  });
  const { root, controller } = mount(exporter);
  controller.update(jnv());
  buttonOf(root).click();
  assert.equal(controller.getState().busy, false);
  assert.ok(statusOf(root).textContent.length > 0);
  assert.equal(controller.getState().lastResult.status, 'not_applicable');
});

test('9: the adapter never logs and never claims a check result', () => {
  const adapter = src('../js/v2/export/dienstplan-export-ui.js');
  assert.doesNotMatch(adapter, /console\.|alert\(|debugger/, 'no console, no alert');
  assert.doesNotMatch(adapter, /geprüft|bestanden|Verstoß|PASS|FAIL/, 'no check claim in the UI text');
  assert.doesNotMatch(adapter, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(adapter, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\//);
  assert.equal(EXPORT_UI_REASONS.READY, 'ready');
});
