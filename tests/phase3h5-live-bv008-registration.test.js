import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3H.5 – the PRODUCTIVE path reaches createDrivingTimeLimitCheck + runCheckModules and the
// resulting CheckReport lands in the session flow. The UI never calls the rule logic directly.
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';
import { runJnvRuleAnalysis } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');

test('the productive bootstrap triggers the rule analysis but never imports the rule logic directly', () => {
  assert.match(bootstrap, /analyzeRules/);
  assert.doesNotMatch(bootstrap, /evaluateDrivingTimeLimit|createDrivingTimeLimitCheck|runCheckModules|mapDrivingTimeEvaluationToCheckResult/);
});

// ===== synthetic exact end-to-end THROUGH THE SESSION (real orchestrator, real check chain) =====
const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: o.line, course: o.course ?? null, trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: o.depMin, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: o.arrMin, dayOffset: 0 },
  dutyKind: o.dutyKind ?? 'serviceDrive', source: { sourceType: 'pdf' }
});
const realSchedule = (driveMinutes) => ({ hardened: { applied: true, services: [{ serviceNumber: '2101', dutyActivities: [
  dutyAct({ svc: '2101', code: '12100', line: '12', course: '1', depMin: 300, arrMin: 300 + driveMinutes })
] }] }, document: { sourceType: 'pdf' } });
const umlDoc = () => createUmlauftafelDocument({ mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }), circulations: [createCirculation({ code: '12100', mode: 'bus' })] });
const exactMatching = () => ({ attempted: true, status: 'completed', reason: null, matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: ['12100'], companionRefs: ['12100'] }] }, warnings: [] });

function syntheticSession(driveMinutes) {
  return createMultiDocumentSession({
    importCompanion: () => Promise.resolve({ classification: { type: 'umlaufkarte', confidence: 'exact' }, document: umlDoc() }),
    buildBundle: () => ({ compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } }),
    runMatching: exactMatching,
    runRuleAnalysis: runJnvRuleAnalysis, // the REAL orchestrator (default), exercised end-to-end
    generateBundleId: () => 'b', generateTimestamp: () => '2026-08-01T00:00:00Z'
  });
}

test('a synthetic exact bundle drives the real chain into a real BV008 CheckReport (PASS)', async () => {
  const session = syntheticSession(80);
  session.setPrimaryResult({ canonicalSchedule: realSchedule(80) }, { name: 'p.pdf' });
  await session.setCompanionFile({ name: 'c.xlsx' });
  const state = await session.analyzeRules();
  assert.equal(state.ruleAnalysis.status, 'completed');
  assert.equal(state.checkReport.type, 'CheckReport');
  assert.equal(state.checkReport.results[0].id, 'BV008');
  assert.equal(state.checkReport.results[0].status, 'PASS');
});

test('a synthetic exact bundle with >270 continuous driving drives the real chain into a FAIL CheckReport', async () => {
  const session = syntheticSession(300);
  session.setPrimaryResult({ canonicalSchedule: realSchedule(300) }, { name: 'p.pdf' });
  await session.setCompanionFile({ name: 'c.xlsx' });
  const state = await session.analyzeRules();
  assert.equal(state.checkReport.results[0].status, 'FAIL');
  assert.equal(state.checkReport.results[0].severity, 'VIOLATION');
  assert.equal(state.checkReport.summary.hitCount, 1);
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

test('the real reference pair flows honestly into the orchestrator and stays NOT applicable (no forced exact)', async (t) => {
  const PDF = FIXTURES.jnvSchedulePdf;
  const XLSX_PATH = FIXTURES.busUmlauftafelXlsx;
  const present = async (p) => { try { await access(p); return true; } catch { return false; } };
  if (!(xlsxReady && (await present(PDF)) && (await present(XLSX_PATH)))) return t.skip('real references / XLSX not available');

  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const { createBundleFromImports } = await import('../js/v2/import/analysis-bundle-controller.js');
  const { runJnvStructuralMatching } = await import('../js/v2/matching/jnv-matching-controller.js');

  const fileOf = (p, type) => ({ name: p.split('/').pop(), type, arrayBuffer: async () => new Uint8Array(readFileSync(p)).buffer.slice(0) });
  const primaryImport = await analyzePdfImport(fileOf(PDF, 'application/pdf'));
  const companionImport = await analyzeExcelImport(fileOf(XLSX_PATH, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const bundle = createBundleFromImports({ id: 'real', createdAt: '2026-08-01T00:00:00Z', primaryImport, companionImport });
  const matching = runJnvStructuralMatching({ bundle, primaryImport, companionImport, metadata: { sourceName: 'B_20260817_MoFr_Schule.pdf' } });

  let result;
  await assert.doesNotReject(async () => { result = await runJnvRuleAnalysis({ bundle, primaryImport, companionImport, matching }); });
  // Schule schedule vs. Ferien Umlauftafel → not an exact driving base → no BV008 run, no CheckReport.
  assert.ok(['not_applicable', 'blocked'].includes(result.status));
  assert.equal(result.checkReport, null);
});
