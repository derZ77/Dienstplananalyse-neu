/** Phase 8.8I — Pages must not combine a new document shell with stale UI modules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, normalize } from 'node:path/posix';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSET_VERSION = 'phase9.10';
const basePath = '/Dienstplananalyse-neu/';
const localAssetPath = assetPath => `${ROOT}/${assetPath.replace(basePath, '')}`;

test('Phase 8.8I: Pages entry modules and changed dashboard/block modules carry one cache version', () => {
  assert.match(html, /type="importmap"/);
  for (const module of [
    'ui/review-dashboard.js',
    'blocks/block-renderer.js',
    'blocks/block-orchestrator.js'
  ]) {
    const assetPath = `${basePath}js/v2/${module}`;
    assert.match(html, new RegExp(`${assetPath.replace(/[.?]/g, '\\$&')}\\?v=${ASSET_VERSION}`));
    assert.equal(existsSync(localAssetPath(assetPath)), true, `${module} muss als Importziel existieren`);
  }
  for (const entry of ['pdf-import-bootstrap.js', 'check-explorer-bootstrap.js']) {
    const assetPath = `js/v2/${entry}`;
    assert.match(html, new RegExp(`${assetPath.replace('.', '\\.')}\\?v=${ASSET_VERSION}`));
    assert.equal(existsSync(`${ROOT}/${assetPath}`), true, `${entry} muss als Entry-Modul existieren`);
  }
});

test('Phase 8.8I: the midnight Block-10 module is explicitly cache-busted by the deployment version', () => {
  assert.match(html, new RegExp(`block-orchestrator\\.js\\?v=${ASSET_VERSION}`));
  assert.doesNotMatch(html, /block-orchestrator\.js\?v=phase8\.9/);
});

test('the productive PDF module graph is recursively cache-versioned', () => {
  const pending = ['js/v2/pdf-import-bootstrap.js'];
  const visited = new Set();
  const unversioned = [];
  const mismatched = [];
  const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const isPdfPipelineModule = path => {
    const name = path.split('/').at(-1);
    return path.startsWith('js/v2/pdf/') ||
      path.startsWith('js/v2/import/pdf-') ||
      path.startsWith('js/v2/umlauftafel/pdf-') ||
      path.startsWith('js/v2/umlauftafel/umlauftafel-') ||
      /^canonical-(?:interruption|validity)\.js$/.test(name) ||
      /^identity-normalization\.js$/.test(name);
  };

  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readFileSync(`${ROOT}/${path}`, 'utf8');

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] || match[2];
      if (!specifier.startsWith('.')) continue;
      const [relative, query = ''] = specifier.split('?');
      const resolved = normalize(`${dirname(path)}/${relative}`);
      if (!resolved.startsWith('js/v2/')) continue;
      if (!isPdfPipelineModule(resolved)) continue;

      if (!query) unversioned.push(`${path} → ${specifier}`);
      else if (query !== `v=${ASSET_VERSION}`) mismatched.push(`${path} → ${specifier}`);
      pending.push(resolved);
    }
  }

  for (const path of [
    'js/v2/pdf/pdf-core.js', 'js/v2/pdf/layout-reconstruction.js',
    'js/v2/pdf/document-profile-detector.js', 'js/v2/pdf/document-normalizer.js',
    'js/v2/pdf/schedule-mapper.js', 'js/v2/pdf/hardened-schedule.js',
    'js/v2/import/pdf-analysis-controller.js', 'js/v2/import/pdf-import-controller.js'
  ]) assert.ok(visited.has(path), `PDF import graph must include ${path}`);
  assert.deepEqual(unversioned, []);
  assert.deepEqual(mismatched, []);
});
