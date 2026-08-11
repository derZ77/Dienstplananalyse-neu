import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3H.5 – the memory-only session triggers the rule analysis exactly once per new exact
// match state, resets it on document changes, and never double-runs. Injected deps only.
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';

const exactBundle = () => ({ compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } });
const exactMatching = () => ({ attempted: true, status: 'completed', reason: null, matchResult: { status: 'exact', matches: [], warnings: [], statistics: {} }, warnings: [] });
const blockedMatching = () => ({ attempted: false, status: 'blocked', reason: 'BUNDLE_NOT_EXACT', matchResult: null, warnings: [] });
const fakeReport = { type: 'CheckReport', results: [{ id: 'BV008', name: 'BV008', category: 'BV', severity: 'INFO', status: 'PASS', message: 'ok', details: {}, affectedServices: [], affectedActivities: [], sourceReferences: [] }], errors: [], summary: { hitCount: 0, resultCount: 1 } };
const okAnalysis = () => Promise.resolve({ attempted: true, status: 'completed', reason: null, jointTimeline: {}, drivingProjection: {}, checkReport: fakeReport, warnings: [] });

const acceptCompanion = () => Promise.resolve({ classification: { type: 'umlaufkarte', confidence: 'exact' }, document: { type: 'UmlauftafelDocument', mode: 'bus' } });
const rejectCompanion = () => Promise.resolve({ classification: { type: 'unknown', confidence: 'none' } });

function spySession({ matching = exactMatching, importCompanion = acceptCompanion } = {}) {
  let calls = 0;
  const runRuleAnalysis = (args) => { calls += 1; return okAnalysis(args); };
  const session = createMultiDocumentSession({
    importCompanion, buildBundle: exactBundle, runMatching: matching, runRuleAnalysis,
    generateBundleId: () => 'b', generateTimestamp: () => '2026-08-01T00:00:00Z'
  });
  return { session, calls: () => calls };
}

const primary = () => ({ canonicalSchedule: { type: 'CanonicalSchedule' } });
const file = (name = 'p.pdf') => ({ name });

test('normalisiert den Canonical Schedule eines Legacy-Excel-ImportResult für den gemeinsamen Pfad', () => {
  const session = createMultiDocumentSession();
  const canonicalSchedule = { type: 'CanonicalSchedule', services: [], activities: [], interruptions: [], warnings: [] };
  const state = session.setPrimaryResult({
    classification: { type: 'legacy_excel_schedule', confidence: 'exact' },
    importResult: { ok: true, data: canonicalSchedule }
  }, file('plan.xlsx'));

  assert.equal(state.primaryImport.canonicalSchedule, canonicalSchedule);
  assert.equal(state.primaryImport.documentType, 'legacy_excel_schedule');
});

test('führt den vorhandenen JES-Basislauf auch für einen erkannten eigenständigen Legacy-Excel-Dienstplan aus', async () => {
  let calls = 0;
  const session = createMultiDocumentSession({
    runJesBaseAnalysis: () => { calls += 1; return okAnalysis(); }
  });
  const canonicalSchedule = { type: 'CanonicalSchedule', services: [], activities: [], interruptions: [], warnings: [] };
  session.setPrimaryResult({
    classification: { type: 'legacy_excel_schedule', confidence: 'exact' },
    importResult: { ok: true, documentType: 'legacy_excel_schedule', data: canonicalSchedule }
  }, file('jes.xlsx'));

  const state = await session.analyzeRules();
  assert.equal(calls, 1);
  assert.equal(state.checkReport, fakeReport);
  assert.equal(state.ruleAnalysis.status, 'completed');
});

test('without an exact match the rule analysis does not run and no CheckReport is produced', async () => {
  const { session, calls } = spySession({ matching: blockedMatching });
  session.setPrimaryResult(primary(), file());
  await session.setCompanionFile(file('c.xlsx'));
  const state = await session.analyzeRules();
  assert.equal(calls(), 0);
  assert.equal(state.checkReport, null);
});

test('an exact match triggers the rule analysis exactly once and stores the CheckReport', async () => {
  const { session, calls } = spySession();
  session.setPrimaryResult(primary(), file());
  await session.setCompanionFile(file('c.xlsx'));
  const state = await session.analyzeRules();
  assert.equal(calls(), 1);
  assert.equal(state.checkReport, fakeReport);
  assert.equal(state.ruleAnalysis.status, 'completed');
  assert.ok(state.ruleAnalysisStatus.length > 0);
});

test('calling analyzeRules twice for the same state does not double-run', async () => {
  const { session, calls } = spySession();
  session.setPrimaryResult(primary(), file());
  await session.setCompanionFile(file('c.xlsx'));
  await session.analyzeRules();
  await session.analyzeRules();
  assert.equal(calls(), 1);
});

test('a new primary triggers a fresh run', async () => {
  const { session, calls } = spySession();
  session.setPrimaryResult(primary(), file('p1.pdf'));
  await session.setCompanionFile(file('c.xlsx'));
  await session.analyzeRules();
  session.setPrimaryResult(primary(), file('p2.pdf'));
  await session.analyzeRules();
  assert.equal(calls(), 2);
});

test('a new companion triggers a fresh run', async () => {
  const { session, calls } = spySession();
  session.setPrimaryResult(primary(), file());
  await session.setCompanionFile(file('c1.xlsx'));
  await session.analyzeRules();
  await session.setCompanionFile(file('c2.xlsx'));
  await session.analyzeRules();
  assert.equal(calls(), 2);
});

test('removing a document resets the rule analysis', async () => {
  const { session } = spySession();
  session.setPrimaryResult(primary(), file());
  await session.setCompanionFile(file('c.xlsx'));
  await session.analyzeRules();
  const state = await session.setCompanionFile(null); // removed → rebuild resets
  assert.equal(state.checkReport, null);
  assert.equal(state.ruleAnalysis, null);
  const after = await session.analyzeRules();
  assert.equal(after.checkReport, null);
});

test('a rejected replacement companion preserves the valid prior CheckReport', async () => {
  let calls = 0;
  let mode = 'accept';
  const importCompanion = () => { return mode === 'accept' ? acceptCompanion() : rejectCompanion(); };
  const runRuleAnalysis = () => { calls += 1; return okAnalysis(); };
  const session = createMultiDocumentSession({ importCompanion, buildBundle: exactBundle, runMatching: exactMatching, runRuleAnalysis, generateBundleId: () => 'b', generateTimestamp: () => 't' });
  session.setPrimaryResult(primary(), file());
  await session.setCompanionFile(file('c.xlsx'));
  await session.analyzeRules();
  assert.equal(calls, 1);
  mode = 'reject';
  const state = await session.setCompanionFile(file('bad.xlsx')); // rejected → keep prior valid state
  const after = await session.analyzeRules();
  assert.equal(calls, 1);                       // no re-run
  assert.equal(after.checkReport, fakeReport);  // prior valid CheckReport preserved
});
