/** Phase 8.8B — full-analysis print stays useful without changing any analysis data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Phase 8.8B: paper retains blocks 1–10 and the report, but removes input and search controls', () => {
  for (const id of ['plan-type-result', 'count-result', 'shared-result', 'reserve-result', 'long-result', 'loc-result', 'segment-result', 'real-driving-time-result', 'shift-result', 'route-result', 'pause-result', 'pruefbericht']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /id="print-excluded-controls"/);
  assert.match(html, /@media print[\s\S]{0,800}#print-excluded-controls[^{]*\{[^}]*display:\s*none/);
  assert.match(html, /@media print[\s\S]{0,1100}#check-explorer[^{]*\{[^}]*display:\s*none/);
});

test('Phase 8.8B: A4 output protects headings and result boxes from bad page breaks', () => {
  assert.match(html, /@page\s*\{[^}]*size:\s*A4\s+portrait/);
  assert.match(html, /h1, h2, h3\s*\{[^}]*break-after:\s*avoid/);
  assert.match(html, /\.result, \.result-status\s*\{[^}]*break-inside:\s*avoid/);
  assert.match(html, /\.report-result[^{]*\{[^}]*break-inside:\s*avoid/);
});

test('Phase 8.8B: status labels and their secondary print colours survive together', () => {
  assert.match(html, /print-color-adjust:\s*exact/);
  assert.match(html, /report-status\[data-status="FAIL"\][^{]*\{[^}]*#b73524/);
  assert.match(html, /report-status\[data-status="PASS"\][^{]*\{[^}]*#2e7d32/);
  assert.match(html, /report-status\[data-status="SKIP"\][\s\S]*NOT_APPLICABLE/);
  assert.doesNotMatch(html, /#pruefbericht \.report-status \{ border: 1pt solid #000; color: #000 !important; \}/);
});

test('Phase 8.8B: compact web details expand for paper rather than losing long lists', () => {
  assert.match(html, /\.result-details > summary\s*\{ display: none !important/);
  assert.match(html, /\.result-details:not\(\[open\]\) > :not\(summary\)\s*\{ display: block !important/);
});
