/**
 * Phase 3I.32 (C/D) — consistency of the handover chain, and its real aggregates.
 *
 * The audit only DESCRIBES what the plan says. It repairs nothing, and it decides nothing:
 * a one-sided or contradictory chain is made visible, never silently completed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { attachExcelHandoverData, auditHandoverChain } from '../js/v2/excel/excel-handover-chain.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';

const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const leg = ({ nr = '', line = '10', uml = '10/1', ab, abOrt, an, anOrt, prev = '', next = '' }) =>
  ['', '', nr, line, uml, ab, abOrt, '', '', an, anOrt, '', prev, next, '', '', '', ''];
const build = (rows) => attachExcelHandoverData(adaptExcelRowsToCanonicalSchedule(rows));

/** A hands over to B at TGR, and B confirms it. */
const mutualPlan = () => [
  HEADER,
  leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
  leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'BBU', prev: '2211' })
];

// =====================================================================================
// C — mutual, one-sided and contradictory relations
// =====================================================================================
test('C: a mutually confirmed handover is recognised as consistent', () => {
  const audit = auditHandoverChain(build(mutualPlan()));
  assert.equal(audit.summary.mutual, 1);
  assert.equal(audit.summary.oneSided, 0);
  assert.equal(audit.summary.conflicting, 0);
  const [link] = audit.links;
  assert.equal(link.evidence, 'consistent');
  assert.equal(link.fromServiceNumber, '2211');
  assert.equal(link.toServiceNumber, '2229');
  assert.equal(link.location, 'TGR');
});

test('C: a one-sided relation stays visible and is NOT completed', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'BBU' })
  ];
  const schedule = build(rows);
  const audit = auditHandoverChain(schedule);
  assert.equal(audit.summary.oneSided, 1);
  assert.equal(audit.links[0].evidence, 'partial');
  assert.equal(schedule.services[1].handover.previousServiceNumber, null,
    'the counterpart is not written back into 2229');
});

test('C: a contradictory relation is reported, never repaired', () => {
  // 2211 says it hands to 2229 — but 2229 says it took over from 2299.
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'TGR', an: '12:00', anOrt: 'BBU', prev: '2299' }),
    leg({ nr: '2299', ab: '13:00', abOrt: 'BBU', an: '18:00', anOrt: 'BBU' })
  ];
  const audit = auditHandoverChain(build(rows));
  assert.equal(audit.summary.conflicting, 1);
  assert.equal(audit.links.find(l => l.fromServiceNumber === '2211').evidence, 'conflicting');
  assert.equal(build(rows).services[1].handover.previousServiceNumber, '2299',
    'the plan keeps saying what it says');
});

test('C: a reference to an unknown duty is reported as dangling', () => {
  const rows = [HEADER, leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '9999' })];
  const audit = auditHandoverChain(build(rows));
  assert.equal(audit.summary.dangling, 1);
  assert.equal(audit.links[0].evidence, 'missing');
});

test('C: a differing handover location is reported, not averaged away', () => {
  const rows = [
    HEADER,
    leg({ nr: '2211', ab: '04:00', abOrt: 'BBU', an: '08:00', anOrt: 'TGR', next: '2229' }),
    leg({ nr: '2229', ab: '08:00', abOrt: 'HLZ', an: '12:00', anOrt: 'BBU', prev: '2211' })
  ];
  const audit = auditHandoverChain(build(rows));
  const [link] = audit.links;
  assert.equal(link.locationMatches, false);
  assert.equal(link.location, 'TGR');
  assert.equal(link.counterpartLocation, 'HLZ');
});

test('C: the audit is pure — it returns a description and changes nothing', () => {
  const schedule = build(mutualPlan());
  const snapshot = JSON.stringify(schedule);
  const first = auditHandoverChain(schedule);
  const second = auditHandoverChain(schedule);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(schedule), snapshot, 'the schedule is untouched');
});

test('C: a schedule without any handover produces an empty, honest audit', () => {
  const rows = [HEADER, leg({ nr: '2201', ab: '03:15', abOrt: 'BBU', an: '12:15', anOrt: 'BBU' })];
  const audit = auditHandoverChain(build(rows));
  assert.deepEqual(audit.links, []);
  assert.equal(audit.summary.mutual, 0);
  assert.equal(audit.summary.servicesWithPrevious, 0);
  assert.equal(audit.summary.servicesWithNext, 0);
});

// =====================================================================================
// D — the real plan, aggregated only
// =====================================================================================
const REAL_PLAN = '/Users/joergziegler/Downloads/Test/B_20260727_MoFrFerien.xlsx';
const realSchedule = () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  const workbook = sandbox.XLSX.read(readFileSync(REAL_PLAN), { type: 'buffer' });
  const rows = sandbox.XLSX.utils
    .sheet_to_json(workbook.Sheets['Diensterklärung'], { header: 1, raw: false, defval: null })
    .map(row => row.map(cell => cell === null ? '' : String(cell).trim()));
  return build(rows);
};

const available = (() => { try { readFileSync(REAL_PLAN); return true; } catch { return false; } })();

test('D: the real plan yields a fully consistent handover chain', { skip: !available && 'reference plan not present' }, () => {
  const audit = auditHandoverChain(realSchedule());
  // Aggregates only — no duty is listed, no personal data is read.
  assert.equal(audit.summary.servicesWithPrevious, 53);
  assert.equal(audit.summary.servicesWithNext, 55);
  assert.equal(audit.summary.mutual, 84, 'every declared handover is confirmed by its counterpart');
  assert.equal(audit.summary.oneSided, 0);
  assert.equal(audit.summary.conflicting, 0);
  assert.equal(audit.summary.dangling, 0);
});

test('D: the real handover locations agree on both sides', { skip: !available && 'reference plan not present' }, () => {
  const audit = auditHandoverChain(realSchedule());
  const mismatches = audit.links.filter(link => link.evidence === 'consistent' && !link.locationMatches);
  assert.ok(mismatches.length <= 2, `at most two location mismatches, found ${mismatches.length}`);
});

test('D: differing start/end locations line up with the declared chain', { skip: !available && 'reference plan not present' }, () => {
  const schedule = realSchedule();
  const differing = schedule.services.filter(service => {
    const first = service.activities.find(a => a.departureLocation);
    const last = [...service.activities].reverse().find(a => a.arrivalLocation);
    return first && last && first.departureLocation !== last.arrivalLocation;
  });
  const withChain = differing.filter(s => s.handover.previousServiceNumber || s.handover.nextServiceNumber);
  assert.ok(differing.length >= 40, `differing ends: ${differing.length}`);
  assert.ok(withChain.length / differing.length > 0.9,
    `the great majority carry a declared handover: ${withChain.length} of ${differing.length}`);
});
