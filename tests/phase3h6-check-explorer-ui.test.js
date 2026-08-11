import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3H.6 – the EXISTING explorer stays the single result surface: no new dashboard, no new
// table architecture, no BV008-specific renderer, no document detail.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const explorer = readFileSync(new URL('../js/v2/ui/check-explorer.js', import.meta.url), 'utf8');
const explorerBootstrap = readFileSync(new URL('../js/v2/check-explorer-bootstrap.js', import.meta.url), 'utf8');
const importBootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../js/v2/explorer/check-explorer-session-bridge.js', import.meta.url), 'utf8');

test('the existing explorer and dashboard regions are unchanged and no new result region was added', () => {
  assert.match(html, /id="check-explorer"/);
  assert.match(html, /id="review-dashboard"/);
  assert.match(html, /data-check-explorer="rows"/);
  assert.match(html, /data-check-explorer="empty"/);
  // no second explorer/dashboard/table architecture
  assert.equal((html.match(/id="check-explorer"/g) || []).length, 1);
  assert.equal((html.match(/id="review-dashboard"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="bv008-|id="rule-report-table|id="check-explorer-2/);
});

test('the existing status regions of the import block are still present', () => {
  for (const id of ['pdf-import-result', 'companion-import-result', 'combination-result', 'match-result', 'rule-analysis-result']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('the existing explorer bootstrap remains the single initialization authority', () => {
  assert.match(explorerBootstrap, /createCheckExplorerController/);
  assert.match(html, /check-explorer-bootstrap\.js/);
  // the import bootstrap must NOT initialize a second explorer
  assert.doesNotMatch(importBootstrap, /createCheckExplorerController|createReviewDashboardController/);
});

test('the explorer has no BV008-specific renderer or rule interpretation', () => {
  // NB: the generic category constant ARBZG predates this phase and is not rule logic.
  assert.doesNotMatch(explorer, /BV008|Lenkzeit|1\/6|Blockpause|Wendezeit|maxContinuousDrivingMinutes/i);
});

test('the bridge adds no rendering, no DOM access and no detail view of its own', () => {
  assert.doesNotMatch(bridge, /document\.|querySelector|createElement|innerHTML|textContent/);
  assert.doesNotMatch(bridge, /circulations|drivingSegments|Haltestelle|Fahrt|serviceNumber/i);
});

test('no document detail, stop, path or personal data is introduced into the result surface', () => {
  for (const source of [bridge, importBootstrap]) {
    assert.doesNotMatch(source, /Haltestelle|Originalzeile|arrayBuffer|Workbook|\/Users\/|\/Volumes\//i);
  }
});

test('the explorer renders only the existing generic CheckResult fields', () => {
  // Phase 8.4B reduces the presentation to four user-facing columns. It still reads only the
  // generic CheckResult projection: rule identity, frozen status, mapped duty numbers and message.
  for (const field of ['row.id', 'row.name', 'row.status', 'row.serviceNumbers', 'row.message']) {
    assert.ok(explorer.includes(field), `generic field remains present: ${field}`);
  }
});
