import { FIXTURES } from './fixtures/paths.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { attachExcelBreakData } from '../js/v2/excel/excel-break-import.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

globalThis.DOMMatrix ||= class DOMMatrix {};

const HEADER = ['', '<kopf>', 'Dienst-', 'Linie', 'Umlauf', 'Ausf.', 'Ort', 'Richtg.', '', 'Einf.', 'Ort', '', 'vorher.', 'nächst.', 'Dienst-', 'Dienst-', 'bez.', '</kopf>'];
const leg = ({ nr = '', course = '12/1', departure, departureLocation, arrival, arrivalLocation, begin = '', end = '', paid = '' }) =>
  ['', '', nr, '12', course, departure, departureLocation, '', '', arrival, arrivalLocation, '', '', '', begin, end, paid, ''];

const pauseReferenceRows = () => [
  HEADER,
  leg({ nr: '2211', departure: '03:46', departureLocation: 'BBU', arrival: '07:15', arrivalLocation: 'HLZ', begin: '03:46', end: '11:20', paid: '07:34' }),
  leg({ departure: '07:50', departureLocation: 'HLZ', arrival: '11:20', arrivalLocation: 'BBU' })
];

const fileLike = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type: 'application/pdf', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

async function loadLegacyTabularParser() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('\t\tfunction isSharedService');
  const end = html.indexOf("\n\n\n\n\n\t\tdocument.getElementById('file-input')");
  const context = vm.createContext({ console });
  vm.runInContext(html.slice(start, end), context);
  return context.parseTabular;
}

test('Phase 6.4: Block 10 projiziert die tabellarische Legacy-Pause mit Ort und Kurs', async () => {
  const rows = pauseReferenceRows();
  const legacy = await loadLegacyTabularParser();
  const legacyOutput = legacy(rows, {}).pauseHtml;
  const canonical = attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' }));
  const output = createOriginalBlockViewModel(canonical).pauseHtml;
  const legacySection = output.split('\n\nBV-Pausenlagenprüfung:')[0];

  assert.match(legacyOutput, /Pause: 07:15 HLZ.*07:50 HLZ.*35 min/);
  assert.match(legacyOutput, /Mindestpause am Ort HLZ: 39 min/);
  assert.match(legacyOutput, /Arbeitszeit vor Pause 03:29.*außerhalb 03:30 bis 04:30 Stunden/);

  assert.match(legacySection, /^Pausen zwischen 30 und 120 Minuten:/);
  assert.match(legacySection, /ID 2211/);
  assert.match(legacySection, /Pause: 07:15 HLZ 12\/1 → 07:50 HLZ 12\/1 \| 35 min/);
  assert.doesNotMatch(legacySection, /BV-Hinweis|Arbeitszeit vor Unterbrechung|Mindestpause/);
});

test('Phase 6.4: echtes JNV-PDF zeigt jeden strukturierten Unterbrechungseintrag in Block 10', async () => {
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const result = await analyzePdfImport(await fileLike(FIXTURES.jnvSchedulePdf));
  const interruptions = result.canonicalSchedule.interruptions;
  const output = createOriginalBlockViewModel(result.canonicalSchedule).pauseHtml;

  assert.ok(interruptions.length > 0, 'JNV-Referenz enthält übernommene Unterbrechungen');
  assert.match(output, /Pausen zwischen 30 und 120 Minuten:/);
  assert.match(output, /Weitere Unterbrechungen \(keine regulären Blockpausen\):/);
  assert.equal((output.match(/Lange Unterbrechung \(geteilter Dienst; keine reguläre Blockpause\):/g) || []).length, interruptions.length);
  interruptions.forEach(interruption => {
    assert.match(output, new RegExp(`${interruption.start.value}–${interruption.end.value} \\| ${interruption.durationMinutes} min`));
  });
});

test('Phase 6.4: echtes JES-PDF liefert deklarierte Pausen und strukturierte lange Dienstunterbrechungen', async () => {
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const result = await analyzePdfImport(await fileLike(FIXTURES.jesSchedulePdf));
  const output = createOriginalBlockViewModel(result.canonicalSchedule).pauseHtml;

  assert.equal(result.canonicalSchedule.interruptions.length, 4);
  assert.match(output, /Lange Unterbrechung \(geteilter Dienst; keine reguläre Blockpause\): 09:09–13:07 \| 238 min/);
  assert.match(output, /Pausen zwischen 30 und 120 Minuten: 12/);
  assert.match(output, /ID 752:[\s\S]*Pause: 09:34 Busbahnhof 7521 → 10:19 Busbahnhof 7521 \| 45 min/);
});
