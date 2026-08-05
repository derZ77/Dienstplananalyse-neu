import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3B.2 – pure validators over the Umlauftafel contracts. Synthetic data only.
const C = await import('../js/v2/umlauftafel/umlauftafel-contract.js');
const V = await import('../js/v2/umlauftafel/umlauftafel-validation.js');

// Fully synthetic, strongly anonymized documents (no real full trip sequences).
const busStop = (seq, role) => C.createStopEvent({ sequence: seq, name: `STOP_${seq}`, role, time: C.createNormalizedTime({ raw: '06:00', hour: 6, minute: 0, dayOffset: 0, role }) });
const syntheticBusDoc = () => C.createUmlauftafelDocument({
  mode: 'bus', sourceFormat: 'xlsx', sourceName: 'anonymized-bus.xlsx',
  validity: C.createValidity({ dayType: 'mo_fr', serviceRegime: 'holidays', validFrom: '2026-07-23', rawLabel: 'Montag–Freitag, Ferien' }),
  circulations: [C.createCirculation({
    code: '10901', mode: 'bus', sequence: 1,
    segments: [
      C.createSegment({ type: 'service_trip', sequence: 1, line: '10', route: 'A', departure: busStop(1, 'departure'), arrival: busStop(2, 'arrival'), stops: [busStop(1, 'departure'), busStop(2, 'arrival')] }),
      C.createSegment({ type: 'deadhead', sequence: 2 })
    ]
  })]
});
const syntheticTramDoc = () => C.createUmlauftafelDocument({
  mode: 'tram', sourceFormat: 'pdf',
  validity: C.createValidity({ dayType: 'mo_do', serviceRegime: 'school' }),
  circulations: [C.createCirculation({ code: '1100', mode: 'tram', sequence: 1, segments: [C.createSegment({ type: 'service_trip', sequence: 1, line: '1', route: 'X' })] })]
});

// === F / §20: full synthetic documents validate =============================
test('F: a synthetic bus document passes validation', () => {
  const r = V.validateUmlauftafelDocument(syntheticBusDoc());
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, []);
});

test('F: a synthetic tram document passes validation', () => {
  const r = V.validateUmlauftafelDocument(syntheticTramDoc());
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('F: missing organization / wrong document type are rejected', () => {
  const bad = { ...syntheticBusDoc(), organization: null };
  assert.equal(V.validateUmlauftafelDocument(bad).valid, false);
  const badType = { ...syntheticBusDoc(), documentType: 'jnv_schedule_pdf' };
  assert.equal(V.validateUmlauftafelDocument(badType).valid, false);
});

test('F: unknown mode / source format are rejected with a path', () => {
  const r = V.validateUmlauftafelDocument({ ...syntheticBusDoc(), mode: 'plane' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.path === 'mode'));
  assert.equal(V.validateUmlauftafelDocument({ ...syntheticBusDoc(), sourceFormat: 'txt' }).valid, false);
});

test('F: an empty umlauf code is rejected', () => {
  const doc = syntheticBusDoc();
  doc.circulations[0].code = '';
  const r = V.validateUmlauftafelDocument(doc);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.path.startsWith('circulations[0]')));
});

test('F: duplicate umlauf codes are rejected', () => {
  const doc = syntheticBusDoc();
  doc.circulations.push(C.createCirculation({ code: '10901', mode: 'bus', sequence: 2 }));
  const r = V.validateUmlauftafelDocument(doc);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.code === 'DUPLICATE_UMLAUF_CODE'));
});

test('F: a circulation mode inconsistent with the document is rejected', () => {
  const doc = syntheticBusDoc();
  doc.circulations[0].mode = 'tram';
  const r = V.validateUmlauftafelDocument(doc);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.code === 'INCONSISTENT_MODE'));
});

// === validators for the smaller contracts ==================================
test('time validator rejects out-of-range values and inconsistent normalizedMinutes', () => {
  assert.equal(V.validateNormalizedTime(C.createNormalizedTime({ raw: '10:00', hour: 10, minute: 0, dayOffset: 0 })).valid, true);
  assert.equal(V.validateNormalizedTime({ raw: '24:00', hour: 24, minute: 0, dayOffset: 0, normalizedMinutes: 1440, role: 'event', confidence: 'exact' }).valid, false);
  assert.equal(V.validateNormalizedTime({ raw: '10:60', hour: 10, minute: 60, dayOffset: 0, normalizedMinutes: 660, role: 'event', confidence: 'exact' }).valid, false);
  assert.equal(V.validateNormalizedTime({ raw: '10:00', hour: 10, minute: 0, dayOffset: -1, normalizedMinutes: 600, role: 'event', confidence: 'exact' }).valid, false);
  assert.equal(V.validateNormalizedTime({ raw: '10:00', hour: 10, minute: 0, dayOffset: 0, normalizedMinutes: 999, role: 'event', confidence: 'exact' }).valid, false, 'inconsistent normalizedMinutes');
});

test('segment validator rejects an unknown segment type and a non-monotone stop order', () => {
  assert.equal(V.validateSegment(C.createSegment({ type: 'service_trip', sequence: 1 })).valid, true);
  assert.equal(V.validateSegment(C.createSegment({ type: 'teleport', sequence: 1 })).valid, false);
});

test('stop-event validator rejects an invalid role', () => {
  assert.equal(V.validateStopEvent(C.createStopEvent({ sequence: 1, role: 'departure' })).valid, true);
  assert.equal(V.validateStopEvent(C.createStopEvent({ sequence: 1, role: 'sideways' })).valid, false);
});

// === G: parser-result validation ===========================================
test('G: parser result validation enforces ok/document and non-negative statistics', () => {
  const good = C.createParserResult({ ok: true, document: syntheticBusDoc(), statistics: { circulationCount: 1, segmentCount: 2, stopEventCount: 2 } });
  assert.equal(V.validateParserResult(good).valid, true);
  const okNoDoc = C.createParserResult({ ok: true, document: null });
  assert.equal(V.validateParserResult(okNoDoc).valid, false, 'ok:true requires a document');
  const negative = C.createParserResult({ ok: true, document: syntheticBusDoc(), statistics: { circulationCount: -1, segmentCount: 0, stopEventCount: 0 } });
  assert.equal(V.validateParserResult(negative).valid, false);
});

// === H: privacy =============================================================
test('H: source validator rejects absolute paths and there is no matching field', () => {
  const cleanSource = C.createSource({ sourceFormat: 'xlsx', sheet: '10901', block: 2, row: 15, column: 7, cell: 'G15' });
  assert.equal(V.validateSource(cleanSource).valid, true);
  const leaky = C.createSource({ sourceFormat: 'xlsx', sheet: '/User' + 's/someone/secret.xlsx' });
  assert.equal(V.validateSource(leaky).valid, false);
  // the segment contract carries no matching status/score field
  const seg = C.createSegment({ type: 'service_trip', sequence: 1 });
  assert.ok(!('matchStatus' in seg) && !('score' in seg));
});

test('H: validators do not mutate their input', () => {
  const doc = syntheticBusDoc();
  const snapshot = JSON.stringify(doc);
  V.validateUmlauftafelDocument(doc);
  assert.equal(JSON.stringify(doc), snapshot);
});
