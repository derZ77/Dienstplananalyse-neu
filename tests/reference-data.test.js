import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceDataContext } from '../js/v2/reference-data.js';
import { loadReferenceDataContext, toReferenceDataContextDebugJson } from '../js/v2/reference-data-loader.js';
import { validateReferenceDataSources, toReferenceDataReportDebugJson } from '../js/v2/reference-data-validator.js';

const source = (overrides = {}) => ({
  type: 'ReferenceDataSource',
  id: 'locations:j:2025',
  area: 'LOCATION_CATALOG',
  version: '1.0.0',
  schemaVersion: '1.0',
  optional: true,
  data: { locations: [{ id: 'jena-west', name: 'Jena West' }] },
  ...overrides
});

test('Referenzdaten validieren Schema, Versionierung und eindeutige IDs', () => {
  const report = validateReferenceDataSources([source(), source({ id: 'travel-times:j:2025', area: 'TRAVEL_TIMES', version: '2.3.1', data: [] })]);
  assert.equal(report.valid, true);
  assert.deepEqual(report.availableAreas, ['LOCATION_CATALOG', 'TRAVEL_TIMES']);
  assert.deepEqual(report.versions.map(entry => [entry.id, entry.version]), [['locations:j:2025', '1.0.0'], ['travel-times:j:2025', '2.3.1']]);
  assert.doesNotThrow(() => JSON.parse(toReferenceDataReportDebugJson(report)));
});

test('Referenzdaten melden fehlende, fehlerhafte und doppelte Quellen eindeutig', () => {
  const report = validateReferenceDataSources([
    source({ version: 'v1', optional: undefined }),
    source()
  ], { requiredAreas: ['LOCATION_CATALOG', 'TRAVEL_TIMES'] });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.code === 'INVALID_VERSION'));
  assert.ok(report.errors.some(error => error.code === 'INVALID_OPTIONAL_FLAG'));
  assert.ok(report.errors.some(error => error.code === 'DUPLICATE_ID'));
  assert.ok(report.errors.some(error => error.code === 'REQUIRED_AREA_MISSING'));
  assert.ok(validateReferenceDataSources({}).errors.some(error => error.code === 'INVALID_SOURCE_SET'));
});

test('optionale fehlende Daten bleiben sichtbar, verhindern aber keinen gültigen Context', () => {
  const { context, report } = loadReferenceDataContext([source()]);
  assert.ok(context);
  assert.equal(report.valid, true);
  assert.ok(report.missingData.includes('TRAVEL_TIMES'));
  assert.equal(context.has('TRAVEL_TIMES'), false);
  assert.equal(context.get('TRAVEL_TIMES'), null);
});

test('ReferenceDataContext kapselt Datenzugriffe und gibt defensiv kopierte Werte zurück', () => {
  const context = createReferenceDataContext([source({ optional: false })]);
  const value = context.get('LOCATION_CATALOG');
  value.locations[0].name = 'Verändert';
  assert.equal(context.get('LOCATION_CATALOG').locations[0].name, 'Jena West');
  assert.equal(context.getVersion('LOCATION_CATALOG'), '1.0.0');
  assert.throws(() => context.get('UNKNOWN'), /Unsupported reference-data area/);
  assert.doesNotThrow(() => JSON.parse(toReferenceDataContextDebugJson(context)));
});

test('Loader erzeugt bei Validierungsfehlern keinen Context und kann Fehler explizit werfen', () => {
  const invalid = [source({ schemaVersion: '2.0' })];
  const loaded = loadReferenceDataContext(invalid);
  assert.equal(loaded.context, null);
  assert.equal(loaded.report.valid, false);
  assert.throws(() => loadReferenceDataContext(invalid, { throwOnError: true }), /INVALID_SCHEMA_VERSION/);
});
