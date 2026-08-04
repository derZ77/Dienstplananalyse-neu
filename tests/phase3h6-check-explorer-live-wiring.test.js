import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3H.6 – the PRODUCTIVE session CheckReport reaches the EXISTING explorer through the
// bridge: real orchestrator → real CheckReport → bridge → real explorer presentation model.
import { createCheckExplorerSessionBridge } from '../js/v2/explorer/check-explorer-session-bridge.js';
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';
import { runJnvRuleAnalysis } from '../js/v2/analysis/jnv-rule-analysis-controller.js';
import { createCheckExplorerModel } from '../js/v2/ui/check-explorer.js';
import { createUmlauftafelDocument, createValidity, createCirculation } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');

test('the productive bootstrap publishes the session CheckReport through the bridge', () => {
  assert.match(bootstrap, /check-explorer-session-bridge/);
  assert.match(bootstrap, /createCheckExplorerSessionBridge/);
  assert.match(bootstrap, /setCheckReport/);
});
test('the productive bootstrap creates no second explorer controller and no second rule analysis', () => {
  assert.doesNotMatch(bootstrap, /createCheckExplorerController|createReviewDashboardController/);
  assert.equal((bootstrap.match(/analyzeRules\(\)/g) || []).length, 1, 'exactly one analyzeRules() call site');
  assert.doesNotMatch(bootstrap, /evaluateDrivingTimeLimit|createDrivingTimeLimitCheck|runCheckModules/);
});

// ===== synthetic productive end-to-end: session → bridge → explorer model =====
const dutyAct = (o) => ({
  serviceNumber: o.svc, circuitNumber: o.code,
  routeIdentity: { line: o.line, course: o.course ?? null, trip: null, kind: 'LINE_COURSE' },
  departureTime: { value: '—', minutesSinceStartOfDay: o.depMin, dayOffset: 0 },
  arrivalTime: { value: '—', minutesSinceStartOfDay: o.arrMin, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'pdf' }
});
const realSchedule = (driveMinutes) => ({ hardened: { applied: true, services: [{ serviceNumber: '2101', dutyActivities: [
  dutyAct({ svc: '2101', code: '12100', line: '12', course: '1', depMin: 300, arrMin: 300 + driveMinutes })
] }] }, document: { sourceType: 'pdf' } });
const umlDoc = () => createUmlauftafelDocument({ mode: 'bus', validity: createValidity({ serviceRegime: 'school', dayType: 'mo_fr' }), circulations: [createCirculation({ code: '12100', mode: 'bus' })] });
const exactMatching = () => ({ attempted: true, status: 'completed', reason: null, matchResult: { status: 'exact', warnings: [], statistics: { umlauftafelCirculationCount: 1, exact: 1 }, matches: [{ type: 'MatchResult', status: 'exact', reasons: ['EXACT_UMLAUF_CODE'], conflicts: [], primaryRefs: ['12100'], companionRefs: ['12100'] }] }, warnings: [] });

function fakeExplorer() {
  const state = { report: null, sets: 0, clears: 0 };
  return {
    state,
    controller: {
      setCheckReport(next) { state.report = next; state.sets += 1; },
      clear() { state.report = null; state.clears += 1; }
    }
  };
}
function productiveSession(driveMinutes) {
  return createMultiDocumentSession({
    importCompanion: () => Promise.resolve({ classification: { type: 'umlaufkarte', confidence: 'exact' }, document: umlDoc() }),
    buildBundle: () => ({ compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } }),
    runMatching: exactMatching,
    runRuleAnalysis: runJnvRuleAnalysis,
    generateBundleId: () => 'b', generateTimestamp: () => '2026-08-01T00:00:00Z'
  });
}
async function driveSession(session, explorerBridge, driveMinutes) {
  session.setPrimaryResult({ canonicalSchedule: realSchedule(driveMinutes) }, { name: 'p.pdf' });
  await session.setCompanionFile({ name: 'c.xlsx' });
  const state = await session.analyzeRules();
  explorerBridge.setCheckReport(state.checkReport);
  return state;
}

test('a productive FAIL run makes the BV008 CheckResult visible in the existing explorer model', async () => {
  const explorer = fakeExplorer();
  const bridge = createCheckExplorerSessionBridge({ explorerController: explorer.controller });
  const state = await driveSession(productiveSession(300), bridge, 300);

  assert.equal(explorer.state.report, state.checkReport, 'the very session CheckReport reached the explorer');
  const model = createCheckExplorerModel(explorer.state.report, {});
  assert.equal(model.checkReportAvailable, true);
  const row = model.rows.find(r => r.id === 'BV008');
  assert.ok(row, 'BV008 row is visible');
  assert.equal(row.status, 'FAIL');
  assert.equal(row.severity, 'VIOLATION');
  assert.equal(row.category, 'BV');
  assert.equal(model.statistics.violation, 1);
});

test('a productive PASS run makes the BV008 CheckResult visible as PASS/INFO', async () => {
  const explorer = fakeExplorer();
  const bridge = createCheckExplorerSessionBridge({ explorerController: explorer.controller });
  await driveSession(productiveSession(80), bridge, 80);
  const model = createCheckExplorerModel(explorer.state.report, {});
  const row = model.rows.find(r => r.id === 'BV008');
  assert.equal(row.status, 'PASS');
  assert.equal(row.severity, 'INFO');
  assert.equal(model.statistics.pass, 1);
  assert.equal(model.statistics.violation, 0);
});

test('BV008 is findable through the existing generic filters and search (no special filter)', async () => {
  const explorer = fakeExplorer();
  const bridge = createCheckExplorerSessionBridge({ explorerController: explorer.controller });
  await driveSession(productiveSession(300), bridge, 300);
  const byStatus = createCheckExplorerModel(explorer.state.report, { status: 'FAIL' });
  const bySeverity = createCheckExplorerModel(explorer.state.report, { severity: 'VIOLATION' });
  const byId = createCheckExplorerModel(explorer.state.report, { checkId: 'bv008' });
  const bySearch = createCheckExplorerModel(explorer.state.report, { search: 'bv008' });
  const mismatch = createCheckExplorerModel(explorer.state.report, { status: 'PASS' });
  for (const m of [byStatus, bySeverity, byId, bySearch]) assert.equal(m.rows.length, 1);
  assert.equal(mismatch.rows.length, 0);
});

test('a document reset clears the explorer and a new run updates it', async () => {
  const explorer = fakeExplorer();
  const bridge = createCheckExplorerSessionBridge({ explorerController: explorer.controller });
  const session = productiveSession(300);
  await driveSession(session, bridge, 300);
  assert.ok(explorer.state.report);

  const removed = await session.setCompanionFile(null);   // reset
  bridge.setCheckReport(removed.checkReport);
  assert.equal(explorer.state.report, null, 'explorer cleared on reset');

  session.setPrimaryResult({ canonicalSchedule: realSchedule(80) }, { name: 'p2.pdf' });
  await session.setCompanionFile({ name: 'c2.xlsx' });
  const again = await session.analyzeRules();
  bridge.setCheckReport(again.checkReport);
  assert.equal(explorer.state.report, again.checkReport, 'explorer updated by the new run');
});

test('an unchanged report does not re-render the explorer', async () => {
  const explorer = fakeExplorer();
  const bridge = createCheckExplorerSessionBridge({ explorerController: explorer.controller });
  const session = productiveSession(80);
  const state = await driveSession(session, bridge, 80);
  bridge.setCheckReport(state.checkReport);        // same reference again (e.g. a repeated render)
  bridge.setCheckReport(state.checkReport);
  assert.equal(explorer.state.sets, 1);
});

// ===== honest real pipeline: no CheckReport, explorer stays empty =====
globalThis.DOMMatrix ||= class DOMMatrix {};
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

test('the real reference pair produces no CheckReport, so the explorer stays in its empty state', async (t) => {
  const PDF = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
  const XLSX_PATH = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
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
  const analysis = await runJnvRuleAnalysis({ bundle, primaryImport, companionImport, matching });

  assert.equal(analysis.checkReport, null, 'Schule vs. Ferien yields no CheckReport (no forced exact)');
  const explorer = fakeExplorer();
  const bridge = createCheckExplorerSessionBridge({ explorerController: explorer.controller });
  bridge.setCheckReport(analysis.checkReport);
  assert.equal(explorer.state.report, null);
  const model = createCheckExplorerModel(explorer.state.report, {});
  assert.equal(model.checkReportAvailable, false);
  assert.equal(model.rows.length, 0);
});
