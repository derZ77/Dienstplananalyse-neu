/**
 * Phase 4.4 (E/F) — the local download and its clean-up.
 *
 * Everything the download touches is injectable, so the behaviour is observable without a browser:
 * which blob was made, which object URL was created, which anchor was clicked, and — the part that
 * actually matters — that the URL is released and the anchor removed on EVERY path, success or not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import {
  downloadDienstplanExport, writeDienstplanXlsx,
  DIENSTPLAN_EXPORT_STATUS, EXPORT_FORMATS, EXPORT_WARNING_CODES
} from '../js/v2/export/dienstplan-xlsx-export.js';
import { buildDienstplanXlsxModel } from '../js/v2/export/dienstplan-xlsx-model.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DAY = new Date(Date.UTC(2026, 7, 4, 9, 30));

const loadXlsx = () => {
  const sandbox = { console };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.process = process; sandbox.Buffer = Buffer;
  createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.XLSX;
};
const XLSX = loadXlsx();

// ---------------------------------------------------------------------------------------
const time = (value) => ({ raw: value ?? '', value: value ?? null,
  minutesSinceStartOfDay: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });
const duration = (value) => ({ raw: value ?? '', value: value ?? null,
  minutes: value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null });
let counter = 0;
const service = (serviceNumber) => {
  const id = `service:1:${serviceNumber}`;
  return {
    id, serviceNumber, begin: time('05:00'), end: time('12:00'), paidTime: duration('07:00'),
    activities: [{
      id: `activity:${id}:${counter++}`, serviceId: id, serviceNumber: '', circuitNumber: '',
      rawActivity: 'Dienst', departureTime: time('05:00'), arrivalTime: time('06:00'),
      departureLocation: ' Bth. Burgau', arrivalLocation: ' Teichgraben',
      originalText: 'ROH', boundingBox: {}, routeIdentity: null, serviceIdentity: null,
      source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 3, boundingBox: {}, originalText: 'ROH' }
    }],
    interruptions: [], originalText: 'ROH', boundingBox: {},
    source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineRange: { start: 1, end: 2 }, boundingBox: {}, originalText: 'ROH' }
  };
};
const readyModel = () => buildDienstplanXlsxModel({
  detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1' }, pageCount: 1 },
  canonicalSchedule: {
    type: 'CanonicalSchedule',
    document: { sourceType: 'pdf', pageCount: 1, source: { byteLength: 0, documentModelType: 'PdfDocumentModel' } },
    services: [service('2101')], activities: [], interruptions: [], warnings: [],
    metadata: { schemaVersion: '1.0', serviceCount: 1, activityCount: 1, interruptionCount: 0 }
  }
});

/** A tiny observable browser. Every call is recorded; nothing real is touched. */
const browser = ({ failClick = false, failCreateUrl = false } = {}) => {
  const log = { blobs: [], created: [], revoked: [], appended: [], removed: [], clicks: 0 };
  const body = {
    appendChild: (node) => { log.appended.push(node); return node; },
    removeChild: (node) => { log.removed.push(node); return node; }
  };
  return {
    log,
    environment: {
      document: {
        body,
        createElement: (tag) => {
          assert.equal(tag, 'a', 'only an anchor is created');
          return { tagName: 'A', href: '', download: '', style: {},
            click: () => { log.clicks += 1; if (failClick) throw new Error('click failed'); } };
        }
      },
      url: {
        createObjectURL: (blob) => {
          if (failCreateUrl) throw new Error('no object url');
          log.created.push(blob); return `blob:local/${log.created.length}`;
        },
        revokeObjectURL: (value) => log.revoked.push(value)
      },
      blobFactory: (parts, init) => { const blob = { parts, init }; log.blobs.push(blob); return blob; }
    }
  };
};

// =====================================================================================
// E — the download
// =====================================================================================
test('E: a ready model is offered as a local download', () => {
  const { log, environment } = browser();
  const result = downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, ...environment });

  assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.READY);
  assert.equal(result.downloaded, true);
  assert.equal(result.format, EXPORT_FORMATS.XLSX);
  assert.equal(result.fileName, 'JNV-Dienstplan-Export-2026-08-04.xlsx');
  assert.equal(log.blobs.length, 1, 'exactly one blob');
  assert.equal(log.created.length, 1, 'exactly one object URL');
  assert.equal(log.clicks, 1, 'exactly one click');
});

test('E: the blob carries the bytes and the spreadsheet MIME type', () => {
  const { log, environment } = browser();
  const result = downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, ...environment });
  const [blob] = log.blobs;
  assert.equal(blob.parts.length, 1);
  assert.ok(blob.parts[0] instanceof Uint8Array);
  assert.equal(blob.parts[0].length, result.bytes.length);
  assert.match(blob.init.type, /spreadsheetml/);
});

test('E: the anchor carries the safe file name and is removed again', () => {
  const { log, environment } = browser();
  downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, ...environment });
  assert.equal(log.appended.length, 1);
  assert.equal(log.removed.length, 1, 'the temporary node is taken out again');
  assert.equal(log.appended[0], log.removed[0], 'the very same node');
  assert.equal(log.appended[0].download, 'JNV-Dienstplan-Export-2026-08-04.xlsx');
  assert.match(log.appended[0].href, /^blob:/);
});

test('E: the object URL is revoked on the success path', () => {
  const { log, environment } = browser();
  downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, ...environment });
  assert.deepEqual(log.revoked, ['blob:local/1'], 'created once, revoked once');
});

test('E: a refused model triggers no download at all', () => {
  const { log, environment } = browser();
  const model = buildDienstplanXlsxModel({ documentType: 'wagenkarte', canonicalSchedule: null });
  const result = downloadDienstplanExport(model, { xlsx: XLSX, now: DAY, ...environment });

  assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.NOT_APPLICABLE);
  assert.equal(result.downloaded, false);
  assert.deepEqual(log.blobs, []);
  assert.deepEqual(log.created, []);
  assert.equal(log.clicks, 0);
});

test('E: without a browser context nothing is attempted', () => {
  const result = downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, document: null, url: null });
  assert.equal(result.downloaded, false);
  assert.ok(result.warnings.some(w => w.code === EXPORT_WARNING_CODES.KEIN_BROWSERKONTEXT));
});

test('E: the download happens only on an explicit call — nothing runs on import', () => {
  const module = src('../js/v2/export/dienstplan-xlsx-export.js');
  const topLevel = module.split('\n').filter(line => /^[a-zA-Z]/.test(line));
  for (const line of topLevel) {
    assert.doesNotMatch(line, /^downloadDienstplanExport\(|^writeDienstplanXlsx\(/, `runs on import: ${line}`);
  }
  assert.doesNotMatch(module, /addEventListener|onchange|DOMContentLoaded/, 'the module wires no event');
  assert.doesNotMatch(module, /document\.getElementById|querySelector/, 'and touches no page element');
});

// =====================================================================================
// F — the error paths clean up after themselves
// =====================================================================================
test('F: a failing click still revokes the URL and removes the node', () => {
  const { log, environment } = browser({ failClick: true });
  const result = downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, ...environment });

  assert.equal(result.downloaded, false);
  assert.ok(result.warnings.some(w => w.code === EXPORT_WARNING_CODES.DOWNLOAD_FEHLGESCHLAGEN));
  assert.deepEqual(log.revoked, ['blob:local/1'], 'the URL is released anyway');
  assert.equal(log.removed.length, 1, 'and the node does not stay behind');
});

test('F: a failing object URL leaves nothing behind either', () => {
  const { log, environment } = browser({ failCreateUrl: true });
  const result = downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, ...environment });

  assert.equal(result.downloaded, false);
  assert.deepEqual(log.revoked, [], 'nothing was created, so nothing is revoked');
  assert.deepEqual(log.removed, [], 'and no node was ever added');
  assert.equal(log.clicks, 0);
});

test('F: a missing SheetJS falls back to CSV rather than failing', () => {
  const { log, environment } = browser();
  const result = downloadDienstplanExport(readyModel(), { xlsx: null, now: DAY, ...environment });

  assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.READY);
  assert.equal(result.format, EXPORT_FORMATS.CSV);
  assert.equal(result.fileName, 'JNV-Dienstplan-Export-2026-08-04.csv');
  assert.equal(result.downloaded, true);
  assert.ok(result.warnings.some(w => w.code === EXPORT_WARNING_CODES.XLSX_RUNTIME_UNAVAILABLE));
  assert.match(log.blobs[0].init.type, /text\/csv/);
});

test('F: a SheetJS that throws falls back to CSV, and no half-written file is offered', () => {
  const broken = { utils: { book_new: () => ({ SheetNames: [], Sheets: {} }), book_append_sheet: () => {},
    aoa_to_sheet: () => ({}) }, write: () => { throw new Error('boom'); } };
  const { log, environment } = browser();
  const result = downloadDienstplanExport(readyModel(), { xlsx: broken, now: DAY, ...environment });

  assert.equal(result.format, EXPORT_FORMATS.CSV);
  assert.equal(result.downloaded, true);
  assert.ok(result.warnings.some(w => w.code === EXPORT_WARNING_CODES.XLSX_WRITE_FAILED));
  assert.ok(!JSON.stringify(result.warnings).includes('boom'), 'no internal message leaks');
  assert.equal(log.blobs.length, 1, 'exactly one file was offered — the CSV');
});

test('F: if even the CSV cannot be produced there is a controlled error and no download', () => {
  const { log, environment } = browser();
  const model = readyModel();
  const poisoned = { ...model, sheets: model.sheets.map((sheet, index) => index !== 0 ? sheet
    : { ...sheet, rows: [[{ nested: true }, ...sheet.rows[0].slice(1)]] }) };
  const result = downloadDienstplanExport(poisoned, { xlsx: null, now: DAY, ...environment });

  assert.equal(result.status, DIENSTPLAN_EXPORT_STATUS.ERROR);
  assert.equal(result.downloaded, false);
  assert.equal(result.bytes, null);
  assert.deepEqual(log.blobs, []);
});

test('F: no warning ever carries a stack trace or an internal message', () => {
  const broken = { utils: { book_new: () => { throw new Error('at Object.<anonymous> (/User' + 's/x/a.js:1:1)'); } } };
  const { environment } = browser();
  const result = downloadDienstplanExport(readyModel(), { xlsx: broken, now: DAY, ...environment });
  const serialised = JSON.stringify(result.warnings);
  assert.ok(!serialised.includes('/User' + 's/'));
  assert.ok(!/at Object|\.js:\d+/.test(serialised));
});

test('F: the download result stays plain, serialisable data', () => {
  const { environment } = browser();
  const result = downloadDienstplanExport(readyModel(), { xlsx: XLSX, now: DAY, ...environment });
  assert.doesNotThrow(() => JSON.stringify({ ...result, bytes: null }));
  for (const warning of result.warnings) {
    assert.deepEqual(Object.keys(warning).sort(), ['code', 'message']);
  }
});
