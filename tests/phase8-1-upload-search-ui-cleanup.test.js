/** Phase 8.1 — presentation-only import, export and original-block search acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImportWorkflowSummary, getImportFileCount } from '../js/v2/ui/import-workflow-view.js';
import { filterAnalysisBlocks } from '../js/v2/ui/analysis-search-controller.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const primary = {
  canonicalSchedule: { type: 'CanonicalSchedule' },
  detection: { profile: { label: 'JES Regionalbus' } }
};

test('Phase 8.1: one analyzed primary PDF shows exactly one file and its available profile', () => {
  const state = { primaryImport: primary, primaryFileName: 'Dienstplan-JES.pdf', checkReport: { results: [] } };
  assert.equal(getImportFileCount(state), 1);
  assert.equal(buildImportWorkflowSummary(state), [
    'Dateien: 1',
    'Hauptdokument: Dienstplan-JES.pdf',
    'Erkennung: JES Regionalbus',
    'Analyse: abgeschlossen.'
  ].join('\n'));
});

test('Phase 8.1: a confirmed companion changes the file count to two', () => {
  const state = { ...primary, primaryImport: primary, primaryFileName: 'Dienstplan-JES.pdf', companionImport: {}, companionFileName: 'Wagenkarte.xlsx' };
  assert.equal(getImportFileCount(state), 2);
  assert.match(buildImportWorkflowSummary(state), /Dateien: 2/);
  assert.match(buildImportWorkflowSummary(state), /Begleitdokument: Wagenkarte\.xlsx/);
});

test('Phase 8.1: an incompatible companion is stated without a false analysis-progress status', () => {
  const state = {
    primaryImport: primary,
    primaryFileName: 'Dienstplan-JES.pdf',
    companionImport: {},
    companionFileName: 'Umlauftafel.xlsx',
    bundle: { compatibility: { status: 'conflicting' } }
  };
  assert.match(buildImportWorkflowSummary(state), /Analyse: für diese Dokumentkombination nicht verfügbar\./);
});

test('Phase 8.1: original result blocks are searched once per complete block and reset neutrally', () => {
  const blocks = [
    { textContent: '1. Anzahl Dienste\nDienst 1103\nLinie 5\nKurs 5/11\nJena Busbahnhof' },
    { textContent: '2. Geteilte Dienste\nDienst 2101' }
  ];
  for (const query of ['1103', 'Linie 5', '5/11', 'Busbahnhof']) {
    assert.deepEqual(filterAnalysisBlocks(blocks, query).map(result => result.matches), [true, false], query);
  }
  assert.deepEqual(filterAnalysisBlocks(blocks, 'geteilte').map(result => result.matches), [false, true]);
  assert.deepEqual(filterAnalysisBlocks(blocks, '').map(result => result.matches), [true, true]);
});

test('Phase 8.1: mobile-safe controls and consistent export action hooks exist', () => {
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*input\[type="file"\] \{ width: 100%; min-height: 2\.75rem;/);
  assert.match(html, /\.export-actions button, \.search-actions button \{ width: 100%; \}/);
  assert.match(html, /class="search-actions"/);
  assert.match(html, /type="search" placeholder="z\. B\. Dienst 72, Linie, Kurs oder Ort"/);
});
