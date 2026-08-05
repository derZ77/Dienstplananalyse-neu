/**
 * Phase 3I.35 (A) — the live context reaches the report.
 *
 * The productive path is: multi-document session → `render(state)` → explorer bridge →
 * `DienstplanV2CheckExplorer.setCheckReport` → Explorer + Dashboard + report. This file asserts
 * that the SAME session snapshot now also yields the schedule and the header metadata, without a
 * second analysis, a second report or a second store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deriveReportContext, buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const schedule = (services = []) => ({
  type: 'CanonicalSchedule',
  services,
  activities: [],
  document: { sourceType: 'excel', source: { layout: 'legacy-tabular-17-column' } },
  metadata: { serviceCount: services.length }
});
const report = () => ({
  type: 'CheckReport',
  results: [{
    id: 'BV003', name: 'BV003', category: 'BV', status: 'FAIL', severity: 'WARNING',
    message: '', details: {}, affectedServices: [], affectedActivities: [], sourceReferences: []
  }],
  errors: [], summary: { resultCount: 1, hitCount: 1 }
});

/** The real shape of the session snapshot the productive bootstrap already has in hand. */
const sessionState = (overrides = {}) => ({
  primaryImport: { ok: true, documentType: 'legacy_excel_schedule', canonicalSchedule: schedule([{ id: 's1', serviceNumber: '2211' }]) },
  companionImport: null,
  primaryFileName: '/User' + 's/somebody/Down' + 'loads/plan.xlsx',
  bundle: null,
  matching: null,
  ruleAnalysis: null,
  checkReport: report(),
  ...overrides
});

// =====================================================================================
// A — the context
// =====================================================================================
test('A: the schedule is found in the session snapshot', () => {
  const context = deriveReportContext(sessionState());
  assert.equal(context.canonicalSchedule.type, 'CanonicalSchedule');
  assert.equal(context.canonicalSchedule.services[0].serviceNumber, '2211');
});

test('A: the schedule is the SAME reference — no copy is made', () => {
  const state = sessionState();
  const context = deriveReportContext(state);
  assert.equal(context.canonicalSchedule, state.primaryImport.canonicalSchedule);
});

test('A: the context derivation mutates nothing', () => {
  const state = sessionState();
  const snapshot = JSON.stringify(state);
  deriveReportContext(state);
  assert.equal(JSON.stringify(state), snapshot);
});

test('A: the document type comes from the import, not from a file name', () => {
  const { metadata } = deriveReportContext(sessionState());
  assert.equal(metadata.documentType, 'legacy_excel_schedule');
});

test('A: the number of duties is counted from the schedule itself', () => {
  const state = sessionState({
    primaryImport: { documentType: 'legacy_excel_schedule', canonicalSchedule: schedule([{ id: 's1' }, { id: 's2' }, { id: 's3' }]) }
  });
  assert.equal(deriveReportContext(state).metadata.serviceCount, 3);
});

test('A: the organization is only reported where the analysis really names one', () => {
  const bare = deriveReportContext(sessionState());
  assert.equal(bare.metadata.organization, null, 'nothing is invented');

  const analysed = deriveReportContext(sessionState({
    ruleAnalysis: { status: 'completed', ruleSet: { organization: 'JNV' } }
  }));
  assert.equal(analysed.metadata.organization, 'JNV');
});

test('A: a supported PDF profile supplies document type and organization when no rule set names them', () => {
  const cases = [
    ['beu-stadtbus-v1', 'JNV', 'jnv_schedule_pdf'],
    ['jes-regionalbus-v1', 'JES', 'jes_schedule_pdf']
  ];
  for (const [profileId, organization, documentType] of cases) {
    const context = deriveReportContext(sessionState({
      primaryImport: {
        canonicalSchedule: schedule([{ id: 's1' }]),
        detection: { status: 'supported', profile: { id: profileId, label: profileId } }
      }
    }));
    assert.equal(context.metadata.organization, organization);
    assert.equal(context.metadata.documentType, documentType);
  }
});

test('A: the day type is taken from the validity the matcher resolved, or stays null', () => {
  const bare = deriveReportContext(sessionState());
  assert.equal(bare.metadata.dayType, null);

  const matched = deriveReportContext(sessionState({
    matching: { status: 'completed', validity: { scheduleDayType: 'mo_fr' } }
  }));
  assert.equal(matched.metadata.dayType, 'mo_fr');
});

test('A: no file name and no path ever reach the metadata', () => {
  const serialised = JSON.stringify(deriveReportContext(sessionState()).metadata);
  assert.ok(!serialised.includes('/User' + 's/'));
  assert.ok(!serialised.includes('.xlsx'));
  assert.ok(!serialised.includes('plan'));
});

test('A: the metadata is small scalars only', () => {
  const { metadata } = deriveReportContext(sessionState());
  assert.deepEqual(Object.keys(metadata).sort(), ['dayType', 'documentType', 'organization', 'serviceCount']);
  for (const value of Object.values(metadata)) {
    assert.ok(value === null || ['string', 'number'].includes(typeof value), String(value));
  }
});

test('A: the context feeds the header of the view model', () => {
  const state = sessionState({ matching: { validity: { scheduleDayType: 'mo_fr' } }, ruleAnalysis: { ruleSet: { organization: 'JNV' } } });
  const context = deriveReportContext(state);
  const model = buildCheckReportViewModel(state.checkReport, {
    canonicalSchedule: context.canonicalSchedule,
    document: context.metadata,
    servicesEvaluated: context.metadata.serviceCount
  });
  assert.equal(model.header.organization, 'JNV');
  assert.equal(model.header.documentType, 'legacy_excel_schedule');
  assert.equal(model.header.dayType, 'mo_fr');
  assert.equal(model.header.servicesEvaluated, 1);
});

test('A: an absent or broken session yields a neutral context, never a throw', () => {
  for (const input of [null, undefined, {}, { primaryImport: null }, { primaryImport: { canonicalSchedule: null } }, { primaryImport: 'nonsense' }]) {
    const context = deriveReportContext(input);
    assert.equal(context.canonicalSchedule, null);
    assert.deepEqual(context.metadata, { organization: null, documentType: null, dayType: null, serviceCount: null });
  }
});

test('A: a non-schedule payload is refused rather than half-read', () => {
  const context = deriveReportContext(sessionState({ primaryImport: { documentType: 'x', canonicalSchedule: { type: 'Something' } } }));
  assert.equal(context.canonicalSchedule, null);
  assert.equal(context.metadata.serviceCount, null);
});

test('A: the productive bootstrap hands the whole state, not just the report', () => {
  const bootstrap = src('../js/v2/pdf-import-bootstrap.js');
  assert.match(bootstrap, /explorerBridge\.setCheckReport\(state\.checkReport\)/, 'the existing hand-over stays');
  assert.match(bootstrap, /deriveReportContext|DienstplanV2CheckReport/, 'and the report gets its context');
});

test('A: no second session, no second store, no second analysis', () => {
  for (const path of ['../js/v2/report/check-report-view-model.js', '../js/v2/report/check-report-view.js']) {
    const module = src(path);
    assert.doesNotMatch(module, /createMultiDocumentSession|runRuleAnalysis|analyzeRules/, path);
    assert.doesNotMatch(module, /check-runner|rule-engine/, path);
  }
  const bootstrap = src('../js/v2/pdf-import-bootstrap.js');
  assert.equal((bootstrap.match(/createMultiDocumentSession\(/g) || []).length, 1, 'exactly one session');
});
