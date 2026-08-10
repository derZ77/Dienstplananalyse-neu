/** Source-neutral projection into the original Dienstübersicht layout. */

export const DIENSTUEBERSICHT_COLUMNS = Object.freeze([
  'Dienst', 'Umlauf', 'voher Dienst', 'nächster Dienst', 'Tätigkeit', 'Abfahrt',
  'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'
]);

const text = value => String(value ?? '').trim();
const clock = value => text(value?.value);

export function buildDienstuebersichtExportModel(schedule, { title = 'Dienstübersicht' } = {}) {
  if (schedule?.type !== 'CanonicalSchedule') throw new TypeError('Expected a CanonicalSchedule.');
  const rows = [];
  for (const service of schedule.services || []) {
    const activities = service.activities || [];
    if (!activities.length) rows.push(serviceRow(service, null));
    activities.forEach((activity, index) => rows.push(serviceRow(service, activity, index === 0)));
    rows.push(Array(DIENSTUEBERSICHT_COLUMNS.length).fill(''));
  }
  return { type: 'DienstübersichtExportModel', sheetName: 'Dienstübersicht', title, columns: [...DIENSTUEBERSICHT_COLUMNS], rows };
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
  ws['!cols'] = [8, 9, 9, 10, 16, 8, 28, 8, 28, 8, 8, 9].map(wch => ({ wch }));
  ws['!rows'] = [{ hpt: 19 }, { hpt: 30 }];
  ws['!pageSetup'] = { orientation: 'landscape', fitToHeight: 0 };
  ws['!printTitles'] = '2:2';
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, model.sheetName);
  wb.Props = { Title: 'Dienstübersicht', Author: 'Dienstplananalyse' };
  return wb;
}
