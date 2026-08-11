import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { attachExcelBreakData } from '../js/v2/excel/excel-break-import.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const rows = [
  ['Dienst', 'Umlauf', 'Tätigkeit', 'Abfahrt', 'Abfahrtsort', 'Ankunft', 'Ankunftsort', 'Beginn', 'Ende', 'Bez. Zeit'],
  ['2211', '12/1', 'Dienst', '03:46', 'BBU', '07:15', 'HLZ', '03:46', '11:20', '07:34'],
  ['', '12/2', 'Dienst', '07:50', 'HLZ', '11:20', 'BBU', '', '', '']
];

test('Phase 6.16: Block 10 erhält die tabellarische Legacy-Pause mit beiden Orten und Kursen', () => {
  const schedule = attachExcelBreakData(adaptExcelRowsToCanonicalSchedule(rows));
  const output = createOriginalBlockViewModel(schedule).pauseHtml;
  const legacyOutput = output.split('\n\nBV-Pausenlagenprüfung:')[0];

  assert.equal(legacyOutput, [
    'Pausen zwischen 30 und 120 Minuten: 1',
    '',
    'ID 2211:',
    '  Pause: 07:15 HLZ 12/1 → 07:50 HLZ 12/2 | 35 min'
  ].join('\n'));
  assert.doesNotMatch(legacyOutput, /BV-Hinweis|Arbeitszeit vor Unterbrechung|Mindestpause/);
});

test('Phase 6.16: Block 10 verwendet den tabellarischen Legacy-Leerfall ohne Zusatzgruppen', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule([rows[0], rows[1]]);

  assert.equal(
    createOriginalBlockViewModel(schedule).pauseHtml,
    'Pausen zwischen 30 und 120 Minuten:\n\nKeine Pausen im Bereich 30–120 Minuten gefunden.'
  );
});
