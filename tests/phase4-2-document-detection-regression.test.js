import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 4.2 (D/E/G) — the multi-signal contract survives the repair.
 *
 * The defect was a false NEGATIVE in one signal. Repairing it must not turn the detector into
 * something that says yes more easily: no threshold was lowered, no signal was waived, and no
 * document that was refused before is accepted now — except the one that was wrongly refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { detectPdfDocumentProfile, PDF_DOCUMENT_PROFILES } = await import('../js/v2/pdf/document-profile-detector.js');
const { analyzePdfImport, buildDetectionText } = await import('../js/v2/import/pdf-analysis-controller.js');
const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { getProfilesForDocumentType } = await import('../js/v2/documents/document-profiles.js');

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const JNV_PDF = FIXTURES.jnvSchedulePdf;
const UMLAUFTAFEL_PDF = FIXTURES.jnvUmlauftafelPdf;
const present = async (path) => { try { await access(path); return true; } catch { return false; } };
const fileLike = (bytes) => ({ name: 'x.pdf', type: 'application/pdf', arrayBuffer: async () => bytes.buffer.slice(0) });

const TITLE_JES = 'Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026';
const TITLE_JNV = 'Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026';
const HEADER = 'Dienst Umlauf Tätigkeit Abfahrt Abfahrtsort Ankunft Ankunftsort Beginn Ende Bez. Zeit';
const LABEL_JES = 'Vorbereitungszeit JES';
const LABEL_JNV = 'Aufrüsten Mitfahrt';

const detect = (text, pageCount = 3) => detectPdfDocumentProfile({ text, pageCount });

// =====================================================================================
// D — no single signal is sufficient
// =====================================================================================
test('D: the title alone is not enough', () => {
  assert.equal(detect(TITLE_JES).status, 'unsupported');
  assert.equal(detect(TITLE_JNV).status, 'unsupported');
});

test('D: the table header alone is not enough', () => {
  const detection = detect(HEADER);
  assert.equal(detection.status, 'unsupported');
  assert.equal(detection.signals.tableHeaderFound, true, 'the signal is true — it is just not sufficient');
});

test('D: the JES labels alone are not enough', () => {
  assert.equal(detect(`${LABEL_JES} Nachbereitungszeit JES JES Pausenort`).status, 'unsupported');
});

test('D: title plus table header without the JES labels stays unsupported', () => {
  const detection = detect(`${TITLE_JES} ${HEADER}`);
  assert.equal(detection.status, 'unsupported');
  assert.deepEqual(detection.signals.jesSignals, [true, true, false], 'exactly the label signal is missing');
});

test('D: title plus JES labels without the table header stays unsupported', () => {
  const detection = detect(`${TITLE_JES} ${LABEL_JES}`);
  assert.equal(detection.status, 'unsupported');
  assert.equal(detection.signals.tableHeaderFound, false);
});

test('D: only all three signals together yield JES', () => {
  const detection = detect(`${TITLE_JES} ${HEADER} ${LABEL_JES}`);
  assert.equal(detection.status, 'supported');
  assert.equal(detection.profile.id, 'jes-regionalbus-v1');
  assert.deepEqual(detection.signals.jesSignals, [true, true, true]);
});

test('D: the detector still demands EVERY signal — the combination was not relaxed', () => {
  const detector = src('../js/v2/pdf/document-profile-detector.js');
  assert.match(detector, /jesSignals\.every\(Boolean\)/, 'JES still requires all of its signals');
  assert.match(detector, /beuSignals\.every\(Boolean\)/, 'JNV likewise');
  assert.doesNotMatch(detector, /\.some\(Boolean\)|score|threshold|weight/i, 'no scoring, no threshold');
});

// =====================================================================================
// E — negatives
// =====================================================================================
test('E: the real JNV plan stays JNV', async (t) => {
  if (!(await present(JNV_PDF))) return t.skip('JNV reference plan not present');
  const { detection, canonicalSchedule } = await analyzePdfImport(fileLike(new Uint8Array(await readFile(JNV_PDF))));
  assert.equal(detection.status, 'supported');
  assert.equal(detection.profile.id, 'beu-stadtbus-v1');
  assert.equal(canonicalSchedule.services.length, 62, 'and its 62 duties are unchanged');
  assert.equal(canonicalSchedule.hardened.applied, true, 'JNV hardening still runs');
  assert.equal(canonicalSchedule.hardened.interruptions.length, 12);
});

test('E: the real Umlauftafel PDF is still refused', async (t) => {
  if (!(await present(UMLAUFTAFEL_PDF))) return t.skip('Umlauftafel reference not present');
  const bytes = new Uint8Array(await readFile(UMLAUFTAFEL_PDF));
  const { detection, canonicalSchedule } = await analyzePdfImport(fileLike(bytes));
  assert.equal(detection.status, 'unsupported');
  assert.equal(detection.profile, undefined);
  assert.equal(canonicalSchedule, null, 'the pipeline does not start');
  assert.equal(detection.signals.tableHeaderFound, false);
  assert.deepEqual(detection.signals.jesSignals, [false, false, false]);
  assert.deepEqual(detection.signals.beuSignals, [false, false, false]);

  // …and the repaired projection did not accidentally create a signal out of its line text.
  const text = buildDetectionText(await extractPdfLayoutDocument(bytes));
  assert.ok(text.includes('Umlauf:'), 'it really is an Umlauftafel');
  assert.ok(!text.includes('Dienste Regionalbus'));
  assert.ok(!text.includes('Dienste Stadtbus'));
});

test('E: a Wagenkarte can never be classified by this detector at all', () => {
  assert.deepEqual(getProfilesForDocumentType('wagenkarte'), []);
  assert.deepEqual(getProfilesForDocumentType('umlaufkarte'), []);
  assert.deepEqual(Object.keys(PDF_DOCUMENT_PROFILES).sort(), ['beu', 'jes']);
  // Wagenkarten arrive as .xlsx and are classified elsewhere; that path is untouched here.
  assert.doesNotMatch(src('../js/v2/import/excel-document-classifier.js'), /4\.2|Phase 4/);
  assert.doesNotMatch(src('../js/v2/import/excel-import-controller.js'), /4\.2|Phase 4/);
});

test('E: a Wagenkarten-like text is not mistaken for a JES plan', () => {
  assert.equal(detect('Wagenkarte Fahrzeug 1234 Umlauf 10901 Dienste Fahrer').status, 'unsupported');
});

test('E: an unknown PDF stays unsupported', () => {
  assert.equal(detect('Irgendein Fahrplan mit einer nicht unterstützten Tabellenstruktur', 1).status, 'unsupported');
  assert.equal(detect('', 0).status, 'unsupported');
});

test('E: prose containing both words far apart is not accepted', () => {
  const prose = 'Die Dienste der Verkehrsbetriebe werden geplant. '
    + 'Ein Absatz weiter unten steht das Wort Regionalbus in einem ganz anderen Zusammenhang. '
    + `${HEADER} ${LABEL_JES}`;
  assert.equal(detect(prose).status, 'unsupported', 'the title phrase must be contiguous');
  assert.equal(detect(`Dienste Regionalbus ${HEADER} ${LABEL_JES}`).status, 'unsupported',
    'and the full dated title is still required');
});

test('E: the title decides which operator a plan belongs to', () => {
  // A Stadtbus title never yields the JES profile, whatever else stands in the document. It
  // resolves to JNV here because the JNV label pattern matches "Vorbereitung" as a substring of
  // "Vorbereitungszeit JES" — existing, unchanged detector behaviour, and the title agrees.
  const mixed = detect(`${TITLE_JNV} ${HEADER} ${LABEL_JES}`);
  assert.notEqual(mixed.profile?.id, 'jes-regionalbus-v1');
  assert.equal(mixed.profile.id, 'beu-stadtbus-v1');
  assert.equal(detect(`${TITLE_JNV} ${HEADER} ${LABEL_JNV}`).profile.id, 'beu-stadtbus-v1');
  assert.equal(detect(`${TITLE_JES} ${HEADER} ${LABEL_JES}`).profile.id, 'jes-regionalbus-v1');
});

// =====================================================================================
// G — regression
// =====================================================================================
test('G: the synthetic detector expectations from Phase 2 still hold', () => {
  assert.equal(detect(`Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026 ${HEADER} ${LABEL_JES}`).profile.id,
    'jes-regionalbus-v1');
  assert.equal(detect(`Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026 ${HEADER} Aufrüsten Mitfahrt`, 15).profile.id,
    'beu-stadtbus-v1');
});

test('G: the CanonicalSchedule contract is unchanged', async (t) => {
  if (!(await present(JNV_PDF))) return t.skip('JNV reference plan not present');
  const { canonicalSchedule } = await analyzePdfImport(fileLike(new Uint8Array(await readFile(JNV_PDF))));
  assert.deepEqual(Object.keys(canonicalSchedule),
    ['type', 'document', 'services', 'activities', 'interruptions', 'warnings', 'metadata', 'hardened']);
  assert.deepEqual(Object.keys(canonicalSchedule.services[0]),
    ['id', 'serviceNumber', 'begin', 'end', 'paidTime', 'activities', 'interruptions',
      'originalText', 'boundingBox', 'source']);
  assert.equal(canonicalSchedule.metadata.schemaVersion, '1.0');
});

test('G: exactly one product file carries this phase', () => {
  const root = fileURLToPath(new URL('../js', import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const touched = walk(root)
    .filter(file => file.endsWith('.js'))
    .filter(file => /Phase 4\.2|4\.2 —|4\.2 -/.test(readFileSync(file, 'utf8')))
    .map(file => file.slice(root.length + 1));
  assert.deepEqual(touched, ['v2/import/pdf-analysis-controller.js'],
    'the repair lives in the detection-text projection and nowhere else');
});

test('G: no rule, runner, matcher or export was touched', () => {
  for (const path of ['../js/v2/checks/check-runner.js', '../js/v2/checks/bv/bv003.js',
    '../js/v2/analysis/one-sixth-rule.js', '../js/v2/analysis/jnv-rule-analysis-controller.js',
    '../js/v2/matching/jnv-bundle-matcher.js', '../js/v2/analysis/joint-timeline.js',
    '../js/v2/analysis/driving-projection.js', '../js/v2/report/check-report-view.js',
    '../js/v2/report/check-report-export.js', '../js/v2/report/check-report-export-model.js']) {
    assert.doesNotMatch(src(path), /4\.2|Phase 4/, `${path} must be untouched`);
  }
  const config = JSON.parse(src('../js/v2/rules/config/organizations/jnv-one-sixth.v1.json'));
  assert.equal(config.status, 'approved');
  assert.equal(config.approvedBy, 'JNV_RULE_APPROVAL_2026_PHASE3I15C');
  assert.equal(config.parameters.activation.enabled.value, false, 'still not activated');
});

test('G: the changed module stays local, without storage, network or a special case', () => {
  const module = src('../js/v2/import/pdf-analysis-controller.js');
  assert.doesNotMatch(module, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(module, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(module, /import .* from ['"](?!\.)/, 'no bare specifier — nothing installed');
  assert.doesNotMatch(module, /\/Users\/|Down' + 'loads|\.pdf['"]/, 'no local file name and no path');
  assert.doesNotMatch(module, /egionalbus|Regionalbus|Stadtbus/, 'no hard-coded document fragment');
  assert.doesNotMatch(module, /process\.env|NODE_ENV|isTest/, 'no test branch');
});
