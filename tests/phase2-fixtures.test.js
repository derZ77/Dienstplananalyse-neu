import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const manifestUrl = new URL('./fixtures/manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

test('fixture manifest has a valid structure', () => {
  assert.ok(Array.isArray(manifest.fixtures) && manifest.fixtures.length > 0);
  const kinds = ['anonymized', 'synthetic', 'contract-only'];
  const statuses = ['available', 'missing', 'planned', 'restricted'];
  for (const f of manifest.fixtures) {
    assert.ok(typeof f.id === 'string' && f.id, 'fixture needs an id');
    assert.ok(kinds.includes(f.sourceKind), `bad sourceKind: ${f.sourceKind}`);
    assert.ok(statuses.includes(f.status), `bad status: ${f.status}`);
  }
});

test('the JNV primary schedule reference is present (not missing_reference)', () => {
  const primary = manifest.fixtures.find(f => f.documentType === 'jnv_schedule_pdf');
  assert.ok(primary, 'expected a JNV schedule fixture');
  assert.equal(primary.profileId, 'beu-stadtbus-v1');
  assert.notEqual(primary.status, 'missing');          // real reference exists (external → restricted)
  assert.notEqual(primary.marker, 'missing_reference');
});

test('the JNV Umlaufkarte companion is still open and marked', () => {
  const umlauf = manifest.fixtures.find(f => f.documentType === 'umlaufkarte');
  assert.ok(umlauf, 'expected an Umlaufkarte fixture');
  assert.notEqual(umlauf.status, 'available');
  assert.ok(['missing_reference', 'synthetic_contract_only'].includes(umlauf.marker));
});

test('no BEU fixture family remains', () => {
  for (const f of manifest.fixtures) {
    assert.notEqual(f.organization, 'BEU');
    assert.notEqual(f.documentType, 'beu_schedule_pdf');
  }
});

test('a synthetic mini fixture exists and is clearly marked synthetic', async () => {
  const url = new URL('./fixtures/synthetic/legacy-excel-mini.rows.json', import.meta.url);
  await access(url);
  const data = JSON.parse(await readFile(url, 'utf8'));
  assert.equal(data._synthetic, true);
});
