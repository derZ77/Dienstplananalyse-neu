import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 3I.17 – the matcher now uses the EXISTING circuit-identity normalisation, so the two real
// JNV notations for one and the same circulation finally meet. Nothing is newly normalised here:
// the matcher asks `normalizeCircuitIdentity` for the key both sides already agree on.
import { matchJnvBundle } from '../js/v2/matching/jnv-bundle-matcher.js';
import { normalizeCircuitIdentity } from '../js/v2/identity/identity-normalization.js';

const BUNDLE = { compatibility: { status: 'exact' }, primary: { documentType: 'jnv_schedule_pdf' }, companion: { documentType: 'umlaufkarte' } };
const schedule = (codes, over = {}) => ({
  serviceRegime: 'school', dayType: 'mo_fr',
  umlaeufe: codes.map(code => (typeof code === 'string' ? { code } : code)),
  ...over
});
const board = (codes, over = {}) => ({
  validity: { serviceRegime: 'school', dayType: 'mo_fr' },
  circulations: codes.map(code => (typeof code === 'string' ? { code, id: code, segments: [] } : code)),
  ...over
});
const run = (planCodes, boardCodes) => matchJnvBundle({ bundle: BUNDLE, schedule: schedule(planCodes), umlauftafel: board(boardCodes) });
const statusOf = (result, code) => result.matches.find(m => (m.primaryRefs || []).includes(code))?.status;

// ===== A. the real pair from Phase 3I.16 =====
test('A: 18/1 and 18100 are recognised as the same circulation', () => {
  const result = run(['18/1'], ['18100']);
  assert.equal(result.status, 'exact');
  assert.equal(result.statistics.exact, 1);
  assert.equal(statusOf(result, '18/1'), 'exact');
});
test('A: the match records HOW it was found', () => {
  const match = run(['18/1'], ['18100']).matches[0];
  assert.deepEqual(match.reasons, ['NORMALIZED_UMLAUF_CODE'], 'a normalised match is never disguised as a raw one');
  assert.deepEqual(match.companionRefs, ['18100'], 'the companion side keeps its own notation');
});

// ===== B. more real pairs =====
test('B: 12/1 ↔ 12100 and 10/9 ↔ 10901 match too', () => {
  const result = run(['12/1', '10/9'], ['12100', '10901']);
  assert.equal(result.status, 'exact');
  assert.equal(result.statistics.exact, 2);
  assert.equal(result.statistics.unmatched, 0);
  assert.equal(result.statistics.missingInSchedule, 0, 'no circulation is left over');
});
test('B: the direction does not matter', () => {
  const reversed = matchJnvBundle({ bundle: BUNDLE, schedule: schedule(['12100']), umlauftafel: board(['12/1']) });
  assert.equal(reversed.statistics.exact, 1, 'the board may carry the slash notation as well');
});
test('B: a whole real-shaped set matches', () => {
  const result = run(['10/9', '12/1', '14/2', '18/1'], ['10901', '12100', '14200', '18100']);
  assert.equal(result.statistics.exact, 4);
  assert.equal(result.statistics.unmatched, 0);
});

// ===== C. different circulations must NOT match =====
test('C: 18/1 does not match 18/2', () => {
  const result = run(['18/1'], ['18/2']);
  assert.equal(result.statistics.exact, 0);
  assert.equal(statusOf(result, '18/1'), 'unmatched');
});
test('C: 18/1 does not match 18200 either', () => {
  const result = run(['18/1'], ['18200']);
  assert.equal(result.statistics.exact, 0);
  assert.equal(statusOf(result, '18/1'), 'unmatched');
});
test('C: a different line never matches', () => {
  assert.equal(run(['18/1'], ['12100']).statistics.exact, 0);
  assert.equal(run(['18/1'], ['10901']).statistics.exact, 0);
});
test('C: KNOWN LIMIT — codes differing only in their trailing digits share one key', () => {
  // `10901` and `10902` are line 10, course 9, trips 01/02. The CENTRAL normalisation keys both
  // as LC:10|9. The matcher accepts that verdict instead of inventing a finer one of its own —
  // and must therefore report ambiguity when both are on the board, never pick one.
  assert.equal(normalizeCircuitIdentity('10901', {}).routeIdentity.normalizedKey,
    normalizeCircuitIdentity('10902', {}).routeIdentity.normalizedKey);
  const result = run(['10/9'], ['10901', '10902']);
  assert.equal(result.statistics.exact, 0, 'no silent pick between two equally valid candidates');
  assert.equal(statusOf(result, '10/9'), 'ambiguous');
});
test('C: the keys themselves prove the distinction', () => {
  const a = normalizeCircuitIdentity('18/1', {}).routeIdentity.normalizedKey;
  const b = normalizeCircuitIdentity('18200', {}).routeIdentity.normalizedKey;
  assert.notEqual(a, b);
});

// ===== D. an unknown notation is never guessed =====
test('D: an unattributable code stays unmatched', () => {
  const result = run(['ABC-XYZ'], ['18100']);
  assert.equal(result.statistics.exact, 0);
  assert.equal(statusOf(result, 'ABC-XYZ'), 'unmatched');
});
test('D: two unattributable codes do not match each other', () => {
  const result = run(['ABC-XYZ'], ['DEF-UVW']);
  assert.equal(result.statistics.exact, 0, 'no key, no match — never a fallback to "both unknown"');
});
test('D: an empty code matches nothing', () => {
  assert.equal(run([''], ['18100']).statistics.exact, 0);
  assert.equal(run(['18/1'], ['']).statistics.exact, 0);
});
test('D: an ambiguous normalised target is reported, not picked', () => {
  // Two board circulations normalise onto the same key — the matcher must not choose one.
  const result = run(['18/1'], ['18100', '18/1 ']);
  assert.notEqual(statusOf(result, '18/1'), 'exact');
  assert.equal(result.statistics.exact, 0);
});

// ===== E. no regression of the existing contracts =====
test('E: an exact raw match still reports EXACT_UMLAUF_CODE', () => {
  const match = run(['12100'], ['12100']).matches[0];
  assert.equal(match.status, 'exact');
  assert.deepEqual(match.reasons, ['EXACT_UMLAUF_CODE'], 'the raw path is untouched and takes precedence');
});
test('E: the validity gate still runs first', () => {
  const result = matchJnvBundle({
    bundle: BUNDLE,
    schedule: schedule(['18/1'], { dayType: 'saturday' }),
    umlauftafel: board(['18100'])
  });
  assert.equal(result.status, 'conflicting');
  assert.equal(result.statistics.exact, 0, 'normalisation never overrides a validity conflict');
  assert.ok(result.warnings.some(w => w.code === 'DAY_TYPE_MISMATCH'));
});
test('E: a duplicate raw code is still reported', () => {
  const result = run(['12100'], ['12100', '12100']);
  assert.ok(result.warnings.some(w => w.code === 'DUPLICATE_UMLAUF_CODE'));
  assert.equal(statusOf(result, '12100'), 'ambiguous');
});
test('E: an unreferenced circulation is still counted as missing in the schedule', () => {
  const result = run(['18/1'], ['18100', '99900']);
  assert.equal(result.statistics.exact, 1);
  assert.equal(result.statistics.missingInSchedule, 1, 'the normalised hit must not be counted as missing');
});
test('E: the invalid-input and invalid-bundle gates are unchanged', () => {
  const partialBundle = { ...BUNDLE, compatibility: { status: 'partial' } };
  assert.equal(matchJnvBundle({ bundle: partialBundle, schedule: schedule(['18/1']), umlauftafel: board(['18100']) }).status,
    'conflicting', 'a non-exact bundle is rejected before any normalisation happens');
  assert.equal(matchJnvBundle({ bundle: BUNDLE, schedule: null, umlauftafel: board(['18100']) }).status, 'conflicting');
});
test('E: the matcher owns no normalisation of its own', () => {
  const src = readFileSync(new URL('../js/v2/matching/jnv-bundle-matcher.js', import.meta.url), 'utf8');
  assert.match(src, /normalizeCircuitIdentity/, 'it uses the existing one');
  assert.doesNotMatch(src, /replace\(\s*\/|padStart|slice\(-?\d/, 'and invents no notation handling');
});
test('E: no rule, projection or timeline module was touched for this', () => {
  for (const path of ['../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/one-sixth-validation.js',
    '../js/v2/analysis/joint-timeline.js', '../js/v2/analysis/driving-projection.js']) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /3I\.17|NORMALIZED_UMLAUF_CODE/, `${path} must carry no Phase 3I.17 change`);
  }
});
