import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');

const references = [
  { name: 'JES', path: '/Users/joergziegler/Downloads/20260713_Dienstübersicht_FDA.pdf', pages: 3 },
  { name: 'BEU', path: '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf', pages: 15 }
];

for (const reference of references) {
  test(`${reference.name}: neutraler PDF-Kern rekonstruiert Layout ohne Textverlust`, async () => {
    const document = await extractPdfLayoutDocument(new Uint8Array(await readFile(reference.path)));
    const pages = document.pages;
    const tables = pages.flatMap(page => page.tables);
    const blocks = pages.flatMap(page => page.serviceBlocks);
    const textObjects = pages.flatMap(page => page.textObjects);
    const lineObjects = pages.flatMap(page => page.lines.flatMap(line => line.textObjects));
    const cells = tables.flatMap(table => table.cells);

    assert.equal(document.type, 'PdfLayoutDocument');
    assert.equal(document.pageCount, reference.pages);
    assert.ok(tables.length > 0, 'mindestens eine geometrische Tabelle');
    assert.ok(blocks.length > 0, 'mindestens ein geometrischer Dienstblock');
    assert.ok(tables.every(table => table.columns.length === 10));
    assert.equal(lineObjects.length, textObjects.length, 'kein Textobjekt geht beim Zeilenaufbau verloren');
    assert.deepEqual(lineObjects.map(item => item.source.pageNumber * 100000 + item.source.objectIndex).sort((a, b) => a - b), textObjects.map(item => item.source.pageNumber * 100000 + item.source.objectIndex).sort((a, b) => a - b));
    assert.ok(textObjects.every(item => Number.isFinite(item.boundingBox.xMin) && Number.isFinite(item.boundingBox.yMin) && item.font.size > 0));
    assert.ok(pages.every(page => page.lines.every((line, index) => line.index === index)));
    assert.ok(pages.every(page => Number.isFinite(page.size.width) && Number.isFinite(page.size.height) && Number.isFinite(page.rotation)));
    assert.ok(cells.every(cell => Number.isInteger(cell.source.pageNumber) && Number.isInteger(cell.source.lineIndex) && Number.isInteger(cell.source.columnIndex)));
  });
}
