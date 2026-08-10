import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { attachExcelBreakData } from '../js/v2/excel/excel-break-import.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

globalThis.DOMMatrix ||= class DOMMatrix {};

const clock = value => {
  const [hours, minutes] = value.split(':').map(Number);
  return { raw: value, value, minutesSinceStartOfDay: hours * 60 + minutes };
};

const pdfFile = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return {
    name: path.split('/').at(-1),
    type: 'application/pdf',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
};

const excelReferenceRows = () => [
  ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
  ['2141', '14400', 'Dienst', '05:03', 'Bth. Burgau', '08:12', 'Bth. Burgau', '04:53', '12:40', '06:43'],
  ['', '14401', 'Dienst', '13:26', 'Bth. Burgau', '15:00', 'Bth. Burgau', '', '', '']
];

function assertCanonicalInterruption(interruption, { start, end, durationMinutes, serviceNumber }) {
  assert.equal(interruption.type, 'serviceInterruption');
  assert.equal(interruption.kind, 'interruption');
  assert.deepEqual(interruption.start, clock(start));
  assert.deepEqual(interruption.end, clock(end));
  assert.equal(interruption.durationMinutes, durationMinutes);
  assert.equal(interruption.serviceNumber, serviceNumber);
  assert.deepEqual(Object.keys(interruption.location).sort(), ['end', 'start']);
  assert.ok('source' in interruption);
}

test('Phase 6.2: echtes JNV-PDF übernimmt erkannte Unterbrechungen in den CanonicalSchedule', async () => {
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const result = await analyzePdfImport(await pdfFile(FIXTURES.jnvSchedulePdf));
  const schedule = result.canonicalSchedule;

  assert.equal(result.detection.profile.id, 'beu-stadtbus-v1');
  assert.ok(schedule.hardened.interruptions.length >= 1, 'Referenz-PDF enthält erkannte Unterbrechungen');
  assert.ok(schedule.interruptions.length >= 1, 'Basis-CanonicalSchedule übernimmt die Unterbrechungen');
  const interruption = schedule.interruptions[0];
  assert.equal(interruption.type, 'serviceInterruption');
  assert.equal(interruption.kind, 'interruption');
  assert.ok(interruption.start?.value);
  assert.ok(interruption.end?.value);
  assert.ok(Number.isInteger(interruption.durationMinutes));
  assert.ok(interruption.location && 'start' in interruption.location && 'end' in interruption.location);
  assert.ok(interruption.serviceId);
  assert.ok(interruption.serviceNumber);
  assert.ok(schedule.services.find(service => service.id === interruption.serviceId).interruptions.includes(interruption));
});

test('Phase 6.2: Excel-Unterbrechungen verwenden denselben Canonical-Vertrag', () => {
  const schedule = attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(excelReferenceRows()));
  assert.equal(schedule.interruptions.length, 1);
  assertCanonicalInterruption(schedule.interruptions[0], {
    start: '08:12', end: '13:26', durationMinutes: 314, serviceNumber: '2141'
  });
  assert.equal(schedule.services[0].interruptions[0], schedule.interruptions[0]);
});

test('Phase 6.2: gleiche Canonical-Unterbrechung erzeugt dieselbe Original-Block-10-Darstellung', () => {
  const excel = attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(excelReferenceRows()));
  const interruption = excel.interruptions[0];
  const pdfLike = {
    ...excel,
    document: { ...excel.document, sourceType: 'pdf' },
    interruptions: [structuredClone(interruption)],
    services: excel.services.map(service => ({
      ...service,
      interruptions: service.interruptions.map(entry => structuredClone(entry))
    }))
  };

  assert.equal(
    createOriginalBlockViewModel(pdfLike).pauseHtml,
    createOriginalBlockViewModel(excel).pauseHtml
  );
});
