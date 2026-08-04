import test from 'node:test';
import assert from 'node:assert/strict';

const { normalizeCircuitIdentity, attachCircuitIdentities } = await import('../js/v2/identity/identity-normalization.js');
const { createRouteIdentity, ROUTE_IDENTITY_KINDS } = await import('../js/v2/identity/route-identity.js');
const { createServiceIdentity } = await import('../js/v2/identity/service-identity.js');

test('12/1 (Alt JNG) → RouteIdentity LINE_COURSE line=12 course=1', () => {
  const { routeIdentity, serviceIdentity } = normalizeCircuitIdentity('12/1');
  assert.equal(serviceIdentity, null);
  assert.equal(routeIdentity.type, 'RouteIdentity');
  assert.equal(routeIdentity.kind, 'LINE_COURSE');
  assert.equal(routeIdentity.line, '12');
  assert.equal(routeIdentity.course, '1');
  assert.equal(routeIdentity.trip, null);
  assert.equal(routeIdentity.raw, '12/1');
  assert.equal(routeIdentity.normalizedKey, 'LC:12|1');
});

test('12100 (Neu JNG/BEU) → RouteIdentity LINE_COURSE, normalizedKey identisch zu 12/1', () => {
  const { routeIdentity, serviceIdentity } = normalizeCircuitIdentity('12100');
  assert.equal(serviceIdentity, null);
  assert.equal(routeIdentity.kind, 'LINE_COURSE');
  assert.equal(routeIdentity.line, '12');
  assert.equal(routeIdentity.course, '1');
  assert.equal(routeIdentity.trip, null);
  assert.equal(routeIdentity.raw, '12100');
  assert.equal(routeIdentity.normalizedKey, 'LC:12|1');
  assert.equal(routeIdentity.normalizedKey, normalizeCircuitIdentity('12/1').routeIdentity.normalizedKey);
});

test('412/16 (JES Wagenkarte) → RouteIdentity LINE_TRIP line=412 trip=16', () => {
  const { routeIdentity, serviceIdentity } = normalizeCircuitIdentity('412/16');
  assert.equal(serviceIdentity, null);
  assert.equal(routeIdentity.kind, 'LINE_TRIP');
  assert.equal(routeIdentity.line, '412');
  assert.equal(routeIdentity.trip, '16');
  assert.equal(routeIdentity.course, null);
  assert.equal(routeIdentity.normalizedKey, 'LT:412|16');
});

test('7511 (JES Übergang) → ServiceIdentity dienst=751 umlauf=1, keine RouteIdentity', () => {
  const { routeIdentity, serviceIdentity } = normalizeCircuitIdentity('7511');
  assert.equal(routeIdentity, null);
  assert.equal(serviceIdentity.type, 'ServiceIdentity');
  assert.equal(serviceIdentity.dienst, '751');
  assert.equal(serviceIdentity.umlauf, '1');
  assert.equal(serviceIdentity.raw, '7511');
  assert.equal(serviceIdentity.normalizedKey, 'DU:751|1');
});

test('12/1 und 12100 sind über normalizedKey äquivalent', () => {
  assert.equal(
    normalizeCircuitIdentity('12/1').routeIdentity.normalizedKey,
    normalizeCircuitIdentity('12100').routeIdentity.normalizedKey
  );
});

test('leere Kennung → weder Route- noch ServiceIdentity', () => {
  assert.deepEqual(normalizeCircuitIdentity('   '), { routeIdentity: null, serviceIdentity: null });
  assert.deepEqual(normalizeCircuitIdentity(null), { routeIdentity: null, serviceIdentity: null });
});

test('unbekanntes Format → UNKNOWN RouteIdentity, raw erhalten, key null', () => {
  const { routeIdentity, serviceIdentity } = normalizeCircuitIdentity('X9-Z');
  assert.equal(serviceIdentity, null);
  assert.equal(routeIdentity.kind, 'UNKNOWN');
  assert.equal(routeIdentity.raw, 'X9-Z');
  assert.equal(routeIdentity.line, null);
  assert.equal(routeIdentity.normalizedKey, null);
});

test('createRouteIdentity lehnt ungültige kind ab', () => {
  assert.throws(() => createRouteIdentity({ raw: '1/1', kind: 'NONSENSE' }), TypeError);
  assert.ok(ROUTE_IDENTITY_KINDS.includes('LINE_COURSE'));
  // ServiceIdentity ohne Umlauf hat keinen key
  assert.equal(createServiceIdentity({ raw: '75', dienst: '75' }).normalizedKey, null);
});

test('attachCircuitIdentities ergänzt Identitäten ohne bestehende Felder zu verlieren', () => {
  const schedule = minimalSchedule();
  const enriched = attachCircuitIdentities(schedule);

  // Abwärtskompatibilität: bestehende Struktur/Felder unverändert vorhanden
  assert.equal(enriched.type, 'CanonicalSchedule');
  assert.equal(enriched.warnings.length, 0);
  assert.equal(enriched.services[0].serviceNumber, '751');
  const [routeAct, serviceAct] = enriched.services[0].activities;
  assert.equal(routeAct.circuitNumber, '12/1');
  assert.equal(routeAct.rawActivity, 'Dienst');
  assert.equal(serviceAct.circuitNumber, '7511');

  // Neue additive Objekte vorhanden
  assert.equal(routeAct.routeIdentity.normalizedKey, 'LC:12|1');
  assert.equal(routeAct.serviceIdentity, null);
  assert.equal(serviceAct.serviceIdentity.normalizedKey, 'DU:751|1');
  assert.equal(serviceAct.routeIdentity, null);

  // schedule.activities spiegeln dieselben angereicherten Aktivitäten
  assert.equal(enriched.activities.length, 2);
  assert.equal(enriched.activities[0].routeIdentity.normalizedKey, 'LC:12|1');
  assert.equal(enriched.activities[1].serviceIdentity.normalizedKey, 'DU:751|1');

  // Eingabe wird nicht mutiert
  assert.equal('routeIdentity' in schedule.services[0].activities[0], false);
});

test('attachCircuitIdentities weist nur CanonicalSchedule zu', () => {
  assert.throws(() => attachCircuitIdentities({ type: 'Something' }), TypeError);
});

function minimalSchedule() {
  const activities = [
    { id: 'a1', serviceId: 's1', serviceNumber: '751', rawActivity: 'Dienst', circuitNumber: '12/1', source: {} },
    { id: 'a2', serviceId: 's1', serviceNumber: '751', rawActivity: 'Dienst', circuitNumber: '7511', source: {} }
  ];
  return {
    type: 'CanonicalSchedule',
    document: { sourceType: 'test' },
    services: [{
      id: 's1', serviceNumber: '751', begin: {}, end: {}, paidTime: {},
      activities, interruptions: [], source: {}
    }],
    activities,
    interruptions: [],
    warnings: [],
    metadata: { schemaVersion: '1.0' }
  };
}
