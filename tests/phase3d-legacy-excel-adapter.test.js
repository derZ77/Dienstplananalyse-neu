import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3D – Legacy-Excel import adapter. Pure module composition: it consumes the
// plain-object workbook (from the SheetJS adapter) and delegates to the EXISTING,
// tested canonical adapter (adaptExcelRowsToCanonicalSchedule). No SheetJS, no DOM.
const { analyzeLegacyExcelWorkbook } = await import('../js/v2/import/legacy-excel-import-adapter.js');

const wb = (sheets) => ({ sheetNames: sheets.map(s => s.name), sheets });
const sheet = (name, rows) => ({ name, ref: null, rows });

test('10-column schedule → CanonicalSchedule via the existing canonical adapter', () => {
  const r = analyzeLegacyExcelWorkbook(wb([sheet('Dienste', [
    ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'ab Ort', 'Ankunft', 'an Ort', 'Beginn', 'Ende', 'Bezahlt'],
    ['1140', '12100', 'Fahrt', '05:00', 'Betriebshof', '05:20', 'Zentrum', '05:00', '13:00', '08:00']
  ])]));
  assert.equal(r.ok, true);
  assert.equal(r.documentType, 'legacy_excel_schedule');
  assert.equal(r.data.type, 'CanonicalSchedule');
  assert.equal(r.data.metadata.excelLayout, 'schedule-10-column');
  assert.equal(r.data.services.length, 1);
  assert.equal(r.data.services[0].serviceNumber, '1140');
  assert.deepEqual(r.warnings, []);
});

test('the existing 17-column layout contract stays protected', () => {
  const row = new Array(17).fill('');
  row[2] = '7511'; row[3] = 'Fahrt'; row[4] = '12100'; row[5] = '05:00'; row[9] = '06:00'; row[14] = '05:00'; row[15] = '13:00';
  const r = analyzeLegacyExcelWorkbook(wb([sheet('Tab', [row])]));
  assert.equal(r.ok, true);
  assert.equal(r.data.metadata.excelLayout, 'legacy-tabular-17-column');
  assert.equal(r.data.services.length, 1);
  assert.equal(r.data.services[0].serviceNumber, '7511');
});

test('the adapter does not produce an Umlauftafel or Wagenkarte result', () => {
  const r = analyzeLegacyExcelWorkbook(wb([sheet('D', [['Dienst', 'Umlauf', 'Tätigkeit'], ['5', '1', 'Fahrt']])]));
  assert.equal(r.documentType, 'legacy_excel_schedule');
  assert.equal(r.data.document.sourceType, 'excel');
  assert.ok(!('mode' in r.data)); // no Umlauftafel mode
});

test('an unusable workbook yields a controlled warning, not a throw', () => {
  const r = analyzeLegacyExcelWorkbook({ sheetNames: [], sheets: [] });
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.ok(r.warnings.some(w => w.code === 'LEGACY_EXCEL_UNSUPPORTED_LAYOUT'));
});

test('the pure adapter function has no DOM dependency (runs headless in Node)', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const r = analyzeLegacyExcelWorkbook(wb([sheet('D', [['Dienst', 'Umlauf', 'Tätigkeit'], ['5', '1', 'Fahrt']])]));
  assert.equal(r.ok, true);
});
