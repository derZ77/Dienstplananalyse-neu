const COLUMN_COUNT = 10;

/**
 * Converts layout-only PDF tables to a layout-preserving, document-neutral
 * PdfDocumentModel. It does not classify rows or interpret their contents.
 */
export function normalizePdfLayoutDocument(pdfLayoutDocument) {
  if (pdfLayoutDocument?.type !== 'PdfLayoutDocument') {
    throw new TypeError('Expected a PdfLayoutDocument.');
  }

  const serviceBlocks = [];
  for (const page of pdfLayoutDocument.pages) {
    for (const block of page.serviceBlocks) {
      const table = page.tables[block.tableIndex];
      if (!table) continue;
      serviceBlocks.push(normalizeServiceBlock(page, table, block, serviceBlocks.length));
    }
  }

  return {
    type: 'PdfDocumentModel',
    pageCount: pdfLayoutDocument.pageCount,
    serviceBlocks,
    source: {
      byteLength: pdfLayoutDocument.source.byteLength,
      layoutDocumentType: pdfLayoutDocument.type
    }
  };
}

function normalizeServiceBlock(page, table, block, serviceBlockIndex) {
  const rows = buildRows(table, block, serviceBlockIndex);
  const firstDataRow = rows.find(row => row.source.lineNumber !== table.headerLineIndex && row.cells.length > 0)
    ?? createEmptyRow(table.headerLineIndex, page.number, table.index, serviceBlockIndex);

  return {
    id: `page-${page.number}-table-${table.index}`,
    serviceNumber: firstDataRow.columns.column1,
    begin: firstDataRow.columns.column8,
    end: firstDataRow.columns.column9,
    paidTime: firstDataRow.columns.column10,
    rows,
    originalText: rows.map(row => row.originalText).join('\n'),
    boundingBox: block.boundingBox,
    source: {
      pageNumber: page.number,
      tableIndex: table.index,
      serviceBlockIndex,
      lineRange: { ...block.lineRange },
      boundingBox: block.boundingBox,
      originalText: rows.map(row => row.originalText).join('\n')
    }
  };
}

function buildRows(table, block, serviceBlockIndex) {
  const rowsByLine = new Map();
  for (const cell of table.cells) {
    if (!rowsByLine.has(cell.rowIndex)) {
      rowsByLine.set(cell.rowIndex, createEmptyRow(cell.rowIndex, cell.source.pageNumber, table.index, serviceBlockIndex));
    }
    const row = rowsByLine.get(cell.rowIndex);
    const field = columnFieldName(cell.columnIndex);
    row.columns[field] = cell.text;
    row.cells.push({
      columnIndex: cell.columnIndex,
      field,
      text: cell.text,
      boundingBox: cell.boundingBox,
      source: {
        pageNumber: cell.source.pageNumber,
        tableIndex: table.index,
        serviceBlockIndex,
        lineNumber: cell.source.lineIndex,
        columnIndex: cell.columnIndex,
        boundingBox: cell.boundingBox,
        originalText: cell.source.originalText
      }
    });
  }

  return [...rowsByLine.values()]
    .filter(row => row.source.lineNumber >= block.lineRange.start && row.source.lineNumber <= block.lineRange.end)
    .sort((left, right) => left.source.lineNumber - right.source.lineNumber)
    .map(row => ({
      ...row,
      originalText: row.cells.map(cell => cell.source.originalText).join(''),
      boundingBox: combineBoxes(row.cells.map(cell => cell.boundingBox)),
      source: {
        ...row.source,
        boundingBox: combineBoxes(row.cells.map(cell => cell.boundingBox)),
        originalText: row.cells.map(cell => cell.source.originalText).join('')
      }
    }));
}

function createEmptyRow(lineNumber, pageNumber, tableIndex, serviceBlockIndex) {
  return {
    columns: Object.fromEntries(Array.from({ length: COLUMN_COUNT }, (_, index) => [columnFieldName(index), ''])),
    cells: [],
    originalText: '',
    boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    source: {
      pageNumber,
      tableIndex,
      serviceBlockIndex,
      lineNumber,
      boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      originalText: ''
    }
  };
}

function columnFieldName(index) {
  return `column${index + 1}`;
}

function combineBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  return {
    xMin: Math.min(...valid.map(box => box.xMin)),
    yMin: Math.min(...valid.map(box => box.yMin)),
    xMax: Math.max(...valid.map(box => box.xMax)),
    yMax: Math.max(...valid.map(box => box.yMax))
  };
}

/** A debug-only, serializable view; it has no UI or persistence side effect. */
export function toPdfDocumentModelDebugJson(pdfDocumentModel, spacing = 2) {
  return JSON.stringify(pdfDocumentModel, null, spacing);
}
