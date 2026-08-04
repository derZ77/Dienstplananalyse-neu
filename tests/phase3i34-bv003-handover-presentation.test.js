/**
 * Phase 3I.34 (B) — BV003 with its relief chain shown next to the finding.
 *
 * VARIANTE B IS BINDING. The presentation adds INFORMATION; it never turns a FAIL into a PASS,
 * never hides a finding, and never presents a relief chain as proven compliance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';
import { attachExcelHandoverData } from '../js/v2/excel/excel-handover-chain.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const leg = ({ nr = '', ab, abOrt = 'BBU', an, anOrt = 'BBU', prev = '', next = '' }) =>
  ['', '', nr, '10', '10/1', ab, abOrt, '', '', an, anOrt, '', prev, next, '', '', '', ''];

/** 2217 → 2211 → 2273: a chain both sides confirm. */
const chainPlan = () => [
  HEADER,
  leg({ nr: '2211', ab: '04:00', abOrt: 'HLZ', an: '12:00', anOrt: 'LGR', prev: '2217', next: '2273' }),
  leg({ nr: '2217', ab: '01:00', an: '04:00', anOrt: 'HLZ', next: '2211' }),
  leg({ nr: '2273', ab: '12:00', abOrt: 'LGR', an: '18:00', prev: '2211' })
];
const schedule = (rows) => attachExcelHandoverData(adaptExcelRowsToCanonicalSchedule(rows));

const bv003 = (affected) => ({
  type: 'CheckReport',
  results: [{
    id: 'BV003', name: 'BV003 Gleiche Anfangs- und Endorte', category: 'BV',
    status: 'FAIL', severity: 'WARNING', message: 'Anfangs- und Endorte weichen ab.',
    details: {}, affectedServices: affected, affectedActivities: [], sourceReferences: []
  }],
  errors: [],
  summary: { resultCount: 1, hitCount: 1 }
});

const modelFor = (rows, affectedNumbers = ['2211']) => {
  const canonicalSchedule = schedule(rows);
  const affected = canonicalSchedule.services
    .filter(s => affectedNumbers.includes(s.serviceNumber)).map(s => s.id);
  return buildCheckReportViewModel(bv003(affected), { canonicalSchedule })
    .results.find(r => r.id === 'BV003');
};

// =====================================================================================
// B — the finding stands, the chain stands beside it
// =====================================================================================
test('B: a FAIL stays a FAIL even with a fully confirmed chain', () => {
  const row = modelFor(chainPlan());
  assert.equal(row.status, 'FAIL');
  assert.equal(row.severity, 'WARNING');
  assert.equal(row.isFinding, true, 'it is still counted as a finding');
});

test('B: the relief chain is visible next to the finding', () => {
  const [entry] = modelFor(chainPlan()).handover;
  assert.equal(entry.serviceNumber, '2211');
  assert.equal(entry.previousServiceNumber, '2217');
  assert.equal(entry.nextServiceNumber, '2273');
  assert.equal(entry.chain, '2217 → 2211 → 2273');
});

test('B: start and end location are named', () => {
  const [entry] = modelFor(chainPlan()).handover;
  assert.equal(entry.startLocation, 'HLZ');
  assert.equal(entry.endLocation, 'LGR');
});

test('B: a consistent chain is explained neutrally, not as compliance', () => {
  const [entry] = modelFor(chainPlan()).handover;
  assert.equal(entry.evidence, 'consistent');
  assert.equal(entry.classification, 'explained_by_handover');
  assert.match(entry.note, /Ablösung/);
  assert.match(entry.note, /nicht automatisch verändert/,
    'the note says plainly that the verdict was left alone');
  assert.doesNotMatch(entry.note, /regelkonform|zulässig|kein Verstoß|bestanden/i,
    'a chain is never presented as proven compliance');
});

test('B: a missing chain is shown as missing, and nothing is invented', () => {
  const rows = [HEADER, leg({ nr: '2211', ab: '04:00', abOrt: 'HLZ', an: '12:00', anOrt: 'LGR' })];
  const [entry] = modelFor(rows).handover;
  assert.equal(entry.previousServiceNumber, null);
  assert.equal(entry.nextServiceNumber, null);
  assert.equal(entry.evidence, 'missing');
  assert.equal(entry.chain, null, 'no chain is drawn where none exists');
  assert.match(entry.note, /keine Ablösung dokumentiert/i);
});

test('B: a one-sided chain is shown as incomplete, never as an explanation', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'HLZ', an: '12:00', anOrt: 'LGR', next: '2273' }),
    leg({ nr: '2273', ab: '12:00', abOrt: 'LGR', an: '18:00' })
  ];
  const [entry] = modelFor(rows).handover;
  assert.equal(entry.evidence, 'partial');
  assert.equal(entry.classification, 'inconclusive');
  assert.match(entry.note, /unvollständig|nicht bestätigt/i);
});

test('B: the chain string omits an end that is not declared', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'HLZ', an: '12:00', anOrt: 'LGR', prev: '2217' }),
    leg({ nr: '2217', ab: '01:00', an: '04:00', anOrt: 'HLZ', next: '2211' })
  ];
  const [entry] = modelFor(rows).handover;
  assert.equal(entry.chain, '2217 → 2211', 'only what the plan declares');
});

test('B: without a schedule the finding still renders, simply without chain data', () => {
  const row = buildCheckReportViewModel(bv003(['excel-service:1'])).results[0];
  assert.equal(row.status, 'FAIL');
  assert.deepEqual(row.handover, []);
  assert.equal(row.handoverAvailable, false);
});

test('B: no status is ever rewritten by the handover projection', () => {
  const canonicalSchedule = schedule(chainPlan());
  const report = bv003(canonicalSchedule.services.filter(s => s.serviceNumber === '2211').map(s => s.id));
  const snapshot = JSON.stringify(report);
  buildCheckReportViewModel(report, { canonicalSchedule });
  assert.equal(JSON.stringify(report), snapshot, 'the report is untouched');
});

test('B: the projection reuses the existing chain module rather than re-deriving it', () => {
  const module = src('../js/v2/report/check-report-view-model.js');
  assert.match(module, /excel-handover-chain\.js/, 'one interpretation site, not two');
  assert.doesNotMatch(module, /previousServiceNumber\s*=\s*[^;]*rawCells/, 'no re-parsing of raw cells');
});

test('B: the chain is only attached where the check itself reported the duty', () => {
  const canonicalSchedule = schedule(chainPlan());
  const report = bv003(canonicalSchedule.services.filter(s => s.serviceNumber === '2211').map(s => s.id));
  const row = buildCheckReportViewModel(report, { canonicalSchedule }).results[0];
  assert.equal(row.handover.length, 1, 'only the affected duty, not the whole plan');
  assert.equal(row.handover[0].serviceNumber, '2211');
});

test('B: only rules that name duties receive the chain projection', () => {
  const canonicalSchedule = schedule(chainPlan());
  const report = {
    type: 'CheckReport',
    results: [{
      id: 'BV010', name: 'BV010', category: 'BV', status: 'PASS', severity: 'INFO',
      message: '', details: {}, affectedServices: [], affectedActivities: [], sourceReferences: []
    }],
    errors: [], summary: { resultCount: 1, hitCount: 0 }
  };
  const row = buildCheckReportViewModel(report, { canonicalSchedule }).results[0];
  assert.deepEqual(row.handover, [], 'a passing rule needs no relief note');
});

test('B: the handover entry carries no raw rows and no personal data', () => {
  const [entry] = modelFor(chainPlan()).handover;
  assert.deepEqual(Object.keys(entry).sort(), [
    'chain', 'classification', 'endLocation', 'evidence', 'nextServiceNumber',
    'note', 'previousServiceNumber', 'serviceNumber', 'startLocation'
  ]);
});
