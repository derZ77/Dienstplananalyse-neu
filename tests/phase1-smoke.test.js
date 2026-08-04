import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticServer } from '../scripts/dev-server.mjs';

async function withServer(run) {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('serves index.html at / with 200 and the app title', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /<title>Dienstplan-Analyse/);
    assert.match(html, /vendor\/xlsx\/xlsx\.full\.min\.js/);
  });
});

test('serves central local runtime assets with javascript content type', async () => {
  await withServer(async (base) => {
    const xlsx = await fetch(base + '/vendor/xlsx/xlsx.full.min.js');
    assert.equal(xlsx.status, 200, 'lokale Excel-Bibliothek muss ausgeliefert werden');
    assert.match(xlsx.headers.get('content-type') || '', /javascript/);

    const mod = await fetch(base + '/js/v2/pdf-import-bootstrap.js');
    assert.equal(mod.status, 200, 'V2-Modul muss ausgeliefert werden');
    assert.match(mod.headers.get('content-type') || '', /javascript/);
  });
});

test('missing files return 404 and only GET/HEAD are allowed', async () => {
  await withServer(async (base) => {
    const missing = await fetch(base + '/does-not-exist.js');
    assert.equal(missing.status, 404);

    const post = await fetch(base + '/', { method: 'POST' });
    assert.equal(post.status, 405, 'keine Uploads/POST erlaubt (keine Persistenz)');
  });
});
