import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const rows = [
  ['Kopf'],
  ['', '', '1101', 'Dienst', '5/11', '04:00', 'BBU', '', '', '12:45', 'BUP', '', '', '', '04:00', '12:45', '08:45']
];

test('identische Excel- und PDF-Canonical-Schedules erzeugen dieselben Original-Blöcke', () => {
  const excel = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const pdf = structuredClone(excel);
  pdf.document.sourceType = 'pdf';

  assert.deepEqual(createOriginalBlockViewModel(pdf), createOriginalBlockViewModel(excel));
});

test('der JES-Referenzdienst erzeugt aus echtem Excel und PDF dieselben Original-Blöcke', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const excel = adaptExcelRowsToCanonicalSchedule([
    ['Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026'],
    ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
    ['751', '', 'Vorbereitungszeit JES', '03:53', 'Betriebshof Jena-Burgau', '04:08', 'Betriebshof Jena-Burgau', '03:53', '12:28', '08:05'],
    ['', '7511', 'Dienst', '04:08', 'Betriebshof Jena-Burgau', '07:03', 'Jena, Busbahnhof Endhst.', '', '', ''],
    ['', '7511', 'Pause', '07:03', 'Busbahnhof', '07:33', 'Busbahnhof', '', '', ''],
    ['', '7511', 'Dienst', '07:33', 'Busbahnhof', '12:13', 'Betriebshof Jena-Burgau', '', '', ''],
    ['', '', 'Nachbereitungszeit JES', '12:13', 'Betriebshof Jena-Burgau', '12:28', 'Betriebshof Jena-Burgau', '', '', '']
  ], { sheetName: 'Dienstübersicht' });
  const path = '/Users/joergziegler/Downloads/20260713_Dienstübersicht_FDA.pdf';
  const result = await analyzePdfImport({ name: 'Dienstplan.pdf', arrayBuffer: () => readFile(path) });
  const service = result.canonicalSchedule.services.find(entry => entry.serviceNumber === '751');
  const pdf = { ...result.canonicalSchedule, services: [service], activities: service.activities };

  assert.deepEqual(createOriginalBlockViewModel(pdf), createOriginalBlockViewModel(excel));
});
