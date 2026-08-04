/**
 * Phase 4.2 (A/F) — the detection text must be built from the reconstructed LINES, not from the
 * raw PDF.js text items.
 *
 * WHY
 * ---
 * PDF.js emits a printed line as several text items. Whether two neighbouring items belong to the
 * same word is decided by their HORIZONTAL DISTANCE, and that distance is already measured: the
 * layout reconstruction inserts a space only where the gap exceeds `max(1.5, fontSize * 0.15)`.
 *
 * The detection text ignored that measurement and joined every item with a space, which tore the
 * word "Regionalbus" apart. This file pins the mechanism on the real, measured geometry of the JES
 * reference plan — its six fragments abut each other at 0.00 pt against a 2.10 pt threshold.
 *
 * Nothing here strips whitespace globally and nothing matches approximately: a space that was
 * PRINTED (the standalone " " item) survives, and a gap that was never there is not invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// The controller transitively loads PDF.js, which needs this before the module is evaluated.
globalThis.DOMMatrix ||= class DOMMatrix {};

const { reconstructLines } = await import('../js/v2/pdf/layout-reconstruction.js');
const { detectPdfDocumentProfile } = await import('../js/v2/pdf/document-profile-detector.js');
const { buildDetectionText } = await import('../js/v2/import/pdf-analysis-controller.js');

const TABLE_HEADER = 'Dienst Umlauf Tätigkeit Abfahrt Abfahrtsort Ankunft Ankunftsort Beginn Ende Bez. Zeit';
const JES_LABEL = 'Vorbereitungszeit JES';

/** A text object in the shape `pdf-core` produces. Only geometry and text matter here. */
let objectIndex = 0;
const item = (text, xMin, xMax, { baseline = 822.22, fontSize = 14, pageNumber = 1, index = null } = {}) => ({
  text,
  direction: 'ltr',
  baseline,
  transform: [fontSize, 0, 0, fontSize, xMin, baseline],
  boundingBox: { xMin, yMin: baseline, xMax, yMax: baseline + fontSize },
  font: { size: fontSize, family: '', weight: '', style: '', name: '' },
  source: { pageNumber, objectIndex: index ?? objectIndex++, originalText: text }
});

/**
 * The six fragments PDF.js really returns for the first line of the JES reference plan, with
 * their measured x-coordinates. Every neighbour abuts the previous one.
 */
const REAL_JES_TITLE_FRAGMENTS = Object.freeze([
  Object.freeze({ text: 'Dienste', xMin: 8.50, xMax: 59.07 }),
  Object.freeze({ text: ' ', xMin: 59.07, xMax: 62.97 }),
  Object.freeze({ text: 'R', xMin: 62.97, xMax: 73.08 }),
  Object.freeze({ text: 'egionalbus Montag bis Freitag (Ferien), ab 1', xMin: 73.08, xMax: 366.19 }),
  Object.freeze({ text: '3', xMin: 366.20, xMax: 373.98 }),
  Object.freeze({ text: '.07.2026', xMin: 373.98, xMax: 428.47 })
]);
const realTitleItems = (overrides = {}) =>
  REAL_JES_TITLE_FRAGMENTS.map(fragment => item(fragment.text, fragment.xMin, fragment.xMax, overrides));

const lineTextOf = (items) => reconstructLines(items).map(line => line.text);
/** What the detection text used to be: every item glued together with a blank. */
const naiveJoin = (items) => items.map(object => object.text).join(' ');

const pageOf = (...itemLists) => ({ lines: reconstructLines(itemLists.flat()) });
const layoutOf = (...pages) => ({ type: 'PdfLayoutDocument', pageCount: pages.length, pages });

// =====================================================================================
// A — the real fragment sequence yields a positive JES title signal
// =====================================================================================
test('A: the measured fragments are reassembled into the printed title', () => {
  assert.deepEqual(lineTextOf(realTitleItems()),
    ['Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026']);
});

test('A: exactly one gap in that line is wide enough for a space — and it was printed', () => {
  const items = realTitleItems();
  const gaps = items.slice(1).map((object, index) => ({
    gap: object.boundingBox.xMin - items[index].boundingBox.xMax,
    threshold: Math.max(1.5, items[index].font.size * 0.15)
  }));
  for (const { gap, threshold } of gaps) {
    assert.ok(gap < threshold, `gap ${gap} must stay below ${threshold} — the fragments abut`);
  }
  // The separator between the two words is a real space CHARACTER, not a positional gap.
  assert.equal(items[1].text, ' ');
});

test('A: the same fragments produce a positive JES detection', () => {
  const text = buildDetectionText(layoutOf(pageOf(
    realTitleItems(),
    [item(TABLE_HEADER, 8, 560, { baseline: 800 })],
    [item(JES_LABEL, 8, 120, { baseline: 780 })]
  )));
  const detection = detectPdfDocumentProfile({ text, pageCount: 3 });
  assert.equal(detection.status, 'supported');
  assert.equal(detection.profile.id, 'jes-regionalbus-v1');
  assert.deepEqual(detection.signals.jesSignals, [true, true, true]);
});

test('A: the naive join is what broke it — pinned as the cause, not as behaviour', () => {
  const naive = naiveJoin(realTitleItems());
  assert.ok(naive.includes('R egionalbus'), 'the old projection tore the word apart');
  assert.ok(!naive.includes('Regionalbus'));
  assert.equal(detectPdfDocumentProfile({
    text: `${naive} ${TABLE_HEADER} ${JES_LABEL}`, pageCount: 3
  }).status, 'unsupported', 'and no title signal could ever match it');
});

// =====================================================================================
// F — fragment boundaries
// =====================================================================================
test('F: a word split anywhere inside "Regionalbus" is rejoined', () => {
  for (const cut of [1, 3, 5, 8, 10]) {
    const word = 'Regionalbus';
    const items = [
      item('Dienste ', 8.5, 62.97),
      item(word.slice(0, cut), 62.97, 62.97 + cut * 9),
      item(`${word.slice(cut)} Montag bis Freitag (Ferien), ab 13.07.2026`, 62.97 + cut * 9, 428.47)
    ];
    assert.match(lineTextOf(items)[0], /Dienste Regionalbus Montag bis Freitag \(Ferien\), ab 13\.07\.2026/,
      `a cut after ${cut} characters must not survive into the text`);
  }
});

test('F: split date digits are rejoined', () => {
  const items = [
    item('ab ', 300, 316), item('1', 316, 324), item('3', 324, 332), item('.07.20', 332, 372),
    item('2', 372, 380), item('6', 380, 388)
  ];
  assert.equal(lineTextOf(items)[0], 'ab 13.07.2026');
});

test('F: additional empty items change nothing', () => {
  const items = [
    item('Dienste', 8.5, 59.07), item(' ', 59.07, 62.97), item('', 62.97, 62.97),
    item('R', 62.97, 73.08), item('', 73.08, 73.08),
    item('egionalbus Montag bis Freitag (Ferien), ab 13.07.2026', 73.08, 428.47)
  ];
  assert.equal(lineTextOf(items)[0], 'Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026');
});

test('F: an unfragmented line passes through unchanged', () => {
  const whole = 'Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026';
  assert.equal(lineTextOf([item(whole, 8.5, 428.47)])[0], whole);
});

test('F: a genuine wide gap still becomes a space — columns are not glued together', () => {
  const items = [item('Ankunftsort', 100, 180), item('Beginn', 400, 450)];
  assert.equal(lineTextOf(items)[0], 'Ankunftsort Beginn');
  // …and the table header therefore survives as ten readable tokens.
  const text = buildDetectionText(layoutOf(pageOf([
    item('Dienst', 10, 50), item('Umlauf', 80, 120), item('Tätigkeit', 150, 200),
    item('Abfahrt', 230, 270), item('Abfahrtsort', 300, 360), item('Ankunft', 390, 430),
    item('Ankunftsort', 460, 520), item('Beginn', 550, 590), item('Ende', 620, 650),
    item('Bez. Zeit', 680, 730)
  ])));
  assert.equal(detectPdfDocumentProfile({ text, pageCount: 1 }).signals.tableHeaderFound, true);
});

test('F: items on different baselines are never joined into one line', () => {
  const items = [
    item('Dienste Regional', 8.5, 200, { baseline: 822 }),
    item('bus Montag bis Freitag', 8.5, 200, { baseline: 780 })
  ];
  assert.deepEqual(lineTextOf(items), ['Dienste Regional', 'bus Montag bis Freitag']);
});

test('F: emission order does not decide reading order — position does', () => {
  const scrambled = [
    item('.07.2026', 373.98, 428.47, { index: 0 }),
    item('R', 62.97, 73.08, { index: 1 }),
    item('Dienste', 8.50, 59.07, { index: 2 }),
    item('3', 366.20, 373.98, { index: 3 }),
    item('egionalbus Montag bis Freitag (Ferien), ab 1', 73.08, 366.19, { index: 4 }),
    item(' ', 59.07, 62.97, { index: 5 })
  ];
  assert.equal(lineTextOf(scrambled)[0], 'Dienste Regionalbus Montag bis Freitag (Ferien), ab 13.07.2026');
});

test('F: the projection reads the first two pages, as before', () => {
  const text = buildDetectionText(layoutOf(
    pageOf([item('Seite eins', 10, 80)]),
    pageOf([item('Seite zwei', 10, 80, { pageNumber: 2 })]),
    pageOf([item('Seite drei', 10, 80, { pageNumber: 3 })])
  ));
  assert.ok(text.includes('Seite eins'));
  assert.ok(text.includes('Seite zwei'));
  assert.ok(!text.includes('Seite drei'), 'the two-page window is unchanged');
});

test('F: every line of the inspected pages reaches the detection text', () => {
  const layout = layoutOf(pageOf(
    realTitleItems(),
    [item(TABLE_HEADER, 8, 560, { baseline: 800 })],
    [item(JES_LABEL, 8, 120, { baseline: 780 })]
  ));
  const text = buildDetectionText(layout);
  for (const line of layout.pages[0].lines) {
    assert.ok(text.includes(line.text), `missing: ${line.text.slice(0, 40)}`);
  }
});

test('F: the projection is a join, not a whitespace strip', () => {
  const text = buildDetectionText(layoutOf(pageOf(realTitleItems())));
  assert.ok(text.includes('Dienste Regionalbus'), 'printed spaces survive');
  assert.ok(!text.includes('DiensteRegionalbus'), 'and are not swallowed');
});

test('F: an empty or malformed layout yields an empty text instead of throwing', () => {
  for (const input of [layoutOf(), layoutOf({ lines: [] }), { pages: [] }, {}, null, undefined]) {
    assert.doesNotThrow(() => buildDetectionText(input));
    assert.equal(typeof buildDetectionText(input), 'string');
  }
});
