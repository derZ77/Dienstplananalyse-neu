import test from 'node:test';
import assert from 'node:assert/strict';
import { createBv001Check } from '../js/v2/checks/bv/bv001.js';
import { createBv002Check } from '../js/v2/checks/bv/bv002.js';
import { runCheckModules } from '../js/v2/checks/check-runner.js';
import { loadReferenceDataContext } from '../js/v2/reference-data-loader.js';

const analysisResult = { type: 'AnalysisResult', document: {}, services: [], statistics: {}, issues: [], warnings: [], metadata: {} };

test('BV001 prüft Betriebshofzeiten mit explizitem Ortsstamm und Betankungsdaten', async () => {
  const context = referenceContext({ fuelingServiceIds: ['service:1'] });
  const normal = schedule([service('service:1', '1', [activity('preparation', '06:00', '06:10', 'Betriebshof Burgau'), activity('postprocessing', '14:00', '14:20', 'Betriebshof Burgau')])]);
  const boundary = schedule([service('service:1', '1', [activity('preparation', '06:00', '06:09', 'Betriebshof Burgau'), activity('postprocessing', '14:00', '14:20', 'Betriebshof Burgau')])]);
  assert.equal((await run(createBv001Check({ canonicalSchedule: normal, referenceDataContext: context })))[0].status, 'PASS');
  assert.equal((await run(createBv001Check({ canonicalSchedule: boundary, referenceDataContext: context })))[0].status, 'FAIL');
});

test('BV001 wird ohne vollständige oder gültige Referenzdaten nicht anwendbar', async () => {
  const scheduleValue = schedule([service('service:1', '1', [activity('preparation', '06:00', '06:10', 'Betriebshof Burgau')])]);
  const missingContext = referenceContext(null, { includePlanMetadata: false });
  const invalidContext = loadReferenceDataContext([referenceSource('LOCATION_CATALOG', { locations: [] }, { schemaVersion: '2.0' })]).context;
  assert.equal((await run(createBv001Check({ canonicalSchedule: scheduleValue, referenceDataContext: missingContext })))[0].status, 'NOT_APPLICABLE');
  assert.equal((await run(createBv001Check({ canonicalSchedule: scheduleValue, referenceDataContext: invalidContext })))[0].status, 'NOT_APPLICABLE');
});

test('BV002 prüft Streckenzeiten und behandelt fehlende oder ungültige Referenzdaten ohne Annahme', async () => {
  const context = referenceContext({ fuelingServiceIds: [] });
  const normal = schedule([service('service:2', '2', [activity('preparation', '07:00', '07:05', 'Jena West'), activity('postprocessing', '13:00', '13:05', 'Jena West')])]);
  const boundary = schedule([service('service:2', '2', [activity('preparation', '07:00', '07:06', 'Jena West')])]);
  assert.equal((await run(createBv002Check({ canonicalSchedule: normal, referenceDataContext: context })))[0].status, 'PASS');
  assert.equal((await run(createBv002Check({ canonicalSchedule: boundary, referenceDataContext: context })))[0].status, 'FAIL');
  assert.equal((await run(createBv002Check({ canonicalSchedule: normal })))[0].status, 'NOT_APPLICABLE');
  assert.equal((await run(createBv002Check({ canonicalSchedule: normal, referenceDataContext: loadReferenceDataContext([referenceSource('LOCATION_CATALOG', { locations: [] }, { schemaVersion: '2.0' })]).context })))[0].status, 'NOT_APPLICABLE');
});

function referenceContext(planMetadata, { includePlanMetadata = true } = {}) {
  const sources = [referenceSource('LOCATION_CATALOG', {
    locations: [
      { name: 'Betriebshof Burgau', classification: 'DEPOT' },
      { name: 'Jena West', classification: 'ROUTE' }
    ]
  })];
  if (includePlanMetadata) sources.push(referenceSource('PLAN_METADATA', planMetadata));
  return loadReferenceDataContext(sources).context;
}

function referenceSource(area, data, overrides = {}) {
  return { type: 'ReferenceDataSource', id: `${area.toLowerCase()}:test`, area, version: '1.0.0', schemaVersion: '1.0', optional: true, data, ...overrides };
}

function schedule(services) {
  const activities = services.flatMap(entry => entry.activities);
  return { type: 'CanonicalSchedule', document: {}, services, activities, interruptions: [], warnings: [], metadata: { schemaVersion: '1.0' } };
}

function service(id, serviceNumber, activities) {
  return {
    id, serviceNumber, begin: {}, end: {}, paidTime: {}, interruptions: [],
    activities: activities.map(entry => ({ ...entry, serviceId: id, serviceNumber })),
    source: { service: id }
  };
}

function activity(activityType, departure, arrival, location) {
  return {
    id: `activity:${activityType}:${departure}`,
    activityType,
    departureTime: clock(departure),
    arrivalTime: clock(arrival),
    departureLocation: activityType === 'preparation' ? location : '',
    arrivalLocation: activityType === 'postprocessing' ? location : '',
    source: { activity: `${activityType}:${departure}` }
  };
}

function clock(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return { value, minutesSinceStartOfDay: hours * 60 + minutes };
}

async function run(module) {
  const report = await runCheckModules(analysisResult, [module]);
  if (report.errors.length) throw new Error(report.errors.map(entry => entry.message).join('; '));
  return report.results;
}
