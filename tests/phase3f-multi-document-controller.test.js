import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3F – memory-only multi-document session controller. Pure logic with injected
// imports / id / timestamp; no DOM, no storage, no network. Companion imports are faked;
// bundle formation uses the real createBundleFromImports (via a counting spy).
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';
import { createBundleFromImports } from '../js/v2/import/analysis-bundle-controller.js';

const controllerSource = readFileSync(new URL('../js/v2/import/multi-document-import-controller.js', import.meta.url), 'utf8');

const JNV = { detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' } }, canonicalSchedule: {} };
const JES = { detection: { status: 'supported', profile: { id: 'jes-regionalbus-v1' } }, canonicalSchedule: {} };
const LEGACY = { classification: { type: 'legacy_excel_schedule', confidence: 'exact' } };

const COMPANIONS = {
  wagenkarte: { classification: { type: 'wagenkarte', confidence: 'exact' }, importResult: { documentType: 'wagenkarte' } },
  umlaufkarte: { classification: { type: 'umlaufkarte', confidence: 'exact' }, document: { mode: 'bus' }, importResult: { documentType: 'umlaufkarte' } },
  legacyCompanion: { classification: { type: 'legacy_excel_schedule', confidence: 'exact' } },
  unknown: { classification: { type: 'unknown', confidence: 'unknown' } },
  ambiguous: { classification: { type: 'unknown', confidence: 'ambiguous' } }
};
const file = (marker) => ({ name: `${marker}.xlsx`, marker });

function makeSession() {
  let n = 0, calls = 0;
  const importCompanion = async (f) => { if (f?.marker === 'boom') throw new Error('broken'); return COMPANIONS[f.marker]; };
  const buildBundle = (args) => { calls += 1; return createBundleFromImports(args); };
  const session = createMultiDocumentSession({
    importCompanion, buildBundle,
    generateBundleId: () => `bundle-${++n}`,
    generateTimestamp: () => '2026-07-31T00:00:00Z'
  });
  return { session, buildCalls: () => calls };
}

test('static: controller uses no storage, no network', () => {
  assert.doesNotMatch(controllerSource, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\s*\(|XMLHttpRequest|WebSocket/);
});

test('only a primary → no bundle', () => {
  const { session } = makeSession();
  const s = session.setPrimaryResult(JNV, { name: 'p.pdf' });
  assert.equal(s.primaryImport, JNV);
  assert.equal(s.bundle, null);
});

test('only a companion → no bundle (bundle needs the primary)', async () => {
  const { session } = makeSession();
  const s = await session.setCompanionFile(file('umlaufkarte'));
  assert.ok(s.companionImport);
  assert.equal(s.bundle, null);
});

test('JNV + Umlaufkarte → exact', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' });
  const s = await session.setCompanionFile(file('umlaufkarte'));
  assert.equal(s.bundle.compatibility.status, 'exact');
});

test('JES + Wagenkarte → exact', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JES, { name: 'p.pdf' });
  const s = await session.setCompanionFile(file('wagenkarte'));
  assert.equal(s.bundle.compatibility.status, 'exact');
});

test('JNV + Wagenkarte → conflicting', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' });
  const s = await session.setCompanionFile(file('wagenkarte'));
  assert.equal(s.bundle.compatibility.status, 'conflicting');
});

test('JES + Umlaufkarte → conflicting', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JES, { name: 'p.pdf' });
  const s = await session.setCompanionFile(file('umlaufkarte'));
  assert.equal(s.bundle.compatibility.status, 'conflicting');
});

test('Legacy + companion → unsupported', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(LEGACY, { name: 'p.xlsx' });
  const s = await session.setCompanionFile(file('wagenkarte'));
  assert.equal(s.bundle.compatibility.status, 'unsupported');
});

test('a legacy schedule is rejected as a companion (only Wagenkarte/Umlaufkarte)', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' });
  const s = await session.setCompanionFile(file('legacyCompanion'));
  assert.equal(s.companionImport, null);
  assert.equal(s.bundle, null);
  assert.match(s.companionStatus, /nicht.*geeignet|nur Wagenkarte|Umlauftafel/i);
});

test('unknown / ambiguous companions are rejected', async () => {
  for (const marker of ['unknown', 'ambiguous']) {
    const { session } = makeSession();
    session.setPrimaryResult(JNV, { name: 'p.pdf' });
    const s = await session.setCompanionFile(file(marker));
    assert.equal(s.companionImport, null, marker);
    assert.equal(s.bundle, null, marker);
  }
});

test('replacing the primary rebuilds the bundle', async () => {
  const { session, buildCalls } = makeSession();
  session.setPrimaryResult(JES, { name: 'p.pdf' });
  await session.setCompanionFile(file('wagenkarte')); // exact (JES+Wagenkarte)
  const s = session.setPrimaryResult(JNV, { name: 'p2.pdf' }); // now JNV+Wagenkarte → conflicting
  assert.equal(s.bundle.compatibility.status, 'conflicting');
  assert.ok(buildCalls() >= 2);
});

test('replacing the companion rebuilds the bundle', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' });
  await session.setCompanionFile(file('wagenkarte')); // conflicting
  const s = await session.setCompanionFile(file('umlaufkarte')); // exact
  assert.equal(s.bundle.compatibility.status, 'exact');
});

test('removing the companion clears the bundle', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' });
  await session.setCompanionFile(file('umlaufkarte'));
  const s = await session.setCompanionFile(null);
  assert.equal(s.companionImport, null);
  assert.equal(s.bundle, null);
});

test('a failed companion replacement does not destroy the valid state', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' });
  await session.setCompanionFile(file('umlaufkarte')); // valid exact
  const s = await session.setCompanionFile(file('boom')); // import throws
  assert.ok(s.companionImport, 'previous valid companion is kept');
  assert.equal(s.bundle.compatibility.status, 'exact', 'previous exact bundle is kept');
});

test('a null/failed primary result does not overwrite a valid primary', async () => {
  const { session } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' });
  const s = session.setPrimaryResult(null, { name: 'broken.pdf' }); // import failed, file present
  assert.equal(s.primaryImport, JNV, 'valid primary is kept');
});

test('createBundleFromImports is called once per complete combination', async () => {
  const { session, buildCalls } = makeSession();
  session.setPrimaryResult(JNV, { name: 'p.pdf' }); // no companion yet → not called
  assert.equal(buildCalls(), 0);
  await session.setCompanionFile(file('umlaufkarte')); // complete → called once
  assert.equal(buildCalls(), 1);
});
