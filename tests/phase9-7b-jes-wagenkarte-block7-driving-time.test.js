import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeVehicleCardDrivingTime, createVehicleCardBlock7ViewModel } from '../js/v2/blocks/wagenkarte-block7.js';
import { renderVehicleCardBlock7 } from '../js/v2/blocks/block-renderer.js';

const duration = minutes => ({ value: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, minutes });
const time = (value, timelineMinutes) => ({ value, timelineMinutes });
const segment = (type, start, end, minutes, extra = {}) => ({ type, start, end, duration: duration(minutes), ...extra });

function service(number = '901', { officialL5Minutes = 249, extraSegments = [], breaks = null, interruptions = null } = {}) {
  const unpaidBreak = segment('UNPAID_BREAK', time('08:27', 507), time('08:57', 537), 30);
  return {
    serviceId: `wagenkarte-service:${number}`,
    serviceNumber: number,
    officialL5: duration(officialL5Minutes),
    segments: [
      segment('LINE_SERVICE', time('05:00', 300), time('07:00', 420), 120, { line: '460', trip: '1' }),
      segment('TURNAROUND', time('07:00', 420), time('07:20', 440), 20),
      segment('DEADHEAD', time('07:30', 450), time('08:27', 507), 57),
      unpaidBreak,
      segment('LINE_SERVICE', time('08:57', 537), time('10:09', 609), 72, { line: '461', trip: '2' }),
      segment('PROVISIONING', time('10:09', 609), time('10:29', 629), 20),
      ...extraSegments
    ],
    // A regular PAUSE lies in the gap between the first line trip and the
    // deadhead. It is deliberately not a legacy Block-7 separator.
    breaks: breaks ?? [unpaidBreak, segment('PAUSE', time('07:20', 440), time('07:30', 450), 10)],
    interruptions: interruptions ?? [],
    additionalTimes: {
      turnaround: [segment('TURNAROUND', time('07:00', 420), time('07:20', 440), 20)],
      provisioning: [segment('PROVISIONING', time('10:09', 609), time('10:29', 629), 20)],
      preparation: [segment('PREPARATION', time('04:45', 285), time('05:00', 300), 15)],
      postprocessing: [segment('POSTPROCESSING', time('10:09', 609), time('10:19', 619), 10)],
      standby: [segment('STANDBY', time('07:20', 440), time('07:30', 450), 10)]
    }
  };
}

test('Phase 9.7B: Block 7 summiert beobachtete Linien- und Leerfahrten und trennt sie an unbezahlter Pause', () => {
  const result = analyzeVehicleCardDrivingTime(service());

  assert.equal(result.tripTimeMinutes, 249);
  assert.equal(result.officialL5Minutes, 249);
  assert.equal(result.l5DifferenceMinutes, 0);
  assert.equal(result.realDrivingTime, 'UNKNOWN');
  assert.deepEqual(result.l5Components, { driving: 'UNKNOWN', turnaround: 'UNKNOWN', provision: 'UNKNOWN', other: 'UNKNOWN', unexplained: 'UNKNOWN' });
  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map(block => block.tripMinutes), [177, 72]);
  assert.equal(result.tripBeforeRelevantBreakMinutes, 177);
  assert.equal(result.tripAfterRelevantBreakMinutes, 72);
  assert.equal(result.maxContinuousTripBlockMinutes, 177);
  assert.equal('drivingTimeLimitStatus' in result, false);
  assert.equal(result.additionalTimes.workAdjacentMinutes, 75);
});

test('Phase 9.7B: mehrere relevante Unterbrechungen erzeugen alle Lenkzeitblöcke, die längste bleibt die Legacy-Zusammenfassung', () => {
  const firstBreak = segment('UNPAID_BREAK', time('06:00', 360), time('06:30', 390), 30);
  const interruption = segment('SERVICE_INTERRUPTION', time('08:00', 480), time('10:30', 630), 150);
  const card = service('902', {
    officialL5Minutes: 240,
    breaks: [firstBreak],
    interruptions: [interruption]
  });
  card.segments = [
    segment('LINE_SERVICE', time('05:00', 300), time('06:00', 360), 60),
    firstBreak,
    segment('DEADHEAD', time('06:30', 390), time('08:00', 480), 90),
    interruption,
    segment('LINE_SERVICE', time('10:30', 630), time('12:00', 720), 90)
  ];
  const result = analyzeVehicleCardDrivingTime(card);

  assert.equal(result.blocks.length, 3);
  assert.deepEqual(result.blocks.map(block => block.tripMinutes), [60, 90, 90]);
  assert.equal(result.relevantBreak.type, 'SERVICE_INTERRUPTION');
  assert.equal(result.tripBeforeRelevantBreakMinutes, 150);
  assert.equal(result.tripAfterRelevantBreakMinutes, 90);
  assert.equal(result.maxContinuousTripBlockMinutes, 90);
});

test('Phase 9.7B: L5 bleibt unabhängig und Differenz ist official L5 minus beobachtete Fahrtenzeit', () => {
  const result = analyzeVehicleCardDrivingTime(service('difference', { officialL5Minutes: 230 }));
  assert.equal(result.tripTimeMinutes, 249);
  assert.equal(result.officialL5Minutes, 230);
  assert.equal(result.l5DifferenceMinutes, -19);
  assert.equal(result.realDrivingTime, 'UNKNOWN');
  assert.equal('drivingTimeLimitStatus' in result, false);
});

test('Phase 9.7B: Mitternachtssegmente bleiben im richtigen Lenkzeitblock und die Block-7-Ausgabe bleibt fachlich lesbar', () => {
  const midnightPause = segment('UNPAID_BREAK', time('00:20', 1460), time('00:50', 1490), 30);
  const card = {
    type: 'VehicleCardSchedule', organization: 'JES', documentType: 'wagenkarte',
    services: [{
      ...service('903', { officialL5Minutes: 70, breaks: [midnightPause], interruptions: [] }),
      segments: [
        segment('LINE_SERVICE', time('23:30', 1410), time('00:20', 1460), 50),
        midnightPause,
        segment('DEADHEAD', time('00:50', 1490), time('01:10', 1510), 20)
      ]
    }]
  };
  const result = analyzeVehicleCardDrivingTime(card.services[0]);
  const view = createVehicleCardBlock7ViewModel(card);

  assert.deepEqual(result.blocks.map(block => block.tripMinutes), [50, 20]);
  assert.match(view.realDrivingTimeText, /ID 903:/);
  assert.match(view.realDrivingTimeText, /Fahrtenzeit: 01:10/);
  assert.match(view.realDrivingTimeText, /Offizieller L5: 01:10/);
  assert.match(view.realDrivingTimeText, /Fahrtenzeit vor Unterbrechung: 00:50/);
  assert.match(view.realDrivingTimeText, /Fahrtenzeit nach Unterbrechung: 00:20/);
  assert.match(view.realDrivingTimeText, /Reale Lenkzeit: nicht bestimmt/);
  assert.doesNotMatch(view.realDrivingTimeText, /Prüfung 04:30h|Lenkzeit gesamt/i);
});

test('Phase 9.7B: die bestehende Block-7-Zielbox erhält nur die Wagenkarten-Lenkzeitausgabe', () => {
  const target = { innerHTML: '', textContent: '' };
  const document = { getElementById: id => id === 'real-driving-time-result' ? target : null };
  const view = { realDrivingTimeText: 'ID 901:\nFahrtenzeit: 04:09' };

  renderVehicleCardBlock7(view, { document });

  assert.match(target.innerHTML, /ID 901/);
  assert.match(target.innerHTML, /Fahrtenzeit: 04:09/);
});
