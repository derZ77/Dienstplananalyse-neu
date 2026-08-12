import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3D – Wagenkarte import adapter. Safe split: it reuses the EXISTING recognition
// signal (B1 === "Dienst-Nr.:") on the plain-object workbook and returns a recognition/
// metadata result. The deep per-Dienst analysis stays in the unchanged inline engine
// (documented open boundary → Phase 3E). No SheetJS, no DOM, no new interpretation.
const { analyzeWagenkarteWorkbook } = await import('../js/v2/import/wagenkarte-import-adapter.js');

const wb = (sheets) => ({ sheetNames: sheets.map(s => s.name), sheets });
const sheet = (name, rows) => ({ name, ref: null, rows });
const dienstSheet = (name, dienstNr) => sheet(name, [['', 'Dienst-Nr.:', '', dienstNr], ['', '', '', '']]);

test('a known Wagenkarte (B1 = "Dienst-Nr.:") is recognized', () => {
  const r = analyzeWagenkarteWorkbook(wb([dienstSheet('Dienst 100', '100')]));
  assert.equal(r.ok, true);
  assert.equal(r.documentType, 'wagenkarte');
  assert.equal(r.data.recognized, true);
  assert.equal(r.data.dienstSheetCount, 1);
  assert.deepEqual(r.warnings, []);
});

test('the recognition result shape is stable and counts Dienst sheets', () => {
  const r = analyzeWagenkarteWorkbook(wb([dienstSheet('A', '100'), dienstSheet('B', '101'), sheet('Info', [['x']])]));
  assert.equal(r.data.sheetCount, 3);
  assert.equal(r.data.dienstSheetCount, 2);
  assert.equal(typeof r.data.fullAnalysisAvailable, 'boolean');
});

test('the adapter defers Block-7 calculation and rendering (documented boundary)', () => {
  const r = analyzeWagenkarteWorkbook(wb([dienstSheet('A', '100')]));
  assert.equal(r.data.fullAnalysisAvailable, false);
  assert.equal(r.limitation, 'WAGENKARTE_FULL_ANALYSIS_IN_INLINE_ENGINE');
});

test('the adapter produces a Wagenkarten-Spezialvertrag, neither an Umlauftafel nor a Legacy schedule', () => {
  const r = analyzeWagenkarteWorkbook(wb([dienstSheet('A', '100')]));
  assert.ok(!('mode' in r.data));
  assert.equal(r.data.type, 'VehicleCardSchedule');
  assert.notEqual(r.data.type, 'CanonicalSchedule');
});

test('a workbook without the Wagenkarte signature yields a controlled warning', () => {
  const r = analyzeWagenkarteWorkbook(wb([sheet('X', [['Umlauf:', '12100'], ['Beginn:', '06:00']])]));
  assert.equal(r.ok, false);
  assert.equal(r.data.recognized, false);
  assert.ok(r.warnings.some(w => w.code === 'WAGENKARTE_UNSUPPORTED_LAYOUT'));
});

test('the pure adapter function has no DOM dependency (runs headless in Node)', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const r = analyzeWagenkarteWorkbook(wb([dienstSheet('A', '100')]));
  assert.equal(r.ok, true);
});
