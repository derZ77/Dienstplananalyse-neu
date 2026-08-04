/** Phase 4.7 — real acceptance PDFs through the productive single-schedule session. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { createMultiDocumentSession } = await import('../js/v2/import/multi-document-import-controller.js');
const { deriveReportContext } = await import('../js/v2/report/check-report-view-model.js');

const ROOT = new URL('../acceptance-data/', import.meta.url);

async function fileOf(relativePath) {
  const bytes = new Uint8Array(await readFile(new URL(relativePath, ROOT)));
  return {
    name: 'selected-by-user.pdf',
    type: 'application/pdf',
    arrayBuffer: async () => bytes.slice().buffer
  };
}

async function importAndAnalyze(relativePath) {
  const primaryImport = await analyzePdfImport(await fileOf(relativePath));
  const session = createMultiDocumentSession();
  session.setPrimaryResult(primaryImport, { name: 'selected-by-user.pdf' });
  return { primaryImport, state: await session.analyzeRules() };
}

test('the JNV acceptance PDF carries its profile context and a completed basis-analysis status', async () => {
  const { primaryImport, state } = await importAndAnalyze('JNV/Dienstplan.pdf');
  const context = deriveReportContext(state);

  assert.equal(primaryImport.detection.profile.id, 'beu-stadtbus-v1');
  assert.equal(context.metadata.organization, 'JNV');
  assert.equal(context.metadata.documentType, 'jnv_schedule_pdf');
  assert.equal(state.checkReport.type, 'CheckReport');
  assert.equal(state.ruleAnalysisStatus, 'Die regelbasierte Prüfung wurde durchgeführt.');
});

test('both JES acceptance PDFs carry JES context and an empty completed basis CheckReport', async () => {
  for (const relativePath of ['JES/20260817_Übersicht_Schule_Jena_FDA.pdf', 'JES/Dienstplan.pdf']) {
    const { primaryImport, state } = await importAndAnalyze(relativePath);
    const context = deriveReportContext(state);

    assert.equal(primaryImport.detection.profile.id, 'jes-regionalbus-v1');
    assert.equal(context.metadata.organization, 'JES');
    assert.equal(context.metadata.documentType, 'jes_schedule_pdf');
    assert.equal(state.checkReport.type, 'CheckReport');
    assert.equal(state.checkReport.results.length, 0, 'no JNV rule is attached to JES');
    assert.equal(state.checkReport.errors.length, 0);
    assert.equal(state.ruleAnalysisStatus, 'Die regelbasierte Prüfung wurde durchgeführt.');
  }
});

test('the productive bootstrap derives its import status from the CheckReport state', async () => {
  const source = await readFile(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
  assert.match(source, /state\.checkReport/);
  assert.match(source, /Die regelbasierte Prüfung wurde durchgeführt\./);
  assert.match(source, /primaryAnalysisStatus\(state\)/);
});
