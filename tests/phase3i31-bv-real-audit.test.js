/**
 * Phase 3I.31 — real audit of the connected BV modules, and completion of the walking-time model.
 *
 * Two things, both grounded in the real Mo–Fr plan:
 *   1. the block-break rule learns the SECOND confirmed walking-time tier (4 minutes),
 *   2. all eight BV modules are exercised together on schedule-shaped data.
 *
 * No rule threshold is moved: BV010 still measures 30, BV012 still measures 33, and the 1/6 rule
 * is not touched at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BLOCK_BREAK_MINIMUM_MINUTES,
  WALKING_TIME_MINUTES,
  WALKING_TIME_STOPS,
  SHORT_WALKING_TIME_MINUTES,
  SHORT_WALKING_TIME_STOPS,
  requiredBlockBreakMinutes,
  evaluateBlockBreak
} from '../js/v2/rules/jnv-block-break.js';
import { attachExcelBreakData } from '../js/v2/excel/excel-break-import.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createBv001Check } from '../js/v2/checks/bv/bv001.js';
import { createBv002Check } from '../js/v2/checks/bv/bv002.js';
import { createBv003Check } from '../js/v2/checks/bv/bv003.js';
import { createBv005Check } from '../js/v2/checks/bv/bv005.js';
import { createBv007Check } from '../js/v2/checks/bv/bv007.js';
import { createBv010Check } from '../js/v2/checks/bv/bv010.js';
import { createBv012Check } from '../js/v2/checks/bv/bv012.js';
import { createBv014Check } from '../js/v2/checks/bv/bv014.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Fixtures in the real 17-column shape of the JNV plan.
// ---------------------------------------------------------------------------
const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const leg = ({ nr = '', line = '10', uml = '10/1', ab, abOrt, an, anOrt, begin = '', end = '', paid = '' }) =>
  ['', '', nr, line, uml, ab, abOrt, '', '', an, anOrt, '', '', '', begin, end, paid, ''];

/** A duty whose two legs leave a `gap`-minute interruption at `stop`. */
const planAt = (stop, gap) => [
  HEADER,
  leg({ nr: '2211', ab: '05:00', abOrt: 'BBU', an: '07:00', anOrt: stop, begin: '05:00', end: '11:00', paid: '06:00' }),
  leg({ ab: `0${7 + Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}`, abOrt: stop, an: '11:00', anOrt: 'BBU' })
];
const dueRows = (breakValue) => [
  ['', 'Dienst-Nr.', 'Dienst-art', 'Umlauf-linie', 'Umlauf-Nr.', 'Wagen-Nr.', 'Beg.', 'Ende', 'P.-regel', 'Block-pause', 'Ab-zug'],
  ['', '2211', 'OPT_Z', '10', '1', '', '5:00', '11:00', '1x33_43', breakValue, '30']
];
const build = (rows, options) => attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(rows), options);
const analysisResult = { type: 'AnalysisResult' };

// =====================================================================================
// A — walking time at Teichgraben / Löbdergraben / Holzmarkt: 6 minutes
// =====================================================================================
test('A: a 36-minute gross break at TGR/LGR/HLZ satisfies the 30-minute minimum', () => {
  for (const stop of ['TGR', 'LGR', 'HLZ']) {
    const verdict = evaluateBlockBreak({ durationMinutes: 36, startLocation: stop, endLocation: stop });
    assert.equal(verdict.requiredMinutes, 36, `${stop} demands 30 + 6`);
    assert.equal(verdict.walkingTimeMinutes, 6);
    assert.equal(verdict.satisfied, true);
  }
});

test('A: 35 minutes at those stops is a net 29-minute break and fails', () => {
  const verdict = evaluateBlockBreak({ durationMinutes: 35, startLocation: 'HLZ', endLocation: 'HLZ' });
  assert.equal(verdict.satisfied, false);
  assert.equal(verdict.deficitMinutes, 1);
});

test('A: the six-minute tier is unchanged by this phase', () => {
  assert.equal(BLOCK_BREAK_MINIMUM_MINUTES, 30);
  assert.equal(WALKING_TIME_MINUTES, 6);
  assert.deepEqual([...WALKING_TIME_STOPS].sort(), ['HLZ', 'LGR', 'TGR']);
});

// =====================================================================================
// B — walking time at Burgaupark: 4 minutes
// =====================================================================================
test('B: a 34-minute gross break at the four-minute stop satisfies the minimum', () => {
  const verdict = evaluateBlockBreak({ durationMinutes: 34, startLocation: 'BUP', endLocation: 'BUP' });
  assert.equal(verdict.requiredMinutes, 34, '30 + 4');
  assert.equal(verdict.walkingTimeMinutes, 4);
  assert.equal(verdict.satisfied, true);
  assert.deepEqual(verdict.walkingTimeStops, ['BUP']);
});

test('B: 33 minutes there is a net 29-minute break and does NOT satisfy it', () => {
  const verdict = evaluateBlockBreak({ durationMinutes: 33, startLocation: 'BUP', endLocation: 'BUP' });
  assert.equal(verdict.satisfied, false);
  assert.equal(verdict.deficitMinutes, 1);
});

test('B: the four-minute tier is declared, and it is a separate tier', () => {
  assert.equal(SHORT_WALKING_TIME_MINUTES, 4);
  assert.deepEqual([...SHORT_WALKING_TIME_STOPS], ['BUP']);
  assert.equal(BLOCK_BREAK_MINIMUM_MINUTES + SHORT_WALKING_TIME_MINUTES, 34);
});

test('B: the stop is recognised by its abbreviation and by its full name', () => {
  for (const location of ['BUP', 'bup', 'Burgaupark', 'Burgaupark (BUP)']) {
    assert.equal(requiredBlockBreakMinutes(location, location), 34, `${location} must be recognised`);
  }
});

test('B: where the two tiers meet, the LONGER walking time governs', () => {
  const verdict = evaluateBlockBreak({ durationMinutes: 36, startLocation: 'BUP', endLocation: 'HLZ' });
  assert.equal(verdict.walkingTimeMinutes, 6, 'the driver still has the longer walk to make');
  assert.equal(verdict.requiredMinutes, 36);
  assert.deepEqual(verdict.walkingTimeStops.sort(), ['BUP', 'HLZ']);
});

test('B: the surcharge is added once, not once per end', () => {
  assert.equal(requiredBlockBreakMinutes('BUP', 'BUP'), 34);
  assert.equal(requiredBlockBreakMinutes('TGR', 'HLZ'), 36);
});

test('B: an unconfirmed stop gets no walking time — nothing is guessed', () => {
  // The depot BBU never hosts a measured break in the real plan, so it carries no surcharge.
  for (const location of ['BBU', 'LOW', 'WIN', 'Irgendwo', '', null]) {
    assert.equal(requiredBlockBreakMinutes(location, location), 30, `${location} must stay at the base value`);
  }
});

// =====================================================================================
// C — a block break below the minimum
// =====================================================================================
test('C: 29 minutes at an ordinary stop fails by one minute', () => {
  const verdict = evaluateBlockBreak({ durationMinutes: 29, startLocation: 'LOW', endLocation: 'LOW' });
  assert.equal(verdict.requiredMinutes, 30);
  assert.equal(verdict.satisfied, false);
  assert.equal(verdict.deficitMinutes, 1);
});

test('C: walking time is a surcharge on the requirement, never a break and never driving time', () => {
  const verdict = evaluateBlockBreak({ durationMinutes: 40, startLocation: 'TGR', endLocation: 'TGR' });
  assert.equal(verdict.durationMinutes, 40, 'the gross break is reported unchanged');
  assert.equal(verdict.requiredMinutes, 36, 'and the walking time only raises what is required');
  assert.ok(!('drivingMinutes' in verdict), 'the module yields no driving time at all');
  assert.ok(!('breakMinutes' in verdict), 'and invents no break of its own');
});

test('C: an unusable duration stays undecidable and is never read as a pass', () => {
  for (const durationMinutes of [null, undefined, NaN, -5, 'dreißig']) {
    const verdict = evaluateBlockBreak({ durationMinutes, startLocation: 'BUP', endLocation: 'BUP' });
    assert.equal(verdict.satisfied, null);
    assert.equal(verdict.deficitMinutes, null);
    assert.equal(verdict.requiredMinutes, 34, 'the requirement is still stated');
  }
});

// =====================================================================================
// D — BV010 on a real, declared break
// =====================================================================================
test('D: BV010 passes a declared 36-minute break imported from Excel', async () => {
  const schedule = build(planAt('TGR', 42), { dienstuebersichtRows: dueRows('0:36') });
  const check = await createBv010Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(check.status, 'PASS');
  assert.equal(check.details.minimumMinutes, 30, 'BV010 still measures 30 — no threshold was moved');
});

test('D: BV010 fails a declared 28-minute break and names the duty', async () => {
  const schedule = build(planAt('TGR', 42), { dienstuebersichtRows: dueRows('0:28') });
  const check = await createBv010Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(check.status, 'FAIL');
  assert.equal(check.severity, 'VIOLATION');
  assert.deepEqual(check.affectedServices, ['excel-service:1']);
  assert.equal(check.affectedActivities.length, 1);
});

test('D: BV010 stays NOT_APPLICABLE where the plan declares no break', async () => {
  const schedule = build(planAt('TGR', 42), {});
  const check = await createBv010Check({ canonicalSchedule: schedule }).run(analysisResult);
  assert.equal(check.status, 'NOT_APPLICABLE');
});

// =====================================================================================
// E — BV012 and the real interruption behind the break
// =====================================================================================
test('E: the imported interruption is gross, the break is net, and both are kept', () => {
  const schedule = build(planAt('BUP', 40), { dienstuebersichtRows: dueRows('0:36') });
  assert.equal(schedule.interruptions.length, 1);
  assert.equal(schedule.interruptions[0].durationMinutes, 40, 'gross');
  const [pause] = schedule.activities.filter(a => a.activityType === 'unpaidBreak');
  assert.equal(pause.declaredMinutes, 36, 'net');
  // 40 gross at a four-minute stop is exactly the 36 the operator declares.
  assert.equal(schedule.interruptions[0].durationMinutes - 4, pause.declaredMinutes);
});

test('E: BV012 measures the declared break against its own 33-minute buffer', async () => {
  const passing = await createBv012Check({ canonicalSchedule: build(planAt('BUP', 40), { dienstuebersichtRows: dueRows('0:36') }) }).run(analysisResult);
  const failing = await createBv012Check({ canonicalSchedule: build(planAt('BUP', 40), { dienstuebersichtRows: dueRows('0:31') }) }).run(analysisResult);
  assert.equal(passing.status, 'PASS');
  assert.equal(failing.status, 'FAIL', '31 minutes clears BV010 but misses the BV012 buffer');
  assert.equal(passing.details.minimumMinutes, 33, 'BV012 still measures 33 — no threshold was moved');
});

test('E: the block-break rule agrees with BV012 on the real interruption', () => {
  const schedule = build(planAt('BUP', 40), { dienstuebersichtRows: dueRows('0:36') });
  const [gap] = schedule.interruptions;
  const verdict = evaluateBlockBreak({ durationMinutes: gap.durationMinutes, startLocation: gap.startLocation, endLocation: gap.endLocation });
  assert.equal(verdict.requiredMinutes, 34);
  assert.equal(verdict.satisfied, true);
});

// =====================================================================================
// F — all eight modules run together over the same schedule
// =====================================================================================
const ALL_MODULES = [
  ['BV001', createBv001Check], ['BV002', createBv002Check], ['BV003', createBv003Check],
  ['BV005', createBv005Check], ['BV007', createBv007Check], ['BV010', createBv010Check],
  ['BV012', createBv012Check], ['BV014', createBv014Check]
];
const STATUSES = new Set(['PASS', 'FAIL', 'SKIP', 'NOT_APPLICABLE']);

test('F: every module returns a contract-shaped result on a real-shaped schedule', async () => {
  const schedule = build(planAt('TGR', 42), { dienstuebersichtRows: dueRows('0:36') });
  for (const [name, factory] of ALL_MODULES) {
    const outcome = await factory({ canonicalSchedule: schedule }).run(analysisResult);
    const results = Array.isArray(outcome) ? outcome : [outcome];
    assert.ok(results.length >= 1, `${name} must yield at least one result`);
    for (const r of results) {
      assert.ok(STATUSES.has(r.status), `${name}: ${r.status} is outside the frozen vocabulary`);
      assert.equal(r.category, 'BV');
      assert.ok(Array.isArray(r.affectedServices) && Array.isArray(r.affectedActivities));
    }
  }
});

test('F: no module throws, and none reports a violation without naming a duty', async () => {
  const schedule = build(planAt('BUP', 40), { dienstuebersichtRows: dueRows('0:36') });
  for (const [name, factory] of ALL_MODULES) {
    const outcome = await factory({ canonicalSchedule: schedule }).run(analysisResult);
    for (const r of (Array.isArray(outcome) ? outcome : [outcome])) {
      if (r.status === 'FAIL') assert.ok(r.affectedServices.length > 0, `${name} must say which duty is affected`);
    }
  }
});

test('F: every module refuses an input that is not a CanonicalSchedule', async () => {
  for (const [name, factory] of ALL_MODULES) {
    await assert.rejects(() => factory({ canonicalSchedule: { type: 'Nope' } }).run(analysisResult),
      TypeError, `${name} must not process a foreign input`);
  }
});

// =====================================================================================
// G — no regression of the 1/6 rule
// =====================================================================================
test('G: the 1/6 rule module carries no change from this phase', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/analysis/joint-timeline.js', '../js/v2/matching/jnv-bundle-matcher.js']) {
    assert.doesNotMatch(src(path), /3I\.31/, `${path} must be untouched`);
  }
});

test('G: the rule set is still approved and still switched off', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false, 'this phase activates nothing');
});

test('G: the walking-time model stays out of the driving and quota calculation', () => {
  // Only executable code is inspected — the header prose deliberately SAYS it touches neither.
  const code = src('../js/v2/rules/jnv-block-break.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /drivingMinutes|quota|oneSixth|lenkzeit/i,
    'the block-break rule must not reach into driving time or the quota');
});
