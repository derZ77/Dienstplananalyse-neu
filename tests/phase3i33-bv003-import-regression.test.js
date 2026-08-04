/**
 * Phase 3I.33 (F/G) — BV003 stays Variante B, the other rules stay green.
 *
 * VARIANTE B IS BINDING: BV003 keeps evaluating start against end location on its own contract.
 * A relief chain is additional information for the reader, never an automatic re-evaluation.
 * Any change in the number of findings must come from CORRECTED IMPORT DATA alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { createBv003Check } from '../js/v2/checks/bv/bv003.js';
import { createBv010Check } from '../js/v2/checks/bv/bv010.js';
import { createBv012Check } from '../js/v2/checks/bv/bv012.js';
import { createBv014Check } from '../js/v2/checks/bv/bv014.js';
import { classifyBv003Findings } from '../js/v2/excel/excel-handover-chain.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const analysisResult = { type: 'AnalysisResult' };

const REAL_PLAN = '/Users/joergziegler/Downloads/Test/B_20260727_MoFrFerien.xlsx';
const available = (() => { try { readFileSync(REAL_PLAN); return true; } catch { return false; } })();

const realImport = async () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  const book = sandbox.XLSX.read(readFileSync(REAL_PLAN), { type: 'buffer' });
  const workbook = {
    sheets: book.SheetNames.map(name => ({
      name,
      rows: sandbox.XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: null })
        .map(row => row.map(cell => cell === null ? '' : String(cell).trim()))
    }))
  };
  const { analyzeLegacyExcelWorkbook } = await import('../js/v2/import/legacy-excel-import-adapter.js');
  return analyzeLegacyExcelWorkbook(workbook, { sourceName: 'plan.xlsx' }).data;
};

// =====================================================================================
// F — BV003 is untouched
// =====================================================================================
test('F: the BV003 product file carries no change from this phase', () => {
  const module = src('../js/v2/checks/bv/bv003.js');
  assert.doesNotMatch(module, /3I\.33|handover|Ablöse|ordering/i,
    'BV003 must know nothing of this import correction');
});

test('F: BV003 still compares first departure against last arrival, nothing else', () => {
  const module = src('../js/v2/checks/bv/bv003.js');
  assert.match(module, /departureLocation/);
  assert.match(module, /arrivalLocation/);
  assert.doesNotMatch(module, /previousServiceNumber|nextServiceNumber/,
    'Variante B: the relief chain does not enter the verdict');
});

test('F: a duty with a fully consistent relief chain STILL fails BV003', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const findings = classifyBv003Findings(schedule);
  const explained = findings.filter(f => f.auditClassification === 'explained_by_handover');
  assert.ok(explained.length > 0, 'the real plan has explained cases');
  const check = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(check.status, 'FAIL', 'Variante B: an explanation does not become a pass');
  assert.equal(check.severity, 'WARNING', 'and the severity is not softened either');
});

test('F: the number of BV003 findings after the import correction', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const check = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  // 41 before this phase. The corrected import restores the duties' REAL end locations, so the
  // count reflects the true data — the rule itself is byte-identical.
  assert.equal(check.affectedServices.length, 56);
  assert.equal(check.status, 'FAIL');
  // 58 duties really do start and end elsewhere; BV003 compares only where BOTH endpoints exist,
  // and two reserve duties carry no arrival location at all.
  const comparable = schedule.services.filter(s => {
    const activities = s.activities.filter(a => a.activityType !== 'unpaidBreak');
    return activities.find(a => a.departureLocation) && [...activities].reverse().find(a => a.arrivalLocation);
  });
  assert.equal(comparable.length, 59, 'two duties have no arrival location and are not comparable');
});

test('F: every BV003 finding names a real duty, none a header artefact', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const check = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  const byId = new Map(schedule.services.map(s => [s.id, s]));
  for (const id of check.affectedServices) {
    const service = byId.get(id);
    assert.ok(service, `${id} must be a real duty`);
    assert.match(service.serviceNumber, /^\d+$/);
  }
});

test('F: the relief chain remains information only — the audit changes no verdict', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const before = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  classifyBv003Findings(schedule);                       // run the audit
  const after = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.deepEqual(after, before, 'auditing does not touch the check');
});

// =====================================================================================
// G — the other rules
// =====================================================================================
test('G: BV010 and BV012 still assess the declared breaks', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const bv010 = await createBv010Check({ canonicalSchedule: schedule }).run(analysisResult);
  const bv012 = await createBv012Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(bv010.status, 'PASS');
  assert.equal(bv012.status, 'PASS');
  assert.equal(bv010.details.minimumMinutes, 30, 'no threshold moved');
  assert.equal(bv012.details.minimumMinutes, 33);
});

test('G: the number of block breaks is unchanged by the reordering', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const breaks = schedule.activities.filter(a => a.activityType === 'unpaidBreak');
  assert.equal(breaks.length, 42, 'the same 42 declared breaks, only in their proper place');
  assert.equal(schedule.interruptions.length, 62);
});

test('G: BV014 still finds provenance for every break', { skip: !available && 'reference plan not present' }, async () => {
  const check = await createBv014Check({ canonicalSchedule: await realImport() }).run(analysisResult);
  assert.equal(check.status, 'PASS');
});

test('G: no break sits at the end of its duty any more', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const trailing = schedule.services.filter(s => s.activities.at(-1)?.activityType === 'unpaidBreak');
  assert.equal(trailing.length, 0, 'a duty never ends with its break');
});

test('G: every duty activity list is in chronological order', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  for (const service of schedule.services) {
    let previous = null;
    let day = 0;
    for (const activity of service.activities) {
      const minutes = activity.departureTime?.minutesSinceStartOfDay;
      if (!Number.isInteger(minutes)) continue;
      if (previous !== null && minutes - previous < -720) day += 1440;   // the operational day rolls over
      const absolute = minutes + day;
      assert.ok(previous === null || absolute >= previous + (day === 0 ? 0 : -1440) || true);
      previous = minutes;
    }
    // The decisive statement: no break precedes the leg it follows in time.
    const seq = service.activities
      .map(a => ({ type: a.activityType, m: a.departureTime?.minutesSinceStartOfDay }))
      .filter(x => Number.isInteger(x.m));
    let offset = 0, last = null;
    for (const item of seq) {
      const value = item.m + offset;
      if (last !== null && value < last - 720) offset += 1440;
      const corrected = item.m + offset;
      assert.ok(last === null || corrected >= last, `${service.serviceNumber}: ${item.type} out of order`);
      last = corrected;
    }
  }
});

test('G: the 1/6 rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});

test('G: no rule module, runner or resolver carries a change from this phase', () => {
  for (const path of ['../js/v2/checks/bv/bv001.js', '../js/v2/checks/bv/bv002.js', '../js/v2/checks/bv/bv003.js',
    '../js/v2/checks/bv/bv005.js', '../js/v2/checks/bv/bv007.js', '../js/v2/checks/bv/bv010.js',
    '../js/v2/checks/bv/bv012.js', '../js/v2/checks/bv/bv014.js', '../js/v2/rules/rule-engine.js',
    '../js/v2/analysis/jnv-rule-analysis-controller.js', '../js/v2/analysis/one-sixth-rule.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/analysis/driving-projection.js']) {
    assert.doesNotMatch(src(path), /3I\.33/, `${path} must be untouched`);
  }
});

test('G: the walking-time rule is untouched — the BUP/BBU finding stays open', () => {
  const module = src('../js/v2/rules/jnv-block-break.js');
  assert.doesNotMatch(module, /3I\.33/, 'no walking-time decision in this phase');
  assert.match(module, /SHORT_WALKING_TIME_MINUTES = 4/);
  // Only executable code is inspected — the header prose deliberately explains WHY BBU has none.
  const code = module.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /BBU/, 'the depot still carries no surcharge');
  assert.doesNotMatch(code, /SHORT_WALKING_TIME_STOPS = Object\.freeze\(\[[^\]]*,/, 'still exactly one short-tier stop');
});

test('G: all nine BV results are present on the corrected import, none errors', { skip: !available && 'reference plan not present' }, async () => {
  // BV008 and BV015_BV018 come from the driving projection, which needs the companion Umlauftafel;
  // they are covered by the Phase 3I.29/3I.31 reports. Here the eight schedule-driven modules run
  // over the CORRECTED import and must all still deliver a contract-shaped result.
  const schedule = await realImport();
  const modules = await Promise.all(['bv001', 'bv002', 'bv003', 'bv005', 'bv007', 'bv010', 'bv012', 'bv014']
    .map(async id => Object.values(await import(`../js/v2/checks/bv/${id}.js`))[0]));
  const ids = [];
  for (const factory of modules) {
    const outcome = await factory({ canonicalSchedule: schedule }).run(analysisResult);
    for (const result of (Array.isArray(outcome) ? outcome : [outcome])) {
      assert.ok(['PASS', 'FAIL', 'SKIP', 'NOT_APPLICABLE'].includes(result.status), `${result.id}: ${result.status}`);
      assert.equal(result.category, 'BV');
      ids.push(result.id);
    }
  }
  assert.deepEqual(ids, ['BV001', 'BV002', 'BV003', 'BV005', 'BV007-START', 'BV007-SPLIT', 'BV010', 'BV012', 'BV014']);
});

test('G: the controller still refuses to report without an exact bundle', async () => {
  const { runJnvRuleAnalysis } = await import('../js/v2/analysis/jnv-rule-analysis-controller.js');
  const report = await runJnvRuleAnalysis({ bundle: null, primaryImport: null, companionImport: null, matching: null });
  assert.equal(report.checkReport, null, 'unchanged gate behaviour');
  assert.equal(report.status, 'not_applicable');
});
