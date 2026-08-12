/** Phase 9.2 — JES PDF interruptions enter the shared CanonicalSchedule and Block 2. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXTURES } from './fixtures/paths.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';

globalThis.DOMMatrix ||= class DOMMatrix {};

const fileOf = async path => {
  const bytes = new Uint8Array(await readFile(path));
  return { name: path.split('/').at(-1), type: 'application/pdf', arrayBuffer: async () => bytes.slice().buffer };
};

async function importPdf(path) {
  const { analyzePdfImport } = await import('../js/v2/import/pdf-analysis-controller.js');
  return (await analyzePdfImport(await fileOf(path))).canonicalSchedule;
}

test('Phase 9.2: JES explicit Dienstunterbrechungen use the common canonical interruption contract', async () => {
  const schedule = await importPdf(FIXTURES.jesSchedulePdf);
  const expected = new Map([
    ['756', ['09:09', '13:07', 238, '05:09', '16:53']],
    ['758', ['10:20', '14:07', 227, '05:35', '17:30']],
    ['759', ['09:39', '13:37', 238, '05:40', '17:26']],
    ['760', ['09:50', '13:50', 240, '06:22', '18:02']]
  ]);

  assert.equal(schedule.interruptions.length, expected.size);
  for (const [serviceNumber, [start, end, durationMinutes, begin, finish]] of expected) {
    const service = schedule.services.find(entry => entry.serviceNumber === serviceNumber);
    const interruption = schedule.interruptions.find(entry => entry.serviceId === service?.id);
    assert.ok(service, `Dienst ${serviceNumber} vorhanden`);
    assert.deepEqual([service.begin.value, service.end.value], [begin, finish]);
    assert.ok(interruption, `Dienst ${serviceNumber} hat eine Canonical-Unterbrechung`);
    assert.deepEqual(
      [interruption.type, interruption.kind, interruption.start.value, interruption.end.value, interruption.durationMinutes, interruption.serviceNumber],
      ['serviceInterruption', 'interruption', start, end, durationMinutes, serviceNumber]
    );
    assert.equal(service.interruptions.length, 1);
  }
});

test('Phase 9.2: Block 2 recognises JES split duties once with their canonical duty span', async () => {
  const schedule = await importPdf(FIXTURES.jesSchedulePdf);
  const output = createOriginalBlockViewModel(schedule).sharedText;

  assert.match(output, /Anzahl geteilte Dienste: 4/);
  assert.match(output, /IDs: 756, 758, 759, 760/);
  assert.match(output, /ID 756: Schichtspanne 11:44/);
  assert.match(output, /ID 758: Schichtspanne 11:55/);
  assert.match(output, /ID 759: Schichtspanne 11:46/);
  assert.match(output, /ID 760: Schichtspanne 11:40/);
  assert.equal((output.match(/ID 756:/g) || []).length, 1, 'keine Doppelzählung');
});

test('Phase 9.2: JES duties without a long Dienstunterbrechung are not split duties', async () => {
  const schedule = await importPdf(FIXTURES.jesSchedulePdf);
  const service = schedule.services.find(entry => entry.serviceNumber === '761');
  const output = createOriginalBlockViewModel(schedule).sharedText;

  assert.ok(service, 'regulärer JES-Dienst vorhanden');
  assert.equal(service.interruptions.length, 0);
  assert.doesNotMatch(output, /ID 761:/);
});

test('Phase 9.2: JNV long interruptions retain the existing unique Block-2 result', async () => {
  const schedule = await importPdf(FIXTURES.jnvSchedulePdf);
  const output = createOriginalBlockViewModel(schedule).sharedText;
  const interruptionServiceNumbers = schedule.interruptions.map(entry => entry.serviceNumber);
  const ids = (output.match(/IDs: (.*)/)?.[1] || '').split(', ').filter(Boolean);

  assert.equal(schedule.interruptions.length, 12);
  assert.equal(new Set(interruptionServiceNumbers).size, 12);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.length, 12);
});
