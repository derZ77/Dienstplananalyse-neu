import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRuleGroups } from '../js/v2/rules/rule-engine.js';

function createCanonicalSchedule() {
  return {
    type: 'CanonicalSchedule',
    document: { sourceType: 'test' },
    services: [],
    activities: [
      { id: 'activity:1', rawActivity: 'Pause bezahlt', circuitNumber: 'A-17', source: { pageNumber: 1 } },
      { id: 'activity:2', rawActivity: 'Dienstfahrt', circuitNumber: 'B-25', source: { pageNumber: 2 } }
    ],
    interruptions: [],
    warnings: [],
    metadata: {}
  };
}

test('unterstützt exact, contains, regex, prefix, suffix und ignore case als Regeldaten', () => {
  const rules = [{ id: 'operators', rules: [
    { id: 'exact', priority: 6, target: 'activities', match: { field: 'rawActivity', operator: 'exact', value: 'pause bezahlt', ignoreCase: true }, action: { type: 'annotate', value: 'exact' } },
    { id: 'contains', priority: 5, target: 'activities', match: { field: 'rawActivity', operator: 'contains', value: 'bezahlt' }, action: { type: 'annotate', value: 'contains' } },
    { id: 'regex', priority: 4, target: 'activities', match: { field: 'circuitNumber', operator: 'regex', value: '^A-\\d+$' }, action: { type: 'annotate', value: 'regex' } },
    { id: 'prefix', priority: 3, target: 'activities', match: { field: 'rawActivity', operator: 'prefix', value: 'Dienst' }, action: { type: 'annotate', value: 'prefix' } },
    { id: 'suffix', priority: 2, target: 'activities', match: { field: 'circuitNumber', operator: 'suffix', value: '25' }, action: { type: 'annotate', value: 'suffix' } }
  ] }];
  const result = applyRuleGroups(createCanonicalSchedule(), rules);

  assert.deepEqual(result.activities[0].ruleAnnotations.map(item => item.value), ['exact', 'contains', 'regex']);
  assert.deepEqual(result.activities[1].ruleAnnotations.map(item => item.value), ['prefix', 'suffix']);
});

test('wertet Regelgruppen und Prioritäten aus und erlaubt Mehrfachtreffer', () => {
  const result = applyRuleGroups(createCanonicalSchedule(), [
    { id: 'lower-priority-group', priority: 1, rules: [
      { id: 'lower', priority: 1, target: 'activities', match: { field: 'rawActivity', operator: 'contains', value: 'Pause' }, action: { type: 'annotate', value: 'lower' } }
    ] },
    { id: 'higher-priority-group', priority: 10, rules: [
      { id: 'higher', priority: 10, target: 'activities', match: { field: 'rawActivity', operator: 'contains', value: 'Pause' }, action: { type: 'annotate', value: 'higher' } }
    ] }
  ]);

  assert.deepEqual(result.activities[0].ruleAnnotations.map(item => item.value), ['higher', 'lower']);
  assert.equal(result.metadata.ruleEngine.matchCount, 2);
  assert.deepEqual(result.metadata.ruleEngine.appliedGroupIds, ['higher-priority-group', 'lower-priority-group']);
});

test('erzeugt Warnungen und belässt bei keinem Treffer den Schedule unverändert', () => {
  const original = createCanonicalSchedule();
  const result = applyRuleGroups(original, [{ id: 'warnings', rules: [
    { id: 'warn', target: 'activities', match: { field: 'rawActivity', operator: 'contains', value: 'Pause' }, action: { type: 'warning', message: 'Generische Warnung' } },
    { id: 'no-match', target: 'activities', match: { field: 'rawActivity', operator: 'exact', value: 'unmatched' }, action: { type: 'warning', message: 'Nicht sichtbar' } }
  ] }]);

  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].message, 'Generische Warnung');
  assert.equal(result.metadata.ruleEngine.matchCount, 1);
  assert.deepEqual(original.warnings, [], 'die Eingabe wird nicht mutiert');
});

test('liefert bei keinen Treffern keine Warnung und keine Annotation', () => {
  const result = applyRuleGroups(createCanonicalSchedule(), [{ id: 'no-hits', rules: [
    { id: 'missing', target: 'activities', match: { field: 'rawActivity', operator: 'exact', value: 'nicht vorhanden' }, action: { type: 'warning', message: 'Nicht erzeugen' } }
  ] }]);

  assert.equal(result.metadata.ruleEngine.matchCount, 0);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.activities.every(activity => !('ruleAnnotations' in activity)));
});
