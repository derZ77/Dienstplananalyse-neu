import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { compareCanonicalSchedules } from '../js/v2/analysis/analysis-adapter.js';
import { analyzeMigratedLegacyChecks } from '../js/v2/analysis/legacy-analysis-migrator.js';

const header = ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'];
const excel = rows => adaptExcelRowsToCanonicalSchedule(rows, { sheetName: 'S' });

test('compareActivity: 12/1 und 12100 gelten als identisch (via RouteIdentity.normalizedKey)', () => {
  const a = excel([header, ['751', '12/1', 'Dienst', '04:00', 'A', '05:00', 'B', '04:00', '12:00', '08:00']]);
  const b = excel([header, ['751', '12100', 'Dienst', '04:00', 'A', '05:00', 'B', '04:00', '12:00', '08:00']]);

  // Unterschiedliche Rohnotation, aber gleicher normalizedKey
  assert.notEqual(a.services[0].activities[0].circuitNumber, b.services[0].activities[0].circuitNumber);
  assert.equal(a.services[0].activities[0].routeIdentity.normalizedKey, 'LC:12|1');
  assert.equal(b.services[0].activities[0].routeIdentity.normalizedKey, 'LC:12|1');

  assert.equal(compareCanonicalSchedules(a, b).equivalent, true);
});

test('groupLegacyRoutes: 12/1 und 12100 landen in derselben Linie/Kurs-Gruppe', () => {
  const canonical = excel([
    header,
    ['1103', '12/1', 'Dienst', '04:00', 'A', '05:00', 'B', '04:00', '12:00', '08:00'],
    ['1104', '12100', 'Dienst', '05:00', 'B', '06:00', 'C', '05:00', '13:00', '08:00']
  ]);
  const { routes } = analyzeMigratedLegacyChecks(canonical);

  assert.deepEqual(Object.keys(routes), ['12/1']);
  assert.equal(routes['12/1'].length, 2);
  assert.deepEqual(routes['12/1'].map(entry => entry.serviceNumber).sort(), ['1103', '1104']);
});

test('groupLegacyRoutes: JES Übergang 7511 erzeugt keine Route-Gruppe', () => {
  const canonical = excel([header, ['751', '7511', 'Dienst', '04:00', 'A', '05:00', 'B', '04:00', '12:00', '08:00']]);
  const activity = canonical.services[0].activities[0];

  // 7511 → ServiceIdentity, keine RouteIdentity
  assert.equal(activity.routeIdentity, null);
  assert.equal(activity.serviceIdentity.normalizedKey, 'DU:751|1');
  // → wird nicht als Linie/Kurs interpretiert
  assert.deepEqual(analyzeMigratedLegacyChecks(canonical).routes, {});
});

test('Fallback ohne RouteIdentity: groupLegacyRoutes arbeitet wie bisher (5/11 gruppiert, 12100 nicht)', () => {
  const canonical = rawSchedule([
    rawActivity('a1', '5/11', '04:00', 240, '05:00', 300, 'A', 'B'),
    rawActivity('a2', '12100', '05:00', 300, '06:00', 360, 'B', 'C')
  ]);
  const { routes } = analyzeMigratedLegacyChecks(canonical);
  // 12100 ohne RouteIdentity fällt durch den Legacy-Regex-Fallback → nicht gruppiert (wie bisher)
  assert.deepEqual(Object.keys(routes), ['5/11']);
});

test('Fallback ohne RouteIdentity: compareActivity unterscheidet 12/1 und 12100 (wie bisher)', () => {
  const a = rawSchedule([rawActivity('a1', '12/1', '04:00', 240, '05:00', 300, 'A', 'B')]);
  const b = rawSchedule([rawActivity('a1', '12100', '04:00', 240, '05:00', 300, 'A', 'B')]);
  assert.equal(compareCanonicalSchedules(a, b).equivalent, false);
});

function rawActivity(id, circuitNumber, depStr, depMin, arrStr, arrMin, depLoc, arrLoc) {
  // Hand gebautes CanonicalSchedule OHNE Identity-Anreicherung → erzwingt den Fallback.
  return {
    id, serviceId: 's1', serviceNumber: '1103', rawActivity: 'Dienst', circuitNumber,
    departureTime: { raw: depStr, value: depStr, minutesSinceStartOfDay: depMin },
    arrivalTime: { raw: arrStr, value: arrStr, minutesSinceStartOfDay: arrMin },
    departureLocation: depLoc, arrivalLocation: arrLoc, source: {}
  };
}

function rawSchedule(activities) {
  return {
    type: 'CanonicalSchedule',
    document: { sourceType: 'test' },
    services: [{
      id: 's1', serviceNumber: '1103',
      begin: { raw: '04:00', value: '04:00', minutesSinceStartOfDay: 240 },
      end: { raw: '12:00', value: '12:00', minutesSinceStartOfDay: 720 },
      paidTime: { raw: '08:00', value: '08:00', minutes: 480 },
      drivingTimeSource: 'UNKNOWN',
      activities, interruptions: [], source: {}
    }],
    activities,
    interruptions: [],
    warnings: [],
    metadata: { schemaVersion: '1.0' }
  };
}
