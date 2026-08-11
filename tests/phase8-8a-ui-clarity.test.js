import test from 'node:test';
import assert from 'node:assert/strict';

import { renderOriginalBlocks } from '../js/v2/blocks/block-renderer.js';
import { createReviewDashboardModel } from '../js/v2/ui/review-dashboard.js';

test('Phase 8.8A: an empty CheckReport keeps recognized duties distinct from assessed and unremarkable duties', () => {
  const schedule = {
    type: 'CanonicalSchedule',
    services: [{ serviceNumber: '101' }, { serviceNumber: '102' }]
  };
  const model = createReviewDashboardModel({ type: 'CheckReport', results: [] }, { canonicalSchedule: schedule });

  assert.equal(model.reportState, 'empty');
  assert.equal(model.statistics.recognizedServices, 2);
  assert.equal(model.statistics.evaluatedServices, 0);
  assert.equal(model.statistics.attentionServices, 0);
  assert.equal(model.statistics.unremarkableServices, null);
});

test('Phase 8.8A: long web result lists are compact while retaining every rendered detail', () => {
  const target = { innerHTML: '' };
  const document = { getElementById: id => id === 'loc-result' ? target : null };
  const list = Array.from({ length: 15 }, (_, index) => `Dienst ${index + 1}: Ort A → Ort B`).join('\n');

  renderOriginalBlocks({ locText: list }, { document });

  assert.match(target.innerHTML, /<details class="result-details">/);
  assert.match(target.innerHTML, /Dienstort-Details anzeigen \(15\)/);
  assert.match(target.innerHTML, /Dienst 15: Ort A → Ort B/);
});

test('Phase 8.8A: short result lists remain immediately visible', () => {
  const target = { innerHTML: '' };
  const document = { getElementById: id => id === 'route-result' ? target : null };

  renderOriginalBlocks({ routeText: 'ID | Zeitbereich | Start → Ziel\n101 | 06:00–07:00 | A → B' }, { document });

  assert.doesNotMatch(target.innerHTML, /<details/);
  assert.match(target.innerHTML, /101 \| 06:00–07:00/);
});

test('Phase 8.8A: long HTML-based shift assignments use the same compact web treatment', () => {
  const target = { innerHTML: '' };
  const document = { getElementById: id => id === 'shift-result' ? target : null };
  const list = Array.from({ length: 15 }, (_, index) => `Dienst ${index + 1}: F1`).join('\n');

  renderOriginalBlocks({ shiftText: list, shiftHtml: '<div>vollständige Schichtzuordnung</div>' }, { document });

  assert.match(target.innerHTML, /<details class="result-details">/);
  assert.match(target.innerHTML, /Schichtzuordnungen anzeigen \(15\)/);
  assert.match(target.innerHTML, /vollständige Schichtzuordnung/);
});
