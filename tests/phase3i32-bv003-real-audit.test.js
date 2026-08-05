import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 3I.32 (E/F) — BV003 as it stands today, classified against the handover chain.
 *
 * BV003 is run UNCHANGED and its verdict is taken as it comes. Nothing is suppressed, no PASS or
 * FAIL is rewritten. The audit only says, for each of today's findings, whether the plan's own
 * handover chain explains it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { attachExcelHandoverData, classifyBv003Findings } from '../js/v2/excel/excel-handover-chain.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createBv003Check } from '../js/v2/checks/bv/bv003.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const analysisResult = { type: 'AnalysisResult' };

const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const leg = ({ nr = '', line = '10', uml = '10/1', ab, abOrt, an, anOrt, prev = '', next = '' }) =>
  ['', '', nr, line, uml, ab, abOrt, '', '', an, anOrt, '', prev, next, '', '', '', ''];
const build = (rows) => attachExcelHandoverData(adaptExcelRowsToCanonicalSchedule(rows));

// =====================================================================================
// E — the classification vocabulary, on constructed cases
// =====================================================================================
const CLASSIFICATIONS = new Set(['explained_by_handover', 'unexplained', 'inconclusive']);
const EVIDENCE = new Set(['consistent', 'partial', 'conflicting', 'missing']);

test('E: a confirmed handover explains a differing end location', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'BBU', prev: '2211' })
  ];
  const schedule = build(rows);
  const [finding] = classifyBv003Findings(schedule).filter(f => f.serviceNumber === '2211');
  assert.equal(finding.startLocation, 'BBU');
  assert.equal(finding.endLocation, 'TGR');
  assert.equal(finding.nextServiceNumber, '2229');
  assert.equal(finding.handoverEvidence, 'consistent');
  assert.equal(finding.auditClassification, 'explained_by_handover');
});

test('E: a differing end WITHOUT any chain stays unexplained', () => {
  const rows = [HEADER, leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR' })];
  const [finding] = classifyBv003Findings(build(rows));
  assert.equal(finding.handoverEvidence, 'missing');
  assert.equal(finding.auditClassification, 'unexplained');
});

test('E: a one-sided chain is inconclusive, never an explanation', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'BBU' })
  ];
  const [finding] = classifyBv003Findings(build(rows)).filter(f => f.serviceNumber === '2211');
  assert.equal(finding.handoverEvidence, 'partial');
  assert.equal(finding.auditClassification, 'inconclusive');
});

test('E: a missing end location is inconclusive, not a deviation', () => {
  const rows = [HEADER, leg({ nr: '2201', ab: '03:15', abOrt: 'BBU', an: '12:15', anOrt: '' })];
  const findings = classifyBv003Findings(build(rows));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].auditClassification, 'inconclusive');
  assert.equal(findings[0].endLocation, null, 'an unknown location is null, never an empty claim');
});

test('E: a duty that starts and ends alike produces no finding at all', () => {
  const rows = [HEADER, leg({ nr: '2201', ab: '03:15', abOrt: 'BBU', an: '12:15', anOrt: 'BBU' })];
  assert.deepEqual(classifyBv003Findings(build(rows)), []);
});

test('E: every audit object carries the agreed fields and vocabulary', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'BBU', prev: '2211' })
  ];
  for (const finding of classifyBv003Findings(build(rows))) {
    assert.deepEqual(Object.keys(finding).sort(), [
      'auditClassification', 'currentBv003Status', 'endLocation', 'handoverEvidence',
      'nextServiceNumber', 'previousServiceNumber', 'serviceNumber', 'startLocation'
    ]);
    assert.ok(CLASSIFICATIONS.has(finding.auditClassification));
    assert.ok(EVIDENCE.has(finding.handoverEvidence));
    assert.equal(finding.currentBv003Status, 'FAIL', 'the audit records what BV003 says TODAY');
  }
});

test('E: the audit matches what BV003 actually reports on the same schedule', async () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'TGR', prev: '2211' })
  ];
  const schedule = build(rows);
  const check = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  const findings = classifyBv003Findings(schedule);
  assert.equal(check.status, 'FAIL');
  assert.equal(check.affectedServices.length, findings.length,
    'the audit covers exactly the duties BV003 names');
});

// =====================================================================================
// F — no rule was changed
// =====================================================================================
test('F: BV003 still reports a differing pair as FAIL — nothing is suppressed', async () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'TGR', prev: '2211' })
  ];
  const check = await createBv003Check({ canonicalSchedule: build(rows) }).run(analysisResult);
  assert.equal(check.status, 'FAIL', 'a fully explained handover STILL fails today');
  assert.equal(check.severity, 'WARNING');
});

test('F: BV003 still passes a duty that returns to its starting point', async () => {
  const rows = [HEADER, leg({ nr: '2201', ab: '03:15', abOrt: 'BBU', an: '12:15', anOrt: 'BBU' })];
  const check = await createBv003Check({ canonicalSchedule: build(rows) }).run(analysisResult);
  assert.equal(check.status, 'PASS');
});

test('F: the BV003 product file carries no change from this phase', () => {
  const module = src('../js/v2/checks/bv/bv003.js');
  assert.doesNotMatch(module, /3I\.32|handover|Ablöse/i, 'BV003 must not know about the chain yet');
});

test('F: no other BV module and no runner carries a change from this phase', () => {
  for (const path of ['../js/v2/checks/bv/bv001.js', '../js/v2/checks/bv/bv002.js', '../js/v2/checks/bv/bv005.js',
    '../js/v2/checks/bv/bv007.js', '../js/v2/checks/bv/bv010.js', '../js/v2/checks/bv/bv012.js',
    '../js/v2/checks/bv/bv014.js', '../js/v2/rules/rule-engine.js',
    '../js/v2/analysis/jnv-rule-analysis-controller.js']) {
    assert.doesNotMatch(src(path), /3I\.32/, `${path} must be untouched`);
  }
});

test('F: the walking-time rule of 3I.31 is untouched — the BUP finding stays open', () => {
  const module = src('../js/v2/rules/jnv-block-break.js');
  assert.doesNotMatch(module, /3I\.32/, 'no walking-time decision is taken in this phase');
  assert.match(module, /SHORT_WALKING_TIME_MINUTES = 4/, 'and the 3I.31 state is preserved');
});

test('F: the 1/6 rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false);
});

test('F: matcher, joint timeline and driving projection carry no change', () => {
  for (const path of ['../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/analysis/driving-projection.js', '../js/v2/analysis/one-sixth-rule.js']) {
    assert.doesNotMatch(src(path), /3I\.32/, `${path} must be untouched`);
  }
});

// =====================================================================================
// E (real) — the same audit over the productive import of the real plan
// =====================================================================================
const REAL_PLAN = FIXTURES.legacyScheduleXlsx;
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

test('E (real): BV003 reports exactly what it reported before this phase', { skip: !available && 'reference plan not present' }, async () => {
  const check = await createBv003Check({ canonicalSchedule: await realImport() }).run(analysisResult);
  assert.equal(check.status, 'FAIL');
  assert.equal(check.severity, 'WARNING');
  // SUPERSEDED BY PHASE 3I.33: 41 was measured while the derived break sat at the END of every
  // duty, so BV003 was reading the BREAK's location as the duty's end. With the import corrected
  // the count is 56 — the rule itself is byte-identical, only its input stopped lying.
  assert.equal(check.affectedServices.length, 56, 'the verdict is untouched by the handover import');
});

test('E (real): the declared relief chain explains nearly every differing end', { skip: !available && 'reference plan not present' }, async () => {
  const schedule = await realImport();
  const check = await createBv003Check({ canonicalSchedule: schedule }).run(analysisResult);
  const findings = classifyBv003Findings(schedule, { bv003AffectedServiceIds: check.affectedServices });
  const count = (value) => findings.filter(f => f.auditClassification === value).length;
  assert.equal(findings.length, 58, 'duties whose real legs start and end elsewhere');
  // SUPERSEDED BY PHASE 3I.33: the one unexplained case was duty 2231, whose "end location" was
  // an absorbed page-header cell reading `Ort`. With repeated headers filtered out it is a normal
  // handover like the rest — 56 explained, none unexplained.
  assert.equal(count('explained_by_handover'), 56);
  assert.equal(count('unexplained'), 0);
  assert.equal(count('inconclusive'), 2, 'the two reserve duties without an arrival location');
});

test('E (real): every explanation rests on a consistent, two-sided chain', { skip: !available && 'reference plan not present' }, async () => {
  const findings = classifyBv003Findings(await realImport());
  for (const finding of findings.filter(f => f.auditClassification === 'explained_by_handover')) {
    assert.equal(finding.handoverEvidence, 'consistent');
    assert.ok(finding.previousServiceNumber || finding.nextServiceNumber, 'and names its counterpart');
  }
});

test('E (real): the audit carries no personal data and no raw rows', { skip: !available && 'reference plan not present' }, async () => {
  const serialised = JSON.stringify(classifyBv003Findings(await realImport()));
  assert.ok(!serialised.includes('rawCells'));
  assert.ok(!serialised.includes('MICROBUS'), 'no document header content');
  assert.ok(!/[A-Za-zÄÖÜäöü]{2,}\s+[A-ZÄÖÜ][a-zäöü]+/.test(serialised.replace(/"[a-zA-Z]+":/g, '')),
    'no name-shaped free text');
});
