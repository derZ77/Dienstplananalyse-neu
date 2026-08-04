import test from 'node:test';
import assert from 'node:assert/strict';

const B = await import('../js/v2/documents/analysis-bundle.js');
const { DOCUMENT_TYPES: T } = await import('../js/v2/documents/document-types.js');

const primary = () => B.createImportedDocument({ id: 'd1', role: 'primary', type: T.JES_SCHEDULE_PDF, organization: 'JES', profileId: 'jes-regionalbus-v1', fileName: 'a.pdf', parserStatus: 'ok' });
const companion = () => B.createImportedDocument({ id: 'd2', role: 'companion', type: T.WAGENKARTE, fileName: 'w.xlsx', parserStatus: 'ok' });

test('single-mode bundle is complete with just a primary', () => {
  const b = B.createAnalysisBundle({ id: 'b1', primary: primary() });
  assert.equal(b.mode, 'single');
  assert.equal(b.matchStatus, 'not_evaluated');
  assert.ok(B.isBundleComplete(b));
});

test('combined-mode bundle with primary + companion', () => {
  const b = B.createAnalysisBundle({ id: 'b2', primary: primary(), companion: companion() });
  assert.equal(b.mode, 'combined');
  assert.ok(B.isBundleComplete(b));
});

test('incomplete combined bundle (companion without primary)', () => {
  const b = B.createAnalysisBundle({ id: 'b3', companion: companion() });
  assert.equal(b.mode, 'combined');
  assert.ok(!B.isBundleComplete(b));
});

test('file bytes are rejected in imported document metadata', () => {
  assert.throws(() => B.createImportedDocument({ id: 'x', role: 'primary', type: T.JES_SCHEDULE_PDF, sourceMetadata: { bytes: [1, 2, 3] } }), TypeError);
  assert.throws(() => B.createImportedDocument({ id: 'x', role: 'primary', type: T.JES_SCHEDULE_PDF, sourceMetadata: { file: {} } }), TypeError);
});

test('invalid role/type rejected', () => {
  assert.throws(() => B.createImportedDocument({ id: 'x', role: 'secondary', type: T.JES_SCHEDULE_PDF }), TypeError);
  assert.throws(() => B.createImportedDocument({ id: 'x', role: 'primary', type: 'nope' }), TypeError);
});

test('state transition is immutable and memory-resident', () => {
  const b = B.createAnalysisBundle({ id: 'b4', primary: primary(), companion: companion() });
  const b2 = B.withBundleState(b, { compatibility: 'compatible', matchStatus: 'exact' });
  assert.equal(b.compatibility, 'unknown'); // original untouched
  assert.equal(b2.compatibility, 'compatible');
  assert.equal(b2.matchStatus, 'exact');
  assert.ok(Object.isFrozen(b));
  assert.ok(Object.isFrozen(b2));
});

test('rejects unsupported state values', () => {
  const b = B.createAnalysisBundle({ id: 'b5', primary: primary() });
  assert.throws(() => B.withBundleState(b, { matchStatus: 'perfect' }), TypeError);
  assert.throws(() => B.withBundleState(b, { compatibility: 'maybe' }), TypeError);
});
