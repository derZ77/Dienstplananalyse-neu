/**
 * Phase 3I.36 (B/E) — the print and export controls.
 *
 * `window.print()` runs only from an explicit user action, never on import. Neither action changes
 * the report, the filter state or a single status.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { renderCheckReportHtml, createCheckReportController } from '../js/v2/report/check-report-view.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const result = (id, status, severity) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity, message: '',
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: []
});
const report = (results = [result('BV003', 'FAIL', 'WARNING'), result('BV010', 'PASS', 'INFO')]) => ({
  type: 'CheckReport', results, errors: [], summary: { resultCount: results.length, hitCount: 1 }
});
const html = (state = {}) => renderCheckReportHtml(buildCheckReportViewModel(report(), { state }));

/** A root that answers `querySelector` from the rendered markup, enough to drive the controller. */
const makeRoot = () => {
  const listeners = new Map();
  const elements = new Map();
  const root = {
    innerHTML: '',
    querySelector(selector) {
      const id = selector.replace('#', '');
      if (!root.innerHTML.includes(`id="${id}"`)) return null;
      if (!elements.has(id)) {
        elements.set(id, {
          id, value: '', checked: false, disabled: false,
          addEventListener: (event, handler) => listeners.set(`${id}:${event}`, handler)
        });
      }
      return elements.get(id);
    }
  };
  return { root, fire: (id, event = 'click') => listeners.get(`${id}:${event}`)?.({}) };
};

// =====================================================================================
// E — the controls
// =====================================================================================
test('E: both actions have visible, accessible labels', () => {
  const out = html();
  assert.ok(out.includes('Prüfbericht drucken'));
  assert.ok(out.includes('Ergebnisse exportieren'));
  assert.match(out, /id="report-print"/);
  assert.match(out, /id="report-export"/);
});

test('E: both are real buttons, never inline handlers', () => {
  const out = html();
  assert.match(out, /<button[^>]*id="report-print"[^>]*type="button"|<button[^>]*type="button"[^>]*id="report-print"/);
  assert.match(out, /<button[^>]*id="report-export"[^>]*type="button"|<button[^>]*type="button"[^>]*id="report-export"/);
  assert.doesNotMatch(out, /onclick=|onsubmit="[^r]/);
});

test('E: the action block is excluded from print', () => {
  assert.match(html(), /class="report-actions no-print"/);
});

test('E: without a report the actions are disabled', () => {
  const out = renderCheckReportHtml(buildCheckReportViewModel(null));
  assert.match(out, /id="report-print"[^>]*disabled|disabled[^>]*id="report-print"/);
  assert.match(out, /id="report-export"[^>]*disabled|disabled[^>]*id="report-export"/);
});

test('E: with a report the actions are enabled', () => {
  const out = html();
  const printButton = out.slice(out.indexOf('id="report-print"') - 60, out.indexOf('id="report-print"') + 60);
  assert.ok(!printButton.includes('disabled'));
});

test('E: there is a polite status area for the export message', () => {
  const out = html();
  assert.match(out, /id="report-action-status"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="report-action-status"/);
});

// =====================================================================================
// B — printing
// =====================================================================================
test('B: printing happens only through an explicit user action', () => {
  const { root, fire } = makeRoot();
  const printed = [];
  const controller = createCheckReportController(root, { printer: () => printed.push('print') });
  controller.setCheckReport(report());
  assert.deepEqual(printed, [], 'rendering a report prints nothing');
  fire('report-print');
  assert.deepEqual(printed, ['print']);
});

test('B: an import never triggers printing', () => {
  const { root } = makeRoot();
  const printed = [];
  const controller = createCheckReportController(root, { printer: () => printed.push('print') });
  controller.setCheckReport(report());
  controller.setReportContext({ metadata: { organization: 'JNV', documentType: null, dayType: null, serviceCount: 61 } });
  controller.setState({ status: 'FAIL' });
  assert.deepEqual(printed, []);
});

test('B: an empty completed report remains printable', () => {
  const { root, fire } = makeRoot();
  const printed = [];
  const controller = createCheckReportController(root, { printer: () => printed.push('print') });
  controller.setCheckReport({ type: 'CheckReport', results: [], errors: [], summary: {} });
  fire('report-print');
  assert.deepEqual(printed, ['print'], 'the completed report header is printable even without rule results');
});

test('B: the filter state survives printing untouched', () => {
  const { root, fire } = makeRoot();
  const controller = createCheckReportController(root, { printer: () => {} });
  controller.setCheckReport(report());
  controller.setState({ status: 'FAIL' });
  const before = root.innerHTML;
  fire('report-print');
  assert.equal(root.innerHTML, before, 'the screen is exactly as it was');
});

test('B: printing changes no status and no report', () => {
  const { root, fire } = makeRoot();
  const controller = createCheckReportController(root, { printer: () => {} });
  const original = report();
  const snapshot = JSON.stringify(original);
  controller.setCheckReport(original);
  fire('report-print');
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(controller.getCheckReport(), original);
});

test('B: the view calls window.print only through the injected printer', () => {
  const module = src('../js/v2/report/check-report-view.js');
  const calls = module.match(/window\.print\(\)/g) || [];
  assert.ok(calls.length <= 1, 'at most one place may reach the browser printer');
  assert.match(module, /printer/, 'and it is injectable, so it can be observed');
});

// =====================================================================================
// Exporting
// =====================================================================================
test('E: exporting is triggered by the button and reports success politely', () => {
  const { root, fire } = makeRoot();
  const downloads = [];
  const controller = createCheckReportController(root, {
    exporter: (file) => { downloads.push(file); return { applied: true }; }
  });
  controller.setCheckReport(report());
  fire('report-export');
  assert.equal(downloads.length, 1);
  assert.ok(root.innerHTML.includes('Export wurde erstellt'));
});

test('E: without a report the export says so instead of failing', () => {
  const { root, fire } = makeRoot();
  const downloads = [];
  createCheckReportController(root, { exporter: (file) => { downloads.push(file); return { applied: true }; } });
  fire('report-export');
  assert.deepEqual(downloads, []);
  assert.ok(root.innerHTML.includes('Kein Prüfbericht zum Export vorhanden'));
});

test('E: a failing export is reported, never thrown', () => {
  const { root, fire } = makeRoot();
  const controller = createCheckReportController(root, {
    exporter: () => { throw new Error('boom'); }
  });
  controller.setCheckReport(report());
  assert.doesNotThrow(() => fire('report-export'));
  assert.ok(root.innerHTML.includes('Export konnte nicht erstellt werden'));
  assert.ok(!root.innerHTML.includes('boom'), 'no internal message leaks to the user');
});

test('E: exporting changes neither the report nor the filter state', () => {
  const { root, fire } = makeRoot();
  const controller = createCheckReportController(root, { exporter: () => ({ applied: true }) });
  const original = report();
  const snapshot = JSON.stringify(original);
  controller.setCheckReport(original);
  controller.setState({ status: 'FAIL' });
  fire('report-export');
  assert.equal(JSON.stringify(original), snapshot);
  assert.ok(root.innerHTML.includes('2 von 2') || root.innerHTML.includes('1 von 2'),
    'the filter is still in force on screen');
});

test('E: the export always covers the whole report, never just the filtered view', () => {
  const { root, fire } = makeRoot();
  const files = [];
  const controller = createCheckReportController(root, { exporter: (file) => { files.push(file); return { applied: true }; } });
  controller.setCheckReport(report());
  controller.setState({ status: 'FAIL' });
  fire('report-export');
  const rows = files[0].sheets.find(sheet => sheet.name === 'Regelergebnisse').rows;
  assert.equal(rows.length, 3, 'header plus BOTH results, despite the screen filter');
});

test('E: the controls introduce no dependency, no storage and no network', () => {
  const module = src('../js/v2/report/check-report-view.js');
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(module, /import .* from ['"](?!\.)/, 'no bare specifier — nothing installed');
});
