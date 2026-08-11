/** Phase 8.9 — Pages must not combine a new document shell with stale UI modules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Phase 8.9: Pages entry modules and changed dashboard/block modules carry one cache version', () => {
  assert.match(html, /type="importmap"/);
  for (const module of [
    'ui/review-dashboard.js',
    'blocks/block-renderer.js',
    'blocks/block-orchestrator.js'
  ]) {
    assert.match(html, new RegExp(`/Dienstplananalyse-neu/js/v2/${module.replace('.', '\\.')}`));
  }
  assert.match(html, /pdf-import-bootstrap\.js\?v=phase8\.9/);
  assert.match(html, /check-explorer-bootstrap\.js\?v=phase8\.9/);
});
