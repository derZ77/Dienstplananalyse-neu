/**
 * Phase 4.6e — regressions found in the real acceptance workflow.
 *
 * These tests deliberately use the acceptance PDFs. They exercise the same
 * productive import and session paths as the browser, without deriving a
 * document type from a file name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { createMultiDocumentSession } = await import('../js/v2/import/multi-document-import-controller.js');

const JES_ACCEPTANCE_PDF = new URL('../acceptance-data/JES/20260817_Übersicht_Schule_Jena_FDA.pdf', import.meta.url);
const JNV_ACCEPTANCE_PDF = new URL('../acceptance-data/JNV/Dienstplan.pdf', import.meta.url);

async function acceptanceFile(url) {
  const bytes = new Uint8Array(await readFile(url));
  return {
    name: 'selected-by-user.pdf',
    type: 'application/pdf',
    arrayBuffer: async () => bytes.slice().buffer
  };
}

test('the JES acceptance PDF with the Schule title is accepted by the productive detector', async () => {
  const result = await analyzePdfImport(await acceptanceFile(JES_ACCEPTANCE_PDF));

  assert.equal(result.detection.status, 'supported');
  assert.equal(result.detection.profile.id, 'jes-regionalbus-v1');
  assert.deepEqual(result.detection.signals.jesSignals, [true, true, true]);
});

test('a standalone JNV acceptance PDF produces the schedule-only BV CheckReport', async () => {
  const primaryImport = await analyzePdfImport(await acceptanceFile(JNV_ACCEPTANCE_PDF));
  assert.equal(primaryImport.detection.profile.id, 'beu-stadtbus-v1');

  const session = createMultiDocumentSession();
  session.setPrimaryResult(primaryImport, { name: 'selected-by-user.pdf' });
  const state = await session.analyzeRules();

  assert.equal(state.ruleAnalysis.status, 'completed');
  assert.equal(state.checkReport.type, 'CheckReport');
  assert.deepEqual(
    state.checkReport.moduleRuns.map(run => run.id).sort(),
    ['bv001', 'bv002', 'bv003', 'bv005', 'bv007', 'bv010', 'bv012', 'bv014']
  );
  assert.ok(!state.checkReport.moduleRuns.some(run => run.id === 'bv008'));
  assert.ok(!state.checkReport.moduleRuns.some(run => run.id === 'bv015_bv018'));
});
