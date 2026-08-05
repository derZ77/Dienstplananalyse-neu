import test from 'node:test';
import assert from 'node:assert/strict';

import { clearOriginalBlocks, renderOriginalBlocks } from '../js/v2/blocks/block-renderer.js';

test('Block-Renderer schreibt ausschließlich in die vorhandenen Original-Ziele', () => {
  const elements = new Map([
    ['plan-type-result', {}], ['count-result', {}], ['shared-result', {}], ['reserve-result', {}],
    ['long-result', {}], ['loc-result', {}], ['segment-result', {}], ['real-driving-time-result', {}],
    ['shift-result', {}], ['route-result', {}], ['pause-result', {}]
  ]);
  const document = { getElementById: id => elements.get(id) ?? null };
  const blocks = {
    planTypeText: 'Plan', countText: 'Anzahl', sharedText: 'Geteilt', reserveText: 'Reserve',
    longText: 'Lang', locText: 'Orte', segmentText: 'Teile', realDrivingTimeText: 'Lenkzeit',
    shiftText: 'Schicht', shiftHtml: '', routeText: 'Linie', pauseHtml: 'Pausen'
  };

  renderOriginalBlocks(blocks, { document });

  assert.equal(elements.get('plan-type-result').textContent, 'Plan');
  assert.equal(elements.get('shift-result').textContent, 'Schicht');
  assert.equal(elements.get('pause-result').textContent, 'Pausen');
});

test('Block-Renderer leert die vorhandenen Ziele beim Entfernen der Primärdatei', () => {
  const element = { textContent: 'alter Wert' };
  const document = { getElementById: () => element };

  clearOriginalBlocks({ document });

  assert.equal(element.textContent, '-');
});
