/** Phase 9.3 — source-neutral day type and validity preservation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXTURES } from './fixtures/paths.js';
import { resolveCanonicalValidity } from '../js/v2/schedule/canonical-validity.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';
import { deriveReportContext } from '../js/v2/report/check-report-view-model.js';

globalThis.DOMMatrix ||= class DOMMatrix {};

const fileOf = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type: 'application/pdf', arrayBuffer: async () => bytes.slice().buffer };
};

async function importPdf(path) {
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  return (await analyzePdfImport(await fileOf(path))).canonicalSchedule;
}

test('Phase 9.3: normalizes proven headers without conflating weekday and school/holiday variant', () => {
  assert.deepEqual(
    resolveCanonicalValidity({ headerText: 'Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026' }),
    { dayType: 'mo_fr', dayTypeSource: 'HEADER', serviceRegime: 'school', serviceRegimeSource: 'HEADER', validFrom: '2026-08-17', validFromSource: 'HEADER', rawLabel: 'Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026' }
  );
  assert.deepEqual(
    resolveCanonicalValidity({ headerText: 'Montag - Freitag (Ferien), ab 23.07.2026' }),
    { dayType: 'mo_fr', dayTypeSource: 'HEADER', serviceRegime: 'holidays', serviceRegimeSource: 'HEADER', validFrom: '2026-07-23', validFromSource: 'HEADER', rawLabel: 'Montag - Freitag (Ferien), ab 23.07.2026' }
  );
});

test('Phase 9.3: supports Saturday and Sunday and leaves ambiguous evidence unknown', () => {
  assert.equal(resolveCanonicalValidity({ headerText: 'Samstag (Schule)' }).dayType, 'saturday');
  assert.equal(resolveCanonicalValidity({ headerText: 'So Ferien' }).dayType, 'sunday');
  const unknown = resolveCanonicalValidity({ headerText: 'Dienstübersicht ohne Gültigkeitsangabe' });
  assert.equal(unknown.dayType, 'unknown');
  assert.equal(unknown.dayTypeSource, 'UNKNOWN');
});

test('Phase 9.3: structured metadata precedes filename and a header wins a conflicting filename', () => {
  const metadata = resolveCanonicalValidity({ documentMetadata: { dayType: 'saturday', serviceRegime: 'school', validFrom: '2026-08-01' }, fileName: 'Plan_MoFr_Ferien.xlsx' });
  assert.deepEqual([metadata.dayType, metadata.dayTypeSource, metadata.serviceRegime, metadata.serviceRegimeSource, metadata.validFrom, metadata.validFromSource], ['saturday', 'DOCUMENT_METADATA', 'school', 'DOCUMENT_METADATA', '2026-08-01', 'DOCUMENT_METADATA']);

  const headerWins = resolveCanonicalValidity({ headerText: 'Dienstplan Samstag (Ferien)', fileName: 'Plan_MoFr_Schule.xlsx' });
  assert.deepEqual([headerWins.dayType, headerWins.dayTypeSource, headerWins.serviceRegime, headerWins.serviceRegimeSource], ['saturday', 'HEADER', 'holidays', 'HEADER']);
});

test('Phase 9.3: filename is only the fallback when header and metadata are absent', () => {
  const fallback = resolveCanonicalValidity({ fileName: 'B_20260817_MoFr_Schule_BEU.xlsx' });
  assert.deepEqual([fallback.dayType, fallback.dayTypeSource, fallback.serviceRegime, fallback.serviceRegimeSource], ['mo_fr', 'FILENAME', 'school', 'FILENAME']);
});

test('Phase 9.3: real JNV and JES schedule PDFs preserve header validity in CanonicalSchedule', async () => {
  const [jnv, jes] = await Promise.all([importPdf(FIXTURES.jnvSchedulePdf), importPdf(FIXTURES.jesSchedulePdf)]);
  assert.deepEqual([jnv.validity.dayType, jnv.validity.serviceRegime, jnv.validity.dayTypeSource], ['mo_fr', 'school', 'HEADER']);
  assert.deepEqual([jes.validity.dayType, jes.validity.serviceRegime, jes.validity.dayTypeSource, jes.validity.validFrom], ['mo_fr', 'holidays', 'HEADER', '2026-07-13']);
  assert.equal(jnv.metadata.dayType, 'mo_fr');
  assert.equal(jes.metadata.serviceRegime, 'holidays');
});

test('Phase 9.3: Excel header validity is retained and reaches the existing weekday Block-4 assessment', () => {
  const rows = [
    ['Dienste Regionalbus Montag–Freitag (Ferien), ab 13.07.2026'],
    ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
    ['701', '7011', 'Dienst', '05:00', 'A', '14:00', 'B', '05:00', '14:00', '08:45']
  ];
  const schedule = adaptExcelRowsToCanonicalSchedule(rows, { fileName: 'wrong_Sa.xlsx', sheetName: 'Dienstplan' });
  const blocks = createOriginalBlockViewModel(schedule);
  assert.deepEqual([schedule.validity.dayType, schedule.validity.serviceRegime, schedule.validity.validFrom], ['mo_fr', 'holidays', '2026-07-13']);
  assert.match(blocks.longText, /BV-Bewertung \(Mo–Fr\):/);
});

test('Phase 9.3: Saturday, Sunday and unknown schedules do not enter the existing weekday Block-4 assessment', () => {
  for (const [header, expected] of [['Samstag (Schule)', 'saturday'], ['Sonntag (Ferien)', 'sunday'], ['ohne Tagesart', 'unknown']]) {
    const schedule = adaptExcelRowsToCanonicalSchedule([['Plan ' + header], ['', '', '701', 'Dienst', '1/1', '05:00', 'A', '', '', '14:00', 'B', '', '', '', '05:00', '14:00', '08:45']], { layout: 'legacy-tabular-17-column' });
    assert.equal(schedule.validity.dayType, expected);
    assert.match(createOriginalBlockViewModel(schedule).longText, /Nicht anwendbar/);
  }
});

test('Phase 9.3: report context reads the canonical day type when matching is absent', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule([['Dienste Montag bis Freitag (Schule)']], { fileName: 'unknown.xlsx' });
  const context = deriveReportContext({ primaryImport: { canonicalSchedule: schedule } });
  assert.equal(context.metadata.dayType, 'mo_fr');
});
