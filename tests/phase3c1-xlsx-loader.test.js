import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3C.1 – isolated JNV Umlauftafel XLSX loader.
// The browser provides globalThis.XLSX via a <script> tag; for Node we bootstrap the
// vendored library onto the global (only the adapter ever references XLSX).
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* library unavailable → real-file tests skip */ }

const { loadUmlauftafelDocumentFromXlsx, detectMode, deriveValidity } = await import('../js/v2/umlauftafel/xlsx-loader.js');
const { interpretUmlaufSheet } = await import('../js/v2/umlauftafel/xlsx-layout.js');
const { validateUmlauftafelDocument } = await import('../js/v2/umlauftafel/umlauftafel-validation.js');

const BUS = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
const TRAM = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FS_20260629_MoFr.xlsx';
const present = async (p) => { try { await access(p); return true; } catch { return false; } };
const ready = async (p) => xlsxReady && (await present(p));
const loadReal = (p) => loadUmlauftafelDocumentFromXlsx(new Uint8Array(readFileSync(p)), { sourceName: p.split('/').pop() });
const byCode = (doc, code) => doc.circulations.find(c => c.code === code);

// === pure layout / helpers (no SheetJS, always run) ========================
const synthSheet = () => [
  ['Umlauf:', '', '', '', '9999', '', '', '', '', '', 'set_MoFr_Schule'],
  ['Beginn:', '', '', '', '23:50', '', '', '', '', '', 'Ende:', '', '', '', '', '', '', '00:30', '', '', '', '', 'Fahrzeugtyp:', '', '', '', '', 'SL'],
  ['Startpunkt:', '', '', '', 'DEP', '', '', '', '', '', 'Endpunkt:', '', '', '', '', '', '', 'DEP', '', '', '', '', 'Seite:', '', '', '', '', '1/1'],
  [], ['Hinweise:'], [],
  ['Linie: 10   Route: 1', '', '', '', '23:50'],
  ['', 'STOP_A', 'ab', '', '23:55'],
  ['', 'STOP_B', 'an', '', '00:30']
];

test('pure: interpretUmlaufSheet extracts header + segments; ignores non-Umlauf/empty sheets', () => {
  const raw = interpretUmlaufSheet('9999', synthSheet());
  assert.equal(raw.code, '9999');
  assert.equal(raw.begin, '23:50');
  assert.equal(raw.end, '00:30');
  assert.equal(raw.vehicleType, 'SL');
  assert.equal(raw.startDepot, 'DEP');
  assert.ok(raw.segments.length >= 1);
  assert.equal(raw.segments[0].type, 'service_trip');
  assert.equal(raw.segments[0].line, '10');
  assert.ok(raw.segments[0].stops.some(s => s.name === 'STOP_A'));
  assert.equal(interpretUmlaufSheet('X', [['garbage', 'cells']]), null);
  assert.equal(interpretUmlaufSheet('Y', []), null);
});

test('pure: mode detection and validity derivation are deterministic', () => {
  assert.equal(detectMode('SL', '10901'), 'bus');
  assert.equal(detectMode('TLV4', '1100'), 'tram');
  assert.equal(detectMode('', '1100'), 'tram');   // fallback to 4-digit code
  assert.equal(detectMode('', '10901'), 'bus');   // fallback to 5-digit code
  assert.equal(detectMode('', ''), null);
  assert.equal(deriveValidity('0706_Knebel1_Ferien').serviceRegime, 'holidays');
  assert.equal(deriveValidity('0629_Knebel1_MoDo').dayType, 'mo_do');
});

test('invalid bytes do not throw; they yield ok:false + a structured warning', (t) => {
  if (!xlsxReady) return t.skip('XLSX library not available');
  let result;
  assert.doesNotThrow(() => { result = loadUmlauftafelDocumentFromXlsx(new Uint8Array([1, 2, 3, 4, 5])); });
  assert.equal(result.ok, false);
  assert.equal(result.document, null);
  assert.ok(result.warnings.some(w => w.code === 'UNSUPPORTED_LAYOUT'));
});

// === Bus reference file =====================================================
test('BUS: produces a valid bus document with vehicle type, depot and tagesart', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference not present');
  const r = loadReal(BUS);
  assert.equal(r.ok, true);
  assert.equal(r.document.mode, 'bus');
  assert.equal(r.document.sourceFormat, 'xlsx');
  assert.equal(r.document.validity.serviceRegime, 'holidays');
  assert.ok(r.document.circulations.length > 1, 'multiple umläufe');
  assert.equal(validateUmlauftafelDocument(r.document).valid, true);
  const c = byCode(r.document, '10901');
  assert.ok(c, 'circulation 10901 present (sheet name = code)');
  assert.equal(c.vehicle.type, 'SL');
  assert.equal(c.depot.start, 'BBU2');
  assert.ok(c.segments.length >= 1 && c.segments.some(s => s.stops.length > 0), 'parallel trip blocks parsed');
});

test('BUS: overnight circulation crosses midnight with a positive span', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference not present');
  const c = byCode(loadReal(BUS).document, '10901');
  assert.equal(c.begin.time.dayOffset, 0);
  assert.equal(c.end.time.dayOffset, 1, 'ends on the next day');
  assert.ok(c.end.time.normalizedMinutes > c.begin.time.normalizedMinutes);
});

test('BUS: multi-page circulations are recognized (Teilumlauf via page.total)', async (t) => {
  if (!(await ready(BUS))) return t.skip('bus reference not present');
  assert.ok(loadReal(BUS).document.circulations.some(c => c.page.total > 1));
});

// === Tram reference file ====================================================
test('TRAM: produces a valid tram document; empty template sheets are ignored', async (t) => {
  if (!(await ready(TRAM))) return t.skip('tram reference not present');
  const r = loadReal(TRAM);
  assert.equal(r.ok, true);
  assert.equal(r.document.mode, 'tram');
  assert.equal(r.document.validity.dayType, 'mo_do');
  assert.equal(validateUmlauftafelDocument(r.document).valid, true);
  // the tram workbook has 34 sheet slots but only real Umlauf sheets become circulations
  assert.ok(r.document.circulations.length > 1 && r.document.circulations.length < 34, 'empty TabelleN sheets skipped');
  assert.ok(r.document.circulations.every(c => /^\d+$/.test(c.code)), 'no template sheet became a circulation');
  const c = byCode(r.document, '1100');
  assert.ok(c);
  assert.equal(c.vehicle.type, 'TLV4');
  assert.equal(c.depot.start, 'BBU1');
  assert.equal(c.page.total, 2, 'multi-page tram umlauf');
  assert.equal(c.end.time.dayOffset, 0, 'a long day umlauf does not spuriously roll over');
});

// === determinism ============================================================
test('loading is deterministic (same bytes → identical document)', async (t) => {
  if (!(await ready(TRAM))) return t.skip('tram reference not present');
  const a = loadReal(TRAM);
  const b = loadReal(TRAM);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
