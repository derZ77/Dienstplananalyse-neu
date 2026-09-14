/** Phase 8.8I — Pages must not combine a new document shell with stale UI modules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

test('PDF import chain carries the deployment version through to profile detection', () => {
  const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
  const importController = readFileSync(new URL('../js/v2/import/pdf-import-controller.js', import.meta.url), 'utf8');
  const analysisController = readFileSync(new URL('../js/v2/import/pdf-analysis-controller.js', import.meta.url), 'utf8');

  assert.match(bootstrap, new RegExp(`pdf-import-controller\\.js\\?v=${ASSET_VERSION}`));
  assert.match(importController, new RegExp(`pdf-analysis-controller\\.js\\?v=${ASSET_VERSION}`));
  assert.match(importController, new RegExp(`document-profile-detector\\.js\\?v=${ASSET_VERSION}`));
  assert.match(analysisController, new RegExp(`document-profile-detector\\.js\\?v=${ASSET_VERSION}`));
});
