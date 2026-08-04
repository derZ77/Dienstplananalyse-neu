import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReferenceDataContext } from '../js/v2/reference-data-loader.js';
import { loadWagenkartenReferenceSource } from '../js/v2/wagenkarten-reference-loader.js';
import { toWagenkartenReferenceDebugJson, validateWagenkartenReferenceSource } from '../js/v2/wagenkarten-reference-validator.js';

const source = (overrides = {}) => ({
  type: 'ReferenceDataSource',
  id: 'wagenkarte:schule:2026-08-17',
  area: 'WAGENKARTE',
  version: '1.0.0',
  schemaVersion: '1.0',
  optional: true,
  data: { cards: [card('wk:1103', '1103'), card('wk:1104', '1104')] },
  ...overrides
});

test('Wagenkarten-Import erzeugt eine versionierte ReferenceDataSource mit mehreren Wagenkarten', () => {
  const loaded = loadWagenkartenReferenceSource(source());
  assert.ok(loaded.source);
  assert.equal(loaded.report.cardCount, 2);
  assert.equal(loaded.source.data.cards[0].trips[0].line, '14');
  const integrated = loadReferenceDataContext([loaded.source]);
  assert.equal(integrated.report.valid, true);
  assert.deepEqual(integrated.report.availableData, ['WAGENKARTE']);
  assert.equal(integrated.context.getVersion('WAGENKARTE'), '1.0.0');
  assert.equal(integrated.context.get('WAGENKARTE').cards[1].serviceNumber, '1104');
});

test('Wagenkarten-Validator prüft Schema, Fahrtfolge, Haltestellenfolge und Zeitpunkte', () => {
  const report = validateWagenkartenReferenceSource(source({ data: { cards: [card('wk:1103', '1103', { trips: [] })] } }));
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.code === 'INVALID_WAGENKARTE_TRIPS'));
  assert.doesNotThrow(() => JSON.parse(toWagenkartenReferenceDebugJson(report)));
});

test('fehlerhafte Wagenkarten werden abgelehnt und erzeugen keinen nutzbaren Source', () => {
  const invalid = source({ data: { cards: [card('wk:1103', '1103', { vehicle: '', trips: [trip({ stops: [stop(2, 'Jena West', '06:00', 'DEPARTURE'), stop(1, 'Lobeda', '06:20', 'ARRIVAL')] })] })] } });
  const loaded = loadWagenkartenReferenceSource(invalid);
  assert.equal(loaded.source, null);
  assert.ok(loaded.report.errors.some(error => error.code === 'INVALID_WAGENKARTE_VEHICLE'));
  assert.ok(loaded.report.errors.some(error => error.code === 'INVALID_STOP_ORDER'));
  assert.throws(() => loadWagenkartenReferenceSource(invalid, { throwOnError: true }), /INVALID_WAGENKARTE_VEHICLE/);
});

test('Wagenkartenversion und eindeutige Dienst-/Kartenkennung werden validiert', () => {
  const invalid = source({ version: 'v1', data: { cards: [card('wk:1103', '1103'), card('wk:1103', '1103')] } });
  const report = validateWagenkartenReferenceSource(invalid);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.code === 'INVALID_VERSION'));
  assert.ok(report.errors.some(error => error.code === 'DUPLICATE_WAGENKARTE_ID'));
  assert.ok(report.errors.some(error => error.code === 'DUPLICATE_WAGENKARTE_SERVICE'));
});

function card(id, serviceNumber, overrides = {}) {
  return {
    id,
    serviceNumber,
    vehicle: 'BUS-42',
    start: { time: '05:50', stop: 'Burgau' },
    end: { time: '14:10', stop: 'Burgau' },
    trips: [trip()],
    ...overrides
  };
}

function trip(overrides = {}) {
  return {
    sequence: 1,
    tripType: 'SERVICE',
    line: '14',
    course: '1103',
    departure: { time: '06:00', stop: 'Jena West' },
    arrival: { time: '06:20', stop: 'Lobeda' },
    stops: [stop(1, 'Jena West', '06:00', 'DEPARTURE'), stop(2, 'Lobeda', '06:20', 'ARRIVAL')],
    ...overrides
  };
}

function stop(sequence, name, time, event) {
  return { sequence, name, time, event };
}
