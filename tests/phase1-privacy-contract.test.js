import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
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

const productionFiles = [
  join(ROOT, 'index.html'),
  ...(await walk(join(ROOT, 'js'), ['.js', '.mjs'])),
  ...(await walk(join(ROOT, 'scripts'), ['.js', '.mjs']))
];
const rel = f => relative(ROOT, f);

test('no persistent browser storage of Dienstplan data in production files', async () => {
  const banned = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'];
  const offenders = [];
  for (const file of productionFiles) {
    const text = await readFile(file, 'utf8');
    for (const b of banned) if (text.includes(b)) offenders.push(`${rel(file)} -> ${b}`);
  }
  assert.deepEqual(offenders, [], 'Persistente Speicherung gefunden:\n' + offenders.join('\n'));
});

test('no service worker / cache-storage usage (imports cannot be cached)', async () => {
  const offenders = [];
  for (const file of productionFiles) {
    const text = await readFile(file, 'utf8');
    if (/serviceWorker\s*\.\s*register/.test(text)) offenders.push(`${rel(file)} -> serviceWorker.register`);
    if (/\bcaches\s*\.\s*(open|match|add)/.test(text)) offenders.push(`${rel(file)} -> Cache API`);
  }
  assert.deepEqual(offenders, [], 'Service-Worker-/Cache-Nutzung gefunden:\n' + offenders.join('\n'));

  // In Phase 1 existiert kein Service-Worker-Skript (kein Cache kann Importe enthalten).
  for (const sw of ['sw.js', 'service-worker.js']) {
    let exists = true;
    try { await access(join(ROOT, sw)); } catch { exists = false; }
    assert.equal(exists, false, `${sw} sollte in Phase 1 nicht existieren`);
  }
});

test('legacy analysis does not log data to the browser console', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /console\.log\s*\(/, 'index.html darf keine console.log-Ausgaben (Dienstplandaten) enthalten');
});
