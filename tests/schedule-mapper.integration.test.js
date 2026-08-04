import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule, toScheduleDocumentDebugJson } = await import('../js/v2/pdf/schedule-mapper.js');

const references = [
  { name: 'JES', path: '/Users/joergziegler/Downloads/20260713_Dienstübersicht_FDA.pdf' },
  { name: 'BEU', path: '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf' }
];

for (const reference of references) {
  test(`${reference.name}: erzeugt die gemeinsame ScheduleDocument-Struktur`, async () => {
    const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(reference.path)));
    const model = normalizePdfLayoutDocument(layout);
    const schedule = mapPdfDocumentToSchedule(model);
    const modelRows = model.serviceBlocks.flatMap(block => block.rows);
    const scheduleRows = schedule.services.flatMap(service => service.rows);
    const activities = schedule.services.flatMap(service => service.activities);

    assert.equal(schedule.type, 'ScheduleDocument');
    assert.equal(schedule.services.length, model.serviceBlocks.length);
    assert.equal(scheduleRows.length, modelRows.length, 'alle Tabellenzeilen werden gemappt');
    assert.ok(schedule.services.every(service => service.serviceNumber && service.begin && service.end && service.paidTime));
    assert.ok(scheduleRows.every(row => ['serviceNumber', 'circuitNumber', 'activityText', 'departureTime', 'departureLocation', 'arrivalTime', 'arrivalLocation', 'begin', 'end', 'paidTime', 'rawActivity', 'source'].every(field => field in row)));
    assert.ok(activities.every(activity => !('activityType' in activity)));
    assert.deepEqual(
      scheduleRows.map(row => `${row.source.pageNumber}:${row.source.tableIndex}:${row.source.lineNumber}`),
      modelRows.map(row => `${row.source.pageNumber}:${row.source.tableIndex}:${row.source.lineNumber}`),
      'Zeilenreihenfolge bleibt unverändert'
    );
    assert.ok(activities.every(activity => {
      const sourceRow = modelRows.find(row => row.source.pageNumber === activity.source.pageNumber && row.source.tableIndex === activity.source.tableIndex && row.source.lineNumber === activity.source.lineNumber);
      return activity.rawActivity === (sourceRow.cells.find(cell => cell.columnIndex === 2)?.source.originalText || '');
    }), 'rawActivity bleibt exakt der PDF-Originaltext der dritten Spalte');
    assert.doesNotThrow(() => JSON.parse(toScheduleDocumentDebugJson(schedule)));
  });
}

test('JES und BEU verwenden dieselbe ScheduleDocument-Form', async () => {
  const schedules = [];
  for (const reference of references) {
    const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(reference.path)));
    schedules.push(mapPdfDocumentToSchedule(normalizePdfLayoutDocument(layout)));
  }
  const [jes, beu] = schedules;
  assert.deepEqual(Object.keys(jes).sort(), Object.keys(beu).sort());
  assert.deepEqual(Object.keys(jes.services[0]).sort(), Object.keys(beu.services[0]).sort());
  assert.deepEqual(Object.keys(jes.services[0].rows[0]).sort(), Object.keys(beu.services[0].rows[0]).sort());
  assert.deepEqual(Object.keys(jes.services[0].activities[0]).sort(), Object.keys(beu.services[0].activities[0]).sort());
});
