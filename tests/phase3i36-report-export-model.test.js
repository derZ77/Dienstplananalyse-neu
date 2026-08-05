/**
 * Phase 3I.36 (C) — the export model.
 *
 * A PURE CONSUMER of the existing view model. It computes no rule value, re-counts nothing, and
 * never mutates the report. Everything it emits already exists on screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCheckReportExportModel, neutraliseCell } from '../js/v2/report/check-report-export-model.js';
import { buildCheckReportViewModel } from '../js/v2/report/check-report-view-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DAY = new Date(Date.UTC(2026, 7, 3, 9, 30));

const result = (id, status, severity, extra = {}) => ({
  id, name: `${id} Regelname`, category: 'BV', status, severity, message: `${id} Meldung`,
  details: {}, affectedServices: [], affectedActivities: [], sourceReferences: [], ...extra
});
const ELEVEN = () => [
  result('BV001', 'NOT_APPLICABLE', 'INFO'), result('BV002', 'NOT_APPLICABLE', 'INFO'),
  result('BV003', 'FAIL', 'WARNING', { affectedServices: ['s1', 's2'] }),
  result('BV005', 'SKIP', 'INFO'), result('BV007-START', 'PASS', 'INFO'),
  result('BV007-SPLIT', 'SKIP', 'INFO'), result('BV010', 'PASS', 'INFO'),
  result('BV008', 'FAIL', 'VIOLATION', { affectedServices: ['s1'] }),
  result('BV012', 'PASS', 'INFO'),
  result('BV015_BV018', 'SKIP', 'INFO', { details: { originalStatus: 'DISABLED' } }),
  result('BV014', 'PASS', 'INFO')
];
const report = (results = ELEVEN(), errors = []) => ({
  type: 'CheckReport', results, errors, summary: { resultCount: results.length, hitCount: 2 }
});
const leg = (from, to, handover) => ({
  id: 'a', departureLocation: from, arrivalLocation: to,
  departureTime: { value: '05:00', minutesSinceStartOfDay: 300 },
  arrivalTime: { value: '12:00', minutesSinceStartOfDay: 720 }, handover
});
const schedule = {
  type: 'CanonicalSchedule',
  services: [
    { id: 's1', serviceNumber: '2211', handover: { previousServiceNumber: '2217', nextServiceNumber: '2273' },
      activities: [leg('HLZ', 'LGR', { previousServiceNumber: '2217', nextServiceNumber: '2273' })] },
    { id: 's2', serviceNumber: '2212', handover: { previousServiceNumber: null, nextServiceNumber: null },
      activities: [leg('BBU', 'TGR', { previousServiceNumber: null, nextServiceNumber: null })] },
    // The counterparts, so duty 2211's chain is genuinely confirmed on both sides.
    { id: 's3', serviceNumber: '2217', handover: { previousServiceNumber: null, nextServiceNumber: '2211' },
      activities: [leg('BBU', 'HLZ', { previousServiceNumber: null, nextServiceNumber: '2211' })] },
    { id: 's4', serviceNumber: '2273', handover: { previousServiceNumber: '2211', nextServiceNumber: null },
      activities: [leg('LGR', 'BBU', { previousServiceNumber: '2211', nextServiceNumber: null })] }
  ],
  activities: []
};
const model = (options = {}) => buildCheckReportViewModel(report(), {
  canonicalSchedule: schedule,
  document: { organization: 'JNV', documentType: 'legacy_excel_schedule', dayType: 'mo_fr' },
  servicesEvaluated: 61,
  ...options
});
const exported = (options = {}) => buildCheckReportExportModel(model(options), { now: DAY });
const sheet = (name, options = {}) => exported(options).sheets.find(s => s.name === name);

// =====================================================================================
// C — the four sheets
// =====================================================================================
test('C: the export carries exactly the four agreed sheets, in order', () => {
  assert.deepEqual(exported().sheets.map(s => s.name),
    ['Zusammenfassung', 'Regelergebnisse', 'Betroffene Dienste', 'Technische Fehler']);
});

test('C: the summary repeats what the header shows, nothing recomputed', () => {
  const rows = sheet('Zusammenfassung').rows;
  const values = new Map(rows.slice(1).map(row => [row[0], row[1]]));
  assert.equal(values.get('Organisation'), 'JNV');
  assert.equal(values.get('Dokumenttyp'), 'legacy_excel_schedule');
  assert.equal(values.get('Tagesart'), 'mo_fr');
  assert.equal(values.get('Dienste'), 61);
  assert.equal(values.get('Regelergebnisse'), 11);
  assert.equal(values.get('PASS'), 4);
  assert.equal(values.get('FAIL'), 2);
  assert.equal(values.get('SKIP'), 3);
  assert.equal(values.get('NOT_APPLICABLE'), 2);
  assert.equal(values.get('INFO'), 9);
  assert.equal(values.get('WARNING'), 1);
  assert.equal(values.get('VIOLATION'), 1);
  assert.equal(values.get('Technische Fehler'), 0);
});

test('C: all eleven rule results are exported, in the report order', () => {
  const rows = sheet('Regelergebnisse').rows;
  assert.equal(rows.length, 12, 'header plus eleven');
  assert.deepEqual(rows.slice(1).map(row => row[1]), [
    'BV001', 'BV002', 'BV003', 'BV005', 'BV007-START', 'BV007-SPLIT',
    'BV010', 'BV008', 'BV012', 'BV015_BV018', 'BV014'
  ]);
  assert.deepEqual(rows.slice(1).map(row => row[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('C: the rule sheet carries the agreed columns', () => {
  const rows = sheet('Regelergebnisse').rows;
  assert.deepEqual(rows[0], ['Reihenfolge', 'Regel-ID', 'Regelname', 'Kategorie', 'Status',
    'Severity', 'Meldung', 'Betroffene Dienste', 'Originalstatus', 'Hinweis']);
  const bv003 = rows.find(row => row[1] === 'BV003');
  assert.equal(bv003[4], 'FAIL', 'the frozen value, not the label');
  assert.equal(bv003[5], 'WARNING');
  assert.equal(bv003[7], 2);
});

test('C: the affected duties are exported one row per duty', () => {
  const rows = sheet('Betroffene Dienste').rows;
  assert.deepEqual(rows[0], ['Regel-ID', 'Dienstnummer', 'Status', 'Severity', 'Anfangsort',
    'Endort', 'Vorheriger Dienst', 'Nachfolgender Dienst', 'Ablösekette vorhanden', 'Einordnungshinweis']);
  const bv003 = rows.filter(row => row[0] === 'BV003');
  assert.equal(bv003.length, 2, 'duty 2211 and duty 2212');
  assert.deepEqual(bv003.map(row => row[1]), ['2211', '2212']);
});

test('C: BV003 carries its relief information into the export', () => {
  const row = sheet('Betroffene Dienste').rows.find(r => r[0] === 'BV003' && r[1] === '2211');
  assert.equal(row[2], 'FAIL', 'Variante B: the status is exported as it stands');
  assert.equal(row[4], 'HLZ');
  assert.equal(row[5], 'LGR');
  assert.equal(row[6], '2217');
  assert.equal(row[7], '2273');
  assert.equal(row[8], 'ja');
  assert.match(row[9], /nicht automatisch verändert/);
  assert.doesNotMatch(row[9], /aufgehoben|regelkonform|zulässig/i);
});

test('C: a duty without a chain says so, and nothing is invented', () => {
  const row = sheet('Betroffene Dienste').rows.find(r => r[1] === '2212');
  assert.equal(row[6], '');
  assert.equal(row[7], '');
  assert.equal(row[8], 'nein');
  assert.match(row[9], /keine Ablösung|nicht dokumentiert/i);
});

test('C: the deactivated one-sixth rule is exported as DISABLED, never as passed', () => {
  const row = sheet('Regelergebnisse').rows.find(r => r[1] === 'BV015_BV018');
  assert.equal(row[4], 'SKIP');
  assert.equal(row[5], 'INFO');
  assert.equal(row[8], 'DISABLED');
  assert.match(row[9], /nicht aktiviert/i);
  assert.notEqual(row[4], 'PASS');
});

test('C: technical errors live on their own sheet, separated from findings', () => {
  const withErrors = buildCheckReportExportModel(
    buildCheckReportViewModel(report(ELEVEN(), [{ module: { id: 'bv001' }, code: 'BV_CHECK_UNAVAILABLE', message: 'Modul nicht verfügbar.' }])),
    { now: DAY });
  const rows = withErrors.sheets.find(s => s.name === 'Technische Fehler').rows;
  assert.deepEqual(rows[0], ['Modul', 'Fehlercode', 'Meldung']);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'bv001');
  assert.equal(rows[1][1], 'BV_CHECK_UNAVAILABLE');
});

test('C: with no technical errors the sheet says so plainly', () => {
  const rows = sheet('Technische Fehler').rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'Keine technischen Fehler');
});

test('C: the export never carries a stack trace, a path or an internal object', () => {
  const nasty = buildCheckReportExportModel(
    buildCheckReportViewModel(report(ELEVEN(), [{
      module: { id: 'bv001' }, code: 'X', message: 'boom',
      stack: 'Error: boom\n    at /User' + 's/somebody/app/js/x.js:12', error: new Error('boom')
    }])), { now: DAY });
  const serialised = JSON.stringify(nasty);
  assert.ok(!serialised.includes('/User' + 's/'));
  assert.ok(!serialised.includes('at /'));
  assert.ok(!serialised.includes('stack'));
});

test('C: no schedule, service or activity object survives into the export', () => {
  const serialised = JSON.stringify(exported());
  assert.ok(!serialised.includes('CanonicalSchedule'));
  assert.ok(!serialised.includes('"activities"'));
  assert.ok(!serialised.includes('departureTime'));
  for (const sheetEntry of exported().sheets) {
    for (const row of sheetEntry.rows) {
      for (const cell of row) {
        assert.ok(cell === null || ['string', 'number', 'boolean'].includes(typeof cell),
          `${sheetEntry.name}: ${typeof cell}`);
      }
    }
  }
});

test('C: the underlying report is not mutated by exporting', () => {
  const original = report();
  const snapshot = JSON.stringify(original);
  buildCheckReportExportModel(buildCheckReportViewModel(original), { now: DAY });
  assert.equal(JSON.stringify(original), snapshot);
});

test('C: the export is filter-independent — it always carries the whole report', () => {
  const filtered = exported({ state: { status: 'FAIL' } });
  assert.equal(filtered.sheets.find(s => s.name === 'Regelergebnisse').rows.length, 12,
    'a screen filter must never remove results from the official export');
});

// =====================================================================================
// Formula injection and file name
// =====================================================================================
test('injection: a cell starting with =, +, - or @ is neutralised', () => {
  for (const dangerous of ['=1+1', '+SUM(A1)', '-2', '@SUM(A1)', '=HYPERLINK("http://x")']) {
    const safe = neutraliseCell(dangerous);
    assert.equal(safe.startsWith("'"), true, dangerous);
    assert.equal(safe.slice(1), dangerous, 'the content itself is preserved');
  }
});

test('injection: ordinary text and numbers are left alone', () => {
  assert.equal(neutraliseCell('BV003'), 'BV003');
  assert.equal(neutraliseCell('Löbdergraben'), 'Löbdergraben');
  assert.equal(neutraliseCell(42), 42, 'a number stays a number');
  assert.equal(neutraliseCell(0), 0);
  assert.equal(neutraliseCell(''), '');
  assert.equal(neutraliseCell(null), '');
});

test('injection: every exported text cell is neutralised', () => {
  const nasty = buildCheckReportExportModel(buildCheckReportViewModel(
    report([result('=cmd|calc', 'FAIL', 'WARNING')])), { now: DAY });
  const cells = nasty.sheets.flatMap(s => s.rows.flat()).filter(cell => typeof cell === 'string');
  assert.ok(cells.some(cell => cell === "'=cmd|calc"));
  assert.ok(!cells.some(cell => typeof cell === 'string' && /^[=+\-@]/.test(cell)));
});

test('file name: safe characters, local date, no path and no original name', () => {
  const { fileNameBase } = exported();
  assert.equal(fileNameBase, 'JNV-Pruefbericht-2026-08-03');
  assert.match(fileNameBase, /^[A-Za-z0-9-]+$/);
  assert.ok(!fileNameBase.includes('/'));
});

test('file name: without an organization it falls back to a neutral name', () => {
  const bare = buildCheckReportExportModel(buildCheckReportViewModel(report()), { now: DAY });
  assert.equal(bare.fileNameBase, 'Dienstplan-Pruefbericht-2026-08-03');
});

test('file name: an odd organization is reduced to safe characters', () => {
  const odd = buildCheckReportExportModel(
    buildCheckReportViewModel(report(), { document: { organization: 'JNV / Jena e.V.' } }), { now: DAY });
  assert.match(odd.fileNameBase, /^[A-Za-z0-9-]+$/);
  assert.ok(odd.fileNameBase.startsWith('JNV-Jena-e-V-'), odd.fileNameBase);
});

// =====================================================================================
// Empty and broken states
// =====================================================================================
test('empty: without a report the model says it has nothing to export', () => {
  const nothing = buildCheckReportExportModel(buildCheckReportViewModel(null), { now: DAY });
  assert.equal(nothing.exportable, false);
  assert.equal(nothing.reason, 'NO_REPORT');
});

test('empty: a report without results is not exportable either', () => {
  const nothing = buildCheckReportExportModel(buildCheckReportViewModel(report([])), { now: DAY });
  assert.equal(nothing.exportable, false);
  assert.equal(nothing.reason, 'NO_RESULTS');
});

test('empty: a report of only SKIP/NOT_APPLICABLE IS exportable — that is a result too', () => {
  const model = buildCheckReportExportModel(buildCheckReportViewModel(
    report([result('BV001', 'NOT_APPLICABLE', 'INFO'), result('BV005', 'SKIP', 'INFO')])), { now: DAY });
  assert.equal(model.exportable, true);
  assert.equal(model.sheets.find(s => s.name === 'Regelergebnisse').rows.length, 3);
});

test('empty: nothing throws, whatever it is handed', () => {
  for (const input of [null, undefined, {}, { results: null }]) {
    assert.doesNotThrow(() => buildCheckReportExportModel(input, { now: DAY }));
  }
});

test('privacy: the export model stores nothing and reaches no network', () => {
  const module = src('../js/v2/report/check-report-export-model.js');
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(module, /check-runner|rule-engine|checks\/bv\//, 'a consumer never re-runs a check');
});
