import test from 'node:test';
import assert from 'node:assert/strict';

const MC = await import('../js/v2/matching/match-contract.js');

test('automation is allowed ONLY for exact matches', () => {
  assert.ok(MC.isAutomationAllowed('exact'));
  for (const status of ['probable', 'ambiguous', 'unmatched', 'conflicting']) {
    assert.ok(!MC.isAutomationAllowed(status), status);
  }
});

test('probable requires manual confirmation; unsafe states block automatic decisions', () => {
  assert.ok(MC.requiresManualConfirmation('probable'));
  assert.ok(!MC.requiresManualConfirmation('exact'));
  for (const status of ['ambiguous', 'unmatched', 'conflicting']) {
    assert.ok(MC.blocksAutomaticDecision(status), status);
  }
  assert.ok(!MC.blocksAutomaticDecision('exact'));
});

test('createMatchResult validates status and shape', () => {
  const r = MC.createMatchResult({ status: 'exact', score: 1, reasons: ['umlauf'], primaryRefs: ['a'], companionRefs: ['b'] });
  assert.equal(r.status, 'exact');
  assert.deepEqual([...r.reasons], ['umlauf']);
  assert.ok(Object.isFrozen(r));
  for (const status of ['exact', 'probable', 'ambiguous', 'unmatched', 'conflicting']) {
    assert.equal(MC.createMatchResult({ status }).status, status);
  }
  assert.throws(() => MC.createMatchResult({ status: 'perfect' }), TypeError);
  assert.throws(() => MC.createMatchResult({ status: 'exact', score: 'high' }), TypeError);
  assert.throws(() => MC.createMatchResult({ status: 'exact', reasons: 'x' }), TypeError);
});

test('comparison features are documented', () => {
  for (const feature of ['serviceNumber', 'umlauf', 'line', 'course', 'trip', 'departureTime', 'arrivalTime', 'startLocation', 'endLocation', 'sequence']) {
    assert.ok(MC.MATCH_COMPARISON_FEATURES.includes(feature), feature);
  }
});
