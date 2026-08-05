import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument, toPdfDocumentModelDebugJson } = await import('../js/v2/pdf/document-normalizer.js');

const references = [
  { name: 'JES', path: FIXTURES.jesSchedulePdf },
  { name: 'BEU', path: FIXTURES.jnvSchedulePdf }
];

for (const reference of references) {
  test(`${reference.name}: normalisiert alle geometrischen Tabellen ohne Profilregel`, async () => {
    const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(reference.path)));
    const model = normalizePdfLayoutDocument(layout);
    const sourceTables = layout.pages.flatMap(page => page.tables);
    const sourceCells = sourceTables.flatMap(table => table.cells);
    const rows = model.serviceBlocks.flatMap(block => block.rows);
    const cells = rows.flatMap(row => row.cells);

    assert.equal(model.type, 'PdfDocumentModel');
    assert.equal(model.serviceBlocks.length, sourceTables.length);
    assert.equal(cells.length, sourceCells.length, 'keine geometrische Zelle geht verloren');
    assert.ok(model.serviceBlocks.every(block => block.serviceNumber && block.begin && block.end && block.paidTime));
    assert.ok(rows.every(row => Object.keys(row.columns).join(',') === 'column1,column2,column3,column4,column5,column6,column7,column8,column9,column10'));
    assert.ok(rows.every(row => Number.isInteger(row.source.pageNumber) && Number.isInteger(row.source.tableIndex) && Number.isInteger(row.source.serviceBlockIndex) && Number.isInteger(row.source.lineNumber)));
    assert.deepEqual(
      cells.map(cell => `${cell.source.pageNumber}:${cell.source.tableIndex}:${cell.source.lineNumber}:${cell.source.columnIndex}`),
      sourceCells.map(cell => `${cell.source.pageNumber}:${cell.source.tableIndex}:${cell.source.lineIndex}:${cell.source.columnIndex}`),
      'Zellreihenfolge bleibt unverändert'
    );
    assert.doesNotThrow(() => JSON.parse(toPdfDocumentModelDebugJson(model)));
  });
}
