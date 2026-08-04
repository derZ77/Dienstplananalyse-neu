import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.9 – the line-18 exception, scoped to AFFECTED SEGMENTS ONLY (3I.8b). Line-18 segments
// are taken out of the evaluation; every other segment of the same circulation stays evaluable.
// Never a whole-duty and never a whole-circulation exemption. An ambiguous line attribution is
// INCONCLUSIVE — never PASS, FAIL or NOT_APPLICABLE.
import { evaluateOneSixthEligibility, ELIGIBILITY_STATUS } from '../js/v2/analysis/one-sixth-rule.js';

const config = JSON.parse(readFileSync(new URL('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json', import.meta.url), 'utf8'));
const p = (path) => path.split('.').reduce((n, k) => n?.[k], config.parameters);

const RULE_CONFIG = {
  ruleId: 'BV015_BV018', enabled: true, organizations: ['JNV'], modes: ['bus', 'tram'],
  requiredRatioNumerator: 1, requiredRatioDenominator: 6, roundingRule: 'ceil_to_full_minute',
  minimumObservedSpanMinutes: 11, creditingMethod: 'full_observed_span',
  acceptedTurnaroundConfidence: ['exact', 'probable'], locationMismatchBlocksCrediting: false,
  allowedDayTypes: p('eligibility.allowedDayTypes').value,
  nightShiftIsException: p('eligibility.nightShiftIsException').value,
  nightShiftStart: p('eligibility.nightShiftStart').value,
  nightShiftStartInclusive: p('eligibility.nightShiftStartInclusive').value,
  admissionLines: p('eligibility.admissionLines').value,
  admissionLineRequiresPureDuty: p('eligibility.admissionLineRequiresPureDuty').value
};
const CONTEXT = { organization: 'JNV', mode: 'bus' };

// `saturday` keeps the day-type gate open so these tests isolate the line filter.
const projection = (circulations) => ({
  metadata: { serviceRegime: 'school', dayType: 'saturday', generatedFrom: 'driving-projection', circulationCount: circulations.length },
  circulations: circulations.map(c => ({
    code: c.code ?? '11100',
    drivingSegments: c.lines.map((line, i) => {
      const segment = { serviceNumber: '2101', kind: 'service', startMinutes: i * 60, endMinutes: i * 60 + 30, durationMinutes: 30, source: { serviceNumber: '2101', activityIndex: i, sourceType: 'pdf' } };
      if (line !== undefined) segment.line = line;
      return segment;
    }),
    drivingBlocks: [], interruptionIntervals: [], nonDrivingIntervals: [],
    statistics: { drivingMinutes: 30 * c.lines.length, nonDrivingMinutes: 0, knownTotalMinutes: 30 * c.lines.length },
    warnings: []
  })),
  warnings: []
});
const check = (circulations) => evaluateOneSixthEligibility({
  drivingProjection: projection(circulations), ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: {}
});
const circulationOf = (result, code = '11100') => result.circulations.find(c => c.circulationCode === code);

// SUPERSEDED BY PHASE 3I.15b — the whole file. The real end-to-end test proved the opposite reading
// correct: line 18 is an ADMISSION GROUND, not a segment exception. Every assertion below now
// states the corrected semantics; the protective half (an unattributable line trip is never
// guessed, no duty-wide exemption is invented, the line comes from the configuration) is kept.

// ===== pure line-18 circulation: admitted, not dismissed =====
test('a circulation consisting only of line 18 is ADMITTED and classified as pure', () => {
  const c = circulationOf(check([{ lines: ['18', '18'] }]));
  assert.equal(c.status, ELIGIBILITY_STATUS.PASS, 'line 18 admits — it never dismisses');
  assert.equal(c.line18Classification, 'PURE_LINE_18_ONLY');
  assert.notEqual(c.status, ELIGIBILITY_STATUS.NOT_APPLICABLE);
});
test('a pure line-18 circulation loses nothing from its calculation', () => {
  const c = circulationOf(check([{ lines: ['18', '18'] }]));
  for (const removed of ['exceptedSegmentCount', 'exceptedSegmentIndexes', 'evaluableSegmentCount']) {
    assert.ok(!(removed in c), `${removed} no longer steers the calculation`);
  }
  assert.equal(c.segmentCount, 2, 'both segments stay part of the duty');
});

// ===== mixed circulation: no line-18 admission, and no partial exemption either =====
test('a mixed circulation is classified as mixed', () => {
  const c = circulationOf(check([{ lines: ['18', '12'] }]));
  assert.equal(c.line18Classification, 'MIXED_WITH_OTHER_LINES');
});
test('a mixed circulation keeps ALL its segments in the calculation', () => {
  const c = circulationOf(check([{ lines: ['18', '12', '18'] }]));
  assert.equal(c.segmentCount, 3, 'no segment drops out any more');
  assert.equal(c.line18Classification, 'MIXED_WITH_OTHER_LINES');
});
test('a duty is never admitted merely because line 18 occurs somewhere in it', () => {
  const weekday = evaluateOneSixthEligibility({
    drivingProjection: { ...projection([{ lines: ['18', '12'] }]), metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: 1 } },
    ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: 5 * 60 }
  });
  assert.equal(circulationOf(weekday).status, ELIGIBILITY_STATUS.NOT_APPLICABLE, 'a mixed weekday duty stays out');
});
test('a circulation without line 18 is classified as mixed and admitted only by its day type', () => {
  const c = circulationOf(check([{ lines: ['12', '5'] }]));
  assert.equal(c.line18Classification, 'MIXED_WITH_OTHER_LINES');
  assert.equal(c.status, ELIGIBILITY_STATUS.PASS, 'the Saturday day type admits it');
  assert.equal(c.eligibilityReason, 'WEEKEND');
});

// ===== the protective half is unchanged =====
test('a partly unknown line attribution is never guessed', () => {
  const c = circulationOf(check([{ lines: ['18', undefined] }]));
  assert.equal(c.lineAttributionComplete, false);
  assert.notEqual(c.line18Classification, 'PURE_LINE_18_ONLY', 'purity may not be assumed');
  assert.ok(c.warnings.some(w => w.code === 'SEGMENT_LINE_AMBIGUOUS'));
});
test('an empty or blank line value counts as unknown, not as a line', () => {
  for (const value of ['', '   ', null]) {
    const c = circulationOf(check([{ lines: ['18', value] }]));
    assert.equal(c.lineAttributionComplete, false, `line ${JSON.stringify(value)}`);
  }
});
test('an unattributable weekday duty is inconclusive, never dismissed', () => {
  const weekday = evaluateOneSixthEligibility({
    drivingProjection: { ...projection([{ lines: ['18', undefined] }]), metadata: { serviceRegime: 'school', dayType: 'mo_fr', generatedFrom: 'driving-projection', circulationCount: 1 } },
    ruleConfig: RULE_CONFIG, context: CONTEXT, eligibility: { dutyStartMinutes: 5 * 60 }
  });
  assert.equal(weekday.status, ELIGIBILITY_STATUS.INCONCLUSIVE);
});
test('a projection without any line field claims no admission and reports the gap', () => {
  const c = circulationOf(check([{ lines: [undefined, undefined] }]));
  assert.equal(c.line18Classification, 'NO_LINE_INFORMATION');
  assert.ok(c.warnings.some(w => w.code === 'SEGMENT_LINE_UNAVAILABLE'), 'the gap is reported');
});

// ===== admission contract =====
test('the configured admission ground really requires a pure duty', () => {
  assert.deepEqual(RULE_CONFIG.admissionLines, ['18']);
  assert.equal(RULE_CONFIG.admissionLineRequiresPureDuty, true);
});
test('the rule module invents no duty-wide exemption and hard-codes no line', () => {
  const src = readFileSync(new URL('../js/v2/analysis/one-sixth-rule.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /entire_duty_if_line_present|pure_line_18_duties_only|entire_circulation/);
  assert.doesNotMatch(src, /'18'|"18"/, 'the admission line comes from the configuration');
});
