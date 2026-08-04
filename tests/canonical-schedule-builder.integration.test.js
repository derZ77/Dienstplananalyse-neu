import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule } = await import('../js/v2/pdf/schedule-mapper.js');
const { buildCanonicalSchedule, toCanonicalScheduleDebugJson } = await import('../js/v2/pdf/canonical-schedule-builder.js');

const references = [
  { name: 'JES', path: '/Users/joergziegler/Downloads/20260713_Dienstübersicht_FDA.pdf' },
  { name: 'BEU', path: '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf' }
];

async function buildReferenceSchedule(path) {
  const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(path)));
  return buildCanonicalSchedule(mapPdfDocumentToSchedule(normalizePdfLayoutDocument(layout)));
}

for (const reference of references) {
  test(`${reference.name}: baut einen vollständigen CanonicalSchedule ohne Fachregeln`, async () => {
    const canonical = await buildReferenceSchedule(reference.path);
    const sourceReferences = canonical.activities.map(activity => activity.source);
    const ids = [
      ...canonical.services.map(service => service.id),
      ...canonical.activities.map(activity => activity.id),
      ...canonical.interruptions.map(interruption => interruption.id)
    ];

    assert.equal(canonical.type, 'CanonicalSchedule');
    assert.equal(canonical.activities.length, canonical.metadata.activityCount);
    assert.equal(canonical.services.length, canonical.metadata.serviceCount);
    assert.equal(canonical.interruptions.length, 0, 'ohne Fachregel werden keine Unterbrechungen erkannt');
    assert.equal(new Set(ids).size, ids.length, 'alle vergebenen IDs sind eindeutig');
    assert.ok(canonical.services.every(service => service.begin.value && service.end.value && service.paidTime.value));
    assert.ok(canonical.activities.every(activity => activity.departureTime.raw === activity.departureTime.value || activity.departureTime.value === null));
    assert.ok(canonical.activities.every(activity => !('activityType' in activity)));
    assert.ok(sourceReferences.every(source => Number.isInteger(source.pageNumber) && Number.isInteger(source.tableIndex) && Number.isInteger(source.lineNumber)));
    assert.doesNotThrow(() => JSON.parse(toCanonicalScheduleDebugJson(canonical)));
  });
}

test('JES und BEU verwenden dieselbe CanonicalSchedule-Form', async () => {
  const [jes, beu] = await Promise.all(references.map(reference => buildReferenceSchedule(reference.path)));
  assert.deepEqual(Object.keys(jes).sort(), Object.keys(beu).sort());
  assert.deepEqual(Object.keys(jes.document).sort(), Object.keys(beu.document).sort());
  assert.deepEqual(Object.keys(jes.services[0]).sort(), Object.keys(beu.services[0]).sort());
  assert.deepEqual(Object.keys(jes.activities[0]).sort(), Object.keys(beu.activities[0]).sort());
});
