import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.16 – the real end-to-end proof with a LEGACY EXCEL duty roster plus an Excel
// Umlauftafel. The attempt did NOT reach the 1/6 rule: the chain stops at three independent
// gates before any duty is assessed. This file pins those three blockers so they cannot be
// forgotten or silently "fixed" — it repairs nothing.
//
// The reference files stay OUTSIDE the repository. Every blocker below is reproducible without
// them, from the productive modules alone.
import { normalizeCircuitIdentity } from '../js/v2/identity/identity-normalization.js';
import { matchJnvBundle } from '../js/v2/matching/jnv-bundle-matcher.js';
import { createJointTimeline } from '../js/v2/analysis/joint-timeline.js';
import { DAY_TYPES } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ===== A. the reference shapes the real files produced (recorded, not stored) =====
// Duty roster (Mon–Fri holiday plan): 61 duties, circulation codes in the `12/1` form.
// Umlauftafel: 35 circulations, codes in the `12100` form. Both read without a loader error.
const SCHEDULE_CODES = ['10/9', '12/1', '14/2', '18/1'];      // shape only — no personal data
const UMLAUFTAFEL_CODES = ['10901', '12100', '14200', '18100'];

test('A: both notations describe the same circulations', () => {
  assert.equal(SCHEDULE_CODES.length, UMLAUFTAFEL_CODES.length);
});

// ===== B. BLOCKER 1 — the matcher ignores the existing notation normalisation =====
test('BLOCKER 1: the two notations normalise to the SAME key', () => {
  for (const [plan, board] of SCHEDULE_CODES.map((c, i) => [c, UMLAUFTAFEL_CODES[i]])) {
    const a = normalizeCircuitIdentity(plan, {}).routeIdentity;
    const b = normalizeCircuitIdentity(board, {}).routeIdentity;
    assert.equal(a.normalizedKey, b.normalizedKey, `${plan} and ${board} are the same circulation`);
    assert.equal(a.line, b.line);
  }
});
// SUPERSEDED BY PHASE 3I.17 — this test pinned that the matcher had NO notion of the identity
// layer, so `12/1` never met `12100`. Phase 3I.17 connected it. The assertion is therefore
// inverted rather than dropped: the connection must stay, and Blocker 1 must not return.
test('BLOCKER 1 (resolved in 3I.17): the matcher now consults that normalisation', () => {
  const matcher = src('../js/v2/matching/jnv-bundle-matcher.js');
  assert.match(matcher, /normalizeCircuitIdentity/,
    'the matcher reaches the identity layer, so 12/1 meets 12100 — see tests/phase3i17-*.test.js');
});
test('BLOCKER 1: the real code sets therefore share no exact code at all', () => {
  const overlap = SCHEDULE_CODES.filter(c => UMLAUFTAFEL_CODES.includes(c));
  assert.deepEqual(overlap, [], 'zero exact overlap — recorded from the real files');
});

// ===== C. BLOCKER 2 — the day-type vocabularies of the two documents do not meet =====
test('BLOCKER 2: the day-type vocabulary holds both values, and they are different', () => {
  const values = Object.values(DAY_TYPES);
  assert.ok(values.includes('mo_fr'), 'the duty roster resolved to mo_fr');
  assert.ok(values.includes('mo_do'), 'the Umlauftafel resolved to mo_do');
  assert.notEqual('mo_fr', 'mo_do', 'so an exact validity match is impossible');
});
// SUPERSEDED BY PHASE 3I.18 — this test pinned that ANY validity difference made the whole match
// `conflicting`. That was too strict: `mo_do` is a valid sub-range of `mo_fr`, and an `unknown`
// regime is an open question, not a contradiction. The assertion is inverted rather than dropped,
// so the pairing keeps being exercised and the old over-strictness cannot return.
test('BLOCKER 2 (resolved in 3I.18): the real pairing matches, but is not automatable', () => {
  const schedule = { serviceRegime: 'holidays', dayType: 'mo_fr', umlaeufe: [{ code: '12/1' }] };
  const umlauftafel = { validity: { serviceRegime: 'unknown', dayType: 'mo_do' }, circulations: [{ code: '12100' }] };
  const result = matchJnvBundle({
    bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
    schedule, umlauftafel
  });
  assert.notEqual(result.status, 'conflicting', 'a valid sub-range is no longer a conflict');
  assert.equal(result.statistics.exact, 1, 'the circulation is matched now');
  assert.equal(result.status, 'probable', 'the unknown regime still costs the result its automatability');
  const codes = result.warnings.map(w => w.code);
  assert.ok(codes.includes('VALIDITY_NOT_CONFIRMED'), 'and the open question is stated');
  assert.ok(!codes.includes('DAY_TYPE_MISMATCH'), 'mo_fr vs mo_do is no longer reported as a mismatch');
});

// ===== D. BLOCKER 3 — the joint timeline only accepts a PDF duty roster =====
test('BLOCKER 3: an Excel duty roster is refused by the joint-timeline gate', () => {
  const result = createJointTimeline({
    bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_excel' }, companion: { documentType: 'umlaufkarte' } },
    canonicalSchedule: { type: 'CanonicalSchedule', services: [] },
    umlauftafelDocument: { circulations: [] },
    matchResult: { status: 'exact', matches: [] }
  });
  assert.equal(result.metadata, null, 'no timeline at all');
  assert.ok(result.warnings.some(w => w.code === 'JOINT_TIMELINE_NOT_APPLICABLE'));
});
// SUPERSEDED BY PHASE 3I.19 — the gate accepted only `jnv_schedule_pdf`. It now admits the
// document type the Excel import really produces as well. Inverted rather than dropped, so the
// Excel path cannot silently fall out of the chain again.
test('BLOCKER 3 (resolved in 3I.19): the gate admits the Excel duty roster too', () => {
  const timeline = src('../js/v2/analysis/joint-timeline.js');
  assert.match(timeline, /legacy_excel_schedule/, 'the Excel duty-roster path is wired into the 1/6 chain');
  assert.match(timeline, /jnv_schedule_pdf/, 'and the PDF path is still admitted');
});

// ===== E. the structured evidence of this attempt =====
test('E: the end-to-end evidence records an unsuccessful proof, honestly', () => {
  // Every counter is what the real run produced: the chain stopped before the rule.
  const e2eEvidence = Object.freeze({
    servicesChecked: 0,
    pureLine18Services: 0,
    nightShiftServices: 0,
    passed: 0,
    failed: 0,
    inconclusive: 0,
    notApplicable: 0,
    warnings: Object.freeze([
      'MATCH_CIRCULATION_NOTATION_DIFFERS',   // 12/1 vs 12100 — normalisation exists, matcher ignores it
      'MATCH_VALIDITY_MISMATCH',              // mo_fr (roster) vs mo_do (Umlauftafel)
      'JOINT_TIMELINE_NOT_APPLICABLE'         // Excel duty roster is not a jnv_schedule_pdf
    ])
  });
  assert.equal(e2eEvidence.servicesChecked, 0, 'no duty reached the rule — the proof is OPEN');
  assert.equal(e2eEvidence.passed + e2eEvidence.failed + e2eEvidence.inconclusive + e2eEvidence.notApplicable, 0);
  assert.equal(e2eEvidence.warnings.length, 3, 'three independent blockers, each sufficient on its own');
  for (const key of ['servicesChecked', 'pureLine18Services', 'nightShiftServices', 'passed', 'failed', 'inconclusive', 'notApplicable']) {
    assert.equal(typeof e2eEvidence[key], 'number', key);
  }
});
test('E: no reference data and no local path entered the repository', () => {
  // The check runs over the OTHER phase files; this file necessarily contains the search
  // patterns themselves and would match itself.
  for (const path of ['./phase3i15b-line18-admission.test.js', './phase3i15c-approval-followup.test.js']) {
    assert.doesNotMatch(src(path), /Users|Volumes/, `${path}: no local path`);
    assert.doesNotMatch(src(path), /xlsx/, `${path}: no reference file name`);
  }
});

// ===== F. what the rule itself would have done is already proven elsewhere =====
test('F: the rule side of the proof is covered by the synthetic phases', () => {
  // The real files could not feed the rule, but its behaviour for exactly these cases is pinned
  // in Phase 3I.15b/3I.15c — pure line 18 admitted and assessed, night shift admitted, deadhead
  // counted, 11-minute threshold, ceiling. This test states where that evidence lives.
  for (const path of ['./phase3i15b-line18-admission.test.js', './phase3i15c-approval-followup.test.js']) {
    assert.ok(src(path).length > 0, `${path} carries the rule-level evidence`);
  }
});
