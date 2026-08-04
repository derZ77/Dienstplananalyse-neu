import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3G.3 – minimal neutral matching status UI (no dashboard, no detail list).
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../js/v2/import/multi-document-import-controller.js', import.meta.url), 'utf8');

test('a single neutral matching status region is present', () => {
  assert.match(html, /id="match-result"/);
});

test('the existing status regions are still present', () => {
  for (const id of ['pdf-import-result', 'companion-import-result', 'combination-result', 'file-input', 'companion-file-input']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('the bootstrap renders the matching status without storage/network', () => {
  assert.match(bootstrap, /match-result/);
  assert.doesNotMatch(bootstrap, /localStorage|sessionStorage|indexedDB|fetch\s*\(/);
});

test('the matching status messages are neutral (no Lenkzeit / 1-6 / score / trip / stop detail)', () => {
  // the neutral wording lives in the controller (matchingStatus text)
  assert.match(controller, /strukturell/i);
  assert.doesNotMatch(controller, /Lenkzeit|1\/6|\bscore\b|Haltestelle|Fahrtfolge|Verstoß|Empfehlung/i);
});

test('the matching region shows no per-trip / per-Umlauf table in the markup', () => {
  const region = html.slice(Math.max(0, html.indexOf('match-result') - 300), html.indexOf('match-result') + 300);
  assert.doesNotMatch(region, /<table|<thead|Lenkzeit|Score/i);
});
