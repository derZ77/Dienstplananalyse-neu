/** Phase 8.2 — source-neutral Block 2 and duration-based Block 10 acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { FIXTURES } from './fixtures/paths.js';
import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const clock = value => ({ raw: value, value, minutesSinceStartOfDay: Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) });
const fileOf = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type: 'application/pdf', arrayBuffer: async () => bytes.slice().buffer };
};

function pauseService(number, { begin = '05:00', pauseStart, pauseEnd, structured = true, id = `service-${number}` } = {}) {
  const activity = structured
    ? { id: `activity-${number}`, serviceId: id, rawActivity: 'Dienst', activityType: 'driving', departureTime: clock(begin), arrivalTime: clock(pauseStart), departureLocation: 'A', arrivalLocation: 'B', circuitNumber: '12/1', source: {} }
    : { id: `activity-${number}`, serviceId: id, rawActivity: 'Dienst', activityType: 'driving', departureTime: { value: null, minutesSinceStartOfDay: null }, arrivalTime: { value: null, minutesSinceStartOfDay: null }, source: {} };
  const interruption = { id: `pause-${number}-${pauseStart}`, serviceId: id, serviceNumber: String(number), kind: 'pause', start: clock(pauseStart), end: clock(pauseEnd), durationMinutes: minutesBetween(pauseStart, pauseEnd), startLocation: 'B', endLocation: 'B', precedingActivityId: activity.id };
  return { id, serviceNumber: String(number), begin: clock(begin), end: clock('18:00'), paidTime: { value: '08:00', minutes: 480 }, activities: [activity], interruptions: [interruption], source: {} };
}

function scheduleOf(services) {
  return {
    type: 'CanonicalSchedule', document: { sourceType: 'synthetic', source: {} }, services,
    activities: services.flatMap(service => service.activities), interruptions: services.flatMap(service => service.interruptions), warnings: [], metadata: {}
  };
}

function minutesBetween(start, end) {
  const result = clock(end).minutesSinceStartOfDay - clock(start).minutesSinceStartOfDay;
  return result >= 0 ? result : result + 1440;
}

function installXlsx() {
  if (globalThis.XLSX?.read) return;
  const sandbox = { console, process, Buffer }; sandbox.global = sandbox; sandbox.globalThis = sandbox;
  sandbox.window = sandbox; sandbox.self = sandbox; createContext(sandbox);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  globalThis.XLSX = sandbox.XLSX;
}

test('Phase 8.2: Block 2 counts repeated shared service numbers once and uses source-neutral span wording', () => {
  const rows = [
    ['Kopf'],
    ['', '', '2141', 'Dienst', '6/12', '05:00', 'A', '', '', '17:00', 'B', '', '', '', '05:00', '17:00', '09:00'],
    ['', '', '2141', 'Dienst', '6/12', '05:00', 'A', '', '', '17:00', 'B', '', '', '', '05:00', '17:00', '09:00'],
    ['', '', '2142', 'Dienst', '6/13', '06:00', 'A', '', '', '18:01', 'B', '', '', '', '06:00', '18:01', '09:00']
  ];
  const excel = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const pdfShape = { ...structuredClone(excel), document: { sourceType: 'pdf', source: {} } };
  const excelOutput = createOriginalBlockViewModel(excel).sharedText;

  assert.equal(excelOutput, createOriginalBlockViewModel(pdfShape).sharedText);
  assert.match(excelOutput, /Anzahl geteilte Dienste: 2/);
  assert.match(excelOutput, /IDs: 2141, 2142/);
  assert.match(excelOutput, /Schichtspanne je geteilter Dienst \(Dienstbeginn bis Dienstende\):/);
  assert.doesNotMatch(excelOutput, /Spalte O|Spalte P/);
  assert.match(excelOutput, /ID 2142: Schichtspanne 12:01/);
  assert.match(excelOutput, /überschreiten 12:00h Schichtspanne/);
});

test('Phase 8.2: JES Excel/PDF keep the same Block-2 result and JNV PDF has unique shared duties', async () => {
  installXlsx();
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { readWorkbookSheets } = await import('../js/v2/umlauftafel/xlsx-sheet-reader.js');
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const xlsxBytes = new Uint8Array(await readFile(FIXTURES.jesTenColumnScheduleXlsx));
  const excel = adaptExcelRowsToCanonicalSchedule(readWorkbookSheets(xlsxBytes).sheets[0].rows, { sheetName: 'Dienstplan' });
  const jesPdf = (await analyzePdfImport(await fileOf(FIXTURES.jesSchedulePdf))).canonicalSchedule;
  const jnvPdf = (await analyzePdfImport(await fileOf(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const jnvOutput = createOriginalBlockViewModel(jnvPdf).sharedText;

  assert.equal(createOriginalBlockViewModel(excel).sharedText, createOriginalBlockViewModel(jesPdf).sharedText);
  const ids = (jnvOutput.match(/IDs: (.*)/)?.[1] || '').split(', ').filter(Boolean);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(ids.length > 0, 'JNV reference contains shared duties');
});

test('Phase 8.2: JNV long interruptions remain visible but are not promoted to regular Block-10 pauses', async () => {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(await fileOf(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).pauseHtml;

  assert.match(output, /Weitere Unterbrechungen \(keine regulären Blockpausen\):/);
  assert.match(output, /Lange Unterbrechung \(geteilter Dienst; keine reguläre Blockpause\)/);
  assert.doesNotMatch(output, /BV-Pausenlagenprüfung:/);
});

test('Phase 8.2: only pauses from 30 through 120 minutes enter the regular Block-10 pause section', () => {
  const services = [
    pauseService(1201, { pauseStart: '08:00', pauseEnd: '08:20' }),
    pauseService(1202, { pauseStart: '08:00', pauseEnd: '08:30' }),
    pauseService(1203, { pauseStart: '08:00', pauseEnd: '09:00' }),
    pauseService(1204, { pauseStart: '08:00', pauseEnd: '10:00' }),
    pauseService(1205, { pauseStart: '08:00', pauseEnd: '10:01' })
  ];
  const output = createOriginalBlockViewModel(scheduleOf(services)).pauseHtml;
  const [regular, additional] = output.split('\n\nWeitere Unterbrechungen (keine regulären Blockpausen):');

  assert.match(regular, /ID 1202:/);
  assert.match(regular, /ID 1203:/);
  assert.match(regular, /ID 1204:/);
  assert.doesNotMatch(regular, /ID 1201:|ID 1205:/);
  assert.match(additional, /Kurze Unterbrechung \(keine reguläre Blockpause; möglicher 1\/6-Kontext\)/);
  assert.match(additional, /Lange Unterbrechung \(geteilter Dienst; keine reguläre Blockpause\)/);
  assert.doesNotMatch(output, /Dienst 1201:|Dienst 1205:/);
});

test('Phase 8.2: Block 10 keeps 3:30 and 4:30 compliant, rejects 3:15 and 4:45, and evaluates a pause within a shared duty', () => {
  const services = [
    pauseService(2141, { pauseStart: '08:15', pauseEnd: '08:45' }),
    pauseService(1202, { pauseStart: '08:30', pauseEnd: '09:00' }),
    pauseService(1203, { pauseStart: '09:30', pauseEnd: '10:00' }),
    pauseService(1204, { pauseStart: '09:45', pauseEnd: '10:15' })
  ];
  const output = createOriginalBlockViewModel(scheduleOf(services)).pauseHtml;

  assert.match(output, /Dienst 2141.*Zeit vor Pause: 03:15 h.*Bewertung: BV-Verstoß/s);
  assert.match(output, /Dienst 1202.*Zeit vor Pause: 03:30 h.*Bewertung: BV eingehalten/s);
  assert.match(output, /Dienst 1203.*Zeit vor Pause: 04:30 h.*Bewertung: BV eingehalten/s);
  assert.match(output, /Dienst 1204.*Zeit vor Pause: 04:45 h.*Bewertung: BV-Verstoß/s);
  assert.match(output, /ID 2141:[\s\S]*Pause: 08:15/);
});

test('Phase 8.2: Block 10 uses and labels the Dienstbeginn fallback when structured work data is missing', () => {
  const output = createOriginalBlockViewModel(scheduleOf([
    pauseService(1206, { pauseStart: '08:45', pauseEnd: '09:15', structured: false })
  ])).pauseHtml;

  assert.match(output, /Dienst 1206.*Zeit vor Pause: 03:45 h.*Grundlage: Fallback Dienstbeginn\/Pausenbeginn/s);
  assert.match(output, /Bewertung basiert auf Zeitdifferenz Dienstbeginn bis Pausenbeginn/);
});
