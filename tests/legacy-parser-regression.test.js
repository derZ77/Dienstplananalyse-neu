import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const indexPath = new URL('../index.html', import.meta.url);

async function loadLegacyParsers() {
  const html = await readFile(indexPath, 'utf8');
  const start = html.indexOf('\t\tfunction isSharedService');
  const end = html.indexOf("\t\tdocument.getElementById('file-input').addEventListener('change', function() {");
  assert.notEqual(start, -1, 'Legacy-Helfer nicht gefunden');
  assert.notEqual(end, -1, 'Legacy-Import-Handler nicht gefunden');

  const context = vm.createContext({ console });
  vm.runInContext(html.slice(start, end), context);
  return context;
}

test('tabellarischer Legacy-Parser liefert sein bestehendes Ergebnisformat', async () => {
  const legacy = await loadLegacyParsers();
  const rows = [
    ['Kopfzeile'],
    ['', '', '1103', '', '5/11', '04:00', 'Start', '', '', '12:45', 'Ende', '', '', '', '04:00', '12:45', '08:45']
  ];

  const result = legacy.parseTabular(rows, {});
  assert.equal(result.countText, 'Anzahl eindeutiger Dienst-IDs: 1');
  assert.match(result.longText, /1103/);
  assert.match(result.routeText, /5\/11/);
});

test('Wagenkarten-Legacy-Parser enthält keine zweite Block-7-Auswertung', async () => {
  const legacy = await loadLegacyParsers();
  const worksheet = {
    B1: { v: 'Dienst-Nr.:' },
    D1: { v: '1103' },
    J1: { v: 'Mo–Fr Schule' },
    D3: { v: '17.08.2026' },
    D4: { v: '04:00' },
    D5: { v: '12:45' },
    L3: { v: '08:45' },
    L4: { v: '08:30' },
    L5: { v: '06:00' }
  };
  const result = legacy.parseWagenkarte({
    SheetNames: ['Wagenkarte'],
    Sheets: { Wagenkarte: worksheet }
  });

  assert.match(result.countText, /Anzahl eindeutiger Dienst-IDs: 1/);
  assert.match(result.planTypeText, /Wagenkarten/);
  assert.equal(result.realDrivingTimeText, undefined);
  assert.equal(result.dienste[0].lenkzeitAnalyse, undefined);
  assert.equal(result.dienste[0].lenkzeitKopf, undefined);
});

test('the sole productive Wagenkarten Block 7 is modular and keeps neutral time semantics', async () => {
  const html = await readFile(indexPath, 'utf8');
  const bootstrap = await readFile(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
  const { analyzeVehicleCardDrivingTime, createVehicleCardBlock7ViewModel } = await import('../js/v2/blocks/wagenkarte-block7.js');
  assert.match(bootstrap, /createVehicleCardBlock7ViewModel, resolveVehicleCardScheduleForBlock7/);
  assert.match(bootstrap, /renderVehicleCardBlock7\(createVehicleCardBlock7ViewModel\(vehicleCardSchedule\)\)/);
  assert.doesNotMatch(html, /function buildWagenkarte(?:RealDrivingTimeText|LenkzeitAnalyse)/);
  assert.doesNotMatch(html, /Prüfung 04:30h:|Lenkzeit real vor\/nach Pause/);

  const listenerStart = html.indexOf("\t\tdocument.getElementById('file-input').addEventListener('change', function() {");
  const listenerEnd = html.indexOf('\n\t\t});', listenerStart);
  assert.notEqual(listenerStart, -1, 'Legacy-Datei-Listener nicht gefunden');
  assert.notEqual(listenerEnd, -1, 'Legacy-Datei-Listener nicht abgeschlossen');
  const legacyListener = html.slice(listenerStart, listenerEnd);
  assert.match(legacyListener, /file-result/);
  assert.doesNotMatch(legacyListener, /parseWagenkarte|detectWorkbookFormat|FileReader|real-driving-time-result/);

  const service = {
    serviceNumber: 'sample',
    segments: [{ type: 'LINE_SERVICE', duration: { minutes: 60 }, start: { timelineMinutes: 300 }, end: { timelineMinutes: 360 } }],
    tripTime: { minutes: 60, value: '01:00' },
    officialL5: { minutes: 70, value: '01:10' },
    assignmentStatus: 'RESOLVED'
  };
  const analysis = analyzeVehicleCardDrivingTime(service);
  assert.equal(analysis.tripTimeMinutes, 60);
  assert.equal(analysis.officialL5Minutes, 70);
  assert.equal(analysis.l5DifferenceMinutes, 10);
  assert.equal(analysis.realDrivingTime, 'UNKNOWN');
  assert.ok(Object.values(analysis.l5Components).every(value => value === 'UNKNOWN'));
  const view = createVehicleCardBlock7ViewModel({ services: [service] });
  assert.match(view.realDrivingTimeText, /Fahrtenzeit: 01:00/);
  assert.match(view.realDrivingTimeText, /Offizieller L5: 01:10/);
  assert.match(view.realDrivingTimeText, /Reale Lenkzeit: nicht bestimmt/);
  assert.doesNotMatch(view.realDrivingTimeText, /Prüfung 04:30h|Lenkzeit real/);
});
