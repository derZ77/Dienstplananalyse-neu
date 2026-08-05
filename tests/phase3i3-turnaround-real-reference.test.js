import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3I.3 – honest read-only inspection of the REAL bus and tram Umlauftafeln. The references
// are only read; nothing is copied into the repository and no original rows are asserted.
import { detectTurnaroundCandidates } from '../js/v2/rules/one-sixth-turnaround-candidates.js';
import { validateTurnaroundDetectionResult } from '../js/v2/rules/one-sixth-turnaround-validation.js';

const BUS = FIXTURES.busUmlauftafelXlsx;
const TRAM = FIXTURES.tramUmlauftafelXlsx;
const present = async (p) => { try { await access(p); return true; } catch { return false; } };

let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

const load = async (path) => {
  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const file = { name: path.split('/').pop(), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arrayBuffer: async () => new Uint8Array(readFileSync(path)).buffer.slice(0) };
  return (await analyzeExcelImport(file)).document;
};

async function assertRealReference(t, path, expectedMode) {
  if (!(xlsxReady && (await present(path)))) return t.skip('real reference / XLSX not available');
  const umlauftafelDocument = await load(path);
  assert.equal(umlauftafelDocument.mode, expectedMode);

  const result = detectTurnaroundCandidates({ umlauftafelDocument });
  assert.equal(validateTurnaroundDetectionResult(result).valid, true, JSON.stringify(result.warnings.slice(0, 3)));
  assert.ok(['complete', 'partial'].includes(result.status), `unexpected status ${result.status}`);
  assert.ok(result.candidates.length > 0, 'the real reference yields trip transitions');

  for (const candidate of result.candidates) {
    assert.equal(candidate.source, 'umlauftafel');
    assert.ok(candidate.endMinutes >= candidate.startMinutes, 'no negative transition');
    assert.equal(candidate.observedSpanMinutes, candidate.endMinutes - candidate.startMinutes);
    // the agreed crediting contract holds on every real candidate
    if (candidate.observedSpanMinutes >= 11) {
      assert.equal(candidate.eligibility, 'qualified');
      assert.equal(candidate.creditedMinutes, candidate.observedSpanMinutes);
    } else {
      assert.equal(candidate.eligibility, 'below_minimum');
      assert.equal(candidate.creditedMinutes, 0);
    }
  }
  // ids are unique => no double counting of a transition
  const ids = result.candidates.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  // both eligibility classes actually occur in the real data
  assert.ok(result.statistics.qualifiedCount > 0, 'some real transitions reach 11 minutes');
  assert.ok(result.statistics.belowMinimumCount > 0, 'some real transitions stay below 11 minutes');
  return result;
}

test('the real BUS Umlauftafel yields validated turnaround candidates', async (t) => {
  await assertRealReference(t, BUS, 'bus');
});

test('the real TRAM Umlauftafel yields validated turnaround candidates', async (t) => {
  await assertRealReference(t, TRAM, 'tram');
});

test('detection over a real reference is deterministic and free of document payload', async (t) => {
  if (!(xlsxReady && (await present(BUS)))) return t.skip('real reference / XLSX not available');
  const umlauftafelDocument = await load(BUS);
  const a = detectTurnaroundCandidates({ umlauftafelDocument });
  const b = detectTurnaroundCandidates({ umlauftafelDocument });
  assert.deepEqual(a.statistics, b.statistics);
  assert.deepEqual(a.candidates.map(c => c.id), b.candidates.map(c => c.id));
  // the result must not carry document payload (no stop lists, no raw cells, no file objects)
  const serialized = JSON.stringify(a);
  assert.doesNotMatch(serialized, /"stops"|"rawMarker"|"originalText"|"buffer"|arrayBuffer/);
});
