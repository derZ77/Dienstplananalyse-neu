import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.29 – two things at once, both about REACH rather than new rule meaning:
//
//   1. the eight finished BV modules are connected to the productive CheckRunner (Phase 3I.28
//      found them wired to nothing but their own tests),
//   2. the JNV block break gains its walking-time special case.
//
// Block break: at least 30 minutes. If the break BEGINS or ENDS at Teichgraben (TGR),
// Löbdergraben (LGR) or Holzmarkt (HLZ), six minutes of walking time are needed on top — so 36.
// Those six minutes are NOT driving time; they only raise the required break length.
import {
  BLOCK_BREAK_MINIMUM_MINUTES, WALKING_TIME_MINUTES, WALKING_TIME_STOPS,
  requiredBlockBreakMinutes, evaluateBlockBreak
} from '../js/v2/rules/jnv-block-break.js';
import { runJnvRuleAnalysis, DEFAULT_ONE_SIXTH_RULE_CONFIG } from '../js/v2/analysis/jnv-rule-analysis-controller.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ===== A. the eight BV modules exist and are identifiable =====
const BV_MODULES = ['bv001', 'bv002', 'bv003', 'bv005', 'bv007', 'bv010', 'bv012', 'bv014'];
test('A: all eight BV modules are present', () => {
  for (const id of BV_MODULES) {
    assert.match(src(`../js/v2/checks/bv/${id}.js`), new RegExp(`export function create${id.toUpperCase().replace('BV', 'Bv')}Check`),
      `${id} must export its factory`);
  }
});

// ===== B. what productive input do they expect? =====
test('B: every module takes a CanonicalSchedule, and nothing it cannot get', () => {
  for (const id of BV_MODULES) {
    assert.match(src(`../js/v2/checks/bv/${id}.js`), /createBv\d+Check\(\{\s*canonicalSchedule/,
      `${id} must be driven by the canonical schedule the controller already holds`);
  }
});
test('B: BV010 and BV012 read a FLAT activity list', () => {
  // This is the gap: the Excel path produces services[].activities, not a flat list.
  for (const id of ['bv010', 'bv012']) {
    assert.match(src(`../js/v2/checks/bv/${id}.js`), /canonicalSchedule\.activities/, `${id} reads a flat list`);
  }
});

// ===== C. the CheckRunner integration =====
const CANONICAL = (services) => ({ type: 'CanonicalSchedule', services });
const activity = (over = {}) => ({
  circuitNumber: '12/1', activityType: null, departureLocation: null, arrivalLocation: null,
  departureTime: { value: '08:00', minutesSinceStartOfDay: 480, dayOffset: 0 },
  arrivalTime: { value: '12:00', minutesSinceStartOfDay: 720, dayOffset: 0 },
  dutyKind: 'serviceDrive', source: { sourceType: 'excel' }, ...over
});
const BUNDLE = { compatibility: { status: 'exact' }, primary: { documentType: 'legacy_excel_schedule' }, companion: { documentType: 'umlaufkarte' } };
const BOARD = { organization: 'JNV', mode: 'bus', validity: { serviceRegime: 'school', dayType: 'mo_fr' }, circulations: [{ code: '12100', id: '12100', segments: [] }] };
const analysis = (services, over = {}) => runJnvRuleAnalysis({
  bundle: BUNDLE,
  primaryImport: { canonicalSchedule: CANONICAL(services) },
  companionImport: { document: BOARD },
  matching: { attempted: true, status: 'completed', reason: null, warnings: [],
    matchResult: { status: 'exact', matches: [{ status: 'exact', primaryRefs: ['12/1'], companionRefs: ['12100'] }] } },
  ...over
});

test('C: the productive report carries the BV modules alongside BV008 and the 1/6 rule', async () => {
  const r = await analysis([{ serviceNumber: '2101', begin: { value: '07:50', minutesSinceStartOfDay: 470, dayOffset: 0 }, activities: [activity()] }]);
  assert.equal(r.status, 'completed', `got ${r.reason}`);
  const ids = r.checkReport.results.map(x => x.id);
  assert.ok(ids.includes('BV008'), 'the existing driving-time check stays');
  assert.ok(ids.includes('BV015_BV018'), 'the 1/6 rule stays');
  // BV007 reports TWO results by its own construction — the earliest duty start and the split-duty
  // limits are separate statements. That is the module's shape, not a defect.
  for (const id of ['BV001', 'BV002', 'BV003', 'BV005', 'BV007-START', 'BV007-SPLIT', 'BV010', 'BV012', 'BV014']) {
    assert.ok(ids.includes(id), `${id} must reach the report`);
  }
  assert.equal(ids.length, 11, 'eight BV modules (BV007 twice) plus BV008 and the 1/6 rule');
});
test('C: connecting them raises no runner error', async () => {
  const r = await analysis([{ serviceNumber: '2101', begin: { value: '07:50', minutesSinceStartOfDay: 470, dayOffset: 0 }, activities: [activity()] }]);
  assert.deepEqual(r.checkReport.errors, [], 'a flat activity view must be provided, not an exception');
});
test('C: the flat view is derived, never invented', async () => {
  const services = [{ serviceNumber: '2101', begin: { value: '07:50', minutesSinceStartOfDay: 470, dayOffset: 0 }, activities: [activity(), activity({ circuitNumber: '12/2' })] }];
  const before = JSON.stringify(services);
  await analysis(services);
  assert.equal(JSON.stringify(services), before, 'the imported schedule is not mutated');
});

// ===== the block break: constants =====
test('the walking-time contract is stated once', () => {
  assert.equal(BLOCK_BREAK_MINIMUM_MINUTES, 30);
  assert.equal(WALKING_TIME_MINUTES, 6);
  assert.deepEqual([...WALKING_TIME_STOPS].sort(), ['HLZ', 'LGR', 'TGR']);
  assert.equal(BLOCK_BREAK_MINIMUM_MINUTES + WALKING_TIME_MINUTES, 36);
});

// ===== D. 30 minutes at an ordinary stop =====
test('D: 30 minutes at an ordinary stop is a block break', () => {
  assert.equal(requiredBlockBreakMinutes('Zentrum', 'Zentrum'), 30);
  const r = evaluateBlockBreak({ durationMinutes: 30, startLocation: 'Zentrum', endLocation: 'Zentrum' });
  assert.equal(r.satisfied, true);
  assert.equal(r.requiredMinutes, 30);
  assert.equal(r.walkingTimeMinutes, 0);
});

// ===== E. 29 minutes at an ordinary stop =====
test('E: 29 minutes is not enough', () => {
  const r = evaluateBlockBreak({ durationMinutes: 29, startLocation: 'Zentrum', endLocation: 'Zentrum' });
  assert.equal(r.satisfied, false);
  assert.equal(r.deficitMinutes, 1);
});

// ===== F. 35 minutes at a walking-time stop =====
test('F: 35 minutes at TGR/LGR/HLZ is NOT enough', () => {
  for (const stop of ['TGR', 'LGR', 'HLZ']) {
    const r = evaluateBlockBreak({ durationMinutes: 35, startLocation: stop, endLocation: stop });
    assert.equal(r.satisfied, false, `${stop} needs 36`);
    assert.equal(r.requiredMinutes, 36);
    assert.equal(r.deficitMinutes, 1);
  }
});

// ===== G. 36 minutes at a walking-time stop =====
test('G: 36 minutes at TGR/LGR/HLZ is enough', () => {
  for (const stop of ['TGR', 'LGR', 'HLZ']) {
    const r = evaluateBlockBreak({ durationMinutes: 36, startLocation: stop, endLocation: stop });
    assert.equal(r.satisfied, true);
    assert.equal(r.walkingTimeMinutes, 6);
  }
});
test('G: the six minutes are never driving time', () => {
  const r = evaluateBlockBreak({ durationMinutes: 36, startLocation: 'TGR', endLocation: 'TGR' });
  assert.equal(r.walkingTimeMinutes, 6);
  assert.ok(!('drivingMinutes' in r), 'the walking time raises the requirement, it produces no driving time');
});

// ===== H/I. one end at a walking-time stop — the decision, stated =====
// DECISION (Phase 3I.29): walking time arises as soon as EITHER end of the break lies at one of
// the three stops — the driver has to walk there or back either way. The stricter reading is
// deliberate: it demands more break, never less, and therefore never shortens a driver's rest.
test('H: a break that BEGINS at a walking-time stop needs 36 minutes', () => {
  assert.equal(requiredBlockBreakMinutes('TGR', 'Zentrum'), 36);
  assert.equal(evaluateBlockBreak({ durationMinutes: 35, startLocation: 'TGR', endLocation: 'Zentrum' }).satisfied, false);
  assert.equal(evaluateBlockBreak({ durationMinutes: 36, startLocation: 'TGR', endLocation: 'Zentrum' }).satisfied, true);
});
test('I: a break that ENDS at a walking-time stop needs 36 minutes as well', () => {
  assert.equal(requiredBlockBreakMinutes('Zentrum', 'HLZ'), 36);
  assert.equal(evaluateBlockBreak({ durationMinutes: 35, startLocation: 'Zentrum', endLocation: 'HLZ' }).satisfied, false);
  assert.equal(evaluateBlockBreak({ durationMinutes: 36, startLocation: 'Zentrum', endLocation: 'HLZ' }).satisfied, true);
});
test('H/I: the decision is recorded on the result, not hidden', () => {
  const mixed = evaluateBlockBreak({ durationMinutes: 36, startLocation: 'TGR', endLocation: 'Zentrum' });
  assert.equal(mixed.walkingTimeStops.length, 1, 'exactly the end that triggered it is named');
  assert.deepEqual(mixed.walkingTimeStops, ['TGR']);
  const both = evaluateBlockBreak({ durationMinutes: 36, startLocation: 'TGR', endLocation: 'LGR' });
  assert.deepEqual(both.walkingTimeStops, ['TGR', 'LGR'], 'both ends are named — the surcharge is still six minutes, once');
  assert.equal(both.requiredMinutes, 36, 'the walking time is not added twice');
});

// ===== robustness =====
test('an unknown or missing location falls back to the ordinary requirement', () => {
  for (const [from, to] of [[null, null], [undefined, 'Zentrum'], ['', ''], [42, {}]]) {
    assert.equal(requiredBlockBreakMinutes(from, to), 30, 'nothing is guessed into a walking-time stop');
  }
});
test('the stop match ignores case and surrounding text', () => {
  assert.equal(requiredBlockBreakMinutes('tgr', 'Zentrum'), 36);
  assert.equal(requiredBlockBreakMinutes(' Teichgraben (TGR) ', 'Zentrum'), 36);
  assert.equal(requiredBlockBreakMinutes('Zentrum', 'Holzmarkt'), 36, 'the full name counts too');
});
test('an unusable duration is undecidable, never a pass', () => {
  for (const value of [null, undefined, NaN, -5, 'lang']) {
    const r = evaluateBlockBreak({ durationMinutes: value, startLocation: 'Zentrum', endLocation: 'Zentrum' });
    assert.equal(r.satisfied, null, 'no duration, no verdict');
    assert.equal(r.deficitMinutes, null);
  }
});

// ===== nothing protected was touched =====
test('the 1/6 approval, line 18, night shift, matcher, timeline and UI are untouched', () => {
  for (const path of ['../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/ui/check-explorer.js']) {
    assert.doesNotMatch(src(path), /3I\.29|WALKING_TIME/, `${path} must be untouched`);
  }
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false, 'still not activated');
});
test('the block-break module carries no 1/6 logic of its own', () => {
  const module = src('../js/v2/rules/jnv-block-break.js');
  assert.doesNotMatch(module, /admissionLine|nightShift|requiredRatio|ceil/, 'it decides break length, nothing else');
});
