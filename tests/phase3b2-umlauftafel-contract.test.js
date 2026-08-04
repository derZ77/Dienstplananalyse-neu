import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3B.2 – JNV Umlauftafel contracts (factories + closed vocabularies).
// Pure data contracts; no XLSX/PDF.js, no file access, no matching. Synthetic only.
const C = await import('../js/v2/umlauftafel/umlauftafel-contract.js');

// === A: document type / mode / source format ===============================
test('A: JNV Umlauftafel reuses the umlaufkarte document type + subtype/mode/format', () => {
  const doc = C.createUmlauftafelDocument({ mode: 'bus', sourceFormat: 'xlsx' });
  assert.equal(doc.documentType, 'umlaufkarte');
  assert.equal(doc.subtype, 'jnv_umlauftafel');
  assert.equal(doc.organization, 'JNV');
  assert.equal(doc.mode, 'bus');
  assert.equal(doc.sourceFormat, 'xlsx');
  assert.equal(doc.schemaVersion, C.UMLAUFTAFEL_SCHEMA_VERSION);
});

test('A: mode and source-format vocabularies are closed and frozen', () => {
  assert.ok(Object.isFrozen(C.UMLAUFTAFEL_MODES) && Object.isFrozen(C.UMLAUFTAFEL_SOURCE_FORMATS));
  assert.deepEqual([...C.UMLAUFTAFEL_MODE_VALUES].sort(), ['bus', 'tram']);
  assert.deepEqual([...C.UMLAUFTAFEL_SOURCE_FORMAT_VALUES].sort(), ['pdf', 'xlsx']);
  assert.deepEqual([...C.UMLAUFTAFEL_SUBTYPE_VALUES], ['jnv_umlauftafel']);
});

// === B: umlauf code stays a string =========================================
test('B: umlauf codes stay strings; leading zeros preserved; no numeric coercion', () => {
  assert.equal(C.createCirculation({ code: '10901', mode: 'bus' }).code, '10901');
  const tram = C.createCirculation({ code: '1100', mode: 'tram' });
  assert.equal(tram.code, '1100');
  assert.equal(typeof tram.code, 'string');
  const zero = C.createCirculation({ code: '01100', mode: 'tram' });
  assert.equal(zero.code, '01100', 'leading zero preserved');
  // id defaults to the code and stays a string
  assert.equal(C.createCirculation({ code: '10901' }).id, '10901');
});

test('B: a code suffix is NOT auto-interpreted as a part number', () => {
  const circ = C.createCirculation({ code: '10901', mode: 'bus' });
  assert.equal(circ.part.index, null);
  assert.equal(circ.part.parentCode, null);
});

// === D: segment factory / closed segment vocabulary =========================
test('D: segment factory keeps line/route as strings and a monotone sequence', () => {
  const seg = C.createSegment({ type: 'service_trip', sequence: 1, line: '10', route: 'A' });
  assert.equal(seg.type, 'service_trip');
  assert.equal(seg.line, '10');
  assert.equal(typeof seg.line, 'string');
  assert.equal(seg.sequence, 1);
  assert.equal(seg.driverChange, false);
  const dh = C.createSegment({ type: 'deadhead', sequence: 2 });
  assert.equal(dh.type, 'deadhead');
  assert.equal(dh.line, null, 'line optional for deadhead');
});

test('D: segment vocabulary is closed and only reference-backed types are included', () => {
  const v = [...C.SEGMENT_TYPE_VALUES].sort();
  assert.deepEqual(v, ['annotation', 'continuation', 'deadhead', 'duty_reference', 'service_trip', 'unknown']);
  // excluded, unprovable candidates must NOT be present
  for (const excluded of ['pull_out', 'pull_in', 'standby', 'break', 'driver_change', 'vehicle_change']) {
    assert.ok(!v.includes(excluded), `${excluded} must be excluded`);
  }
});

// === E: stop event factory / roles =========================================
test('E: stop event factory maps ab/an markers and keeps a closed role vocabulary', () => {
  const dep = C.createStopEvent({ sequence: 1, name: 'STOP_A', role: 'departure', rawMarker: 'ab' });
  assert.equal(dep.role, 'departure');
  assert.equal(dep.rawMarker, 'ab');
  assert.deepEqual(Object.keys(dep.source), []);
  assert.deepEqual([...C.STOP_EVENT_ROLE_VALUES].sort(),
    ['arrival', 'begin', 'departure', 'depot_entry', 'depot_exit', 'end', 'pass', 'unknown']);
});

// === G: parser result contract =============================================
test('G: parser result factory yields ok/document/warnings/statistics', () => {
  const ok = C.createParserResult({ ok: true, document: C.createUmlauftafelDocument({ mode: 'bus' }), statistics: { circulationCount: 1, segmentCount: 0, stopEventCount: 0 } });
  assert.equal(ok.ok, true);
  assert.ok(ok.document);
  const fail = C.createParserResult({ ok: false, warnings: [C.createUmlauftafelWarning({ code: 'UNSUPPORTED_LAYOUT', severity: 'error', scope: 'document' })] });
  assert.equal(fail.ok, false);
  assert.equal(fail.document, null);
  assert.equal(fail.statistics.circulationCount, 0);
});

test('G: warning factory uses closed severity/scope vocabularies', () => {
  assert.deepEqual([...C.WARNING_SEVERITY_VALUES].sort(), ['error', 'info', 'warning']);
  assert.deepEqual([...C.WARNING_SCOPE_VALUES].sort(), ['circulation', 'document', 'segment', 'stop_event', 'time']);
  assert.ok(C.WARNING_CODE_VALUES.includes('INVALID_TIME'));
  assert.ok(C.WARNING_CODE_VALUES.includes('DUPLICATE_UMLAUF_CODE'));
});

// === H: privacy / JSON ======================================================
test('H: factories build JSON-serializable, library-free objects with no personal data', () => {
  const doc = C.createUmlauftafelDocument({
    mode: 'tram', sourceFormat: 'xlsx',
    validity: C.createValidity({ dayType: 'mo_fr', serviceRegime: 'holidays', rawLabel: 'Montag–Freitag, Ferien' }),
    circulations: [C.createCirculation({ code: '1100', mode: 'tram', segments: [C.createSegment({ type: 'service_trip', sequence: 1 })] })]
  });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(doc)));
});

test('H: normalized-time factory computes normalizedMinutes and preserves raw', () => {
  const t = C.createNormalizedTime({ raw: '00:17', hour: 0, minute: 17, dayOffset: 1, role: 'departure' });
  assert.equal(t.raw, '00:17');
  assert.equal(t.normalizedMinutes, 1 * 1440 + 0 * 60 + 17);
  assert.equal(t.dayOffset, 1);
});

test('H: factories do not mutate their inputs', () => {
  const segs = [C.createSegment({ type: 'deadhead', sequence: 1 })];
  const before = segs.length;
  C.createCirculation({ code: '10901', segments: segs });
  assert.equal(segs.length, before);
});
