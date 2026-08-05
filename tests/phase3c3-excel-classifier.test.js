import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3C.3 – content-based Excel classifier. Most cases use synthetic PLAIN workbook
// objects (the classifier never touches SheetJS); the real bus/tram files need the
// adapter, so XLSX is bootstrapped for Node (browser provides it via a <script> tag).
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

const { classifyExcelDocument } = await import('../js/v2/import/excel-document-classifier.js');
const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');

const BUS = FIXTURES.busUmlauftafelXlsx;
const TRAM = FIXTURES.tramUmlauftafelXlsx;
const present = async (p) => { try { await access(p); return true; } catch { return false; } };
const ready = async (p) => xlsxReady && (await present(p));
const wb = (sheets) => ({ sheetNames: sheets.map(s => s.name), sheets });
const sheet = (name, rows) => ({ name, ref: null, rows });

// === real references → exact umlaufkarte with mode =========================
test('real bus workbook → exact umlaufkarte / bus', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference / XLSX not available');
  const c = classifyExcelDocument(readWorkbookSheets(new Uint8Array(readFileSync(BUS))));
  assert.equal(c.type, 'umlaufkarte');
  assert.equal(c.subtype, 'jnv_umlauftafel');
  assert.equal(c.mode, 'bus');
  assert.equal(c.confidence, 'exact');
});

test('real tram workbook → exact umlaufkarte / tram', async (t) => {
  if (!(await ready(TRAM))) return t.skip('tram reference / XLSX not available');
  const c = classifyExcelDocument(readWorkbookSheets(new Uint8Array(readFileSync(TRAM))));
  assert.equal(c.type, 'umlaufkarte');
  assert.equal(c.mode, 'tram');
  assert.equal(c.confidence, 'exact');
});

// === synthetic plain workbooks (no SheetJS needed) =========================
test('a Wagenkarte workbook (B1 = "Dienst-Nr.:") → exact wagenkarte', () => {
  const c = classifyExcelDocument(wb([sheet('Karte1', [['', 'Dienst-Nr.:', ''], ['Dienst', '123']])]));
  assert.equal(c.type, 'wagenkarte');
  assert.equal(c.confidence, 'exact');
});

test('a legacy Excel schedule (Dienst/Umlauf/Tätigkeit header) → exact legacy_excel_schedule', () => {
  const c = classifyExcelDocument(wb([sheet('Dienste', [['Dienst', 'Umlauf', 'Tätigkeit', 'Beginn', 'Ende'], ['1140', '', 'Dienst', '05:00', '13:00']])]));
  assert.equal(c.type, 'legacy_excel_schedule');
  assert.equal(c.confidence, 'exact');
});

test('an empty workbook → unknown', () => {
  const c = classifyExcelDocument(wb([]));
  assert.equal(c.type, 'unknown');
  assert.equal(c.confidence, 'unknown');
});

test('several supporting Umlauftafel signals but a required one missing → probable', () => {
  const c = classifyExcelDocument(wb([sheet('X', [['Umlauf:'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00']])]));
  assert.equal(c.confidence, 'probable');
  assert.notEqual(c.type, 'umlaufkarte'); // probable is not routed
});

test('conflicting strong signals of two types → ambiguous', () => {
  const c = classifyExcelDocument(wb([
    sheet('12100', [['Umlauf:', '12100'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00'], ['Linie: 10   Route: 1'], ['Dienst-Nr.:']]),
    sheet('12200', [['Umlauf:', '12200'], ['Beginn:', '', '', '', '06:00'], ['Ende:', '', '', '', '14:00'], ['Linie: 10']])
  ]));
  assert.equal(c.confidence, 'ambiguous');
  assert.equal(c.type, 'unknown');
  assert.ok(c.conflicts.includes('CONFLICTING_EXCEL_DOCUMENT_SIGNALS'));
  assert.deepEqual([...c.candidates].sort(), ['umlaufkarte', 'wagenkarte']);
});

test('a truly unrelated workbook → unknown', () => {
  const c = classifyExcelDocument(wb([sheet('Notes', [['hello', 'world'], ['foo', 'bar']])]));
  assert.equal(c.type, 'unknown');
  assert.equal(c.confidence, 'unknown');
});

test('classification is deterministic and does not mutate the workbook', () => {
  const input = wb([sheet('Karte1', [['', 'Dienst-Nr.:']])]);
  const snapshot = JSON.stringify(input);
  const a = classifyExcelDocument(input);
  const b = classifyExcelDocument(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(input), snapshot);
});
