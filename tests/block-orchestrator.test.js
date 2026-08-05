import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptExcelRowsToCanonicalSchedule } from '../js/v2/excel/excel-canonical-adapter.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const rows = [
  ['Kopf'],
  ['', '', '1140', 'Dienst', '5/11', '04:00', 'A', '', '', '17:00', 'B', '', '', '', '04:00', '17:00', '09:00'],
  ['', '', '1101', 'Dienst', '6/12', '03:00', 'BBU', '', '', '12:00', 'BUP', '', '', '', '03:00', '12:00', '09:00']
];

test('Block-Orchestrator projiziert einen Canonical Schedule vollständig auf die Original-Blockform', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const blocks = createOriginalBlockViewModel(schedule);

  assert.deepEqual(Object.keys(blocks).sort(), [
    'countText', 'locText', 'longText', 'pauseHtml', 'planHinweis', 'planTypeText',
    'realDrivingTimeText', 'reserveText', 'routeText', 'segmentText', 'sharedText',
    'shiftHtml', 'shiftText'
  ]);
  assert.match(blocks.planTypeText, /Straßenbahn – Mo–Fr Schule/);
  assert.match(blocks.countText, /2/);
  assert.match(blocks.sharedText, /1140/);
  assert.match(blocks.reserveText, /1101/);
  assert.match(blocks.longText, /1101.*1140|1140.*1101/);
  assert.match(blocks.locText, /1140/);
  assert.match(blocks.segmentText, /1140/);
  assert.equal(blocks.realDrivingTimeText, 'Für tabellarische Dienstpläne nicht verfügbar.');
  assert.match(blocks.shiftText, /GF1/);
  assert.match(blocks.routeText, /5\/11/);
  assert.match(blocks.pauseHtml, /Keine Pausen|Keine Dienstunterbrechungen/);
});

test('Block-Orchestrator behandelt eine bestätigte Unterbrechung als Datenmodell, nicht als PDF-Sonderfall', () => {
  const schedule = adaptExcelRowsToCanonicalSchedule(rows, { layout: 'legacy-tabular-17-column' });
  const interruption = {
    serviceId: schedule.services[0].id,
    serviceNumber: '1140',
    start: { value: '09:00' },
    end: { value: '09:30' },
    durationMinutes: 30
  };
  const blocks = createOriginalBlockViewModel({ ...schedule, interruptions: [interruption] });

  assert.match(blocks.pauseHtml, /1140/);
  assert.match(blocks.pauseHtml, /09:00–09:30/);
});
