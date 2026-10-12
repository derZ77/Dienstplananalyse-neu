import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.DOMMatrix ||= class DOMMatrix {};
const { attachTimeChangeNotice } = await import('../js/v2/import/pdf-analysis-controller.js');
const { createOriginalBlockViewModel } = await import('../js/v2/blocks/block-orchestrator.js');

const schedule = () => ({
  type: 'CanonicalSchedule', services: [], activities: [], interruptions: [], warnings: [],
  document: { sourceType: 'pdf', pageCount: 1 }, metadata: {}, validity: { dayType: 'saturday' }
});

test('Zeitumstellung erhält Quelldaten und macht ungeklärte Zeitbasis sichtbar', () => {
  const original = schedule();
  const result = attachTimeChangeNotice(original, 'Dienste Samstag Zeitumstellung am 24.10.2026');
  assert.equal(result.services, original.services);
  assert.equal(result.activities, original.activities);
  assert.equal(original.warnings.length, 0);
  assert.equal(result.warnings[0].code, 'TIME_CHANGE_REQUIRES_REVIEW');
  const view = createOriginalBlockViewModel(result);
  assert.match(view.planTypeText, /Zeitumstellung/);
  assert.match(view.planTypeText, /PDF/);
  assert.match(view.planTypeText, /Prüfung erforderlich/);
});

test('Normale Dienstpläne erhalten keinen Zeitumstellungshinweis', () => {
  const original = schedule();
  assert.equal(attachTimeChangeNotice(original, 'Dienste Stadtbus Samstag, ab 24.10.2026'), original);
});
