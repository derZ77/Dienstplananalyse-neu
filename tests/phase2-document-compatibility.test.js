import test from 'node:test';
import assert from 'node:assert/strict';

const { evaluateDocumentCompatibility: ev } = await import('../js/v2/documents/document-compatibility.js');
const { DOCUMENT_TYPES: T } = await import('../js/v2/documents/document-types.js');

test('JES + Wagenkarte: compatible and productive', () => {
  const r = ev(T.JES_SCHEDULE_PDF, T.WAGENKARTE);
  assert.equal(r.status, 'compatible');
  assert.equal(r.productive, true);
  assert.equal(r.code, 'JES_WAGENKARTE');
});

test('JNV + Umlaufkarte: compatible but not yet productive', () => {
  const r = ev(T.JNV_SCHEDULE_PDF, T.UMLAUFKARTE);
  assert.equal(r.status, 'compatible');
  assert.equal(r.productive, false);
  assert.equal(r.code, 'JNV_UMLAUFKARTE');
});

test('JES + Umlaufkarte: incompatible', () => {
  assert.equal(ev(T.JES_SCHEDULE_PDF, T.UMLAUFKARTE).status, 'incompatible');
});

test('JNV + Wagenkarte: incompatible (JNV uses Umlaufkarten)', () => {
  assert.equal(ev(T.JNV_SCHEDULE_PDF, T.WAGENKARTE).status, 'incompatible');
});

test('no BEU document type exists in the contract', () => {
  assert.equal(T.BEU_SCHEDULE_PDF, undefined);
});

test('single analysis (no companion) is compatible', () => {
  const r = ev(T.JES_SCHEDULE_PDF);
  assert.equal(r.status, 'compatible');
  assert.equal(r.code, 'SINGLE_ANALYSIS');
  assert.equal(r.productive, true);
});

test('companion-as-primary and duplicate companions are incompatible', () => {
  assert.equal(ev(T.WAGENKARTE, T.WAGENKARTE).status, 'incompatible');
  assert.equal(ev(T.UMLAUFKARTE, T.UMLAUFKARTE).status, 'incompatible');
  assert.equal(ev(T.LEGACY_EXCEL_SCHEDULE, T.WAGENKARTE).status, 'incompatible');
});

test('unknown types handled without throwing', () => {
  assert.equal(ev('nope', T.WAGENKARTE).status, 'unknown');
  assert.equal(ev(T.JES_SCHEDULE_PDF, 'nope').status, 'incompatible');
  assert.equal(ev(T.UNKNOWN).status, 'incompatible');
});
