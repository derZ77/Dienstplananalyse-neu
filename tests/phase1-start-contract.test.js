import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package.json declares start and test scripts', () => {
  assert.ok(pkg.scripts, 'scripts fehlen in package.json');
  assert.equal(typeof pkg.scripts.start, 'string', 'npm start fehlt');
  assert.equal(typeof pkg.scripts.test, 'string', 'npm test fehlt');
});

test('start uses the versioned dev-server, not the unversioned server.js', async () => {
  assert.doesNotMatch(pkg.scripts.start, /server\.js/, 'start darf nicht die unversionierte server.js verwenden');
  assert.match(pkg.scripts.start, /scripts\/dev-server\.mjs/, 'start soll den versionierten Dev-Server verwenden');
  // Die referenzierte Startdatei existiert versioniert im Repository.
  await access(new URL('../scripts/dev-server.mjs', import.meta.url));
});

test('main entry is not the unversioned server.js', () => {
  assert.notEqual(pkg.main, 'server.js', 'main darf nicht auf die unversionierte server.js zeigen');
});

test('no runtime dependencies are required (fresh checkout is startfähig)', () => {
  const deps = { ...(pkg.dependencies || {}) };
  assert.deepEqual(deps, {}, 'Phase 1 benötigt keine externen Laufzeit-Abhängigkeiten');
});
