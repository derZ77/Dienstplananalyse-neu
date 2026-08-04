import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3H.5 – a single neutral rule-analysis status region. No detail table, no per-trip / per-
// service / per-time data, no scores, no recommendations. Existing status regions stay intact.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../js/v2/import/multi-document-import-controller.js', import.meta.url), 'utf8');

test('a single neutral rule-analysis status region is present', () => {
  assert.match(html, /id="rule-analysis-result"/);
});

test('the existing status regions are still present', () => {
  for (const id of ['pdf-import-result', 'companion-import-result', 'combination-result', 'match-result', 'file-input', 'companion-file-input']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('the bootstrap renders the rule-analysis status and triggers the analysis, without storage/network', () => {
  assert.match(bootstrap, /rule-analysis-result/);
  assert.match(bootstrap, /analyzeRules/);
  assert.doesNotMatch(bootstrap, /localStorage|sessionStorage|indexedDB|fetch\s*\(/);
});

test('the rule-analysis status messages are neutral (no service numbers, times, trips, scores, recommendations, or other rules)', () => {
  assert.doesNotMatch(controller, /Lenkzeit|1\/6|\bscore\b|Haltestelle|Fahrtfolge|Verstoß|Empfehlung|ArbZG|Blockpause/i);
  // the neutral rule-analysis wording exists in the controller
  assert.match(controller, /regelbasierte Prüfung|BV008 wurde geprüft|bestätigte Abweichung/i);
});

test('the rule-analysis region shows no per-trip / per-service table in the markup', () => {
  const idx = html.indexOf('rule-analysis-result');
  const region = html.slice(Math.max(0, idx - 300), idx + 300);
  assert.doesNotMatch(region, /<table|<thead|Lenkzeit|Score/i);
});

test('the bootstrap does not reach into the rule logic directly (goes through the session)', () => {
  assert.doesNotMatch(bootstrap, /evaluateDrivingTimeLimit|createDrivingTimeLimitCheck|runCheckModules/);
});
