import { FIXTURES } from './fixtures/paths.js';
/**
 * Phase 4.1 (E/F) — CONTRACT TEST: the mapping matrix, measured on the real reference plans.
 *
 * Nothing is implemented in this phase. What is asserted here is which target column HAS a source
 * in today's pipeline and which has none — measured, not assumed. A column without a source stays
 * empty in the export; it is never filled by guessing.
 *
 * The column names are restated from `phase4-1-pdf-to-xlsx-contract.test.js`, which is the
 * authority for the contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

import { detectPdfDocumentProfile } from '../js/v2/pdf/document-profile-detector.js';

globalThis.DOMMatrix ||= class DOMMatrix {};
const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule } = await import('../js/v2/pdf/schedule-mapper.js');
const { buildHardenedCanonicalSchedule } = await import('../js/v2/pdf/hardened-schedule.js');
// SUPERSEDED BY PHASE 4.2: the detection text is now the reconstructed line text.
const { buildDetectionText } = await import('../js/v2/import/pdf-analysis-controller.js');

const REFERENCE = {
  jnv: FIXTURES.jnvSchedulePdf,
  jes: FIXTURES.jesSchedulePdf,
  excel: FIXTURES.legacyScheduleXlsx
};
const readable = (path) => { try { readFileSync(path); return true; } catch { return false; } };

/** The real JNV plan through the real pipeline — read once, reused by every test below. */
let jnvSchedule = null;
const jnv = async () => {
  if (!jnvSchedule) {
    const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(REFERENCE.jnv)));
    jnvSchedule = buildHardenedCanonicalSchedule(
      mapPdfDocumentToSchedule(normalizePdfLayoutDocument(layout)), { profileId: 'beu-stadtbus-v1' });
  }
  return jnvSchedule;
};
const filled = (list, pick) => list.filter(entry => {
  const value = pick(entry);
  return value !== null && value !== undefined && String(value).trim() !== '';
}).length;

const skipJnv = !readable(REFERENCE.jnv) && 'JNV reference plan not present';

// =====================================================================================
// E — every column either has a real source or stays empty
// =====================================================================================
test('E: the JNV Dienstplan-PDF really does reach a CanonicalSchedule', { skip: skipJnv }, async () => {
  const schedule = await jnv();
  assert.equal(schedule.type, 'CanonicalSchedule');
  assert.equal(schedule.services.length, 62, '62 duties on the reference plan');
  assert.equal(schedule.activities.length, 656, '656 activity rows');
  assert.equal(new Set(schedule.services.map(s => String(s.serviceNumber).trim())).size, 62,
    'every duty number is unique — the Dienste sheet has a stable key');
});

test('E: the duty-level columns are complete', { skip: skipJnv }, async () => {
  const { services } = await jnv();
  assert.equal(filled(services, s => s.serviceNumber), 62, 'Dienstnummer');
  assert.equal(filled(services, s => s.begin?.value), 62, 'Dienstbeginn');
  assert.equal(filled(services, s => s.end?.value), 62, 'Dienstende');
  assert.equal(filled(services, s => s.paidTime?.value), 62, 'Bezahlte Zeit');
});

test('E: the activity-level columns have the coverage the mapping matrix records',
  { skip: skipJnv }, async () => {
    const { activities } = await jnv();
    assert.equal(activities.length, 656);
    // Printed in a dedicated column on (almost) every row:
    assert.equal(filled(activities, a => a.rawActivity), 629, 'Tätigkeit');
    assert.equal(filled(activities, a => a.departureTime?.value), 629, 'Beginn');
    assert.equal(filled(activities, a => a.arrivalTime?.value), 629, 'Ende');
    assert.equal(filled(activities, a => a.departureLocation), 629, 'Anfangsort');
    assert.equal(filled(activities, a => a.arrivalLocation), 629, 'Endort');
    // Only where the row actually drives a line service:
    assert.equal(filled(activities, a => a.circuitNumber), 173, 'Umlauf');
    assert.equal(filled(activities, a => a.routeIdentity?.line), 173, 'Linie (derived from the Umlauf)');
    // The remaining 27 rows are page footers and interruption lines — they carry no activity.
    assert.equal(656 - 629, 27, 'rows without an activity text');
  });

test('E: the Linie is DERIVED from the Umlauf code and never invented', { skip: skipJnv }, async () => {
  const { activities } = await jnv();
  const withCircuit = activities.filter(a => String(a.circuitNumber || '').trim() !== '');
  for (const activity of withCircuit) {
    assert.equal(activity.routeIdentity?.kind, 'LINE_COURSE');
    assert.ok(activity.routeIdentity.line, 'a line only where a circuit code exists');
  }
  const withoutCircuit = activities.filter(a => String(a.circuitNumber || '').trim() === '');
  for (const activity of withoutCircuit) {
    assert.ok(!activity.routeIdentity?.line, 'no circuit code → no line, and no guess');
  }
  const sample = withCircuit.find(a => a.circuitNumber.trim() === '12100');
  assert.deepEqual({ line: sample.routeIdentity.line, course: sample.routeIdentity.course },
    { line: '12', course: '1' }, '12100 is line 12, course 1');
});

test('E: Richtung has NO source in the PDF and therefore stays empty', { skip: skipJnv }, async () => {
  const { activities } = await jnv();
  // The PDF layout is ten columns wide: Dienst, Umlauf, Tätigkeit, Abfahrt, Abfahrtsort,
  // Ankunft, Ankunftsort, Beginn, Ende, Bez. Zeit. None of them is a direction.
  for (const activity of activities.slice(0, 40)) {
    assert.ok(!('direction' in activity), 'the model has no direction field for a PDF activity');
  }
  const layoutColumns = readFileSync(new URL('../js/v2/pdf/document-profile-detector.js', import.meta.url), 'utf8');
  assert.doesNotMatch(layoutColumns, /Richt/, 'and the ten-column header knows no direction either');
});

test('E: the relief chain has NO source in the PDF and therefore stays empty',
  { skip: skipJnv }, async () => {
    const { activities } = await jnv();
    assert.equal(filled(activities, a => a.handoverSource?.previous), 0, 'Vorheriger Dienst');
    assert.equal(filled(activities, a => a.handoverSource?.next), 0, 'Nachfolgender Dienst');
    assert.ok(activities.every(a => a.handoverSource === undefined),
      'the field is absent, not empty — the PDF simply has no such column');
  });

test('E: every row can name its page, so the export is traceable without a raw copy',
  { skip: skipJnv }, async () => {
    const { activities } = await jnv();
    assert.equal(filled(activities, a => a.source?.pageNumber), 656, 'Seite');
    assert.ok(activities.every(a => Number.isInteger(a.source.pageNumber) && a.source.pageNumber >= 1));
  });

test('E: Pause and Unterbrechung both have a source', { skip: skipJnv }, async () => {
  const schedule = await jnv();
  const paused = schedule.activities.filter(a => /^Pause/i.test(String(a.rawActivity || '').trim()));
  assert.equal(paused.length, 106, '45 unpaid + 61 paid break rows are printed as activities');
  assert.equal(schedule.hardened.applied, true);
  assert.equal(schedule.hardened.interruptions.length, 12, 'plus 12 Dienstunterbrechungen');
  assert.equal(schedule.hardened.interruptions.filter(i => i.valid).length, 12, 'all of them parseable');
});

// =====================================================================================
// F — uncertain values are marked, never silently smoothed over
// =====================================================================================
test('F: the pipeline itself flags the rows that must become "inconclusive"',
  { skip: skipJnv }, async () => {
    const { hardened } = await jnv();
    const byCode = {};
    for (const warning of hardened.warnings) byCode[warning.code] = (byCode[warning.code] || 0) + 1;
    assert.deepEqual(byCode, { NON_TABULAR_ANNOTATION: 15, AMBIGUOUS_GENERIC_DUTY: 1 },
      'these are exactly the rows the export must mark rather than present as clean');
    assert.equal(hardened.metadata.warningCount, 16);
  });

test('F: an ambiguous duty is flagged on the activity itself', { skip: skipJnv }, async () => {
  const { hardened } = await jnv();
  const ambiguous = hardened.services.flatMap(s => s.dutyActivities).filter(a => a.ambiguousDuty);
  assert.equal(ambiguous.length, 1, 'one row could not be classified from present evidence');
  assert.equal(ambiguous[0].dutyKind, 'genericDuty', 'and it stays generic instead of being guessed');
});

test('F: the midnight rollover is a derived value and must not be reported as printed',
  { skip: skipJnv }, async () => {
    const schedule = await jnv();
    const rolled = schedule.hardened.services.filter(s => s.end.dayOffset > 0);
    assert.equal(rolled.length, 6, 'six duties run past midnight');
    // The base schedule knows nothing of it — only the hardened view does. A column fed from
    // the hardened view is therefore "probable", never "exact".
    const base = schedule.services.find(s => s.serviceNumber === rolled[0].serviceNumber);
    assert.equal('dayOffset' in base.end, false, 'the printed cell carries no day offset');
  });

test('F: a location is trimmed, and trimming is the ONLY normalisation allowed',
  { skip: skipJnv }, async () => {
    const { activities } = await jnv();
    const locations = [...new Set(activities.map(a => a.departureLocation).filter(Boolean))];
    assert.equal(locations.length, 15, 'fifteen distinct stops on the reference plan');
    assert.equal(locations.filter(name => /^\s/.test(name)).length, 15,
      'every one of them arrives with a leading space — the export trims, nothing more');
    assert.ok(locations.some(name => name.trim() === 'Bth. Burgau'));
  });

// =====================================================================================
// The trap: `rawActivity` does NOT mean the same thing on both import paths
// =====================================================================================
test('F: PDF rawActivity is a Tätigkeit — Excel rawActivity is a Linie',
  { skip: (!readable(REFERENCE.jnv) || !readable(REFERENCE.excel)) && 'reference plans not present' },
  async () => {
    const { activities } = await jnv();
    const pdfVerbs = new Set(activities.map(a => String(a.rawActivity || '').trim()).filter(Boolean));
    for (const verb of ['Dienst', 'Wegezeit', 'Vorbereitung', 'Nachbereitung', 'Pause', 'Aufrüsten']) {
      assert.ok(pdfVerbs.has(verb), `the PDF prints the activity "${verb}"`);
    }

    const sandbox = { console };
    sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
    sandbox.process = process; sandbox.Buffer = Buffer;
    createContext(sandbox);
    runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
    const book = sandbox.XLSX.read(readFileSync(REFERENCE.excel), { type: 'buffer' });
    const workbook = {
      sheets: Array.from(book.SheetNames, name => ({
        name,
        rows: Array.from(sandbox.XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: null }),
          row => Array.from(row, cell => cell === null ? '' : String(cell).trim()))
      }))
    };
    const { analyzeLegacyExcelWorkbook } = await import('../js/v2/import/legacy-excel-import-adapter.js');
    const excel = analyzeLegacyExcelWorkbook(workbook, { sourceName: 'plan.xlsx' }).data;
    const excelValues = new Set(excel.activities.map(a => String(a.rawActivity || '').trim()).filter(Boolean));
    assert.ok(excelValues.has('10') && excelValues.has('16'), 'the Excel column holds line numbers');
    for (const verb of ['Wegezeit', 'Vorbereitung', 'Aufrüsten']) {
      assert.ok(!excelValues.has(verb), `"${verb}" never appears on the Excel path`);
    }
    // Therefore: the Dienstplan sheet is defined for the PDF path. An Excel source would need its
    // own mapping and is out of scope for this export.
  });

// =====================================================================================
// The blocking finding of Phase 4.1 — REPAIRED in Phase 4.2
// =====================================================================================
// SUPERSEDED BY PHASE 4.2: this pair used to record that the real JES plan was refused before
// it could reach the pipeline. It was, and the cause below is still the measured truth about
// PDF.js. What changed is the PRODUCT: the detection text is now built from the reconstructed
// line text instead of from blank-joined raw items, so the fragments are rejoined and the plan is
// classified. The assertions are therefore inverted rather than removed — the old naive join is
// kept only as the pinned cause, no longer as the behaviour.
test('BEFUND (behoben in 4.2): the fragmentation is real, and the productive path now handles it',
  { skip: !readable(REFERENCE.jes) && 'JES reference plan not present' }, async () => {
    const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(REFERENCE.jes)));

    // The cause, measured: PDF.js splits the heading into fragments.
    assert.deepEqual([...layout.pages[0].lines[0].textObjects.map(o => o.text)],
      ['Dienste', ' ', 'R', 'egionalbus Montag bis Freitag (Ferien), ab 1', '3', '.07.2026']);

    // The OLD projection — every raw item joined with a blank — still fails, as it must.
    const naive = layout.pages.slice(0, 2).flatMap(p => p.textObjects.map(o => o.text || '')).join(' ');
    assert.ok(naive.replace(/\s+/g, ' ').includes('R egionalbus'), 'the naive join tore the word apart');
    assert.equal(detectPdfDocumentProfile({ text: naive, pageCount: layout.pageCount }).status, 'unsupported');

    // The PRODUCTIVE projection rejoins them and the plan is recognised.
    const detection = detectPdfDocumentProfile({
      text: buildDetectionText(layout), pageCount: layout.pageCount });
    assert.equal(detection.status, 'supported');
    assert.equal(detection.profile.id, 'jes-regionalbus-v1');
    assert.deepEqual(detection.signals.jesSignals, [true, true, true], 'all three signals, none waived');
  });

test('BEFUND (behoben in 4.2): the JES data is usable, with its two known JES-specific gaps',
  { skip: !readable(REFERENCE.jes) && 'JES reference plan not present' }, async () => {
    // SUPERSEDED BY PHASE 4.2: detection is no longer bypassed here — the schedule is the one the
    // productive orchestrator now produces for this document.
    const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
    const bytes = new Uint8Array(await readFile(REFERENCE.jes));
    const { detection, canonicalSchedule: schedule } = await analyzePdfImport({
      name: 'plan.pdf', type: 'application/pdf', arrayBuffer: async () => bytes.buffer
    });

    assert.equal(detection.profile.id, 'jes-regionalbus-v1');
    assert.equal(schedule.services.length, 19, 'nineteen duty blocks are reconstructed');
    assert.equal(filled(schedule.services, s => s.begin?.value), 19);
    assert.equal(filled(schedule.services, s => s.paidTime?.value), 19);

    // …the two JES-specific gaps remain and stay in the effort estimate:
    const numbers = schedule.services.map(s => String(s.serviceNumber).trim());
    assert.equal(new Set(numbers).size, 18, 'one duty number appears twice — a duty split by a page break');
    assert.equal(filled(schedule.activities, a => a.routeIdentity?.line), 0,
      'the four-digit JES circuit codes yield no line — the Linie column stays empty for JES');
    assert.equal(schedule.hardened, undefined, 'and hardening is bound to the JNV profile only');
  });
