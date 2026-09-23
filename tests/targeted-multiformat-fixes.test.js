import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { analyzeWagenkarteWorkbook } from '../js/v2/import/wagenkarte-import-adapter.js';
import * as wagenkarteBlock7 from '../js/v2/blocks/wagenkarte-block7.js';
import { formatCanonicalValidity, resolveCanonicalValidity } from '../js/v2/schedule/canonical-validity.js';

globalThis.DOMMatrix ||= class DOMMatrix {};
const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
const { createOriginalBlockViewModel } = await import('../js/v2/blocks/block-orchestrator.js');
const { analyzeVehicleCardDrivingTime, createVehicleCardBlock7ViewModel } = wagenkarteBlock7;

const xlsxSandbox = {};
Object.assign(xlsxSandbox, { global: xlsxSandbox, globalThis: xlsxSandbox, window: xlsxSandbox, self: xlsxSandbox, process, Buffer, console });
createContext(xlsxSandbox);
runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), xlsxSandbox);
globalThis.XLSX = xlsxSandbox.XLSX;

const DOCUMENT_DIRECTORY = process.env.DIENSTPLANANALYSE_TEST_DOCUMENT_DIR
  || fileURLToPath(new URL('./private-fixtures/', import.meta.url));
const fileLike = async name => {
  const bytes = new Uint8Array(await readFile(join(DOCUMENT_DIRECTORY, name)));
  return { name, type: name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arrayBuffer: async () => bytes.slice().buffer };
};
const exists = async name => { try { await access(join(DOCUMENT_DIRECTORY, name)); return true; } catch { return false; } };

test('Sonn- und Feiertag remains a distinct day type through canonical validity and blocks', async t => {
  if (!(await exists('DB Sonn- und Feiertag, ab 17.08.2026.pdf'))) return t.skip('real Sunday/holiday PDF is not available');
  const result = await analyzePdfImport(await fileLike('DB Sonn- und Feiertag, ab 17.08.2026.pdf'));
  assert.equal(result.detection.status, 'supported');
  assert.equal(result.canonicalSchedule.validity.dayType, 'sunday_holiday');
  assert.equal(result.canonicalSchedule.services.length, 29);
  assert.equal(createOriginalBlockViewModel(result.canonicalSchedule).countText, 'Anzahl eindeutiger Dienst-IDs: 29');
  assert.equal(resolveCanonicalValidity({ headerText: 'Dienste Stadtbus Sonn- und Feiertag, ab 17.08.2026' }).dayType, 'sunday_holiday');
  assert.equal(formatCanonicalValidity(result.canonicalSchedule.validity), 'Sonn- und Feiertag');
});

test('real Straßenbahn schedule PDF uses the shared schedule flow and retains its two labelled variants', async t => {
  if (!(await exists('DS Montag bis Freitag, ab 17.08.2026.pdf'))) return t.skip('real Straßenbahn PDF is not available');
  const result = await analyzePdfImport(await fileLike('DS Montag bis Freitag, ab 17.08.2026.pdf'));
  assert.equal(result.detection.status, 'supported');
  assert.equal(result.detection.documentFamily, 'tram');
  assert.equal(result.canonicalSchedule.type, 'CanonicalSchedule');
  assert.equal(result.canonicalSchedule.services.length, 57);
  assert.equal(result.canonicalSchedule.hardened.applied, true);
  for (const number of ['1196', '1199']) {
    assert.deepEqual(result.canonicalSchedule.services.filter(service => service.serviceNumber === number).map(service => service.variantValidity?.label), ['Mo-Do', 'Fr']);
  }
  const blocks = createOriginalBlockViewModel(result.canonicalSchedule);
  assert.match(blocks.countText, /55/);
  assert.ok(blocks.routeText.length > 0);
  assert.ok(blocks.pauseHtml.length > 0);
});

test('Wagenkarte validity is projected per sheet and does not collapse into document validity', () => {
  const sheet = (name, qualifier, number) => ({ name, rows: [
    ['Dienst-Nr.:', '', String(number), '', '', '', '', '', qualifier],
    [], ['Gültig ab:', '', '14.09.2026'], ['Dienstbeginn:', '', '05:00'], ['Dienstende:', '', '13:00'],
    ['', 'Linie / Fahrt-Nr.'], ['', '460 / 1'], ['ab', '05:00', 'Depot'], ['an', '05:30', 'Zentrum']
  ] });
  const input = { sheets: [
    sheet('609', 'Montag - Donnerstag, Schule', 609),
    sheet('612', 'Mo, Di, Mi, Fr (Schule)', 612),
    sheet('629', 'Montag - Freitag, Schule', 629)
  ] };
  const result = analyzeWagenkarteWorkbook(input, { sourceName: '20260914_Eisenberg_Schule.xlsx' });
  assert.equal(result.ok, true);
  assert.equal(result.data.validity.dayType, 'unknown', 'the mixed workbook summary must not borrow the first sheet qualifier');
  assert.deepEqual(result.data.services.map(service => service.validity.rawLabel), [
    'Montag - Donnerstag, Schule', 'Mo, Di, Mi, Fr (Schule)', 'Montag - Freitag, Schule'
  ]);
  assert.deepEqual(result.data.services.map(service => service.validity.dayQualifier?.code), ['MON_THU', 'MON_TUE_WED_FRI', 'MON_FRI']);
  assert.ok(result.data.services.every(service => service.validity.validFrom === '2026-09-14'));
  const drivingResult = service => {
    const { service: _inputService, ...calculation } = analyzeVehicleCardDrivingTime(service);
    return calculation;
  };
  const block7WithValidity = result.data.services.map(drivingResult);
  const block7WithoutValidity = result.data.services.map(service => {
    const { validity, ...unchangedDrivingData } = service;
    return drivingResult(unchangedDrivingData);
  });
  assert.deepEqual(block7WithValidity, block7WithoutValidity, 'per-sheet validity remains outside the unchanged Block 7 calculation');
});

test('real Jena and Eisenberg Wagenkarten retain their exact per-sheet weekday qualifiers', async t => {
  const names = ['20260914_Jena_Schule.xlsx', '20260914_Eisenberg_Schule.xlsx'];
  if (!(await Promise.all(names.map(exists))).every(Boolean)) return t.skip('real Wagenkarte workbooks are not available');
  const [jena, eisenberg] = await Promise.all(names.map(async name => analyzeExcelImport(await fileLike(name))));
  assert.equal(jena.importResult.ok, true);
  assert.equal(jena.importResult.data.services.length, 20);
  assert.equal(jena.importResult.data.validity.dayType, 'unknown', 'the document summary does not erase the sheet-level Monday-only exception');
  assert.deepEqual([...jena.importResult.data.services.filter(service => service.validity.dayQualifier?.code === 'MONDAY').map(service => service.serviceNumber)], ['660', '671']);
  assert.equal(eisenberg.importResult.ok, true);
  assert.deepEqual([...eisenberg.importResult.data.services.map(service => service.validity.dayQualifier?.code)], ['MON_THU', 'MON_TUE_WED_FRI', 'MON_FRI']);
});

test('real Wagenkarten preserve physical day sections, section-local L5 and source provenance', async t => {
  const names = ['20260914_Jena_Schule.xlsx', '20260914_Eisenberg_Schule.xlsx'];
  if (!(await Promise.all(names.map(exists))).every(Boolean)) return t.skip('real Wagenkarte workbooks are not available');
  const [jena, eisenberg] = await Promise.all(names.map(async name => analyzeExcelImport(await fileLike(name))));
  const jena671 = jena.importResult.data.services.find(service => service.serviceNumber === '671');
  const eisenberg612 = eisenberg.importResult.data.services.find(service => service.serviceNumber === '612');
  const eisenberg609 = eisenberg.importResult.data.services.find(service => service.serviceNumber === '609');

  assert.deepEqual(Array.from(jena671.sections, section => section.officialDrivingTime.minutes), [305, 322, 326, 325]);
  assert.deepEqual(Array.from(jena671.sections, section => section.sourceRanges.map(range => [range.headerRow, range.endRow])), [[[1, 68]], [[69, 136]], [[137, 204]], [[205, 272]]]);
  assert.ok(Array.from(jena671.sections, section => section.validity.dayQualifier?.code).every(Boolean));
  assert.ok(jena671.sections[0].segments.some(segment => segment.sourceRange?.startRow && segment.sourceRange?.endRow));
  assert.deepEqual(Array.from(eisenberg612.sections, section => section.tripTime.minutes), [297, 304]);
  assert.deepEqual(Array.from(eisenberg612.sections, section => section.officialDrivingTime.minutes), [309, 349]);
  const jena652 = jena.importResult.data.services.find(service => service.serviceNumber === '652');
  assert.equal(jena652.sections.length, 1, 'a repeated physical header with the same qualifier/L5 is a continuation');
  assert.equal(jena652.sections.some(section => section.tripTime.value === '00:00'), false);
  assert.equal(jena652.sections[0].tripTime.minutes, 341);
  assert.deepEqual(jena652.sections[0].sourceRanges.map(range => [range.headerRow, range.endRow]), [[1, 68], [69, 136]]);
  assert.deepEqual(createVehicleCardBlock7ViewModel({ services: [jena652] }).analyses.map(analysis => analysis.tripTimeMinutes), [341]);
  const jena657 = jena.importResult.data.services.find(service => service.serviceNumber === '657');
  assert.equal(jena657.sections.length, 1, 'page fragmentation cannot make an extra semantic day section');
  assert.equal(jena657.sections[0].tripTime.minutes, null);
  assert.ok(jena657.sections[0].warnings.includes('SECTION_BOUNDARY_AMBIGUOUS'));
  assert.equal(createVehicleCardBlock7ViewModel({ services: [jena657] }).analyses.length, 1);
  const eisenberg609MonThu = eisenberg609.sections.filter(section => section.validity.dayQualifier?.code === 'MON_THU');
  const eisenberg609Friday = eisenberg609.sections.filter(section => section.validity.dayQualifier?.code === 'FRIDAY');
  assert.equal(eisenberg609MonThu.length, 1);
  assert.equal(eisenberg609MonThu[0].tripTime.minutes, 298);
  assert.equal(eisenberg609MonThu[0].tripTime.value, '04:58');
  assert.deepEqual(eisenberg609MonThu[0].sourceRanges.map(range => [range.headerRow, range.endRow]), [[1, 68], [69, 136]]);
  assert.equal(eisenberg609Friday.length, 1);
  const ambiguous609Section = eisenberg609Friday[0];
  assert.ok(ambiguous609Section);
  assert.equal(ambiguous609Section.tripTime.minutes, null, 'the 810/3 fragment crossing the repeated header must not be presented as a verified section total');
  assert.equal(eisenberg609.sections.some(section => section.segments.some(item => item.line === '810' && item.trip === '3')), false);
  assert.deepEqual(ambiguous609Section.unresolvedTrips.map(item => [item.line, item.trip, item.status]), [['810', '3', 'SECTION_BOUNDARY_AMBIGUOUS']]);
  assert.ok(ambiguous609Section.unresolvedTrips[0].source.row > 0);
  assert.deepEqual(ambiguous609Section.sourceRanges.map(range => [range.headerRow, range.endRow]), [[137, 204], [205, 272]]);
  assert.equal(ambiguous609Section.segments.some(item => item.source?.row >= 205), true, 'continuation evidence is retained but not emitted as an independent section');
  const eisenberg609Block = createVehicleCardBlock7ViewModel({ services: [eisenberg609] });
  assert.equal(eisenberg609Block.analyses.length, 2, 'Block 7 displays semantic day sections, not physical fragments');
  assert.equal(eisenberg609Block.analyses.filter(analysis => analysis.service.validity.dayQualifier.code === 'FRIDAY')[0].tripTimeMinutes, null);
});

test('Wagenkarte day qualifiers preserve the full Dienstag-bis-Freitag range', () => {
  const input = { sheets: [{ name: '660', rows: [
    ['Dienst-Nr.:', '', '660', '', '', '', '', '', 'Dienstag bis Freitag, Schule'],
    [], ['Gültig ab:', '', '14.09.2026'], ['Dienstbeginn:', '', '05:00'], ['Dienstende:', '', '13:00'],
    ['', 'Linie / Fahrt-Nr.'], ['', '460 / 1'], ['ab', '05:00', 'Depot'], ['an', '05:30', 'Zentrum']
  ] }] };
  const result = analyzeWagenkarteWorkbook(input, { sourceName: '20260914_Jena_Schule.xlsx' });
  assert.deepEqual(result.data.services[0].validity.dayQualifier.days, ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);
  assert.equal(result.data.services[0].validity.dayQualifier.code, 'TUESDAY_FRIDAY');
  assert.match(createVehicleCardBlock7ViewModel(result.data).realDrivingTimeText, /Dienstag bis Freitag, Schule/);
});

test('all 23 real Wagenkarten sheets conserve physical ranges without fragment sections', async t => {
  const names = ['20260914_Jena_Schule.xlsx', '20260914_Eisenberg_Schule.xlsx'];
  if (!(await Promise.all(names.map(exists))).every(Boolean)) return t.skip('real Wagenkarte workbooks are not available');
  const cards = await Promise.all(names.map(async name => analyzeExcelImport(await fileLike(name))));
  const services = cards.flatMap(result => result.importResult.data.services);
  const sections = services.flatMap(service => service.sections);
  assert.equal(services.length, 23, 'the two workbooks contain 23 service sheets');
  assert.equal(sections.length, 29, 'repeated same-day physical headers are merged, distinct day sections remain');
  assert.equal(sections.reduce((sum, section) => sum + section.sourceRanges.length, 0), 43, 'all physical source ranges survive semantic merging');
  assert.ok(sections.every(section => section.sourceRanges.length > 0));
  assert.ok(sections.every(section => section.sourceRanges.every(range => Number.isInteger(range.headerRow)
    && Number.isInteger(range.endRow) && range.endRow >= range.headerRow
    && Number.isInteger(range.officialL5Minutes)
    && ['INITIAL_HEADER', 'REPEATED_HEADER'].includes(range.physicalBoundaryBefore)
    && typeof range.semanticBoundaryBefore === 'string')));
  assert.equal(sections.filter(section => section.tripTime.minutes === 0).length, 0, 'there are no header-only artificial zero-time sections');
  assert.equal(sections.filter(section => section.tripTime.minutes > 0 && section.tripTime.minutes < 30).length, 0, 'no short continuation fragments remain as standalone sections');
  assert.ok(sections.filter(section => section.validity.dayQualifier?.code === 'TUESDAY_FRIDAY')
    .every(section => ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].every(day => section.validity.dayQualifier.days.includes(day))));
  assert.ok(sections.filter(section => (section.warnings || []).includes('SECTION_BOUNDARY_AMBIGUOUS')).every(section => section.tripTime.minutes === null));
});

test('Block 7 reports section-level Fahrtenzeit separately from official L5 and does not claim real driving time', async t => {
  if (!(await exists('20260914_Jena_Schule.xlsx'))) return t.skip('real Jena Wagenkarte workbook is not available');
  const result = await analyzeExcelImport(await fileLike('20260914_Jena_Schule.xlsx'));
  const card = result.importResult.data;
  const service671 = card.services.find(service => service.serviceNumber === '671');
  const view = createVehicleCardBlock7ViewModel(card);
  const analyses = view.analyses.filter(analysis => analysis.service.serviceNumber === '671');
  assert.equal(analyses.length, 4);
  assert.deepEqual(Array.from(analyses, analysis => analysis.tripTimeMinutes), [271, 309, 298, 312]);
  assert.deepEqual(Array.from(analyses, analysis => analysis.officialL5Minutes), [305, 322, 326, 325]);
  assert.deepEqual(Array.from(analyses, analysis => analysis.l5DifferenceMinutes), [34, 13, 28, 13]);
  assert.deepEqual(Array.from(analyses, analysis => analysis.maxContinuousTripBlockMinutes), [170, 201, 203, 203]);
  assert.ok(analyses.every(analysis => analysis.realDrivingTime === 'UNKNOWN'));
  assert.ok(analyses.every(analysis => Object.values(analysis.l5Components).every(value => value === 'UNKNOWN')));
  assert.doesNotMatch(view.realDrivingTimeText, /Puffer|Buffer/);
  assert.notEqual(service671.officialDrivingTime?.minutes, 305, 'multi-section services must not expose first-section L5 as service-wide L5');
});

test('Block 7 can select an explicitly typed JES companion Wagenkarte without changing match gates', () => {
  const schedule = { type: 'CanonicalSchedule', services: [] };
  const vehicleCard = { type: 'VehicleCardSchedule', organization: 'JES', services: [] };
  assert.equal(wagenkarteBlock7.resolveVehicleCardScheduleForBlock7({ primaryImport: { canonicalSchedule: schedule }, companionImport: { importResult: { data: vehicleCard } } }), vehicleCard);
  assert.equal(wagenkarteBlock7.resolveVehicleCardScheduleForBlock7({ primaryImport: { importResult: { data: vehicleCard } } }), vehicleCard);
  assert.equal(wagenkarteBlock7.resolveVehicleCardScheduleForBlock7({ primaryImport: { importResult: { data: { ...vehicleCard, organization: 'JNV' } } } }), null);
});

test('all ten supplied real documents still reach their supported import pipelines', async t => {
  const pdfNames = [
    '20260831_Übersicht_Schule_Jena_FDA.pdf',
    'DB Mo-Fr Schule, ab 17.08.2026.pdf',
    'DB Samstag, ab 17.08.2026.pdf',
    'DB Sonn- und Feiertag, ab 17.08.2026.pdf',
    'DS Montag bis Freitag, ab 17.08.2026.pdf'
  ];
  const excelNames = [
    'S_20260413_Mo-Fr_UKL.xlsx', 'F_Schule_20261026.xlsx', 'B_20260727_MoFrFerien.xlsx',
    '20260914_Jena_Schule.xlsx', '20260914_Eisenberg_Schule.xlsx'
  ];
  const names = [...pdfNames, ...excelNames];
  if (!(await Promise.all(names.map(exists))).every(Boolean)) return t.skip('all ten user-provided regression documents are not available');
  for (const name of pdfNames) {
    const result = await analyzePdfImport(await fileLike(name));
    assert.equal(result.detection.status, 'supported', `${name} must remain supported`);
    assert.equal(result.canonicalSchedule.type, 'CanonicalSchedule', `${name} must reach CanonicalSchedule`);
    assert.ok(result.canonicalSchedule.services.length > 0, `${name} must produce services`);
  }
  for (const name of excelNames) {
    const result = await analyzeExcelImport(await fileLike(name));
    assert.equal(result.classification.confidence, 'exact', `${name} must remain exactly classified`);
    assert.equal(result.importResult?.ok, true, `${name} must reach its recognized import adapter`);
  }
});
