/**
 * Phase 4.5 (11/12) — the scope gate.
 *
 * This phase is a UI wiring and a capability switch. Everything it is not allowed to touch is
 * checked here rather than trusted: the parsers, the rules, the Phase 4.3 model, the Phase 4.4
 * exporter and the whole Prüfbericht.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const UNTOUCHED = [
  // parsers and detection
  '../js/v2/pdf/pdf-core.js', '../js/v2/pdf/document-normalizer.js', '../js/v2/pdf/schedule-mapper.js',
  '../js/v2/pdf/canonical-schedule-builder.js', '../js/v2/pdf/hardened-schedule.js',
  '../js/v2/pdf/jnv-schedule-hardening.js', '../js/v2/pdf/row-type-contract.js',
  '../js/v2/pdf/layout-reconstruction.js', '../js/v2/pdf/document-profile-detector.js',
  '../js/v2/import/pdf-analysis-controller.js', '../js/v2/import/pdf-import-controller.js',
  '../js/v2/import/excel-import-controller.js', '../js/v2/import/legacy-excel-import-adapter.js',
  // rules and analysis
  '../js/v2/checks/check-runner.js', '../js/v2/checks/bv/bv003.js',
  '../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/jnv-rule-analysis-controller.js',
  '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
  '../js/v2/analysis/driving-projection.js',
  // the export chain of Phase 4.3 and 4.4
  '../js/v2/export/dienstplan-xlsx-model.js', '../js/v2/export/dienstplan-xlsx-export.js',
  // the Prüfbericht
  '../js/v2/report/check-report-view.js', '../js/v2/report/check-report-view-model.js',
  '../js/v2/report/check-report-export.js', '../js/v2/report/check-report-export-model.js'
];

// =====================================================================================
// 11 — nothing outside the allowed scope carries this phase
// =====================================================================================
test('11: no parser, rule, model, exporter or report file carries Phase 4.5', () => {
  for (const path of UNTOUCHED) {
    assert.doesNotMatch(src(path), /4\.5/, `${path} must be untouched`);
  }
});

test('11: exactly the allowed product files carry this phase', () => {
  const root = fileURLToPath(new URL('../js', import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const touched = walk(root)
    .filter(file => file.endsWith('.js'))
    .filter(file => /Phase 4\.5/.test(readFileSync(file, 'utf8')))
    .map(file => file.slice(root.length + 1))
    .sort();
  assert.deepEqual(touched, [
    'v2/documents/document-profiles.js',
    'v2/export/dienstplan-export-ui.js',
    'v2/pdf-import-bootstrap.js'
  ], 'capability, adapter and wiring — nothing else');
});

test('11: the Phase 4.3 model and the Phase 4.4 exporter keep their public surface', async () => {
  const model = await import('../js/v2/export/dienstplan-xlsx-model.js');
  assert.equal(typeof model.buildDienstplanXlsxModel, 'function');
  assert.deepEqual([...model.SHEET_NAMES], ['Dienstplan', 'Dienste', 'Importhinweise']);
  assert.deepEqual([...model.CONFIDENCE_LEVELS], ['exact', 'derived', 'inconclusive']);

  const exporter = await import('../js/v2/export/dienstplan-xlsx-export.js');
  for (const name of ['createDienstplanWorkbook', 'writeDienstplanXlsx',
    'createDienstplanCsv', 'downloadDienstplanExport']) {
    assert.equal(typeof exporter[name], 'function', name);
  }
  assert.deepEqual(Object.values(exporter.DIENSTPLAN_EXPORT_STATUS).sort(),
    ['error', 'not_applicable', 'ready']);
});

test('11: the Prüfbericht gains no Dienstplan export', () => {
  for (const path of ['../js/v2/report/check-report-view.js', '../js/v2/report/check-report-export.js',
    '../js/v2/report/check-report-export-model.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /Dienstplan als Excel|dienstplan-export-ui|dienstplan-xlsx/,
      `${path} must stay a report`);
  }
  const html = src('../index.html');
  const reportSection = html.slice(html.indexOf('id="pruefbericht"'), html.indexOf('id="check-explorer"'));
  assert.ok(!reportSection.includes('dienstplan-export'), 'the export lives in the import block, not here');
});

test('11: the rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false, 'Phase 4.5 activates no rule');
});

test('11: the import block keeps everything it had', () => {
  const html = src('../index.html');
  for (const id of ['file-input', 'file-result', 'pdf-import-result', 'companion-file-input',
    'companion-import-result', 'combination-result', 'match-result', 'rule-analysis-result']) {
    assert.ok(html.includes(`id="${id}"`), `${id} must still exist`);
  }
  assert.match(html, /accept="\.xlsx,\.xls,\.pdf,application\/pdf"/, 'the file input is unchanged');
});

test('11: the export mount point sits in the import block, once', () => {
  const html = src('../index.html');
  const block = html.slice(html.indexOf('id="file-input"'), html.indexOf('0b. Optionales Begleitdokument'));
  assert.ok(block.includes('id="dienstplan-export"'), 'mounted in block 0');
  assert.equal((html.match(/id="dienstplan-export"/g) || []).length, 1, 'exactly once');
});

// =====================================================================================
// 12 — privacy and product hygiene
// =====================================================================================
test('12: no network, no storage, no telemetry, no new dependency', () => {
  for (const path of ['../js/v2/export/dienstplan-export-ui.js', '../js/v2/pdf-import-bootstrap.js',
    '../js/v2/documents/document-profiles.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/, `${path}: no storage`);
    assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/, `${path}: no network`);
    assert.doesNotMatch(module, /https?:\/\//, `${path}: no external host`);
    assert.doesNotMatch(module, /import .* from ['"](?!\.)/, `${path}: nothing installed`);
    assert.doesNotMatch(module, /\/Users\/|Downloads/, `${path}: no local path`);
  }
  const packageJson = JSON.parse(src('../package.json'));
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
});

test('12: the page still forbids every outbound connection', () => {
  assert.match(src('../index.html'), /connect-src 'none'/, 'the CSP was not loosened for an export');
});

test('12: the adapter writes text, never markup', () => {
  const adapter = src('../js/v2/export/dienstplan-export-ui.js');
  assert.doesNotMatch(adapter, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
    'a warning text can never become markup');
  assert.match(adapter, /textContent/, 'text is set as text');
});

test('12: no reference artefact and no binary was added to the repository', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const offenders = readdirSync(root)
    .filter(entry => /\.(xlsx|xls|csv|pdf|zip)$/i.test(entry));
  assert.deepEqual(offenders, [], 'no workbook, PDF or CSV lies in the app directory');
});

test('12: the bootstrap wires the export without touching the existing status flow', () => {
  const bootstrap = src('../js/v2/pdf-import-bootstrap.js');
  // Everything block 0/0b already did must still be there.
  for (const id of ['companion-import-result', 'combination-result', 'match-result', 'rule-analysis-result']) {
    assert.ok(bootstrap.includes(id), `${id} is still rendered`);
  }
  assert.match(bootstrap, /session\.analyzeRules\(\)/, 'the rule analysis still runs as before');
  assert.match(bootstrap, /explorerBridge\.setCheckReport/, 'and the report still gets its data');
  assert.doesNotMatch(bootstrap, /downloadDienstplanExport|buildDienstplanXlsxModel/,
    'the bootstrap delegates to the adapter instead of exporting itself');
});
