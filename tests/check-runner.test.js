import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheckModules, toCheckReportDebugJson } from '../js/v2/checks/check-runner.js';

const analysisResult = {
  type: 'AnalysisResult',
  document: {},
  services: [],
  statistics: {},
  issues: [],
  warnings: [],
  metadata: { schemaVersion: '1.0' }
};

function dummyModule({ id, name = id, category, priority = 0, enabled = true, run }) {
  return { id, name, category, priority, enabled, run };
}

function result(id, category, status = 'PASS') {
  return {
    id,
    name: id,
    category,
    severity: status === 'FAIL' ? 'VIOLATION' : 'INFO',
    status,
    message: `Dummy ${id}`,
    details: { fixture: true },
    affectedServices: ['service:1'],
    affectedActivities: [],
    sourceReferences: []
  };
}

test('CheckRunner führt mehrere Kategorien in Prioritätsreihenfolge aus und normalisiert CheckResults', async () => {
  const order = [];
  const report = await runCheckModules(analysisResult, [
    dummyModule({ id: 'custom-low', category: 'CUSTOM', priority: 1, run: () => { order.push('low'); return result('custom-low', 'CUSTOM'); } }),
    dummyModule({ id: 'internal-high', category: 'INTERNAL', priority: 10, run: () => { order.push('high'); return [result('pass', 'INTERNAL'), result('hit', 'INTERNAL', 'FAIL')]; } })
  ]);

  assert.deepEqual(order, ['high', 'low']);
  assert.equal(report.results.length, 3);
  assert.equal(report.summary.hitCount, 1);
  assert.equal(report.summary.errorCount, 0);
  assert.equal(report.moduleRuns[0].id, 'internal-high');
  assert.doesNotThrow(() => JSON.parse(toCheckReportDebugJson(report)));
});

test('CheckRunner filtert Kategorien und deaktiviert Module ohne Ausführung', async () => {
  let executed = false;
  const report = await runCheckModules(analysisResult, [
    dummyModule({ id: 'bv', category: 'BV', run: () => result('bv', 'BV') }),
    dummyModule({ id: 'arbzg', category: 'ARBZG', enabled: false, run: () => result('arbzg', 'ARBZG') }),
    dummyModule({ id: 'custom', category: 'CUSTOM', run: () => { executed = true; return result('custom', 'CUSTOM'); } })
  ], { categories: ['BV', 'ARBZG'] });

  assert.equal(executed, false);
  assert.deepEqual(report.results.map(entry => entry.id), ['bv']);
  assert.deepEqual(report.disabledModules.map(entry => [entry.id, entry.reason]), [
    ['arbzg', 'module-disabled'],
    ['custom', 'category-filtered']
  ]);
  assert.equal(report.summary.disabledModuleCount, 2);
});

test('CheckRunner isoliert Ausnahmen und führt nachfolgende Module weiter aus', async () => {
  const report = await runCheckModules(analysisResult, [
    dummyModule({ id: 'throws', category: 'INTERNAL', priority: 10, run: () => { throw new Error('isolierter Fehler'); } }),
    dummyModule({ id: 'after-error', category: 'CUSTOM', run: () => result('after-error', 'CUSTOM', 'FAIL') })
  ]);

  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].message, 'isolierter Fehler');
  assert.deepEqual(report.results.map(entry => entry.id), ['after-error']);
  assert.equal(report.moduleRuns[0].status, 'ERROR');
  assert.equal(report.moduleRuns[1].status, 'COMPLETED');
});

test('CheckRunner misst Laufzeiten und akzeptiert nur AnalysisResult sowie gültige Schnittstellenwerte', async () => {
  const report = await runCheckModules(analysisResult, [
    dummyModule({ id: 'performance', category: 'WAGENKARTE', run: async () => result('performance', 'WAGENKARTE') })
  ], { disabledModuleIds: [] });

  assert.ok(report.summary.totalDurationMs >= 0);
  assert.ok(report.moduleRuns[0].durationMs >= 0);
  await assert.rejects(() => runCheckModules({ type: 'CanonicalSchedule' }, []), /AnalysisResult/);
  await assert.rejects(() => runCheckModules(analysisResult, [dummyModule({ id: 'invalid-category', category: 'UNKNOWN', run: () => null })]), /Unsupported CheckModule category/);
});
