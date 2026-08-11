/** Phase 8.8D — Block 10 must project declared pause activities without changing imports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { FIXTURES } from './fixtures/paths.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

globalThis.DOMMatrix ||= class DOMMatrix {};

const fileLike = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return {
    name: path.split('/').at(-1), type: 'application/pdf',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
};

const clock = value => ({ raw: value, value, minutesSinceStartOfDay: Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) });
const activity = (id, serviceId, start, end, rawActivity = 'Pause') => ({
  id, serviceId, rawActivity, departureTime: clock(start), arrivalTime: clock(end),
  departureLocation: 'Pauseort', arrivalLocation: 'Pauseort', circuitNumber: '12/1', source: {}
});

function scheduleWithEvents({ activities, interruptions = [] }) {
  const id = 'service-8801';
  const work = { id: 'work-8801', serviceId: id, rawActivity: 'Dienst', departureTime: clock('05:00'), arrivalTime: clock('08:30'), departureLocation: 'A', arrivalLocation: 'Pauseort', source: {} };
  const ownActivities = [work, ...activities.map(entry => ({ ...entry, serviceId: id }))];
  const ownInterruptions = interruptions.map(entry => ({ ...entry, serviceId: id, serviceNumber: '8801' }));
  const service = { id, serviceNumber: '8801', begin: clock('05:00'), end: clock('18:00'), paidTime: { value: '08:00', minutes: 480 }, activities: ownActivities, interruptions: ownInterruptions, source: {} };
  return { type: 'CanonicalSchedule', document: { sourceType: 'synthetic', source: {} }, services: [service], activities: ownActivities, interruptions: ownInterruptions, warnings: [], metadata: {} };
}

test('Phase 8.8D: real JNV declared pause activities enter Block 10 while long interruptions stay separate', async () => {
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(await fileLike(FIXTURES.jnvSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).pauseHtml;

  assert.match(output, /Pausen zwischen 30 und 120 Minuten: 45/);
  assert.match(output, /ID 2111:[\s\S]*Pause: 08:20 Stadtzentrum \(Pause\) → 08:50 Stadtzentrum \(Pause\) \| 30 min/);
  assert.match(output, /Dienst 2111:[\s\S]*Zeit vor Pause: 04:23 h[\s\S]*BV-Bewertung: BV eingehalten/);
  assert.match(output, /ID 2141:[\s\S]*Lange Unterbrechung \(geteilter Dienst; keine reguläre Blockpause\): 08:22–13:26 \| 304 min/);
  assert.equal((output.match(/Lange Unterbrechung \(geteilter Dienst; keine reguläre Blockpause\):/g) || []).length, 12);
});

test('Phase 8.8D: real JES declared pause activities enter Block 10 without duplicates', async () => {
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  const schedule = (await analyzePdfImport(await fileLike(FIXTURES.jesSchedulePdf))).canonicalSchedule;
  const output = createOriginalBlockViewModel(schedule).pauseHtml;

  assert.match(output, /Pausen zwischen 30 und 120 Minuten: 12/);
  assert.match(output, /ID 752:[\s\S]*Pause: 09:34 Busbahnhof 7521 → 10:19 Busbahnhof 7521 \| 45 min/);
  assert.equal((output.match(/\| deklarierte Pause im Dienst/g) || []).length, 12);
});

test('Phase 8.8D: a declared activity pause and the matching canonical interruption are shown once', () => {
  const interruption = { id: 'canonical-pause', kind: 'pause', start: clock('08:30'), end: clock('09:00'), durationMinutes: 30, startLocation: 'Pauseort', endLocation: 'Pauseort' };
  const schedule = scheduleWithEvents({ activities: [activity('declared-pause', 'service-8801', '08:30', '09:00')], interruptions: [interruption] });
  const output = createOriginalBlockViewModel(schedule).pauseHtml;

  assert.match(output, /Pausen zwischen 30 und 120 Minuten: 1/);
  assert.equal((output.match(/^ID 8801:/gm) || []).length, 1);
});

test('Phase 8.8D: multiple pauses and a long split interruption remain independent', () => {
  const longInterruption = { id: 'split', kind: 'interruption', start: clock('10:00'), end: clock('13:00'), durationMinutes: 180 };
  const schedule = scheduleWithEvents({
    activities: [activity('first-pause', 'service-8801', '08:30', '09:00'), activity('second-pause', 'service-8801', '14:00', '14:30')],
    interruptions: [longInterruption]
  });
  const output = createOriginalBlockViewModel(schedule).pauseHtml;

  assert.match(output, /Pausen zwischen 30 und 120 Minuten: 2/);
  assert.match(output, /Pause: 08:30 Pauseort 12\/1 → 09:00 Pauseort 12\/1 \| 30 min/);
  assert.match(output, /Pause: 14:00 Pauseort 12\/1 → 14:30 Pauseort 12\/1 \| 30 min/);
  assert.match(output, /Weitere Unterbrechungen \(keine regulären Blockpausen\):[\s\S]*Lange Unterbrechung/);
});
