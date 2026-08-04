import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'tests', 'docs', '.git']);

async function walk(dir, exts, acc = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(p, exts, acc);
    } else if (exts.some(x => e.name.endsWith(x))) {
      acc.push(p);
    }
  }
  return acc;
}

// Produktive App-Dateien: index.html + js/** + scripts/** — ohne vendor/tests/docs/node_modules.
const productionFiles = [
  join(ROOT, 'index.html'),
  ...(await walk(join(ROOT, 'js'), ['.js', '.mjs'])),
  ...(await walk(join(ROOT, 'scripts'), ['.js', '.mjs']))
];
const rel = f => relative(ROOT, f);

// Lokale Hosts sind erlaubt; alles andere ist ein externer Laufzeitzugriff.
const ALLOWED_HOST = /^(localhost|127\.0\.0\.1)/;
const FORBIDDEN_HOSTS = [
  'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com',
  'cdnjs.cloudflare.com', 'onrender.com', 'openrouter.ai', 'api.openai.com',
  'api.anthropic.com', 'google-analytics.com', 'googletagmanager.com'
];

test('production files scanned (guard against empty scan)', () => {
  assert.ok(productionFiles.length >= 3, 'Es sollten produktive Dateien gefunden werden');
});

test('no external runtime URLs in production HTML/JS', async () => {
  const offenders = [];
  for (const file of productionFiles) {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/https?:\/\/([^/"'`\s)]+)/g)) {
      if (!ALLOWED_HOST.test(m[1])) offenders.push(`${rel(file)} -> ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], 'Externe URLs im produktiven Code:\n' + offenders.join('\n'));
});

test('no known CDN / AI / analytics hosts in production files', async () => {
  const offenders = [];
  for (const file of productionFiles) {
    const text = await readFile(file, 'utf8');
    for (const host of FORBIDDEN_HOSTS) if (text.includes(host)) offenders.push(`${rel(file)} -> ${host}`);
  }
  assert.deepEqual(offenders, [], 'Verbotene Hosts:\n' + offenders.join('\n'));
});

test('index.html carries a CSP that blocks external connections', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy"/, 'CSP-Meta fehlt');
  assert.match(html, /default-src 'self'/, "default-src 'self' fehlt");
  assert.match(html, /connect-src 'none'/, "connect-src 'none' fehlt (externe Verbindungen müssen blockiert sein)");
});

test('index.html contains no network primitives (AI removed)', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\bfetch\s*\(/, 'index.html darf keine fetch-Aufrufe enthalten');
  assert.doesNotMatch(html, /new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|navigator\.sendBeacon/, 'keine Netzwerk-Primitive erlaubt');
});
