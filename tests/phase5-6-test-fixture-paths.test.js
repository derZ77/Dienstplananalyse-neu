import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_PATHS = [
  '/' + 'Users/',
  '/' + 'Volumes/',
  ['acceptance', 'data'].join('-')
];

async function testFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith('.test.js') ? [path] : [];
  }));
  return files.flat();
}

test('Phase 5.6: Testquellen enthalten keine festen lokalen Benutzer- oder Volumes-Pfade', async () => {
  const offenders = [];
  for (const file of await testFiles(TEST_ROOT)) {
    const source = await readFile(file, 'utf8');
    if (FORBIDDEN_PATHS.some(path => source.includes(path))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
