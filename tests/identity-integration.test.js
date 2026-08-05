import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { adaptExcelRowsToCanonicalSchedule } = await import('../js/v2/excel/excel-canonical-adapter.js');
const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule } = await import('../js/v2/pdf/schedule-mapper.js');
const { buildCanonicalSchedule } = await import('../js/v2/pdf/canonical-schedule-builder.js');

const BEU_PDF = FIXTURES.jnvSchedulePdf;

// 10-Spalten-Dienstübersicht mit Umlaufspalte 12/1, 12100 und JES-Übergang 7511.
const excelRows = [
  ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
  ['751', '12/1', 'Dienst', '04:00', 'A', '05:00', 'B', '04:00', '12:00', '08:00'],
  ['', '12100', 'Dienst', '05:00', 'B', '06:00', 'C', '', '', ''],
  ['', '7511', 'Dienst', '06:00', 'C', '07:00', 'D', '', '', '']
];

async function buildPdfSchedule(path) {
  const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(path)));
  return buildCanonicalSchedule(mapPdfDocumentToSchedule(normalizePdfLayoutDocument(layout)));
}

test('Excel → CanonicalSchedule wird automatisch mit RouteIdentity/ServiceIdentity angereichert', () => {
  const canonical = adaptExcelRowsToCanonicalSchedule(excelRows, { fileName: 'wp24.xlsx', sheetName: 'S' });
  const [a0, a1, a2] = canonical.services[0].activities;

  // Jede Aktivität trägt beide Identity-Felder (Wert null oder Objekt)
  assert.ok(canonical.activities.every(a => 'routeIdentity' in a && 'serviceIdentity' in a));

  // 12/1 → RouteIdentity LINE_COURSE, key LC:12|1
  assert.equal(a0.routeIdentity.kind, 'LINE_COURSE');
  assert.equal(a0.routeIdentity.normalizedKey, 'LC:12|1');
  assert.equal(a0.serviceIdentity, null);

  // 12100 → gleicher normalizedKey wie 12/1
  assert.equal(a1.routeIdentity.normalizedKey, 'LC:12|1');
  assert.equal(a1.routeIdentity.normalizedKey, a0.routeIdentity.normalizedKey);

  // 7511 (JES Übergang) → ServiceIdentity vorhanden, keine RouteIdentity
  assert.equal(a2.routeIdentity, null);
  assert.equal(a2.serviceIdentity.dienst, '751');
  assert.equal(a2.serviceIdentity.umlauf, '1');
  assert.equal(a2.serviceIdentity.normalizedKey, 'DU:751|1');

  // AUFGABE 4: bestehende Felder unverändert erhalten
  assert.equal(canonical.type, 'CanonicalSchedule');
  assert.equal(canonical.services[0].serviceNumber, '751');
  assert.equal(canonical.metadata.excelLayout, 'schedule-10-column');
  assert.equal(a0.circuitNumber, '12/1');
  assert.equal(a1.circuitNumber, '12100');
  assert.equal(a2.circuitNumber, '7511');
});

test('PDF → CanonicalSchedule wird automatisch mit RouteIdentity angereichert', async () => {
  const canonical = await buildPdfSchedule(BEU_PDF);

  assert.equal(canonical.type, 'CanonicalSchedule');
  assert.ok(canonical.activities.every(a => 'routeIdentity' in a && 'serviceIdentity' in a));
  // BEU verwendet 5-stellige Umlaufcodes → mindestens eine RouteIdentity LINE_COURSE
  assert.ok(canonical.activities.some(a => a.routeIdentity && a.routeIdentity.kind === 'LINE_COURSE'));
  // AUFGABE 4: bestehende Felder erhalten (circuitNumber weiterhin vorhanden)
  assert.ok(canonical.activities.every(a => 'circuitNumber' in a));
});

test('AUFGABE 7: Excel und PDF liefern beide angereicherte CanonicalSchedules (quellenunabhängig)', async () => {
  const excel = adaptExcelRowsToCanonicalSchedule(excelRows, {});
  const pdf = await buildPdfSchedule(BEU_PDF);

  for (const canonical of [excel, pdf]) {
    assert.equal(canonical.type, 'CanonicalSchedule');
    assert.ok(canonical.activities.length > 0);
    assert.ok(canonical.activities.every(a => 'routeIdentity' in a && 'serviceIdentity' in a));
  }
});
