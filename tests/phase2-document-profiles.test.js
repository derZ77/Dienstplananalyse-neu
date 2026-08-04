import test from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../js/v2/documents/document-profiles.js');

// SUPERSEDED BY PHASE 4.5: both profiles used to declare only the three parsing capabilities,
// and `xlsxExport` was explicitly listed among the ones that stay off — the honest record that no
// export existed. Phases 4.3/4.4 built it and Phase 4.5 switched it on for exactly these two
// profiles. The rule these tests protect is unchanged and still enforced: a profile declares only
// capabilities that are backed by shipped, tested code.
test('JES active with only proven capabilities', () => {
  const jes = P.getProfile('jes-regionalbus-v1');
  assert.equal(jes.status, 'active');
  assert.equal(jes.organization, 'JES');
  assert.equal(jes.documentType, 'jes_schedule_pdf');
  assert.deepEqual([...jes.capabilities], ['parse', 'normalize', 'analyze', 'xlsxExport']);
  assert.ok(!jes.capabilities.includes('oneSixth'));
  assert.ok(!jes.capabilities.includes('combinedAnalysis'));
  assert.ok(!jes.capabilities.includes('lenkzeit'));
});

test('JNV active via the technical profile beu-stadtbus-v1', () => {
  const jnv = P.getProfile('beu-stadtbus-v1');
  assert.equal(jnv.status, 'active');
  assert.equal(jnv.organization, 'JNV');
  assert.equal(jnv.documentType, 'jnv_schedule_pdf');
  assert.deepEqual([...jnv.capabilities], ['parse', 'normalize', 'analyze', 'xlsxExport']);
  assert.deepEqual([...jnv.supportedCompanionTypes], ['umlaufkarte']);
  // SUPERSEDED BY PHASE 4.5: `xlsxExport` moved out of this list because it is now implemented.
  // The still-unimplemented JNV extensions stay off.
  for (const cap of ['combinedAnalysis', 'lenkzeit', 'oneSixth']) {
    assert.ok(!jnv.capabilities.includes(cap), `should not declare ${cap}`);
  }
});

test('no separate BEU-organization profile and no reserved JNV placeholder', () => {
  assert.equal(P.getProfile('jnv-schedule-reserved'), null);
  for (const profile of P.listProfiles()) {
    assert.notEqual(profile.organization, 'BEU', `profile ${profile.id} must not be organization BEU`);
  }
});

test('no profile declares an unknown capability', () => {
  for (const profile of P.listProfiles()) {
    for (const capability of profile.capabilities) {
      assert.ok(P.PROFILE_CAPABILITIES.includes(capability), `unknown capability ${capability}`);
    }
  }
});

test('active profiles are JES + JNV (JNV carried by beu-stadtbus-v1)', () => {
  const active = P.listProfilesByStatus('active').map(p => p.id);
  assert.ok(active.includes('jes-regionalbus-v1'));
  assert.ok(active.includes('beu-stadtbus-v1'));
  assert.equal(P.getProfile('beu-stadtbus-v1').organization, 'JNV');
});
