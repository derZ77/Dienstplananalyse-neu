import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3I.18 – validity is a QUESTION ABOUT DAY RANGES, not about string equality.
//
// A Mon–Fri duty roster may legitimately carry Mon–Thu Umlauftafeln: in school and holiday
// timetables Monday to Thursday share one set of circulations while Friday differs. The board
// then describes a valid SUB-RANGE of the roster — not a contradiction.
//
// The question Level 1 has to answer is therefore:
//   "Can the Umlauftafel be a valid sub-range of the duty roster?"
//
// COMPATIBLE   — proven: the board's days are contained in the roster's days.
// INCOMPATIBLE — proven otherwise: the two day ranges are disjoint.
// UNKNOWN      — not decidable: a side says `unknown`, carries no weekday set, or the board
//                reaches beyond the roster. Never silently treated as either of the other two.
import {
  VALIDITY_COMPATIBILITY, DAY_TYPE_DAYS, dayTypeDays,
  compareDayTypes, compareServiceRegimes, assessValidityCompatibility
} from '../js/v2/matching/validity-compatibility.js';
import { matchJnvBundle } from '../js/v2/matching/jnv-bundle-matcher.js';

const { COMPATIBLE, INCOMPATIBLE, UNKNOWN } = VALIDITY_COMPATIBILITY;

const BUNDLE = { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } };
const run = (schedValidity, boardValidity, codes = ['12/1']) => matchJnvBundle({
  bundle: BUNDLE,
  schedule: { ...schedValidity, umlaeufe: codes.map(code => ({ code })) },
  umlauftafel: { validity: boardValidity, circulations: codes.map(code => ({ code, id: code, segments: [] })) }
});
const codesOf = (result) => result.warnings.map(w => w.code);

// ===== A. the real case: Mon–Fri roster, Mon–Thu board =====
test('A: mo_fr roster + mo_do board is COMPATIBLE', () => {
  assert.equal(compareDayTypes('mo_fr', 'mo_do').status, COMPATIBLE);
});
test('A: because Mon–Thu is a subset of Mon–Fri', () => {
  const roster = dayTypeDays('mo_fr');
  const board = dayTypeDays('mo_do');
  assert.ok(board.every(day => roster.includes(day)), 'every board day is covered by the roster');
  assert.ok(roster.length > board.length, 'Friday is the day the board does not describe');
});
test('A: the matcher lets that pair through Level 1', () => {
  const result = run({ serviceRegime: 'holidays', dayType: 'mo_fr' }, { serviceRegime: 'holidays', dayType: 'mo_do' });
  assert.notEqual(result.status, 'conflicting', 'a valid sub-range is not a conflict');
  assert.equal(result.statistics.exact, 1);
});
test('A: but the partial coverage is stated, never hidden', () => {
  const result = run({ serviceRegime: 'holidays', dayType: 'mo_fr' }, { serviceRegime: 'holidays', dayType: 'mo_do' });
  assert.ok(codesOf(result).includes('VALIDITY_PARTIAL_COVERAGE'),
    'the reader must know the board does not describe every day of the roster');
});

// ===== B. identical validity =====
test('B: mo_fr roster + mo_fr board is COMPATIBLE', () => {
  assert.equal(compareDayTypes('mo_fr', 'mo_fr').status, COMPATIBLE);
});
test('B: an identical pair passes without a coverage warning', () => {
  const result = run({ serviceRegime: 'school', dayType: 'mo_fr' }, { serviceRegime: 'school', dayType: 'mo_fr' });
  assert.equal(result.statistics.exact, 1);
  assert.ok(!codesOf(result).includes('VALIDITY_PARTIAL_COVERAGE'), 'nothing is left uncovered');
  assert.ok(!codesOf(result).includes('VALIDITY_NOT_CONFIRMED'));
});

// ===== C. the reverse direction is NOT symmetric =====
test('C: mo_do roster + mo_fr board is not COMPATIBLE', () => {
  const verdict = compareDayTypes('mo_do', 'mo_fr').status;
  assert.notEqual(verdict, COMPATIBLE, 'the board reaches beyond the roster — that is never proven valid');
  assert.ok(verdict === INCOMPATIBLE || verdict === UNKNOWN);
});
test('C: and the matcher does not report it as a plain exact match', () => {
  const result = run({ serviceRegime: 'school', dayType: 'mo_do' }, { serviceRegime: 'school', dayType: 'mo_fr' });
  assert.notEqual(result.status, 'exact', 'an unproven day range must not yield an automatable result');
});

// ===== D. `unknown` is neither a conflict nor a free pass =====
test('D: mo_fr roster + unknown board is UNKNOWN', () => {
  assert.equal(compareDayTypes('mo_fr', 'unknown').status, UNKNOWN);
  assert.equal(compareDayTypes('unknown', 'mo_do').status, UNKNOWN);
});
test('D: an unknown service regime is UNKNOWN, not a mismatch', () => {
  assert.equal(compareServiceRegimes('holidays', 'unknown').status, UNKNOWN);
  assert.equal(compareServiceRegimes('holidays', 'holidays').status, COMPATIBLE);
  assert.equal(compareServiceRegimes('holidays', 'school').status, INCOMPATIBLE);
});
test('D: UNKNOWN does not block the match outright', () => {
  const result = run({ serviceRegime: 'holidays', dayType: 'mo_fr' }, { serviceRegime: 'unknown', dayType: 'mo_do' });
  assert.notEqual(result.status, 'conflicting', 'an unproven validity is not a proven contradiction');
  assert.equal(result.statistics.exact, 1, 'the circulation is still matched');
});
test('D: UNKNOWN is never automatable — it is stated and downgraded', () => {
  const result = run({ serviceRegime: 'holidays', dayType: 'mo_fr' }, { serviceRegime: 'unknown', dayType: 'mo_do' });
  assert.ok(codesOf(result).includes('VALIDITY_NOT_CONFIRMED'));
  assert.equal(result.status, 'probable', 'a human must confirm the two documents belong together');
});
test('D: the real Phase 3I.16 pairing is exactly this case', () => {
  const verdict = assessValidityCompatibility({
    schedule: { serviceRegime: 'holidays', dayType: 'mo_fr' },
    companion: { serviceRegime: 'unknown', dayType: 'mo_do' }
  });
  assert.equal(verdict.dayType.status, COMPATIBLE, 'mo_do IS a valid sub-range of mo_fr');
  assert.equal(verdict.serviceRegime.status, UNKNOWN, 'but the board states no regime');
  assert.equal(verdict.status, UNKNOWN, 'the weaker of the two decides');
});

// ===== E. weekend against weekday =====
test('E: a weekend board against a weekday roster is INCOMPATIBLE', () => {
  assert.equal(compareDayTypes('mo_fr', 'saturday').status, INCOMPATIBLE);
  assert.equal(compareDayTypes('mo_fr', 'sunday').status, INCOMPATIBLE);
  assert.equal(compareDayTypes('mo_fr', 'weekend').status, INCOMPATIBLE);
  assert.equal(compareDayTypes('saturday', 'mo_fr').status, INCOMPATIBLE);
});
test('E: the matcher still refuses that pair', () => {
  const result = run({ serviceRegime: 'school', dayType: 'mo_fr' }, { serviceRegime: 'school', dayType: 'saturday' });
  assert.equal(result.status, 'conflicting');
  assert.equal(result.statistics.exact, 0);
  assert.ok(codesOf(result).includes('DAY_TYPE_MISMATCH'));
});
test('E: inside the weekend the subset rule still holds', () => {
  assert.equal(compareDayTypes('weekend', 'saturday').status, COMPATIBLE);
  assert.equal(compareDayTypes('saturday', 'weekend').status, UNKNOWN, 'the board reaches beyond the roster');
  assert.equal(compareDayTypes('mo_fr', 'friday').status, COMPATIBLE);
});

// ===== F. no regression: proven contradictions stay blocked =====
test('F: two different known regimes remain a conflict', () => {
  const result = run({ serviceRegime: 'school', dayType: 'mo_fr' }, { serviceRegime: 'holidays', dayType: 'mo_fr' });
  assert.equal(result.status, 'conflicting');
  assert.ok(codesOf(result).includes('REGIME_MISMATCH'));
  assert.equal(result.statistics.exact, 0);
});
test('F: a disjoint day range remains a conflict even with matching regimes', () => {
  const result = run({ serviceRegime: 'school', dayType: 'friday' }, { serviceRegime: 'school', dayType: 'mo_do' });
  assert.equal(result.status, 'conflicting', 'Friday and Mon–Thu share no day at all');
});
test('F: a conflict is decided BEFORE any circulation is compared', () => {
  const result = run({ serviceRegime: 'school', dayType: 'mo_fr' }, { serviceRegime: 'holidays', dayType: 'saturday' });
  assert.deepEqual(result.matches, [], 'Level 1 still short-circuits');
});
test('F: the day-type sets themselves are a closed, non-empty model', () => {
  for (const [dayType, days] of Object.entries(DAY_TYPE_DAYS)) {
    assert.ok(Array.isArray(days) && days.length > 0, `${dayType} must carry a real weekday set`);
    assert.equal(new Set(days).size, days.length, `${dayType} must not repeat a day`);
  }
  assert.equal(dayTypeDays('unknown'), null, 'unknown carries no set');
  assert.equal(dayTypeDays('school_days'), null, 'a regime-like value is not a weekday set');
  assert.equal(dayTypeDays('holidays'), null);
});
test('F: compatibility is never invented from two unattributable values', () => {
  assert.equal(compareDayTypes('unknown', 'unknown').status, UNKNOWN);
  assert.equal(compareServiceRegimes('unknown', 'unknown').status, UNKNOWN);
  assert.equal(compareDayTypes('school_days', 'school_days').status, UNKNOWN,
    'equal strings are not equal day ranges when neither is a day range');
});
test('F: an INCOMPATIBLE field always wins over an UNKNOWN one', () => {
  const verdict = assessValidityCompatibility({
    schedule: { serviceRegime: 'unknown', dayType: 'mo_fr' },
    companion: { serviceRegime: 'unknown', dayType: 'saturday' }
  });
  assert.equal(verdict.status, INCOMPATIBLE, 'a proven contradiction is not softened by an open question');
});
