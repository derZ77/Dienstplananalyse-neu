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
  assert.match(blocks.realDrivingTimeText, /Lenkzeit-\/Fahrzeitbewertung nicht verfügbar/);
  assert.match(blocks.realDrivingTimeText, /Wagenkarte oder Umlauftafel/);
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
  assert.match(blocks.pauseHtml, /Pause: 09:00.*09:30.*30 min/);
});

test('Block-Orchestrator zeigt belegten PDF-Titel bei unbekanntem Nummernschema', () => {
  const title = 'Dienste Regionalbus Montag bis Freitag Schule, ab 26.10.2026';
  const schedule = adaptExcelRowsToCanonicalSchedule([
    ['Kopf'],
    ['', '', '601', 'Dienst', '6011', '04:17', 'Eisenberg', '', '', '11:22', 'Eisenberg', '', '', '', '04:02', '11:37', '07:05']
  ], { layout: 'legacy-tabular-17-column' });
  schedule.validity = { dayType: 'mo_fr', dayTypeSource: 'HEADER', serviceRegime: 'school', rawLabel: title };
  const blocks = createOriginalBlockViewModel(schedule);
  assert.equal(blocks.planHinweis, title);
  assert.equal(blocks.planTypeText, `Erkannter Dienstplan: ${title}`);
});
