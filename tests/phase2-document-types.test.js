import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../js/v2/documents/document-types.js');

test('canonical document types: jnv_schedule_pdf, no separate beu_schedule_pdf', () => {
  assert.equal(M.DOCUMENT_TYPES.JES_SCHEDULE_PDF, 'jes_schedule_pdf');
  assert.equal(M.DOCUMENT_TYPES.JNV_SCHEDULE_PDF, 'jnv_schedule_pdf');
  assert.equal(M.DOCUMENT_TYPES.BEU_SCHEDULE_PDF, undefined); // no separate BEU document type
  assert.ok(!M.DOCUMENT_TYPE_VALUES.includes('beu_schedule_pdf'));
  assert.ok(!M.isDocumentType('beu_schedule_pdf'));
  assert.ok(M.isKnownDocumentType('jnv_schedule_pdf'));
});

test('no reserved document types (JNV is a real, detected type)', () => {
  assert.deepEqual([...M.RESERVED_DOCUMENT_TYPES], []);
  assert.ok(!M.isReservedDocumentType('jnv_schedule_pdf'));
});

test('organization mapping: jnv_schedule_pdf → JNV; BEU is not an organization', () => {
  assert.equal(M.documentTypeOrganization('jnv_schedule_pdf'), 'JNV');
  assert.equal(M.documentTypeOrganization('jes_schedule_pdf'), 'JES');
  assert.equal(M.ORGANIZATIONS.BEU, undefined);
  assert.ok(!Object.values(M.ORGANIZATIONS).includes('BEU'));
});

test('roles primary/companion; invalid role rejected', () => {
  assert.ok(M.isDocumentRole('primary'));
  assert.ok(M.isDocumentRole('companion'));
  assert.ok(!M.isDocumentRole('secondary'));
  assert.throws(() => M.assertDocumentRole('secondary'), TypeError);
});

test('companion document types', () => {
  assert.ok(M.isCompanionDocumentType('wagenkarte'));
  assert.ok(M.isCompanionDocumentType('umlaufkarte'));
  assert.ok(!M.isCompanionDocumentType('jnv_schedule_pdf'));
});

test('unknown type handling', () => {
  assert.ok(!M.isKnownDocumentType('unknown'));
  assert.ok(!M.isKnownDocumentType('nonsense'));
  assert.throws(() => M.assertDocumentType('nonsense'), TypeError);
});
