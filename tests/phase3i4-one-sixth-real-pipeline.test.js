import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3I.4 – honest real-reference run. The real Umlauftafeln are read read-only and pushed
// through the real candidate detection into the rule. Because a real exact bundle (and therefore a
// real driving projection) is not available, the rule must report INCONCLUSIVE / NOT_APPLICABLE
// instead of a fabricated PASS or FAIL.
import { evaluateOneSixthRule } from '../js/v2/analysis/one-sixth-rule.js';
import { validateOneSixthEvaluation } from '../js/v2/analysis/one-sixth-validation.js';
import { detectTurnaroundCandidates } from '../js/v2/rules/one-sixth-turnaround-candidates.js';

const BUS = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
const TRAM = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FS_20260629_MoFr.xlsx';
const present = async (p) => { try { await access(p); return true; } catch { return false; } };

const CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false
};

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

async function realRun(t, path, expectedMode) {
  if (!(xlsxReady && (await present(path)))) return t.skip('real reference / XLSX not available');
  const umlauftafelDocument = await load(path);
  assert.equal(umlauftafelDocument.mode, expectedMode);

  // real candidate detection over the real reference
  const turnaroundDetection = detectTurnaroundCandidates({ umlauftafelDocument });
  assert.ok(turnaroundDetection.candidates.length > 0, 'the real reference yields turnaround candidates');

  // No real exact bundle exists, so there is no real driving projection: the rule must stay honest.
  let result;
  assert.doesNotThrow(() => {
    result = evaluateOneSixthRule({
      drivingProjection: { metadata: null, circulations: [], warnings: [] },
      turnaroundDetection,
      ruleConfig: CONFIG,
      context: { organization: 'JNV', mode: expectedMode }
    });
  });
  assert.equal(validateOneSixthEvaluation(result).valid, true);
  assert.ok(['NOT_APPLICABLE', 'INCONCLUSIVE'].includes(result.status), `unexpected status ${result.status}`);
  assert.deepEqual(result.violations, [], 'no violation may be invented without a driving projection');
  assert.deepEqual(result.services, []);
  return { turnaroundDetection, result };
}

test('the real BUS reference runs into the rule and stays honest without a driving projection', async (t) => {
  await realRun(t, BUS, 'bus');
});

test('the real TRAM reference runs into the rule and stays honest without a driving projection', async (t) => {
  await realRun(t, TRAM, 'tram');
});

test('real candidates never yield a definitive verdict when the driving time is unknown', async (t) => {
  if (!(xlsxReady && (await present(BUS)))) return t.skip('real reference / XLSX not available');
  const umlauftafelDocument = await load(BUS);
  const turnaroundDetection = detectTurnaroundCandidates({ umlauftafelDocument });

  // a structurally valid projection whose driving time is unknown
  const projection = {
    metadata: { serviceRegime: 'holidays', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: 1 },
    circulations: [{
      code: turnaroundDetection.candidates[0].circulationCode,
      drivingSegments: [], drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
      statistics: { drivingMinutes: null, nonDrivingMinutes: 0, knownTotalMinutes: null }, warnings: []
    }],
    warnings: []
  };
  const result = evaluateOneSixthRule({ drivingProjection: projection, turnaroundDetection, ruleConfig: CONFIG, context: { organization: 'JNV', mode: 'bus' } });
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.deepEqual(result.violations, []);
  assert.equal(validateOneSixthEvaluation(result).valid, true);
  // no document payload leaks into the rule result
  assert.doesNotMatch(JSON.stringify(result), /"stops"|"rawMarker"|"originalText"|arrayBuffer|buffer/);
});
