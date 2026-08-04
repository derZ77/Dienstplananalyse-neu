import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const indexPath = new URL('../index.html', import.meta.url);

async function loadLegacyParsers() {
  const html = await readFile(indexPath, 'utf8');
  const start = html.indexOf('\t\tfunction isSharedService');
  const end = html.indexOf("\n\n\n\n\n\t\tdocument.getElementById('file-input')");
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

test('Wagenkarten-Legacy-Parser bleibt separat ausführbar', async () => {
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
});
