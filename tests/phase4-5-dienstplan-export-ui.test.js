/**
 * Phase 4.5 (2–5, 10) — the visibility and enablement matrix.
 *
 * Two decisions, deliberately separate and separately testable:
 *   VISIBLE  the profile holds `xlsxExport` AND the current import is a successful JNV/JES
 *            Dienstplan context.
 *   ENABLED  additionally the Phase 4.3 model says `status === 'ready'`.
 *
 * A single positive signal is never enough. A file extension, a file name or the mere existence of
 * an import grants nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDienstplanExportState, createDienstplanExportController, EXPORT_UI_REASONS, EXPORT_BUTTON_LABEL
} from '../js/v2/export/dienstplan-export-ui.js';

// ---------------------------------------------------------------------------------------
// fixtures — a real Phase 4.3-shaped analysis result
// ---------------------------------------------------------------------------------------
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
const schedule = (services) => ({
  type: 'CanonicalSchedule',
  document: { sourceType: 'pdf', pageCount: 1, source: { byteLength: 0, documentModelType: 'PdfDocumentModel' } },
  services, activities: services.flatMap(entry => entry.activities), interruptions: [], warnings: [],
  metadata: { schemaVersion: '1.0', serviceCount: services.length, activityCount: 1, interruptionCount: 0 }
});

/** A PDF import result, exactly as `analyzePdfImport` returns it. */
const pdfImport = (profileId, services = [service('2101')]) => ({
  detection: { status: 'supported', profile: { id: profileId }, title: '', pageCount: 1, signals: {} },
  canonicalSchedule: schedule(services)
});
/** An Excel import result, exactly as `analyzeExcelImport` returns it. */
const excelImport = (type) => ({
  classification: { type, subtype: null, mode: null, confidence: 'exact', signals: [], conflicts: [], candidates: [] },
  document: null, result: null, importResult: { documentType: type, ok: true, data: {}, warnings: [] }, warnings: []
});

const session = (primaryImport) => ({ primaryImport, companionImport: null, primaryFileName: null });
const jnv = () => session(pdfImport('beu-stadtbus-v1'));
const jes = () => session(pdfImport('jes-regionalbus-v1'));

// A tiny observable DOM. Only what the adapter is allowed to touch exists here.
const makeElement = (tag) => ({
  tagName: tag.toUpperCase(), children: [], listeners: {},
  textContent: '', hidden: false, disabled: false, id: '', className: '', type: '',
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = String(value); },
  getAttribute(name) { return this.attributes[name] ?? null; },
  appendChild(node) { this.children.push(node); return node; },
  addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); },
  click() { for (const handler of this.listeners.click ?? []) handler(); }
});
const makeDocument = () => ({ createElement: (tag) => makeElement(tag) });
const mount = (options = {}) => {
  const root = makeElement('div');
  const controller = createDienstplanExportController(root, { document: makeDocument(), ...options });
  return { root, controller };
};
const buttonOf = (root) => root.children.flatMap(node => [node, ...node.children])
  .find(node => node.tagName === 'BUTTON');
const statusOf = (root) => root.children.flatMap(node => [node, ...node.children])
  .find(node => node.tagName === 'P');

// =====================================================================================
// 2 — the happy path
// =====================================================================================
test('2: an exportable JNV import is visible and enabled', () => {
  const state = resolveDienstplanExportState(jnv());
  assert.equal(state.visible, true);
  assert.equal(state.enabled, true);
  assert.equal(state.documentType, 'jnv_schedule_pdf');
  assert.equal(state.organization, 'JNV');
  assert.equal(state.reason, EXPORT_UI_REASONS.READY);
});

test('2: an exportable JES import is visible and enabled', () => {
  const state = resolveDienstplanExportState(jes());
  assert.equal(state.visible, true);
  assert.equal(state.enabled, true);
  assert.equal(state.documentType, 'jes_schedule_pdf');
  assert.equal(state.organization, 'JES');
});

test('2: the rendered action carries the agreed label and is a real button', () => {
  const { root, controller } = mount();
  controller.update(jnv());
  const button = buttonOf(root);
  assert.equal(button.textContent, EXPORT_BUTTON_LABEL);
  assert.equal(EXPORT_BUTTON_LABEL, 'Dienstplan als Excel exportieren');
  assert.equal(button.type, 'button', 'never a submit');
  assert.equal(button.disabled, false);
});

// =====================================================================================
// 3 — no import, running, failed, unusable
// =====================================================================================
test('3: without any import there is nothing to see and nothing to click', () => {
  for (const sessionState of [null, undefined, {}, session(null), session(undefined)]) {
    const state = resolveDienstplanExportState(sessionState);
    assert.equal(state.visible, false, JSON.stringify(sessionState));
    assert.equal(state.enabled, false);
    assert.equal(state.reason, EXPORT_UI_REASONS.KEIN_IMPORT);
  }
});

test('3: a failed or unsupported PDF import stays invisible', () => {
  for (const primary of [
    { detection: { status: 'unsupported' }, canonicalSchedule: null },
    { detection: { status: 'supported', profile: null }, canonicalSchedule: null },
    { detection: { status: 'supported', profile: { id: 'unbekannt-v9' } }, canonicalSchedule: null }
  ]) {
    const state = resolveDienstplanExportState(session(primary));
    assert.equal(state.visible, false, JSON.stringify(primary.detection));
    assert.equal(state.enabled, false);
  }
});

test('3: a supported profile WITHOUT a usable schedule is visible but not enabled', () => {
  // The document type is right and the profile may export — but there is nothing to write.
  const state = resolveDienstplanExportState(session({
    detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } }, canonicalSchedule: null
  }));
  assert.equal(state.visible, true, 'the user learns that this document COULD be exported');
  assert.equal(state.enabled, false, 'but not from this import');
  assert.equal(state.reason, EXPORT_UI_REASONS.NICHT_EXPORTIERBAR);
});

test('3: an empty schedule yields inconclusive and stays disabled', () => {
  const state = resolveDienstplanExportState(session(pdfImport('beu-stadtbus-v1', [])));
  assert.equal(state.modelStatus, 'inconclusive');
  assert.equal(state.visible, true);
  assert.equal(state.enabled, false);
});

test('3: a broken schedule never throws and never enables', () => {
  for (const canonicalSchedule of [{}, { type: 'Anderes' }, { type: 'CanonicalSchedule', services: 'nope' }, 42]) {
    let state;
    assert.doesNotThrow(() => {
      state = resolveDienstplanExportState(session({
        detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } }, canonicalSchedule
      }));
    });
    assert.equal(state.enabled, false, JSON.stringify(canonicalSchedule));
  }
});

// =====================================================================================
// 4 — every other document type
// =====================================================================================
test('4: Legacy-Excel, Umlauftafel and Wagenkarte get no Dienstplan export action', () => {
  for (const type of ['legacy_excel_schedule', 'umlaufkarte', 'wagenkarte', 'unknown']) {
    const state = resolveDienstplanExportState(session(excelImport(type)));
    assert.equal(state.visible, false, type);
    assert.equal(state.enabled, false, type);
    assert.equal(state.reason, EXPORT_UI_REASONS.KEIN_DIENSTPLAN_PDF, type);
  }
});

test('4: an Excel import is recognised as such and never mistaken for a PDF', () => {
  const state = resolveDienstplanExportState(session(excelImport('legacy_excel_schedule')));
  assert.equal(state.documentType, null, 'no document type is claimed for a non-PDF import');
  assert.equal(state.organization, null);
  assert.equal(state.model, null, 'and no projection model is built at all');
});

test('4: nothing is decided from a file name or an extension', () => {
  const withName = { ...session(excelImport('legacy_excel_schedule')), primaryFileName: 'JNV-Dienstplan.pdf' };
  assert.equal(resolveDienstplanExportState(withName).visible, false);
  const namedWrong = { ...jnv(), primaryFileName: 'irgendwas.xlsx' };
  assert.equal(resolveDienstplanExportState(namedWrong).enabled, true, 'and not against it either');
});

// =====================================================================================
// 5 — switching imports
// =====================================================================================
test('5: switching from an exportable to a non-exportable import removes the action', () => {
  const { root, controller } = mount();
  controller.update(jnv());
  assert.equal(buttonOf(root).disabled, false);

  controller.update(session(excelImport('umlaufkarte')));
  assert.equal(controller.getState().visible, false);
  assert.equal(buttonOf(root).disabled, true, 'a hidden action must not stay clickable');
  assert.equal(buttonOf(root).getAttribute('tabindex'), '-1', 'and not stay focusable');
});

test('5: after a switch no old model is kept', () => {
  const { controller } = mount();
  controller.update(jnv());
  assert.notEqual(controller.getState().model, null);
  controller.update(session(null));
  assert.equal(controller.getState().model, null, 'the previous model is gone, not reused');
  assert.equal(controller.getState().enabled, false);
});

test('5: switching between JNV and JES updates the organization', () => {
  const { controller } = mount();
  controller.update(jnv());
  assert.equal(controller.getState().organization, 'JNV');
  controller.update(jes());
  assert.equal(controller.getState().organization, 'JES');
});

test('5: the controller survives being handed nonsense', () => {
  const { controller } = mount();
  for (const input of [null, undefined, 'nonsense', 42, [], { primaryImport: 'x' }]) {
    assert.doesNotThrow(() => controller.update(input), String(input));
    assert.equal(controller.getState().enabled, false);
  }
});

// =====================================================================================
// 10 — accessibility and the neutral status line
// =====================================================================================
test('10: the hidden action is neither enabled nor focusable', () => {
  const { root, controller } = mount();
  controller.update(session(excelImport('wagenkarte')));
  const container = root.children[0];
  assert.equal(container.hidden, true, 'the whole group is hidden');
  assert.equal(buttonOf(root).disabled, true);
  assert.equal(buttonOf(root).getAttribute('tabindex'), '-1');
});

test('10: a visible but not enabled action explains itself politely', () => {
  const { root, controller } = mount();
  controller.update(session(pdfImport('beu-stadtbus-v1', [])));
  assert.equal(root.children[0].hidden, false);
  assert.equal(buttonOf(root).disabled, true);
  assert.equal(statusOf(root).getAttribute('aria-live'), 'polite');
  assert.ok(statusOf(root).textContent.length > 0, 'and says why');
});

test('10: the button carries an accessible name and its state', () => {
  const { root, controller } = mount();
  controller.update(jnv());
  const button = buttonOf(root);
  assert.equal(button.textContent, EXPORT_BUTTON_LABEL, 'the label IS the accessible name');
  assert.equal(button.getAttribute('aria-disabled'), 'false');
  controller.update(session(pdfImport('beu-stadtbus-v1', [])));
  assert.equal(button.getAttribute('aria-disabled'), 'true');
});

test('10: the status text is set as text, never as markup', () => {
  const { root, controller } = mount();
  controller.update(jnv());
  const status = statusOf(root);
  assert.equal(typeof status.textContent, 'string');
  assert.equal(status.innerHTML, undefined, 'the adapter never touches innerHTML');
});

test('10: rendering twice does not duplicate the controls', () => {
  const { root, controller } = mount();
  controller.update(jnv());
  controller.update(jes());
  controller.update(jnv());
  const buttons = root.children.flatMap(node => [node, ...node.children]).filter(node => node.tagName === 'BUTTON');
  assert.equal(buttons.length, 1, 'the controls are built once and only updated');
});

test('10: a page without the mount point simply has no export action', () => {
  assert.doesNotThrow(() => createDienstplanExportController(null, { document: makeDocument() }));
  const controller = createDienstplanExportController(null, { document: makeDocument() });
  assert.doesNotThrow(() => controller.update(jnv()));
  assert.equal(controller.getState().visible, true, 'the decision is still computed …');
  assert.doesNotThrow(() => controller.triggerExport(), '… and triggering is simply a no-op');
});
