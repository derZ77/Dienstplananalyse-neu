import test from 'node:test';
import assert from 'node:assert/strict';

const PV = await import('../js/v2/documents/provenance.js');

test('createSourcedValue keeps the value and records origin', () => {
  const s = PV.createSourcedValue(42, { sourceDocumentId: 'd1', sourceType: 'wagenkarte', sourceField: 'lenkzeit', confidence: 'exact' });
  assert.equal(s.value, 42);
  assert.equal(s.sourceType, 'wagenkarte');
  assert.equal(s.sourceField, 'lenkzeit');
  assert.equal(s.confidence, 'exact');
  assert.ok(PV.isSourcedValue(s));
  assert.ok(Object.isFrozen(s));
});

test('invalid confidence rejected', () => {
  assert.throws(() => PV.createSourcedValue(1, { confidence: 'maybe' }), TypeError);
});

test('rawValue unwraps SourcedValue and passes through plain values', () => {
  assert.equal(PV.rawValue(PV.createSourcedValue(5, {})), 5);
  assert.equal(PV.rawValue(9), 9);
  assert.equal(PV.isSourcedValue(9), false);
});
