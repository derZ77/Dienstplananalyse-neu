import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.20 – CONTRACT tests for the operational day. No professional logic is changed here.
// Where code and contract already agree, that is pinned. Where they do not, the DIFFERENCE is
// pinned as the current state, so a later correction has to come past this file.
//
//   The JNV operational day runs 03:00 → 03:00 of the following calendar day.
//   `10901` and `10902` are therefore NOT two different courses. They are one night circulation
//   that the timetable documentation breaks across the 03:00 boundary onto two sheets.
//   No artificial separation may be forced on the duty assessment.
import { normalizeCircuitIdentity } from '../js/v2/identity/identity-normalization.js';
import { matchJnvBundle } from '../js/v2/matching/jnv-bundle-matcher.js';
import { normalizeUmlauftafelTimeSequence, ROLLOVER_THRESHOLD_MINUTES } from '../js/v2/umlauftafel/umlauftafel-time.js';
import { createValidity } from '../js/v2/umlauftafel/umlauftafel-contract.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// The contract, stated once. It lives in this file only — no module carries it yet (see D).
const OPERATIONAL_DAY_START_MINUTES = 180;          // 03:00
const OPERATIONAL_DAY_LENGTH_MINUTES = 1440;

// ===== A. the operational day as a closed interval =====
test('A: the operational day runs from 03:00 to 03:00 of the next calendar day', () => {
  assert.equal(OPERATIONAL_DAY_START_MINUTES, 3 * 60);
  assert.equal(OPERATIONAL_DAY_START_MINUTES + OPERATIONAL_DAY_LENGTH_MINUTES, 27 * 60, 'it ends at 27:00');
  assert.equal(OPERATIONAL_DAY_LENGTH_MINUTES, 24 * 60, 'and it is a full day long — no minute is lost or doubled');
});
test('A: a clock time before 03:00 belongs to the PREVIOUS operational day', () => {
  // 02:30 on calendar day X is minute 1590 of operational day X-1, not minute 150 of day X.
  const inOperationalDay = (clockMinutes, dayOffset = 0) =>
    clockMinutes + dayOffset * 1440 - OPERATIONAL_DAY_START_MINUTES;
  assert.equal(inOperationalDay(2 * 60 + 30), -30, 'before the boundary → still the day before');
  assert.equal(inOperationalDay(2 * 60 + 30, 1), 1410, '02:30 of the next calendar day is minute 1410');
  assert.ok(inOperationalDay(2 * 60 + 30, 1) < OPERATIONAL_DAY_LENGTH_MINUTES, 'and still inside the same operational day');
});
test('A: 03:00 itself opens the new operational day', () => {
  assert.equal(3 * 60 - OPERATIONAL_DAY_START_MINUTES, 0);
  assert.equal(2 * 60 + 59 - OPERATIONAL_DAY_START_MINUTES, -1, 'one minute earlier is the day before');
});

// ===== B. 10901 / 10902 are one circulation, not two courses =====
test('B: the central normalisation already sees them as the SAME course', () => {
  const a = normalizeCircuitIdentity('10901', {}).routeIdentity;
  const b = normalizeCircuitIdentity('10902', {}).routeIdentity;
  assert.equal(a.normalizedKey, b.normalizedKey, 'line 10, course 9 — the trailing digits are the sheet, not the course');
  assert.equal(a.line, b.line);
  assert.equal(a.course, b.course);
});
test('B: and the duty roster notation carries no trailing digits at all', () => {
  // `10/9` cannot distinguish the sheets — the distinction exists only in the documentation.
  const plan = normalizeCircuitIdentity('10/9', {}).routeIdentity;
  assert.equal(plan.normalizedKey, normalizeCircuitIdentity('10901', {}).routeIdentity.normalizedKey);
  assert.equal(plan.trip, null, 'the roster names no trip — there is nothing to separate');
});
test('B: the observed real split sits exactly on the operational-day boundary', () => {
  // Recorded from the real Umlauftafel in Phase 3I.19 (no reference data in this repository):
  //   10901 runs 21:46 → 03:13 (+1), 10902 runs 03:14 → 04:23 (+1).
  const SHEET_A = { from: 21 * 60 + 46, to: 1440 + 3 * 60 + 13 };
  const SHEET_B = { from: 1440 + 3 * 60 + 14, to: 1440 + 4 * 60 + 23 };
  assert.equal(SHEET_B.from - SHEET_A.to, 1, 'the two sheets follow each other without a gap');
  assert.ok(SHEET_A.to > 1440 + OPERATIONAL_DAY_START_MINUTES, 'sheet A crosses 03:00');
  assert.ok(SHEET_B.from > 1440 + OPERATIONAL_DAY_START_MINUTES, 'sheet B starts just after it');
  assert.equal(SHEET_B.to - SHEET_A.from, 397, 'together: one continuous night circulation of 6h37');
});
test('B: the other three colliding pairs are NOT operational-day artefacts', () => {
  // 11301 05:07–10:02 against 11302 14:59–18:56 — two separate stints on the same day, far from
  // any 03:00 boundary. The operational-day decision explains 10901/10902 and nothing else.
  const MORNING = { from: 5 * 60 + 7, to: 10 * 60 + 2 };
  const AFTERNOON = { from: 14 * 60 + 59, to: 18 * 60 + 56 };
  assert.ok(AFTERNOON.from - MORNING.to > 60, 'a real gap of hours, not a documentation break');
  assert.ok(MORNING.from > OPERATIONAL_DAY_START_MINUTES && AFTERNOON.to < 1440 + OPERATIONAL_DAY_START_MINUTES,
    'both lie inside one operational day');
});

// ===== C. DIFFERENCE (current state) — uniqueness is enforced in the matcher =====
test('C: the matcher treats two sheets of one course as an ambiguity', () => {
  // This is where the assumption "one key = exactly one circulation sheet" lives. Pinned as the
  // CURRENT state: the fachliche Klärung of Phase 3I.20 says they are one course, so this
  // assertion must be revisited when the operational day is implemented.
  const result = matchJnvBundle({
    bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
    schedule: { serviceRegime: 'school', dayType: 'mo_fr', umlaeufe: [{ code: '10/9' }] },
    umlauftafel: { validity: { serviceRegime: 'school', dayType: 'mo_fr' }, circulations: [{ code: '10901', id: '10901', segments: [] }, { code: '10902', id: '10902', segments: [] }] }
  });
  assert.equal(result.matches[0].status, 'ambiguous');
  assert.deepEqual([...result.matches[0].conflicts], ['MULTIPLE_CIRCULATIONS_FOR_CODE']);
  assert.equal(result.statistics.exact, 0, 'the night duty reaches no circulation at all today');
});
test('C: the matcher reports the ambiguity — it never silently picks one sheet', () => {
  const result = matchJnvBundle({
    bundle: { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } },
    schedule: { serviceRegime: 'school', dayType: 'mo_fr', umlaeufe: [{ code: '10/9' }] },
    umlauftafel: { validity: { serviceRegime: 'school', dayType: 'mo_fr' }, circulations: [{ code: '10901', id: '10901', segments: [] }, { code: '10902', id: '10902', segments: [] }] }
  });
  assert.deepEqual([...result.matches[0].companionRefs], ['10901', '10902'], 'both are named, none is chosen');
});

// ===== D. DIFFERENCE (current state) — no module knows the operational day =====
test('D: the rollover threshold is a 12-hour heuristic, not the operational-day boundary', () => {
  assert.equal(ROLLOVER_THRESHOLD_MINUTES, 720, '12 h — it answers "did midnight pass?", not "which operational day?"');
  assert.notEqual(ROLLOVER_THRESHOLD_MINUTES, OPERATIONAL_DAY_START_MINUTES);
});
test('D: within ONE sheet the midnight crossing is already resolved correctly', () => {
  const { times, warnings } = normalizeUmlauftafelTimeSequence([
    { raw: '21:46', role: 'departure' }, { raw: '23:58', role: 'arrival' }, { raw: '03:13', role: 'arrival' }
  ]);
  assert.deepEqual(times.map(t => t.dayOffset), [0, 0, 1], 'the crossing inside a sheet is handled');
  assert.equal(times[2].normalizedMinutes, 1440 + 3 * 60 + 13);
  assert.ok(warnings.every(w => w.code !== 'IMPLAUSIBLE_TIME_SEQUENCE'));
});
test('D: but nothing joins two SHEETS across the boundary', () => {
  // Each sheet is normalised on its own; sheet B restarts at dayOffset 0 because, read alone,
  // 03:14 is simply an early morning. The connection is only visible with the operational day.
  const sheetB = normalizeUmlauftafelTimeSequence([{ raw: '03:14', role: 'departure' }, { raw: '04:23', role: 'arrival' }]);
  assert.deepEqual(sheetB.times.map(t => t.dayOffset), [0, 0], 'read alone it looks like a morning sheet');
});
test('D: the validity record carries no operational day either', () => {
  const validity = createValidity({ dayType: 'mo_fr', serviceRegime: 'school' });
  assert.deepEqual(Object.keys(validity).sort(), ['dayType', 'rawLabel', 'serviceRegime', 'validFrom', 'validTo']);
  assert.ok(!Object.keys(validity).some(k => /operational|betriebstag/i.test(k)), 'no field exists for it yet');
});
test('D: and no productive module mentions an operational day at all', () => {
  for (const path of ['../js/v2/umlauftafel/umlauftafel-contract.js', '../js/v2/umlauftafel/umlauftafel-time.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js']) {
    assert.doesNotMatch(src(path), /operationalDay|OPERATIONAL_DAY/, `${path}: the concept is not implemented yet`);
  }
});

// ===== E. the candidate places for the contract, named =====
test('E: the three places that would have to carry it are identifiable', () => {
  // 1. the validity record — where a document states what it is valid for
  assert.match(src('../js/v2/umlauftafel/umlauftafel-contract.js'), /export function createValidity/);
  // 2. the time normalisation — where a clock value becomes an absolute minute
  assert.match(src('../js/v2/umlauftafel/umlauftafel-time.js'), /ROLLOVER_THRESHOLD_MINUTES/);
  // 3. the rule configuration — where the JNV-specific parameters are settled
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.ok(config.parameters, 'the rule set holds the confirmed JNV parameters');
  assert.ok(!JSON.stringify(config).match(/operationalDay/i), 'and carries no operational-day parameter yet');
});

// ===== F. nothing here activates or changes anything =====
test('F: the rule set stays approved and disabled', () => {
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.parameters.activation.enabled.value, false);
});
test('F: this phase adds no professional logic to any module', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/analysis/jnv-rule-analysis-controller.js']) {
    assert.doesNotMatch(src(path), /3I\.20/, `${path} must carry no Phase 3I.20 change`);
  }
});
