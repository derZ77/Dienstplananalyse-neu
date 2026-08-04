import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3G.3 – productive JNV matching orchestrator. Wires the frozen 3G.1/3G.2 pieces
// behind strict execution gates. No rule evaluation, no scoring, no storage/network.
import { runJnvStructuralMatching } from '../js/v2/matching/jnv-matching-controller.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const source = readFileSync(new URL('../js/v2/matching/jnv-matching-controller.js', import.meta.url), 'utf8');
const TITLE = 'Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026';

const umlDoc = (regime, dayType, codes) => createUmlauftafelDocument({
  mode: 'bus', validity: createValidity({ serviceRegime: regime, dayType }),
  circulations: codes.map(c => createCirculation({ code: c, mode: 'bus' }))
});
const canonical = (codes) => ({
  services: [{ serviceNumber: '2101', activities: codes.map(code => ({
    serviceNumber: '2101', circuitNumber: code, routeIdentity: { line: '12', course: '1', kind: 'LINE_COURSE' },
    departureTime: { value: '05:00', minutesSinceStartOfDay: 300, dayOffset: 0 }, arrivalTime: { value: '13:00', minutesSinceStartOfDay: 780, dayOffset: 0 },
    departureLocation: 'Hof', arrivalLocation: 'Zentrum'
  })) }],
  hardened: { applied: true, dayQualifiers: [] }
});
const primaryImport = (codes, title = TITLE) => ({ detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' }, title }, canonicalSchedule: canonical(codes) });
const companionImport = (doc) => ({ classification: { type: 'umlaufkarte', confidence: 'exact' }, document: doc });
const bundle = (compat = 'exact', p = 'jnv_schedule_pdf', c = 'umlaufkarte') => ({ compatibility: { status: compat }, primary: { documentType: p, role: 'primary' }, companion: { documentType: c, role: 'companion' } });
const run = (over = {}, deps) => runJnvStructuralMatching({
  bundle: over.bundle !== undefined ? over.bundle : bundle(),
  primaryImport: over.primaryImport !== undefined ? over.primaryImport : primaryImport(['12100']),
  companionImport: over.companionImport !== undefined ? over.companionImport : companionImport(umlDoc('school', 'mo_fr', ['12100'])),
  metadata: over.metadata || {}
}, deps);

test('no rules / scoring / storage / network in the orchestrator', () => {
  assert.doesNotMatch(source, /Lenkzeit|1\/6|BV0|ArbZG|Fahrpersonal|Wendezeit|Blockpause|\bscore\b|fuzzy|distance|localStorage|fetch\s*\(/i);
});

test('the controller status vocabulary is distinct from the frozen match status', () => {
  const r = run();
  assert.ok(['idle', 'blocked', 'completed', 'failed'].includes(r.status));
});

// ===== Gates 1–4 =====
test('no bundle → not attempted, blocked', () => {
  const r = run({ bundle: null });
  assert.equal(r.attempted, false);
  assert.equal(r.matchResult, null);
});
test('a non-exact bundle → blocked BUNDLE_NOT_EXACT (no matcher)', () => {
  for (const compat of ['conflicting', 'unsupported', 'probable']) {
    const r = run({ bundle: bundle(compat) });
    assert.equal(r.attempted, false, compat);
    assert.equal(r.reason, 'BUNDLE_NOT_EXACT', compat);
    assert.equal(r.matchResult, null);
  }
});
test('a wrong primary or companion document type → blocked INVALID_DOCUMENT_PAIR', () => {
  assert.equal(run({ bundle: bundle('exact', 'jes_schedule_pdf', 'umlaufkarte') }).reason, 'INVALID_DOCUMENT_PAIR');
  assert.equal(run({ bundle: bundle('exact', 'jnv_schedule_pdf', 'wagenkarte') }).reason, 'INVALID_DOCUMENT_PAIR');
});

// ===== Gates 5–6 =====
test('a missing CanonicalSchedule → blocked MISSING_CANONICAL_SCHEDULE', () => {
  assert.equal(run({ primaryImport: { detection: { title: TITLE } } }).reason, 'MISSING_CANONICAL_SCHEDULE');
});
test('a missing Umlauftafel document → blocked MISSING_UMLAUFTAFEL_DOCUMENT', () => {
  assert.equal(run({ companionImport: { classification: { type: 'umlaufkarte' }, document: null } }).reason, 'MISSING_UMLAUFTAFEL_DOCUMENT');
});

// ===== Gate 7: validity must be exact =====
test('non-exact validity (unknown / probable / ambiguous) → blocked VALIDITY_NOT_EXACT, no match', () => {
  const unknownP = primaryImport(['12100'], null); // no title
  assert.equal(run({ primaryImport: unknownP }).reason, 'VALIDITY_NOT_EXACT');
  const probable = run({ primaryImport: { ...unknownP }, metadata: { sourceName: 'B_MoFr_Schule.pdf' } }); // filename only → probable
  assert.equal(probable.reason, 'VALIDITY_NOT_EXACT');
  const ambiguous = run({ primaryImport: primaryImport(['12100'], 'Stadtbus (Schule)'), metadata: { sourceName: 'X_Ferien.pdf' } });
  assert.equal(ambiguous.reason, 'VALIDITY_NOT_EXACT');
  for (const r of [run({ primaryImport: unknownP }), probable, ambiguous]) { assert.equal(r.attempted, false); assert.equal(r.matchResult, null); }
});

// ===== Gates 8–9 (injected to force the branch) =====
test('an invalid schedule match view → blocked INVALID_SCHEDULE_MATCH_VIEW', () => {
  const r = run({}, { validateView: () => ({ valid: false, errors: [{ code: 'X', path: 'y' }] }) });
  assert.equal(r.reason, 'INVALID_SCHEDULE_MATCH_VIEW');
  assert.equal(r.matchResult, null);
});
test('an invalid match input → blocked INVALID_JNV_MATCH_INPUT', () => {
  const r = run({}, { validateInput: () => ({ valid: false, errors: [{ code: 'X', path: 'y' }] }) });
  assert.equal(r.reason, 'INVALID_JNV_MATCH_INPUT');
});

// ===== full path with the real frozen matcher =====
test('all gates pass → matchJnvBundle runs exactly once, status completed, exact match', () => {
  let calls = 0;
  const r = run({}, { runMatch: (args) => { calls += 1; return { status: 'exact', matches: [], warnings: [], statistics: {} }; } });
  assert.equal(r.attempted, true);
  assert.equal(r.status, 'completed');
  assert.equal(r.matchResult.status, 'exact');
  assert.equal(calls, 1, 'the matcher is invoked exactly once');
  assert.equal(r.validity.confidence, 'exact');
});
test('the real frozen matcher yields exact for a matching Umlauf and conflicting for a regime mismatch', () => {
  assert.equal(run().matchResult.status, 'exact'); // school/mo_fr both sides, code 12100
  assert.equal(run({ companionImport: companionImport(umlDoc('holidays', 'mo_fr', ['12100'])) }).matchResult.status, 'conflicting');
  assert.equal(run({ companionImport: companionImport(umlDoc('school', 'mo_fr', ['99999'])) }).matchResult.status, 'unmatched');
});

test('an unexpected matcher error is isolated (status failed, no throw)', () => {
  let r;
  assert.doesNotThrow(() => { r = run({}, { runMatch: () => { throw new Error('boom'); } }); });
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, 'JNV_MATCHING_FAILED');
  assert.equal(r.matchResult, null);
});

test('the orchestrator output is JSON-compatible, deterministic, and does not mutate inputs', () => {
  const input = { bundle: bundle(), primaryImport: primaryImport(['12100']), companionImport: companionImport(umlDoc('school', 'mo_fr', ['12100'])), metadata: {} };
  const snap = JSON.stringify(input);
  const a = runJnvStructuralMatching(input);
  const b = runJnvStructuralMatching(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snap);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
  assert.deepEqual(Object.keys(a).sort(), ['attempted', 'matchResult', 'reason', 'scheduleViewValid', 'status', 'validity', 'warnings']);
});
