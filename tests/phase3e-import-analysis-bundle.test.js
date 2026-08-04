import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3E – productive AnalysisBundle infrastructure (data model only). No analysis,
// no matching, no results. Reuses the frozen document-type/role contracts and the
// profile pairing knowledge; produces a lean productive bundle shape.
import {
  createAnalysisBundle, evaluateBundleCompatibility, validateAnalysisBundle,
  BUNDLE_COMPATIBILITY_STATUS, PRIMARY_DOCUMENT_TYPES
} from '../js/v2/import/import-analysis-bundle.js';
import { createImportedDocument } from '../js/v2/documents/analysis-bundle.js';
import { DOCUMENT_TYPES as T, DOCUMENT_ROLES as R } from '../js/v2/documents/document-types.js';

const prim = (type, id = 'p') => createImportedDocument({ id, role: R.PRIMARY, type });
const comp = (type, id = 'c') => createImportedDocument({ id, role: R.COMPANION, type });

// ===== §5 structural compatibility (types only, no fachliche analysis) =====
test('exact: a schedule combined with its canonical companion', () => {
  assert.equal(evaluateBundleCompatibility(T.JES_SCHEDULE_PDF, T.WAGENKARTE).status, 'exact');
  assert.equal(evaluateBundleCompatibility(T.JNV_SCHEDULE_PDF, T.UMLAUFKARTE).status, 'exact');
});

test('conflicting: a schedule combined with the wrong operator companion', () => {
  assert.equal(evaluateBundleCompatibility(T.JES_SCHEDULE_PDF, T.UMLAUFKARTE).status, 'conflicting');
  assert.equal(evaluateBundleCompatibility(T.JNV_SCHEDULE_PDF, T.WAGENKARTE).status, 'conflicting');
});

test('unsupported: legacy takes no companion, companion-as-primary, schedule-as-companion, unknown', () => {
  assert.equal(evaluateBundleCompatibility(T.LEGACY_EXCEL_SCHEDULE, T.WAGENKARTE).status, 'unsupported');
  assert.equal(evaluateBundleCompatibility(T.WAGENKARTE, T.UMLAUFKARTE).status, 'unsupported');
  assert.equal(evaluateBundleCompatibility(T.JES_SCHEDULE_PDF, T.JNV_SCHEDULE_PDF).status, 'unsupported');
  assert.equal(evaluateBundleCompatibility(T.UNKNOWN, T.WAGENKARTE).status, 'unsupported');
});

test('the compatibility status vocabulary is the closed 5-value contract', () => {
  assert.deepEqual(
    Object.values(BUNDLE_COMPATIBILITY_STATUS).sort(),
    ['ambiguous', 'conflicting', 'exact', 'probable', 'unsupported']
  );
});

test('compatibility is a pure, deterministic, explanatory result (never a bare boolean)', () => {
  const a = evaluateBundleCompatibility(T.JES_SCHEDULE_PDF, T.WAGENKARTE);
  const b = evaluateBundleCompatibility(T.JES_SCHEDULE_PDF, T.WAGENKARTE);
  assert.deepEqual(a, b);
  assert.equal(typeof a.status, 'string');
  assert.equal(typeof a.code, 'string');
  assert.equal(typeof a.reason, 'string');
});

// ===== §3/§6 factory: exact bundle shape, no analysis, no matches =====
test('the bundle contains exactly id, createdAt, primary, companion, compatibility, warnings', () => {
  const b = createAnalysisBundle({ id: 'b1', createdAt: '2026-07-31T00:00:00Z', primary: prim(T.JNV_SCHEDULE_PDF), companion: comp(T.UMLAUFKARTE) });
  assert.deepEqual(Object.keys(b).sort(), ['companion', 'compatibility', 'createdAt', 'id', 'primary', 'warnings']);
  assert.ok(!('mode' in b));
  assert.ok(!('matchStatus' in b)); // no matches
});

test('the factory is deterministic and stores no analysis result', () => {
  const args = { id: 'b2', createdAt: '2026-07-31T00:00:00Z', primary: prim(T.JES_SCHEDULE_PDF), companion: comp(T.WAGENKARTE) };
  assert.deepEqual(createAnalysisBundle(args), createAnalysisBundle(args));
  const b = createAnalysisBundle(args);
  assert.ok(!('canonicalSchedule' in b.primary) && !('data' in b.primary) && !('result' in b.primary));
});

test('an exact combination carries no warnings', () => {
  const b = createAnalysisBundle({ id: 'b3', primary: prim(T.JNV_SCHEDULE_PDF), companion: comp(T.UMLAUFKARTE) });
  assert.equal(b.compatibility.status, 'exact');
  assert.deepEqual(b.warnings, []);
});

test('an invalid combination yields warnings, never an exception', () => {
  let b;
  assert.doesNotThrow(() => { b = createAnalysisBundle({ id: 'b4', primary: prim(T.JES_SCHEDULE_PDF), companion: comp(T.UMLAUFKARTE) }); });
  assert.equal(b.compatibility.status, 'conflicting');
  assert.ok(b.warnings.length >= 1);
  assert.ok(b.warnings.every(w => typeof w.code === 'string'));
});

test('a companion document placed in the primary slot warns (role/type mismatch), no throw', () => {
  let b;
  assert.doesNotThrow(() => { b = createAnalysisBundle({ id: 'b5', primary: prim(T.WAGENKARTE), companion: comp(T.UMLAUFKARTE) }); });
  assert.ok(b.warnings.some(w => w.code === 'INVALID_PRIMARY_TYPE'));
});

test('the factory requires a non-empty id (programmer error → throw)', () => {
  assert.throws(() => createAnalysisBundle({ primary: prim(T.JES_SCHEDULE_PDF) }), TypeError);
});

test('PRIMARY_DOCUMENT_TYPES lists the three schedule primaries only', () => {
  assert.deepEqual([...PRIMARY_DOCUMENT_TYPES].sort(), ['jes_schedule_pdf', 'jnv_schedule_pdf', 'legacy_excel_schedule']);
});

// ===== §7 validation: dependency-free { valid, errors:[...] } =====
test('validation accepts a well-formed bundle', () => {
  const b = createAnalysisBundle({ id: 'ok', createdAt: '2026-07-31T00:00:00Z', primary: prim(T.JNV_SCHEDULE_PDF), companion: comp(T.UMLAUFKARTE) });
  assert.deepEqual(validateAnalysisBundle(b), { valid: true, errors: [] });
});

test('validation reports structured errors for a malformed bundle', () => {
  const r = validateAnalysisBundle({ id: '', createdAt: null, primary: { role: 'companion' }, companion: null, compatibility: null, warnings: 'nope' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.code === 'MISSING_ID'));
  assert.ok(r.errors.some(e => e.code === 'INVALID_WARNINGS'));
  assert.ok(r.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string'));
});
