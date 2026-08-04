/**
 * Maps the fixed ten-column PdfDocumentModel into a shared ScheduleDocument.
 * The mapping names positions only; it does not classify or validate content.
 */
export function mapPdfDocumentToSchedule(pdfDocumentModel) {
  if (pdfDocumentModel?.type !== 'PdfDocumentModel') {
    throw new TypeError('Expected a PdfDocumentModel.');
  }

  return {
    type: 'ScheduleDocument',
    pageCount: pdfDocumentModel.pageCount,
    services: pdfDocumentModel.serviceBlocks.map(mapServiceBlock),
    source: {
      byteLength: pdfDocumentModel.source.byteLength,
      documentModelType: pdfDocumentModel.type
    }
  };
}

function mapServiceBlock(block) {
  const rows = block.rows.map(mapTableRow);
  const headerLineNumber = block.source.lineRange.start;
  const activities = rows
    .filter(row => row.source.lineNumber !== headerLineNumber)
    .map((row, index) => mapActivityRecord(row, index));

  return {
    id: block.id,
    serviceNumber: block.serviceNumber,
    begin: block.begin,
    end: block.end,
    paidTime: block.paidTime,
    rows,
    activities,
    originalText: block.originalText,
    boundingBox: block.boundingBox,
    source: block.source
  };
}

function mapTableRow(row) {
  const rawActivity = rawColumnText(row, 2);
  return {
    serviceNumber: row.columns.column1,
    circuitNumber: row.columns.column2,
    activityText: row.columns.column3,
    departureTime: row.columns.column4,
    departureLocation: row.columns.column5,
    arrivalTime: row.columns.column6,
    arrivalLocation: row.columns.column7,
    begin: row.columns.column8,
    end: row.columns.column9,
    paidTime: row.columns.column10,
    rawActivity,
    originalText: row.originalText,
    boundingBox: row.boundingBox,
    source: row.source
  };
}

function mapActivityRecord(row, index) {
  return {
    index,
    serviceNumber: row.serviceNumber,
    circuitNumber: row.circuitNumber,
    rawActivity: row.rawActivity,
    departureTime: row.departureTime,
    departureLocation: row.departureLocation,
    arrivalTime: row.arrivalTime,
    arrivalLocation: row.arrivalLocation,
    originalText: row.originalText,
    boundingBox: row.boundingBox,
    source: row.source
  };
}

function rawColumnText(row, columnIndex) {
  return row.cells.find(cell => cell.columnIndex === columnIndex)?.source.originalText || '';
}

/** Debug-only serialization without UI or persistence side effects. */
export function toScheduleDocumentDebugJson(scheduleDocument, spacing = 2) {
  return JSON.stringify(scheduleDocument, null, spacing);
}
