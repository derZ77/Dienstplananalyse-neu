import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3H.3 – config + evaluation validators for the 270-minute driving-time rule, plus an
// honest real-pipeline run (no forced exact). Structure only; no rule logic here.
import { validateDrivingTimeRuleConfig, validateDrivingTimeEvaluation } from '../js/v2/analysis/driving-time-limit-validation.js';
import { evaluateDrivingTimeLimit } from '../js/v2/analysis/driving-time-limit-rule.js';

const CONFIG_URL = new URL('../js/v2/rules/config/shared/driving-time-limit.v1.json', import.meta.url);
const CONFIG = { ruleId: 'BV008', enabled: true, maxContinuousDrivingMinutes: 270, qualifyingInterruption: { singleMinimumMinutes: 45, splitSequence: [15, 30] } };

// ===== config validator =====
test('the canonical shipped config file is valid and carries the confirmed BV008 parameters', () => {
  const cfg = JSON.parse(readFileSync(CONFIG_URL, 'utf8'));
  const v = validateDrivingTimeRuleConfig(cfg);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  assert.equal(cfg.ruleId, 'BV008');
  assert.equal(cfg.maxContinuousDrivingMinutes, 270);
  assert.equal(cfg.qualifyingInterruption.singleMinimumMinutes, 45);
  assert.deepEqual(cfg.qualifyingInterruption.splitSequence, [15, 30]);
});
test('a well-formed config validates', () => {
  assert.deepEqual(validateDrivingTimeRuleConfig(CONFIG), { valid: true, errors: [] });
});
test('a config validator rejects structural defects', () => {
  const bad = (o) => validateDrivingTimeRuleConfig({ ...CONFIG, ...o }).valid;
  assert.equal(validateDrivingTimeRuleConfig(null).valid, false);
  assert.equal(bad({ ruleId: '' }), false);
  assert.equal(bad({ enabled: 'yes' }), false);
  assert.equal(bad({ maxContinuousDrivingMinutes: 0 }), false);
  assert.equal(bad({ maxContinuousDrivingMinutes: -5 }), false);
  assert.equal(bad({ qualifyingInterruption: null }), false);
  assert.equal(bad({ qualifyingInterruption: { singleMinimumMinutes: 0, splitSequence: [15, 30] } }), false);
  assert.equal(bad({ qualifyingInterruption: { singleMinimumMinutes: 45, splitSequence: [15] } }), false);
  assert.equal(bad({ qualifyingInterruption: { singleMinimumMinutes: 45, splitSequence: [15, -1] } }), false);
});
test('the config validator does not mutate its input', () => {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  const snap = JSON.stringify(cfg);
  validateDrivingTimeRuleConfig(cfg);
  assert.equal(JSON.stringify(cfg), snap);
});

// ===== evaluation validator =====
const evalOf = (dur) => evaluateDrivingTimeLimit({
  drivingProjection: { metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: 1 },
    circulations: [{ code: '12100', drivingSegments: [{ serviceNumber: '2101', kind: 'service', startMinutes: 0, endMinutes: dur, durationMinutes: dur, source: { serviceNumber: '2101', activityIndex: 0, sourceType: 'pdf' } }], drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [], statistics: {}, warnings: [] }],
    warnings: [] },
  ruleConfig: CONFIG
});

test('a produced evaluation (PASS and FAIL) validates structurally', () => {
  assert.deepEqual(validateDrivingTimeEvaluation(evalOf(200)), { valid: true, errors: [] });
  assert.deepEqual(validateDrivingTimeEvaluation(evalOf(300)), { valid: true, errors: [] });
});
test('the evaluation validator rejects an out-of-vocabulary status', () => {
  const bad = { ...evalOf(200), status: 'MAYBE' };
  assert.equal(validateDrivingTimeEvaluation(bad).valid, false);
});
test('the evaluation validator rejects a violation carrying an unsafe source ref', () => {
  const ev = evalOf(300);
  ev.violations[0].sourceRefs = [{ serviceNumber: '2101', originalText: 'A/B 05:00 Depot' }];
  assert.equal(validateDrivingTimeEvaluation(ev).valid, false);
});
test('the evaluation validator rejects a missing ruleId or non-array circulations', () => {
  assert.equal(validateDrivingTimeEvaluation({ ...evalOf(200), ruleId: undefined }).valid, false);
  assert.equal(validateDrivingTimeEvaluation({ ...evalOf(200), circulations: null }).valid, false);
  assert.equal(validateDrivingTimeEvaluation(null).valid, false);
});

// ===== honest real pipeline (no forced exact) =====
globalThis.DOMMatrix ||= class DOMMatrix {};
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

test('the real pipeline flows honestly into the driving-time rule without a throw and yields a valid, in-vocabulary evaluation', async (t) => {
  const PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
  const XLSX_PATH = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
  const present = async (p) => { try { await access(p); return true; } catch { return false; } };
  if (!(xlsxReady && (await present(PDF)) && (await present(XLSX_PATH)))) return t.skip('real references / XLSX not available');

  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const { createBundleFromImports } = await import('../js/v2/import/analysis-bundle-controller.js');
  const { runJnvStructuralMatching } = await import('../js/v2/matching/jnv-matching-controller.js');
  const { createJointTimeline } = await import('../js/v2/analysis/joint-timeline.js');
  const { createDrivingProjection } = await import('../js/v2/analysis/driving-projection.js');

  const fileOf = (p, type) => ({ name: p.split('/').pop(), type, arrayBuffer: async () => new Uint8Array(readFileSync(p)).buffer.slice(0) });
  const primaryImport = await analyzePdfImport(fileOf(PDF, 'application/pdf'));
  const companionImport = await analyzeExcelImport(fileOf(XLSX_PATH, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const bundle = createBundleFromImports({ id: 'real', createdAt: '2026-08-01T00:00:00Z', primaryImport, companionImport });
  const matching = runJnvStructuralMatching({ bundle, primaryImport, companionImport, metadata: { sourceName: 'B_20260817_MoFr_Schule.pdf' } });

  const jointTimeline = createJointTimeline({ bundle, canonicalSchedule: primaryImport.canonicalSchedule, umlauftafelDocument: companionImport.document, matchResult: matching.matchResult });
  const drivingProjection = createDrivingProjection({ jointTimeline });

  let evaluation;
  await assert.doesNotReject(async () => { evaluation = evaluateDrivingTimeLimit({ drivingProjection, ruleConfig: CONFIG }); });
  assert.equal(validateDrivingTimeEvaluation(evaluation).valid, true);
  // Honest: the real reference pair (Schule schedule vs. Ferien Umlauftafel) is not an exact
  // driving base here → the rule is NOT_APPLICABLE. We never fabricate an exact result.
  assert.ok(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'DISABLED'].includes(evaluation.status));
  if (jointTimeline.metadata === null) assert.equal(evaluation.status, 'NOT_APPLICABLE');
});
