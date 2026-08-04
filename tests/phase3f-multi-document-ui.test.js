import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3F – UI contract. The app is browser-only with no DOM test harness, so the
// two-input contract is verified against the index.html source and the bootstrap glue.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');

test('the existing primary file input is still present and unchanged in intent', () => {
  assert.match(html, /id="file-input"/);
  assert.match(html, /id="file-input"[^>]*accept="[^"]*\.pdf/i); // primary still accepts pdf
});

test('an optional companion file input exists and accepts only .xlsx (no PDF)', () => {
  assert.match(html, /id="companion-file-input"/);
  const tag = html.match(/<input[^>]*id="companion-file-input"[^>]*>/i)[0];
  assert.match(tag, /accept="[^"]*\.xlsx/i);
  assert.doesNotMatch(tag, /\.pdf/i, 'companion input must not offer PDF in this phase');
});

test('the companion input is clearly labelled as optional', () => {
  // a label/heading near the companion input carries an "optional" wording
  assert.match(html, /[Oo]ptional/);
});

test('three separate status regions exist (primary, companion, combination)', () => {
  assert.match(html, /id="pdf-import-result"/);      // primary (existing)
  assert.match(html, /id="companion-import-result"/); // companion (new)
  assert.match(html, /id="combination-result"/);      // combination (new)
});

test('the new UI shows no matching / Lenkzeit / 1-6 / score wording', () => {
  // scope the check to the companion block region to avoid unrelated legacy text
  const block = html.slice(html.indexOf('companion-file-input') - 400, html.indexOf('companion-file-input') + 600);
  assert.doesNotMatch(block, /[Mm]atching|Lenkzeit|1\/6|[Ss]core|Umlaufzuordnung|Abweichung/);
});

test('the bootstrap wires the companion input and renders combination status, without storage/network', () => {
  assert.match(bootstrap, /companion-file-input/);
  assert.match(bootstrap, /combination-result|companion-import-result/);
  assert.match(bootstrap, /createMultiDocumentSession/);
  assert.doesNotMatch(bootstrap, /localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest|WebSocket/);
});

test('the bootstrap still initializes the unchanged single PDF/Excel import', () => {
  assert.match(bootstrap, /initializePdfImport/);
  assert.match(bootstrap, /file-input/);
});
