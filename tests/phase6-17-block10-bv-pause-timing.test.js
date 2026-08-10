import test from 'node:test';
import assert from 'node:assert/strict';

import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

const clock = value => ({ raw: value, value, minutesSinceStartOfDay: Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) });
const activity = (id, serviceId, start, end) => ({ id, serviceId, rawActivity: 'Dienst', departureTime: clock(start), arrivalTime: clock(end), departureLocation: 'A', arrivalLocation: 'B', circuitNumber: '12/1', source: {} });
const service = (number, start, end, activityEnd, interruptionStart, interruptionEnd) => {
  const id = `service-${number}`;
  const entry = { id, serviceNumber: String(number), begin: clock(start), end: clock(end), paidTime: { value: '08:00', minutes: 480 }, activities: [activity(`activity-${number}`, id, start, activityEnd)], interruptions: [], source: {} };
  const interruption = { id: `interruption-${number}`, serviceId: id, serviceNumber: String(number), kind: 'pause', start: clock(interruptionStart), end: clock(interruptionEnd), durationMinutes: 40, startLocation: 'B', endLocation: 'B' };
  entry.interruptions = [interruption];
  return { entry, interruption };
};

function scheduleWith(...entries) {
  return { type: 'CanonicalSchedule', document: { sourceType: 'excel', source: {} }, services: entries.map(item => item.entry), activities: entries.flatMap(item => item.entry.activities), interruptions: entries.map(item => item.interruption), warnings: [], metadata: {} };
}

test('Phase 6.17: Block 10 bewertet 3:30–4:30 Stunden Arbeitszeit vor der Pause als eingehalten', () => {
  const output = createOriginalBlockViewModel(scheduleWith(service(1201, '05:00', '14:00', '08:45', '08:45', '09:25'))).pauseHtml;

  assert.match(output, /BV-Pausenlagenprüfung:/);
  assert.match(output, /Dienst 1201.*Zeit vor Pause: 03:45 h.*Grundlage: Arbeitszeitdaten.*Bewertung: BV eingehalten/s);
});

test('Phase 6.17: Block 10 bewertet Arbeitszeit vor 3:30 oder nach 4:30 Stunden als Verstoß', () => {
  const output = createOriginalBlockViewModel(scheduleWith(
    service(1202, '05:00', '14:00', '08:29', '08:29', '09:09'),
    service(1203, '05:00', '14:00', '09:31', '09:31', '10:11')
  )).pauseHtml;

  assert.match(output, /Dienst 1202.*Zeit vor Pause: 03:29 h.*Bewertung: BV-Verstoß/s);
  assert.match(output, /Dienst 1203.*Zeit vor Pause: 04:31 h.*Bewertung: BV-Verstoß/s);
});

test('Phase 6.17: Block 10 kennzeichnet die Dienstbeginn-Fallbackbewertung', () => {
  const item = service(1204, '05:00', '14:00', '08:45', '08:45', '09:25');
  item.entry.activities = [{ id: 'activity-1204', serviceId: item.entry.id, rawActivity: 'Dienst', departureTime: { value: null, minutesSinceStartOfDay: null }, arrivalTime: { value: null, minutesSinceStartOfDay: null }, source: {} }];
  const output = createOriginalBlockViewModel(scheduleWith(item)).pauseHtml;

  assert.match(output, /Dienst 1204.*Zeit vor Pause: 03:45 h.*Grundlage: Fallback Dienstbeginn\/Pausenbeginn/s);
  assert.match(output, /Bewertung basiert auf Zeitdifferenz Dienstbeginn bis Pausenbeginn/);
});
