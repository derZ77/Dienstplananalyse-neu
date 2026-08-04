import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3G.3 – the memory-only multi-document session now runs the structural matcher
// once per new exact bundle. Matching is injected so the call count is observable.
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';

const TITLE = 'Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026';
const PRIMARY = { detection: { title: TITLE }, canonicalSchedule: { services: [], hardened: { applied: true, dayQualifiers: [] } } };
const COMPANION = { classification: { type: 'umlaufkarte', confidence: 'exact' }, document: { validity: {}, circulations: [] } };

function makeSession(bundleCompat = 'exact') {
  let matchCalls = 0;
  const session = createMultiDocumentSession({
    importCompanion: async (f) => (f?.reject ? { classification: { type: 'legacy_excel_schedule', confidence: 'exact' } } : COMPANION),
    buildBundle: () => ({ compatibility: { status: bundleCompat }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } }),
    runMatching: () => { matchCalls += 1; return { attempted: true, status: 'completed', reason: null, matchResult: { status: 'exact', statistics: {} }, validity: { confidence: 'exact' }, scheduleViewValid: true, warnings: [] }; },
    generateBundleId: () => 'b', generateTimestamp: () => 't'
  });
  return { session, matchCalls: () => matchCalls };
}
const file = (name = 'p.pdf', extra = {}) => ({ name, ...extra });

test('only a primary → no bundle, no matching', () => {
  const { session, matchCalls } = makeSession();
  const s = session.setPrimaryResult(PRIMARY, file());
  assert.equal(s.bundle, null);
  assert.equal(s.matching, null);
  assert.equal(matchCalls(), 0);
});

test('only a companion → no bundle, no matching', async () => {
  const { session, matchCalls } = makeSession();
  const s = await session.setCompanionFile(file('c.xlsx'));
  assert.equal(s.matching, null);
  assert.equal(matchCalls(), 0);
});

test('an exact JNV bundle runs the matcher exactly once and stores the result', async () => {
  const { session, matchCalls } = makeSession();
  session.setPrimaryResult(PRIMARY, file());
  const s = await session.setCompanionFile(file('c.xlsx'));
  assert.ok(s.bundle);
  assert.equal(s.matching.status, 'completed');
  assert.equal(s.matching.matchResult.status, 'exact');
  assert.equal(matchCalls(), 1);
  assert.ok(s.matchingStatus.length > 0);
});

test('replacing the primary re-runs the matcher (once more)', async () => {
  const { session, matchCalls } = makeSession();
  session.setPrimaryResult(PRIMARY, file());
  await session.setCompanionFile(file('c.xlsx')); // 1
  session.setPrimaryResult({ ...PRIMARY }, file('p2.pdf')); // 2
  assert.equal(matchCalls(), 2);
});

test('replacing the companion re-runs the matcher', async () => {
  const { session, matchCalls } = makeSession();
  session.setPrimaryResult(PRIMARY, file());
  await session.setCompanionFile(file('c.xlsx')); // 1
  await session.setCompanionFile(file('c2.xlsx')); // 2
  assert.equal(matchCalls(), 2);
});

test('removing the companion clears the matching', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(PRIMARY, file());
  await session.setCompanionFile(file('c.xlsx'));
  const s = await session.setCompanionFile(null);
  assert.equal(s.matching, null);
});

test('removing the primary clears the matching', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(PRIMARY, file());
  await session.setCompanionFile(file('c.xlsx'));
  const s = session.setPrimaryResult(null, null);
  assert.equal(s.matching, null);
});

test('a rejected companion replacement does not destroy the valid matching', async () => {
  const { session, matchCalls } = makeSession();
  session.setPrimaryResult(PRIMARY, file());
  await session.setCompanionFile(file('c.xlsx')); // valid → matching (1)
  const s = await session.setCompanionFile(file('bad.xlsx', { reject: true })); // rejected type
  assert.equal(s.matching.status, 'completed', 'previous valid matching is kept');
  assert.equal(matchCalls(), 1, 'no extra matcher run for a rejected replacement');
});

test('a conflicting bundle still runs the orchestrator (which blocks internally) — no double matching', async () => {
  const { session, matchCalls } = makeSession('conflicting');
  session.setPrimaryResult(PRIMARY, file());
  await session.setCompanionFile(file('c.xlsx'));
  assert.equal(matchCalls(), 1); // exactly once per new bundle; the orchestrator decides blocked
});

test('the matching state is memory-only (no storage/network in the controller source)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/v2/import/multi-document-import-controller.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\s*\(|XMLHttpRequest|WebSocket/);
});
