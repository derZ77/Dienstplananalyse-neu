import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3H.6 – the session→explorer bridge. It only hands the EXISTING CheckReport to the
// EXISTING explorer controller: no second report, no re-aggregation, no new status/severity,
// no BV008-specific interpretation, no storage, no network.
import { createCheckExplorerSessionBridge } from '../js/v2/explorer/check-explorer-session-bridge.js';

const src = readFileSync(new URL('../js/v2/explorer/check-explorer-session-bridge.js', import.meta.url), 'utf8');

const checkResult = (status, severity) => ({ id: 'BV008', name: 'BV008 Maximale ununterbrochene Lenkzeit', category: 'BV', severity, status, message: 'm', details: {}, affectedServices: [], affectedActivities: [], sourceReferences: [] });
const report = (status = 'PASS', severity = 'INFO') => ({ type: 'CheckReport', results: [checkResult(status, severity)], errors: [], summary: { hitCount: status === 'FAIL' ? 1 : 0, resultCount: 1 } });

function fakeController({ throwOnSet = false } = {}) {
  const calls = { set: [], clear: 0 };
  return {
    calls,
    controller: {
      setCheckReport(next) { if (throwOnSet) throw new TypeError('boom'); calls.set.push(next); },
      clear() { calls.clear += 1; }
    }
  };
}
const bridgeWith = (opts) => { const f = fakeController(opts); return { ...f, bridge: createCheckExplorerSessionBridge({ explorerController: f.controller }) }; };

test('the bridge contains no rule/aggregation/storage/network logic of its own', () => {
  assert.doesNotMatch(src, /1\/6|BV015|ArbZG|Blockpause|Wendezeit|VIOLATION|hitCount|localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest/i);
});

// ===== report handover =====
test('a PASS report is handed to the explorer unchanged (same reference)', () => {
  const { bridge, calls } = bridgeWith();
  const r = report('PASS', 'INFO');
  const outcome = bridge.setCheckReport(r);
  assert.equal(outcome.applied, true);
  assert.equal(calls.set.length, 1);
  assert.equal(calls.set[0], r, 'the very same CheckReport object is passed through');
});
test('a FAIL report is handed through unchanged', () => {
  const { bridge, calls } = bridgeWith();
  const r = report('FAIL', 'VIOLATION');
  bridge.setCheckReport(r);
  assert.equal(calls.set[0], r);
  assert.equal(calls.set[0].results[0].severity, 'VIOLATION');
  assert.equal(calls.set[0].summary.hitCount, 1);
});
test('a SKIP/WARNING report is handed through unchanged', () => {
  const { bridge, calls } = bridgeWith();
  const r = report('SKIP', 'WARNING');
  bridge.setCheckReport(r);
  assert.equal(calls.set[0].results[0].status, 'SKIP');
  assert.equal(calls.set[0].results[0].severity, 'WARNING');
});
test('a NOT_APPLICABLE report is handed through unchanged', () => {
  const { bridge, calls } = bridgeWith();
  bridge.setCheckReport(report('NOT_APPLICABLE', 'INFO'));
  assert.equal(calls.set[0].results[0].status, 'NOT_APPLICABLE');
});

// ===== empty / reset =====
test('no report never throws and leaves an already empty explorer untouched', () => {
  const { bridge, calls } = bridgeWith();
  let outcome;
  assert.doesNotThrow(() => { outcome = bridge.setCheckReport(null); });
  assert.equal(outcome.applied, true);
  assert.equal(calls.set.length, 0);
  assert.equal(calls.clear, 0, 'no redundant re-render of the existing empty state');
});
test('a report followed by no report clears the explorer', () => {
  const { bridge, calls } = bridgeWith();
  bridge.setCheckReport(report());
  const outcome = bridge.setCheckReport(null);
  assert.equal(outcome.applied, true);
  assert.equal(calls.clear, 1);
});
test('clearCheckReport() clears the explorer', () => {
  const { bridge, calls } = bridgeWith();
  bridge.setCheckReport(report());
  bridge.clearCheckReport();
  assert.equal(calls.clear, 1);
});
test('a report change replaces the previous one', () => {
  const { bridge, calls } = bridgeWith();
  const a = report('PASS', 'INFO');
  const b = report('FAIL', 'VIOLATION');
  bridge.setCheckReport(a);
  bridge.setCheckReport(b);
  assert.deepEqual(calls.set, [a, b]);
});
test('setting the same reference twice does not update the explorer again', () => {
  const { bridge, calls } = bridgeWith();
  const r = report();
  bridge.setCheckReport(r);
  bridge.setCheckReport(r);
  assert.equal(calls.set.length, 1);
});
test('clearing twice does not clear the explorer again', () => {
  const { bridge, calls } = bridgeWith();
  bridge.setCheckReport(report());
  bridge.clearCheckReport();
  bridge.clearCheckReport();
  assert.equal(calls.clear, 1);
});
test('after a clear the same report can be applied again', () => {
  const { bridge, calls } = bridgeWith();
  const r = report();
  bridge.setCheckReport(r);
  bridge.clearCheckReport();
  bridge.setCheckReport(r);
  assert.equal(calls.set.length, 2);
});

// ===== error isolation =====
test('an invalid report is rejected in a controlled way and keeps the previous explorer state', () => {
  const { bridge, calls } = bridgeWith();
  const valid = report();
  bridge.setCheckReport(valid);
  const outcome = bridge.setCheckReport({ type: 'SomethingElse', results: [] });
  assert.equal(outcome.applied, false);
  assert.equal(outcome.reason, 'INVALID_CHECK_REPORT');
  assert.equal(calls.set.length, 1, 'the invalid report never reaches the explorer');
  assert.equal(calls.clear, 0, 'a valid previous report is not destroyed');
});
test('a missing explorer controller is handled without throwing', () => {
  const bridge = createCheckExplorerSessionBridge({ explorerController: null });
  const outcome = bridge.setCheckReport(report());
  assert.equal(outcome.applied, false);
  assert.equal(outcome.reason, 'NO_EXPLORER_CONTROLLER');
});
test('an explorer that throws is isolated (no throw to the caller)', () => {
  const { bridge } = bridgeWith({ throwOnSet: true });
  let outcome;
  assert.doesNotThrow(() => { outcome = bridge.setCheckReport(report()); });
  assert.equal(outcome.applied, false);
  assert.equal(outcome.reason, 'EXPLORER_UPDATE_FAILED');
});
test('a lazily resolved controller is picked up when it becomes available', () => {
  const f = fakeController();
  let available = null;
  const bridge = createCheckExplorerSessionBridge({ explorerController: () => available });
  assert.equal(bridge.setCheckReport(report()).applied, false); // not ready yet
  available = f.controller;
  assert.equal(bridge.setCheckReport(report()).applied, true);
  assert.equal(f.calls.set.length, 1);
});

// ===== dispose =====
test('after dispose() the bridge no longer touches the explorer', () => {
  const { bridge, calls } = bridgeWith();
  bridge.dispose();
  const outcome = bridge.setCheckReport(report());
  assert.equal(outcome.applied, false);
  assert.equal(outcome.reason, 'DISPOSED');
  bridge.clearCheckReport();
  assert.equal(calls.set.length, 0);
  assert.equal(calls.clear, 0);
});
