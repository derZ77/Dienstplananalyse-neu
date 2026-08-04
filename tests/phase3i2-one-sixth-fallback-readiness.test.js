import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';

// Phase 3I.2 – the fallback candidate contract and the re-assessed data readiness. The candidate
// signal may select a data path and mark a duty as worth checking; it must never be a verdict.
import {
  createOneSixthCandidate,
  validateOneSixthCandidate,
  CANDIDATE_STATUSES,
  CANDIDATE_SOURCES,
  CANDIDATE_EVIDENCE
} from '../js/v2/rules/one-sixth-candidate-contract.js';

const src = readFileSync(new URL('../js/v2/rules/one-sixth-candidate-contract.js', import.meta.url), 'utf8');

// ===== the candidate vocabulary is closed and verdict-free =====
test('the candidate vocabulary is exactly probable / not_indicated / inconclusive', () => {
  assert.deepEqual([...CANDIDATE_STATUSES].sort(), ['inconclusive', 'not_indicated', 'probable']);
});
test('the candidate contract knows no verdict vocabulary and evaluates nothing', () => {
  // NB: the literal "1/6" appears in the module title; the guard targets verdict and arithmetic tokens.
  assert.doesNotMatch(src, /\bPASS\b|\bFAIL\b|VIOLATION|hitCount|drivingMinutes|plannedDriving|divide|Math\./);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest/);
});
test('the source priority vocabulary carries the Umlauftafel first and a schedule fallback', () => {
  assert.ok(CANDIDATE_SOURCES.includes('umlauftafel'));
  assert.ok(CANDIDATE_SOURCES.includes('schedule_structured'));
  assert.ok(CANDIDATE_SOURCES.includes('schedule_fallback'));
});
test('the two documented indicators are the only evidence values', () => {
  assert.deepEqual([...CANDIDATE_EVIDENCE].sort(), ['NO_EXPLICIT_BLOCK_PAUSE', 'PAID_TIME_EQUALS_DUTY_TIME']);
});

// ===== candidate factory =====
test('an indicator-backed fallback yields probable, not a verdict', () => {
  const candidate = createOneSixthCandidate({ status: 'probable', source: 'schedule_fallback', evidence: ['PAID_TIME_EQUALS_DUTY_TIME'] });
  assert.equal(candidate.status, 'probable');
  assert.equal(candidate.source, 'schedule_fallback');
  assert.deepEqual(candidate.evidence, ['PAID_TIME_EQUALS_DUTY_TIME']);
  assert.deepEqual(Object.keys(candidate).sort(), ['evidence', 'source', 'status', 'warnings']);
});
test('an unprovable block-pause absence must collapse to inconclusive, never probable', () => {
  const candidate = createOneSixthCandidate({ status: 'inconclusive', source: 'schedule_fallback', warnings: ['BLOCK_PAUSE_ABSENCE_NOT_PROVABLE'] });
  assert.equal(candidate.status, 'inconclusive');
  assert.ok(candidate.warnings.includes('BLOCK_PAUSE_ABSENCE_NOT_PROVABLE'));
});
test('unknown status, source, evidence or warnings are dropped instead of invented', () => {
  const candidate = createOneSixthCandidate({ status: 'PASS', source: 'guess', evidence: ['MADE_UP'], warnings: ['NONSENSE'] });
  assert.equal(candidate.status, 'inconclusive');
  assert.equal(candidate.source, 'none');
  assert.deepEqual(candidate.evidence, []);
  assert.deepEqual(candidate.warnings, []);
});
test('the validator accepts a well-formed candidate and rejects foreign vocabulary', () => {
  assert.deepEqual(validateOneSixthCandidate(createOneSixthCandidate({ status: 'not_indicated', source: 'umlauftafel' })), { valid: true, errors: [] });
  assert.equal(validateOneSixthCandidate({ status: 'FAIL', source: 'umlauftafel', evidence: [], warnings: [] }).valid, false);
  assert.equal(validateOneSixthCandidate(null).valid, false);
});

// ===== readiness re-assessment is pinned to the audit =====
const AUDIT = new URL('../PHASE-3I.2-JNV-1-6-FACHVERTRAGSKORREKTUR-FALLBACKSTRATEGIE.md', import.meta.url);
test('the audit records an honest overall status that is not READY', () => {
  const doc = readFileSync(AUDIT, 'utf8');
  assert.match(doc, /PARTIALLY_READY|NOT_READY/);
  assert.doesNotMatch(doc, /Gesamtstatus:\s*\*{0,2}READY\b/);
});
// PHASE 3I.2b: the crediting variant is decided; the audit must state the closed rule, not an open A/B.
test('the audit documents the block-pause limitation and the DECIDED crediting rule', () => {
  const doc = readFileSync(AUDIT, 'utf8');
  for (const token of ['Blockpause', 'activityType', 'full_observed_span']) assert.match(doc, new RegExp(token));
  assert.match(doc, /11\s*→\s*11/);
  assert.match(doc, /15\s*→\s*15/);
  assert.doesNotMatch(doc, /Variante A|Variante B|Spanne\s*−\s*1|Spanne minus/i, 'no superseded variant wording');
});

// ===== real-schedule readiness probe (honest, skips when unavailable) =====
test('the real JNV schedule provides duty span and paid time but NO activity classification', async (t) => {
  const PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
  const present = async (p) => { try { await access(p); return true; } catch { return false; } };
  if (!(await present(PDF))) return t.skip('real JNV schedule not available');
  globalThis.DOMMatrix ||= class DOMMatrix {};

  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const fileOf = (p, type) => ({ name: p.split('/').pop(), type, arrayBuffer: async () => new Uint8Array(readFileSync(p)).buffer.slice(0) });
  const schedule = (await analyzePdfImport(fileOf(PDF, 'application/pdf'))).canonicalSchedule;
  const services = schedule.services || [];

  assert.ok(services.length > 0);
  assert.ok(services.every(s => Number.isInteger(s.paidTime?.minutes)), 'paid time is available for every duty');
  assert.ok(services.every(s => Number.isInteger(s.begin?.minutesSinceStartOfDay) && Number.isInteger(s.end?.minutesSinceStartOfDay)), 'duty begin/end are available');
  // the blocking finding: activities are never classified, so a MISSING block pause is unprovable
  const classified = (schedule.activities || []).filter(a => a.activityType);
  assert.equal(classified.length, 0, 'the JNV pipeline classifies no activity type today');
});
