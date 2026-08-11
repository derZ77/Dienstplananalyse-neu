import test from 'node:test';
import assert from 'node:assert/strict';

import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';
import { renderExistingStatusText } from '../js/v2/blocks/block-renderer.js';

const clock = value => ({ value, raw: value, minutesSinceStartOfDay: Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) });

function scheduleWithPause({ number, workEnd, pauseStart, pauseEnd, structured = true }) {
  const id = `service-${number}`;
  const activity = structured
    ? { id: `activity-${number}`, serviceId: id, activityType: 'driving', rawActivity: 'Fahrt', departureTime: clock('05:00'), arrivalTime: clock(workEnd), departureLocation: 'A', arrivalLocation: 'B', source: {} }
    : { id: `activity-${number}`, serviceId: id, activityType: 'driving', rawActivity: 'Fahrt', departureTime: {}, arrivalTime: {}, source: {} };
  const interruption = { id: `pause-${number}`, serviceId: id, serviceNumber: String(number), kind: 'pause', start: clock(pauseStart), end: clock(pauseEnd), durationMinutes: 30, startLocation: 'B', endLocation: 'B', precedingActivityId: activity.id };
  const service = { id, serviceNumber: String(number), begin: clock('05:00'), end: clock('14:00'), paidTime: { value: '08:00', minutes: 480 }, activities: [activity], interruptions: [interruption], source: {} };
  return { type: 'CanonicalSchedule', document: { sourceType: 'synthetic', source: {} }, services: [service], activities: [activity], interruptions: [interruption], warnings: [], metadata: {} };
}

test('Phase 8.6: Block 10 exposes minimum pause, structured BV result and the shared color status', () => {
  const output = createOriginalBlockViewModel(scheduleWithPause({ number: 8101, workEnd: '08:30', pauseStart: '08:30', pauseEnd: '09:00' })).pauseHtml;

  assert.match(output, /Pause: 08:30 - 09:00/);
  assert.match(output, /Dauer: 30 min/);
  assert.match(output, /Mindestpause erfüllt: Ja \(reguläre Blockpause ab 30 Minuten\)/);
  assert.match(output, /Zeit vor Pause: 03:30 h/);
  assert.match(output, /BV-Bewertung: BV eingehalten/);
  assert.match(renderExistingStatusText(output), /status-pass/);
});

test('Phase 8.6: Block 10 makes fallback explicitly yellow instead of claiming a conclusive BV result', () => {
  const output = createOriginalBlockViewModel(scheduleWithPause({ number: 8102, workEnd: '08:45', pauseStart: '08:45', pauseEnd: '09:15', structured: false })).pauseHtml;

  assert.match(output, /Grundlage: Fallback Dienstbeginn\/Pausenbeginn/);
  assert.match(output, /BV-Bewertung: BV-Prüfung erforderlich/);
  assert.match(renderExistingStatusText(output), /status-warning/);
  assert.doesNotMatch(output, /BV-Bewertung: BV eingehalten|BV-Bewertung: BV-Verstoß/);
});

test('Phase 8.6: Block 6 marks every over-04:30 service part as a review notice and reserves red for existing failures', () => {
  const schedule = scheduleWithPause({ number: 8103, workEnd: '09:45', pauseStart: '09:45', pauseEnd: '10:15' });
  schedule.services[0].interruptions = [];
  schedule.interruptions = [];
  schedule.services[0].activities[0].arrivalTime = clock('10:00');
  const output = createOriginalBlockViewModel(schedule).segmentText;

  assert.match(output, /Arbeitszeit über 04:30 h – BV-Prüfung erforderlich/);
  assert.match(renderExistingStatusText(output), /status-warning/);
  assert.doesNotMatch(renderExistingStatusText(output), /status-fail/);
});

test('Phase 8.6: Block 9 lists every trip exactly once as ID, time range and start-to-destination', () => {
  const id = 'service-8104';
  const activity = { id: 'activity-8104', serviceId: id, rawActivity: 'Fahrt', departureTime: clock('06:00'), arrivalTime: clock('07:00'), departureLocation: 'Start', arrivalLocation: 'Ziel', circuitNumber: '5/11', source: {} };
  const schedule = { type: 'CanonicalSchedule', document: { sourceType: 'synthetic', source: {} }, services: [{ id, serviceNumber: '8104', begin: clock('06:00'), end: clock('07:00'), paidTime: { value: '01:00', minutes: 60 }, activities: [activity], interruptions: [], source: {} }], activities: [activity], interruptions: [], warnings: [], metadata: {} };
  const output = createOriginalBlockViewModel(schedule).routeText;

  assert.match(output, /ID \| Zeitbereich \| Start → Ziel/);
  assert.match(output, /8104 \| 06:00–07:00 \| Start → Ziel/);
  assert.equal((output.match(/8104/g) || []).length, 1);
});
