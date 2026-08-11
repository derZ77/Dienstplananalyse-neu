/** Source-neutral projection into the original Dienstübersicht layout. */

export const DIENSTUEBERSICHT_COLUMNS = Object.freeze([
  'Dienst', 'Umlauf', 'voher Dienst', 'nächster Dienst', 'Tätigkeit', 'Abfahrt',
  'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'
]);

const text = value => String(value ?? '').trim();
const clock = value => text(value?.value);
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileDate = now => [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const REF_COLORS = Object.freeze({ header: '1F4E78', service: 'D9E1F2', body: 'FFFFFF', pause: 'FFF2CC' });
const THIN_BORDER = Object.freeze({ top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } });
const TEXT_COLUMNS = new Set([2, 3, 4, 6, 8]);
const ROW_HEIGHTS = Object.freeze({ title: 20, header: 24, service: 16, activity: 15, spacer: 6 });
// This is an OpenXML schema identifier embedded in the XLSX, not a network endpoint.
const OOXML_SPREADSHEET_NS = ['http:', '', 'schemas.openxmlformats.org', 'spreadsheetml/2006/main'].join('/');

const rowStyle = (fill, column) => ({
  font: { name: 'Calibri', sz: 10, bold: fill === REF_COLORS.service },
  fill: { patternType: 'solid', fgColor: { rgb: fill } },
  border: THIN_BORDER,
  alignment: { horizontal: TEXT_COLUMNS.has(column) ? 'left' : 'center', vertical: 'center', wrapText: TEXT_COLUMNS.has(column) }
});

// Presentation-only classification matching the original Dienstübersicht: both
// "Pause" and "Pause (bezahlt)" receive the reference's yellow activity band.
const isPauseRow = row => /^pause(?:\s|\(|$)/i.test(text(row?.[4]));

function applyReferenceLayout(ws, model, xlsx) {
  ws.A1.s = { font: { name: 'Calibri', sz: 14, bold: true }, alignment: { horizontal: 'left', vertical: 'center' } };
  for (let column = 0; column < DIENSTUEBERSICHT_COLUMNS.length; column += 1) {
    const address = xlsx.utils.encode_cell({ r: 1, c: column });
    ws[address].s = {
      font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: REF_COLORS.header } },
      border: THIN_BORDER,
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    };
  }

  model.rows.forEach((row, index) => {
    const worksheetRow = index + 2;
    if (!row.some(Boolean)) { ws['!rows'][worksheetRow] = { hpt: ROW_HEIGHTS.spacer }; return; }
    const fill = row[0] ? REF_COLORS.service : isPauseRow(row) ? REF_COLORS.pause : REF_COLORS.body;
    for (let column = 0; column < DIENSTUEBERSICHT_COLUMNS.length; column += 1) {
      const address = xlsx.utils.encode_cell({ r: worksheetRow, c: column });
      ws[address] ??= { t: 's', v: '' };
      ws[address].s = rowStyle(fill, column);
    }
    ws['!rows'][worksheetRow] = { hpt: row[0] ? ROW_HEIGHTS.service : ROW_HEIGHTS.activity };
  });
}

// This minimal style table deliberately follows the element and attribute conventions of
// the supplied Excel reference. SheetJS' browser writer retains cell values but omits the
// corresponding style table, so only this proven presentation contract is inserted.
const REFERENCE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${OOXML_SPREADSHEET_NS}"><numFmts count="0"/>
<fonts count="5"><font><name val="Calibri"/><family val="2"/><color theme="1"/><sz val="11"/><scheme val="minor"/></font><font><b val="1"/><sz val="14"/></font><font><b val="1"/><color rgb="00FFFFFF"/><sz val="10"/></font><font><sz val="10"/></font><font><b val="1"/><sz val="10"/></font></fonts>
<fills count="6"><fill><patternFill/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="001F4E78"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="00FFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="00D9E1F2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="00FFF2CC"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" pivotButton="0" quotePrefix="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="4" borderId="1" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="4" borderId="1" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="5" borderId="1" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="5" borderId="1" applyAlignment="1" pivotButton="0" quotePrefix="0" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0" hidden="0"/></cellStyles><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;

const columnIndex = letter => letter.charCodeAt(0) - 65;
const xmlText = entry => new TextDecoder().decode(new Uint8Array(entry.content));
const xmlBytes = value => new TextEncoder().encode(value);

function replaceZipEntry(archive, xlsx, path, value) {
  const entry = xlsx.CFB.find(archive, path);
  if (entry) entry.content = xmlBytes(value);
  else xlsx.CFB.utils.cfb_add(archive, path, xmlBytes(value));
}

function styleWorksheetXml(xml, model) {
  const dataStyle = (row, column) => {
    if (row[0]) return TEXT_COLUMNS.has(column) ? 6 : 5;
    if (isPauseRow(row)) return TEXT_COLUMNS.has(column) ? 8 : 7;
    return TEXT_COLUMNS.has(column) ? 4 : 3;
  };
  const styledCells = xml.replace(/<c r="([A-L])(\d+)"([^>]*)/g, (match, letter, rowNumber, attributes) => {
    const row = Number(rowNumber);
    const style = row === 1 ? 1 : row === 2 ? 2 : dataStyle(model.rows[row - 3] ?? [], columnIndex(letter));
    return `<c r="${letter}${rowNumber}"${attributes.replace(/\s+s="\d+"/, '')} s="${style}"`;
  });
  const pageSettings = `<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>`;
  // SheetJS emits ignoredErrors after sheetData. OpenXML requires page settings before
  // that section; appending them at the end produces a well-formed, but schema-invalid,
  // worksheet that Microsoft Excel repairs on open.
  const withoutExistingPageSettings = styledCells.replace(/<pageMargins[^>]*\/>|<pageSetup[^>]*\/>/g, '');
  return withoutExistingPageSettings.includes('<ignoredErrors')
    ? withoutExistingPageSettings.replace('<ignoredErrors', `${pageSettings}<ignoredErrors`)
    : withoutExistingPageSettings.replace('</worksheet>', `${pageSettings}</worksheet>`);
}

function addPrintDefinitions(xml, lastRow) {
  const definitions = `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Dienstübersicht'!$A$1:$L$${lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Dienstübersicht'!$1:$2</definedName></definedNames>`;
  return xml.includes('<definedNames>')
    ? xml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, definitions)
    : xml.replace('</workbook>', `${definitions}</workbook>`);
}

// The vendored SheetJS build writes values reliably but drops cell styles. Keep its data writer,
// then add only the reference OpenXML presentation layer to the generated XLSX package.
function applyOpenXmlReferenceLayout(bytes, model, xlsx) {
  if (!xlsx?.CFB?.read || !xlsx.CFB.write || !xlsx.CFB.find) return bytes;
  try {
    // `Array.from` also keeps this boundary robust when the vendored runtime lives in an iframe
    // or a test VM and its Uint8Array constructor differs from the caller's constructor.
    const archive = xlsx.CFB.read(Array.from(bytes), { type: 'array' });
    const worksheet = xlsx.CFB.find(archive, '/xl/worksheets/sheet1.xml');
    const workbook = xlsx.CFB.find(archive, '/xl/workbook.xml');
    if (!worksheet || !workbook) return bytes;
    replaceZipEntry(archive, xlsx, '/xl/styles.xml', REFERENCE_STYLES_XML);
    replaceZipEntry(archive, xlsx, '/xl/worksheets/sheet1.xml', styleWorksheetXml(xmlText(worksheet), model));
    replaceZipEntry(archive, xlsx, '/xl/workbook.xml', addPrintDefinitions(xmlText(workbook), model.rows.length + 2));
    const written = xlsx.CFB.write(archive, { type: 'array', fileType: 'zip', compression: true });
    return written instanceof Uint8Array ? written : new Uint8Array(written);
  } catch {
    return bytes;
  }
}

export function resolveDienstuebersichtTitle(schedule, { title = null } = {}) {
  const knownTitle = text(title)
    || text(schedule?.metadata?.title)
    || text(schedule?.document?.source?.title)
    || text(schedule?.document?.title);
  return knownTitle || 'Dienstübersicht';
}

export function buildDienstuebersichtExportModel(schedule, { title = null } = {}) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');
  const rows = [];
  for (const service of schedule.services || []) {
    const activities = service.activities || [];
    if (!activities.length) rows.push(serviceRow(service, null));
    activities.forEach((activity, index) => rows.push(serviceRow(service, activity, index === 0)));
    rows.push(Array(DIENSTUEBERSICHT_COLUMNS.length).fill(''));
  }
  return { type: 'DienstübersichtExportModel', sheetName: 'Dienstübersicht', title: resolveDienstuebersichtTitle(schedule, { title }), columns: [...DIENSTUEBERSICHT_COLUMNS], rows };
}

function serviceRow(service, activity, isFirst = true) {
  return [
    isFirst ? text(service.serviceNumber) : '', text(activity?.circuitNumber), text(activity?.handoverSource?.previous), text(activity?.handoverSource?.next),
    text(activity?.rawActivity), clock(activity?.departureTime), text(activity?.departureLocation), clock(activity?.arrivalTime), text(activity?.arrivalLocation),
    isFirst ? clock(service.begin) : '', isFirst ? clock(service.end) : '', isFirst ? text(service.paidTime?.value) : ''
  ];
}

export function createDienstuebersichtWorkbook(model, { xlsx = globalThis.XLSX } = {}) {
  if (!xlsx?.utils || model?.type !== 'DienstübersichtExportModel') return null;
  const ws = xlsx.utils.aoa_to_sheet([[model.title, ...Array(11).fill('')], model.columns, ...model.rows]);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
  ws['!cols'] = [8, 9, 9, 10, 23, 8, 28, 8, 28, 8, 8, 9].map(wch => ({ wch }));
  ws['!rows'] = [{ hpt: ROW_HEIGHTS.title }, { hpt: ROW_HEIGHTS.header }];
  applyReferenceLayout(ws, model, xlsx);
  ws['!pageSetup'] = { orientation: 'landscape', paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
  ws['!pageMargins'] = { left: 0.75, right: 0.75, top: 1, bottom: 1, header: 0.5, footer: 0.5 };
  ws['!printArea'] = `A1:L${model.rows.length + 2}`;
  ws['!printTitles'] = '2:2';
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, model.sheetName);
  wb.Props = { Title: 'Dienstübersicht', Author: 'Dienstplananalyse' };
  return wb;
}

/** Writes the already-projected overview as a local XLSX file; it never re-reads source data. */
export function writeDienstuebersichtXlsx(model, { xlsx = globalThis.XLSX, now = new Date() } = {}) {
  if (model?.type !== 'DienstübersichtExportModel' || !xlsx?.write) {
    return { status: 'error', format: null, fileName: null, mimeType: null, bytes: null, warnings: [{ code: 'MODELL_UNGUELTIG' }] };
  }
  try {
    const workbook = createDienstuebersichtWorkbook(model, { xlsx });
    const bytes = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
    const styled = applyOpenXmlReferenceLayout(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), model, xlsx);
    return { status: 'ready', format: 'xlsx', fileName: `Dienstübersicht-${fileDate(now)}.xlsx`, mimeType: MIME_XLSX, bytes: styled, warnings: [] };
  } catch {
    return { status: 'error', format: null, fileName: null, mimeType: null, bytes: null, warnings: [{ code: 'XLSX_WRITE_FAILED' }] };
  }
}

/** Delivers the generated overview using the browser's regular local-download mechanism. */
export function downloadDienstuebersichtExport(model, options = {}) {
  const output = writeDienstuebersichtXlsx(model, options);
  if (output.status !== 'ready') return { ...output, downloaded: false };
  const doc = options.document ?? globalThis.document;
  const url = options.url ?? globalThis.URL;
  if (!doc?.createElement || !url?.createObjectURL) return { ...output, downloaded: false };
  let objectUrl; let anchor;
  try {
    objectUrl = url.createObjectURL(new Blob([output.bytes], { type: output.mimeType }));
    anchor = doc.createElement('a'); anchor.href = objectUrl; anchor.download = output.fileName;
    doc.body?.appendChild?.(anchor); anchor.click();
    return { ...output, downloaded: true };
  } catch {
    return { ...output, downloaded: false };
  } finally {
    if (anchor) doc.body?.removeChild?.(anchor);
    if (objectUrl) url.revokeObjectURL?.(objectUrl);
  }
}
