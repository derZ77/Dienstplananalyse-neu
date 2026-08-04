import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3G.1 – productive JNV bundle matcher. Pure STRUCTURAL correspondence only:
// Level 1 regime+dayType (else conflicting), Level 2 exact-string Umlauf code (no
// normalization), Level 3 consistency → warnings only. No rules, no analysis, no scoring.
import { matchJnvBundle, buildScheduleMatchView } from '../js/v2/matching/jnv-bundle-matcher.js';
import { validateJnvMatchInput } from '../js/v2/matching/jnv-match-validation.js';
import { createUmlauftafelDocument, createValidity, createCirculation, createSegment, DAY_TYPES, SERVICE_REGIMES } from '../js/v2/umlauftafel/umlauftafel-contract.js';
import { MATCH_STATUSES } from '../js/v2/matching/match-contract.js';

const matcherSource = readFileSync(new URL('../js/v2/matching/jnv-bundle-matcher.js', import.meta.url), 'utf8');

const umlauftafel = (regime, dayType, codes) => createUmlauftafelDocument({
  mode: 'bus',
  validity: createValidity({ serviceRegime: regime, dayType }),
  circulations: codes.map((c, i) => (typeof c === 'string'
    ? createCirculation({ code: c, mode: 'bus', sequence: i + 1 })
    : createCirculation({ code: c.code, mode: 'bus', sequence: i + 1, segments: (c.segments || []).map(createSegment) })))
});
const scheduleView = (regime, dayType, umlaeufe) => ({ serviceRegime: regime, dayType, umlaeufe: umlaeufe.map(u => (typeof u === 'string' ? { code: u } : u)) });
const exactBundle = () => ({ compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf', role: 'primary' }, companion: { documentType: 'umlaufkarte', role: 'companion' } });

// ===== structural hygiene: no rules / scoring / analysis =====
test('the matcher contains no rule engine, driving time, 1/6, scoring, or heuristics', () => {
  assert.doesNotMatch(matcherSource, /Lenkzeit|drivingTime|1\/6|oneSixth|ArbZG|BV0|distance|fuzzy|Math\.random|score\s*[:=]\s*[0-9]/i);
});

// ===== Level 1 =====
test('matching regime + dayType with a bijective Umlauf set → exact', () => {
  const r = matchJnvBundle({ bundle: exactBundle(), schedule: scheduleView('holidays', 'mo_fr', ['12100', '12200']), umlauftafel: umlauftafel('holidays', 'mo_fr', ['12100', '12200']) });
  assert.equal(r.status, MATCH_STATUSES.EXACT);
  assert.equal(r.matches.length, 2);
  assert.ok(r.matches.every(m => m.status === 'exact'));
  assert.equal(r.statistics.exact, 2);
});

test('a wrong service regime (holiday vs school) → conflicting, no matches', () => {
  const r = matchJnvBundle({ schedule: scheduleView('school', 'mo_fr', ['12100']), umlauftafel: umlauftafel('holidays', 'mo_fr', ['12100']) });
  assert.equal(r.status, MATCH_STATUSES.CONFLICTING);
  assert.equal(r.matches.length, 0);
  assert.ok(r.warnings.some(w => /REGIME/.test(w.code)));
});

test('a wrong day type → conflicting', () => {
  const r = matchJnvBundle({ schedule: scheduleView('holidays', 'saturday', ['12100']), umlauftafel: umlauftafel('holidays', 'mo_fr', ['12100']) });
  assert.equal(r.status, MATCH_STATUSES.CONFLICTING);
  assert.ok(r.warnings.some(w => /DAY_?TYPE/.test(w.code)));
});

// ===== Level 2 =====
test('a matching single Umlauf → exact', () => {
  const r = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', ['12100']), umlauftafel: umlauftafel('regular', 'mo_fr', ['12100']) });
  assert.equal(r.status, MATCH_STATUSES.EXACT);
});

test('a schedule Umlauf missing from the Umlauftafel → unmatched', () => {
  const r = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', ['12100', '12200']), umlauftafel: umlauftafel('regular', 'mo_fr', ['12100']) });
  assert.equal(r.status, MATCH_STATUSES.UNMATCHED);
  assert.equal(r.matches.find(m => m.primaryRefs.includes('12200')).status, 'unmatched');
  assert.equal(r.statistics.unmatched, 1);
});

test('a duplicate Umlauf code in the Umlauftafel → ambiguous', () => {
  const r = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', ['12100']), umlauftafel: umlauftafel('regular', 'mo_fr', ['12100', '12100']) });
  assert.equal(r.status, MATCH_STATUSES.AMBIGUOUS);
  assert.ok(r.warnings.some(w => /DUPLICATE/.test(w.code)));
});

test('a code matching multiple circulations → ambiguous (never exact)', () => {
  const r = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', ['12100', '12200']), umlauftafel: umlauftafel('regular', 'mo_fr', ['12100', '12100', '12200']) });
  assert.equal(r.status, MATCH_STATUSES.AMBIGUOUS);
  assert.equal(r.matches.find(m => m.primaryRefs.includes('12100')).status, 'ambiguous');
});

test('Umlauf codes compare as EXACT strings — no normalization, leading zeros preserved', () => {
  const mismatch = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', ['0412']), umlauftafel: umlauftafel('regular', 'mo_fr', ['412']) });
  assert.equal(mismatch.matches[0].status, 'unmatched', '"0412" must not match "412"');
  const match = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', ['0412']), umlauftafel: umlauftafel('regular', 'mo_fr', ['0412']) });
  assert.equal(match.status, MATCH_STATUSES.EXACT);
});

// ===== Level 3 (consistency → warnings only, never creates/destroys an exact match) =====
test('an inconsistent line on a matching code raises a warning but keeps the code exact', () => {
  const uml = umlauftafel('regular', 'mo_fr', [{ code: '12100', segments: [{ line: '99' }] }]);
  const r = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', [{ code: '12100', line: '10' }]), umlauftafel: uml });
  assert.equal(r.status, MATCH_STATUSES.EXACT);
  assert.equal(r.matches[0].status, 'exact');
  assert.ok(r.warnings.some(w => /LINE|CONSISTENC/.test(w.code)));
});

// ===== invalid input / bundle guard =====
test('a non-exact bundle is rejected as conflicting (no matching performed)', () => {
  const r = matchJnvBundle({ bundle: { compatibility: { status: 'conflicting' }, primary: {}, companion: {} }, schedule: scheduleView('regular', 'mo_fr', ['12100']), umlauftafel: umlauftafel('regular', 'mo_fr', ['12100']) });
  assert.equal(r.status, MATCH_STATUSES.CONFLICTING);
  assert.ok(r.warnings.some(w => /BUNDLE/.test(w.code)));
});

test('missing schedule or Umlauftafel is handled controlled (conflicting, no throw)', () => {
  let r;
  assert.doesNotThrow(() => { r = matchJnvBundle({ schedule: null, umlauftafel: null }); });
  assert.equal(r.status, MATCH_STATUSES.CONFLICTING);
  assert.ok(Array.isArray(r.matches) && Array.isArray(r.warnings) && typeof r.statistics === 'object');
});

test('the output is a pure structural match object (no analysis fields)', () => {
  const r = matchJnvBundle({ schedule: scheduleView('regular', 'mo_fr', ['12100']), umlauftafel: umlauftafel('regular', 'mo_fr', ['12100']) });
  assert.deepEqual(Object.keys(r).sort(), ['matches', 'statistics', 'status', 'warnings']);
  for (const key of ['lenkzeit', 'drivingTime', 'score', 'recommendation', 'oneSixth', 'checks']) assert.ok(!(key in r));
});

// ===== validation =====
test('validateJnvMatchInput accepts a well-formed input and reports structured errors otherwise', () => {
  const ok = validateJnvMatchInput({ schedule: scheduleView('regular', 'mo_fr', ['12100']), umlauftafel: umlauftafel('regular', 'mo_fr', ['12100']) });
  assert.deepEqual(ok, { valid: true, errors: [] });
  const bad = validateJnvMatchInput({ schedule: null, umlauftafel: {} });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string'));
});

// ===== schedule view builder (structural extraction only) =====
test('buildScheduleMatchView extracts distinct Umlauf codes (exact strings) from a canonical schedule', () => {
  const canonical = { services: [
    { activities: [{ circuitNumber: '12100' }, { circuitNumber: '12100' }] },
    { activities: [{ circuitNumber: '0412' }, { circuitNumber: '' }] }
  ] };
  const view = buildScheduleMatchView(canonical, { serviceRegime: 'regular', dayType: 'mo_fr' });
  assert.equal(view.serviceRegime, 'regular');
  assert.deepEqual(view.umlaeufe.map(u => u.code).sort(), ['0412', '12100']);
});

// ===== real JNV reference (never skipped: falls back to a realistic synthetic doc) =====
test('the matcher runs on a real (or realistic) JNV Umlauftafel and yields a valid structured result', async () => {
  const BUS = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
  let circulations = umlauftafel('holidays', 'mo_fr', ['12100', '12200']).circulations;
  try {
    await access(BUS);
    const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
    createContext(sb);
    runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
    globalThis.XLSX = sb.XLSX;
    const { loadUmlauftafelDocumentFromXlsx } = await import('../js/v2/umlauftafel/xlsx-loader.js');
    const loaded = loadUmlauftafelDocumentFromXlsx(new Uint8Array(readFileSync(BUS)));
    if (loaded?.document?.circulations?.length) circulations = loaded.document.circulations;
  } catch { /* fall back to the synthetic realistic document */ }

  // Force a known, matching validity so Level 1 passes and Level 2 runs on the real codes.
  const umlDoc = createUmlauftafelDocument({ mode: 'bus', validity: createValidity({ serviceRegime: 'holidays', dayType: 'mo_fr' }), circulations });
  const codes = umlDoc.circulations.map(c => c.code).filter(Boolean);
  const view = { serviceRegime: 'holidays', dayType: 'mo_fr', umlaeufe: codes.map(code => ({ code })) };

  const r = matchJnvBundle({ schedule: view, umlauftafel: umlDoc });
  assert.ok(Object.values(MATCH_STATUSES).includes(r.status));
  assert.equal(r.matches.length, codes.length, 'Level 2 evaluated every real Umlauf code');
  assert.equal(r.statistics.umlauftafelCirculationCount, umlDoc.circulations.length);
});
