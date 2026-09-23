import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { detectPdfDocumentProfile, PDF_DOCUMENT_PROFILES } from '../js/v2/pdf/document-profile-detector.js';
import { reconstructTablesAndBlocks } from '../js/v2/pdf/layout-reconstruction.js';
import { classifyActivityRow, classifyRowText, matchDayQualifier } from '../js/v2/pdf/row-type-contract.js';
import { resolveCanonicalValidity } from '../js/v2/schedule/canonical-validity.js';

globalThis.DOMMatrix ||= class DOMMatrix {};
const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { createOriginalBlockViewModel } = await import('../js/v2/blocks/block-orchestrator.js');
const { renderOriginalBlocks } = await import('../js/v2/blocks/block-renderer.js');
const { analyzeCanonicalSchedule } = await import('../js/v2/analysis/analysis-core.js');

const HEADER = 'Dienst Umlauf Tätigkeit Abfahrt Abfahrtsort Ankunft Ankunftsort Beginn Ende Bez. Zeit';
const PRIVATE_PDFS = Object.freeze({
  citybusWeekday: fileURLToPath(new URL('./private-fixtures/citybus-weekday.pdf', import.meta.url)),
  regionalbusWeekday: fileURLToPath(new URL('./private-fixtures/regionalbus-weekday.pdf', import.meta.url)),
  citybusSaturday: fileURLToPath(new URL('./private-fixtures/citybus-saturday.pdf', import.meta.url))
});

async function readPrivatePdf(path) {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const fileLike = (name, bytes) => ({
  name,
  type: 'application/pdf',
  arrayBuffer: async () => new Uint8Array(bytes).buffer
});

function renderTargets(blocks) {
  const targets = new Map(['plan-type-result', 'count-result', 'shared-result', 'reserve-result', 'long-result',
    'loc-result', 'segment-result', 'real-driving-time-result', 'shift-result', 'route-result', 'pause-result',
    'current-plan-display'].map(id => [id, { innerHTML: '', textContent: '' }]));
  renderOriginalBlocks(blocks, { document: { getElementById: id => targets.get(id) || null } });
  return targets;
}

test('BEU profile uses real service rows as an independent signal for citybus plans', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Stadtbus Montag bis Freitag (Schule), ab 17.08.2026 ${HEADER} 2147 001 Dienst 04:55 Jena 12:00 Gera 04:50 13:00 07:00 Pause`,
    pageCount: 6
  });

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.profile, PDF_DOCUMENT_PROFILES.beu);
});

test('BEU profile stays unsupported when title and header have no actual service rows', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Stadtbus Montag bis Freitag, ab 17.08.2026 ${HEADER}`,
    pageCount: 1
  });

  assert.equal(result.status, 'unsupported');
});

test('citybus document family accepts Saturday while validity remains a separate fact', () => {
  const result = detectPdfDocumentProfile({
    text: `Dienste Stadtbus Samstag, ab 17.08.2026 ${HEADER} 2380 001 Dienst 22:00 Jena 05:00 Jena 21:50 05:10 06:00`,
    pageCount: 3
  });

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.profile, PDF_DOCUMENT_PROFILES.beu);
  assert.equal(resolveCanonicalValidity({ headerText: 'Dienste Stadtbus Samstag, ab 17.08.2026' }).dayType, 'saturday');
});

test('explicit service variant qualifiers retain controlled codes', () => {
  assert.deepEqual(matchDayQualifier('Mo-Do'), { code: 'MON_THU', label: 'Mo-Do' });
  assert.deepEqual(matchDayQualifier('Fr'), { code: 'FRIDAY', label: 'Fr' });
  assert.deepEqual(classifyActivityRow({ serviceNumber: 'Mo-Do' }), { type: 'day_qualifier', code: 'MON_THU', label: 'Mo-Do' });
  assert.deepEqual(classifyActivityRow({ serviceNumber: 'Fr' }), { type: 'day_qualifier', code: 'FRIDAY', label: 'Fr' });
});

function pdfLine(labels, y) {
  const anchors = [20, 68, 120, 202, 252, 329, 381, 445, 491, 537];
  const textObjects = labels.map((text, index) => ({
    text,
    baseline: y,
    font: { size: 9 },
    boundingBox: { xMin: anchors[index], xMax: anchors[index] + text.length * 4, yMin: y, yMax: y + 9 },
    source: { pageNumber: 8, objectIndex: index }
  }));
  const boundingBox = {
    xMin: Math.min(...textObjects.map(object => object.boundingBox.xMin)),
    xMax: Math.max(...textObjects.map(object => object.boundingBox.xMax)),
    yMin: y,
    yMax: y + 9
  };
  return { text: labels.join(' '), baseline: y, textObjects, boundingBox, source: { pageNumber: 8 } };
}

test('layout accepts one complete geometric header when followed by plausible service rows', () => {
  const labels = ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'];
  const lines = [
    pdfLine(labels, 700),
    pdfLine(['684', 'R1', 'Dienst', '08:00', 'Jena', '08:30', 'Jena', '08:00', '12:00', '04:00'], 680)
  ];
  const reconstructed = reconstructTablesAndBlocks(lines, 8, { xMin: 0, yMin: 0, xMax: 600, yMax: 800 });

  assert.equal(reconstructed.tables.length, 1);
  assert.ok(reconstructed.tables[0].cells.some(cell => cell.text === '684'));
});

test('layout rejects a lone header-like line without following service rows', () => {
  const labels = ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'];
  const lines = [pdfLine(labels, 700)];

  assert.equal(reconstructTablesAndBlocks(lines, 8, { xMin: 0, yMin: 0, xMax: 600, yMax: 800 }).tables.length, 0);
});

test('bare Fr is classified as an explicit Friday qualifier, not an unsupported annotation', () => {
  assert.deepEqual(classifyRowText('Fr'), { type: 'day_qualifier', code: 'FRIDAY', label: 'Fr' });
});

test('real citybus weekday PDF keeps its 2147 variants, logical duty count and rendered blocks', async t => {
  const bytes = await readPrivatePdf(PRIVATE_PDFS.citybusWeekday);
  if (!bytes) return t.skip('private citybus weekday evidence is not installed');

  const { detection, canonicalSchedule } = await analyzePdfImport(fileLike('citybus-weekday.pdf', bytes));
  assert.equal(detection.profile?.id, 'beu-stadtbus-v1');
  assert.equal(canonicalSchedule?.type, 'CanonicalSchedule');
  assert.equal(canonicalSchedule.services.length, 63);
  assert.equal(new Set(canonicalSchedule.services.map(service => service.serviceNumber)).size, 62);
  assert.equal(canonicalSchedule.activities.length, 201);
  assert.equal(canonicalSchedule.interruptions.length, 13);
  const analysis = analyzeCanonicalSchedule(canonicalSchedule);
  assert.deepEqual([analysis.statistics.serviceCount, analysis.statistics.uniqueServiceCount], [63, 62]);
  const pauseActivities = canonicalSchedule.activities.filter(activity => /^\s*pause(?:\s|\(|$)/i.test(activity.rawActivity || ''));
  assert.equal(pauseActivities.length, 45);

  const variants = canonicalSchedule.services.filter(service => service.serviceNumber === '2147');
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map(service => service.variantValidity?.dayType), ['MON_THU', 'FRIDAY']);
  assert.deepEqual(variants.map(service => service.variantValidity?.label), ['Mo-Do', 'Fr']);
  assert.deepEqual(variants.map(service => service.validity?.dayType), ['MON_THU', 'FRIDAY']);
  assert.equal(canonicalSchedule.hardened.warnings.some(warning => warning.code === 'UNSUPPORTED_DAY_QUALIFIER'), false);

  const blocks = createOriginalBlockViewModel(canonicalSchedule);
  assert.equal(blocks.countText, 'Anzahl eindeutiger Dienst-IDs: 62');
  assert.match(blocks.sharedText, /Anzahl geteilte Dienste:/);
  assert.match(blocks.sharedText, /Anzahl geteilte Dienste: 12/);
  assert.match(blocks.longText, /Dienste >08:30h:/);
  assert.match(blocks.locText, /Unterschiedliche Orte:/);
  assert.ok(blocks.shiftText.length > 0);
  assert.match(blocks.routeText, /Dienste nach Linie\/Kurs:/);
  assert.match(blocks.pauseHtml, /Pausen zwischen 30 und 120 Minuten/);
  assert.equal((blocks.pauseHtml.match(/deklarierte Pause im Dienst/g) || []).length, 45);
  for (const interruption of canonicalSchedule.interruptions) {
    assert.ok(blocks.pauseHtml.includes(interruption.start.value));
    assert.ok(blocks.pauseHtml.includes(interruption.end.value));
  }
  assert.ok(canonicalSchedule.services.every(service => service.paidTime.value));
  assert.ok(canonicalSchedule.activities.some(activity => activity.departureLocation && activity.arrivalLocation));

  const targets = renderTargets(blocks);
  assert.match(targets.get('count-result').innerHTML, /62/);
  assert.match(targets.get('pause-result').innerHTML, /Pausen zwischen/);
});

test('real JES regionalbus PDF reconstructs its single page-eight header and duty 684', async t => {
  const bytes = await readPrivatePdf(PRIVATE_PDFS.regionalbusWeekday);
  if (!bytes) return t.skip('private JES regionalbus evidence is not installed');

  const layout = await extractPdfLayoutDocument(new Uint8Array(bytes));
  assert.ok(layout.pages[7].tables.length > 0);
  const { detection, canonicalSchedule } = await analyzePdfImport(fileLike('regionalbus-weekday.pdf', bytes));
  assert.equal(detection.profile?.id, 'jes-regionalbus-v1');
  assert.equal(canonicalSchedule.services.length, 39);
  assert.equal(new Set(canonicalSchedule.services.map(service => service.serviceNumber)).size, 34);
  const analysis = analyzeCanonicalSchedule(canonicalSchedule);
  assert.deepEqual([analysis.statistics.serviceCount, analysis.statistics.uniqueServiceCount], [39, 34]);
  assert.equal(canonicalSchedule.activities.length, 286);
  const service684 = canonicalSchedule.services.find(service => service.serviceNumber === '684');
  assert.ok(service684, 'the page-eight duty survives canonical construction');
  assert.ok(service684.activities.length > 0);

  const blocks = createOriginalBlockViewModel(canonicalSchedule);
  assert.equal(blocks.countText, 'Anzahl eindeutiger Dienst-IDs: 34');
  assert.match(blocks.sharedText, /Anzahl geteilte Dienste:/);
  assert.match(blocks.sharedText, /Anzahl geteilte Dienste: 20/);
  assert.match(blocks.pauseHtml, /Pausen zwischen 30 und 120 Minuten/);
  assert.ok(blocks.pauseHtml.includes('ID 684:'), 'page-eight pauses survive through Block 10');
  assert.ok(blocks.routeText.length > 0);
  const targets = renderTargets(blocks);
  assert.match(targets.get('count-result').innerHTML, /34/);
  assert.match(targets.get('pause-result').innerHTML, /ID 684:/);
});

test('real citybus Saturday PDF is detected as BEU and keeps Saturday and overnight times', async t => {
  const bytes = await readPrivatePdf(PRIVATE_PDFS.citybusSaturday);
  if (!bytes) return t.skip('private citybus Saturday evidence is not installed');

  const { detection, canonicalSchedule } = await analyzePdfImport(fileLike('citybus-saturday.pdf', bytes));
  assert.equal(detection.profile?.id, 'beu-stadtbus-v1');
  assert.equal(canonicalSchedule?.type, 'CanonicalSchedule');
  assert.equal(canonicalSchedule.validity.dayType, 'saturday');
  assert.equal(canonicalSchedule.services.length, 31);
  assert.equal(new Set(canonicalSchedule.services.map(service => service.serviceNumber)).size, 31);
  assert.equal(canonicalSchedule.activities.length, 65);
  const analysis = analyzeCanonicalSchedule(canonicalSchedule);
  assert.deepEqual([analysis.statistics.serviceCount, analysis.statistics.uniqueServiceCount], [31, 31]);
  for (const serviceNumber of ['2380', '2381', '2382', '2383', '2384', '2399']) {
    const service = canonicalSchedule.services.find(entry => entry.serviceNumber === serviceNumber);
    assert.ok(service, `missing overnight service ${serviceNumber}`);
    const hardened = canonicalSchedule.hardened.services.find(entry => entry.serviceNumber === serviceNumber);
    assert.equal(hardened.end.dayOffset, 1, `${serviceNumber} crosses to the next day`);
    assert.ok(hardened.end.relativeMinutes > hardened.begin.relativeMinutes, `${serviceNumber} has a positive overnight span`);
  }
  assert.ok(canonicalSchedule.hardened.services.every(service => service.end.dayOffset >= 0));
  assert.ok(canonicalSchedule.hardened.services.flatMap(service => service.dutyActivities)
    .every(activity => activity.departureTime.dayOffset >= 0 && activity.arrivalTime.dayOffset >= 0));

  const blocks = createOriginalBlockViewModel(canonicalSchedule);
  assert.equal(blocks.countText, 'Anzahl eindeutiger Dienst-IDs: 31');
  assert.match(blocks.sharedText, /Anzahl geteilte Dienste:/);
  assert.match(blocks.sharedText, /Anzahl geteilte Dienste: 0/);
  assert.match(blocks.pauseHtml, /Pausen zwischen 30 und 120 Minuten/);
  assert.equal((blocks.pauseHtml.match(/deklarierte Pause im Dienst/g) || []).length, 15);
  assert.ok(blocks.routeText.length > 0);
  const targets = renderTargets(blocks);
  assert.match(targets.get('count-result').innerHTML, /31/);
  assert.match(targets.get('pause-result').innerHTML, /Pausen zwischen/);
});
