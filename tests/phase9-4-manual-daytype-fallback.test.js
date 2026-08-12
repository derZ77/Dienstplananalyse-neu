/** Phase 9.4 — manual validity fallback is a session-only canonical override. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMultiDocumentSession } from '../js/v2/import/multi-document-import-controller.js';
import { attachCanonicalValidity } from '../js/v2/schedule/canonical-validity.js';
import { createOriginalBlockViewModel } from '../js/v2/blocks/block-orchestrator.js';
import { resolveJnvScheduleValidity } from '../js/v2/matching/jnv-schedule-validity.js';

const schedule = (header = '') => attachCanonicalValidity({
  type: 'CanonicalSchedule',
  document: { sourceType: 'pdf', source: {} },
  services: [{ id: 's-1', serviceNumber: '1150', begin: { value: '05:00', minutesSinceStartOfDay: 300 }, end: { value: '14:00', minutesSinceStartOfDay: 840 }, paidTime: { value: '08:45', minutes: 525 }, activities: [], interruptions: [], source: {} }],
  activities: [], interruptions: [], warnings: [], metadata: {}
}, { headerText: header });

const primary = (canonicalSchedule) => ({
  detection: { status: 'supported', profile: { id: 'beu-stadtbus-v1', label: 'JNV' } },
  canonicalSchedule
});
const file = name => ({ name });
const report = dayType => ({ type: 'CheckReport', results: [{ id: 'TEST', status: dayType === 'mo_fr' ? 'PASS' : 'NOT_APPLICABLE' }], errors: [], summary: {} });

test('Phase 9.4: automatic values are retained until an explicit user override', () => {
  const session = createMultiDocumentSession();
  session.setPrimaryResult(primary(schedule('Dienste Montag bis Freitag (Ferien), ab 13.07.2026')), file('a.pdf'));
  const before = session.getState().primaryImport.canonicalSchedule.validity;
  assert.deepEqual([before.dayType, before.dayTypeSource, before.serviceRegime, before.validFrom], ['mo_fr', 'HEADER', 'holidays', '2026-07-13']);

  session.setManualDayType('saturday');
  const after = session.getState().primaryImport.canonicalSchedule.validity;
  assert.deepEqual([after.dayType, after.dayTypeSource, after.serviceRegime, after.validFrom], ['saturday', 'MANUAL', 'holidays', '2026-07-13']);
  assert.match(createOriginalBlockViewModel(session.getState().primaryImport.canonicalSchedule).longText, /Nicht anwendbar/);
});

test('Phase 9.4: unknown can be changed to each supported manual day type and block 4 follows the active value', () => {
  for (const dayType of ['mo_fr', 'saturday', 'sunday']) {
    const session = createMultiDocumentSession();
    session.setPrimaryResult(primary(schedule('Dienstübersicht ohne Tagesart (Schule)')), file(`${dayType}.pdf`));
    assert.equal(session.getState().primaryImport.canonicalSchedule.validity.dayType, 'unknown');
    session.setManualDayType(dayType);
    const active = session.getState().primaryImport.canonicalSchedule.validity;
    assert.deepEqual([active.dayType, active.dayTypeSource, active.serviceRegime], [dayType, 'MANUAL', 'school']);
    const block4 = createOriginalBlockViewModel(session.getState().primaryImport.canonicalSchedule).longText;
    if (dayType === 'mo_fr') assert.match(block4, /BV-Bewertung \(Mo–Fr\):/);
    else assert.match(block4, /Nicht anwendbar/);
  }
});

test('Phase 9.4: override invalidates the old report and reruns the existing analysis path', async () => {
  const calls = [];
  const session = createMultiDocumentSession({
    runBaseAnalysis: async ({ primaryImport }) => {
      const dayType = primaryImport.canonicalSchedule.validity.dayType;
      calls.push(dayType);
      return { status: 'completed', checkReport: report(dayType) };
    }
  });
  session.setPrimaryResult(primary(schedule('ohne Tagesart')), file('unknown.pdf'));
  await session.analyzeRules();
  assert.equal(session.getState().checkReport.results[0].status, 'NOT_APPLICABLE');

  session.setManualDayType('mo_fr');
  assert.equal(session.getState().checkReport, null, 'vorheriger Prüfbericht wird verworfen');
  await session.analyzeRules();
  assert.deepEqual(calls, ['unknown', 'mo_fr']);
  assert.equal(session.getState().checkReport.results[0].status, 'PASS');
});

test('Phase 9.4: automatic reset and a new file never retain a previous manual override', () => {
  const session = createMultiDocumentSession();
  session.setPrimaryResult(primary(schedule('Dienste Montag bis Freitag (Schule)')), file('a.pdf'));
  session.setManualDayType('sunday');
  session.setManualDayType('automatic');
  assert.deepEqual([session.getState().primaryImport.canonicalSchedule.validity.dayType, session.getState().primaryImport.canonicalSchedule.validity.dayTypeSource], ['mo_fr', 'HEADER']);

  session.setPrimaryResult(primary(schedule('Plan Samstag (Ferien)')), file('b.pdf'));
  const b = session.getState().primaryImport.canonicalSchedule.validity;
  assert.deepEqual([b.dayType, b.dayTypeSource, b.serviceRegime], ['saturday', 'HEADER', 'holidays']);
});

test('Phase 9.4: companion import cannot change the primary schedule validity', async () => {
  const session = createMultiDocumentSession({
    importCompanion: async () => ({ classification: { type: 'umlaufkarte', confidence: 'exact' }, document: { mode: 'bus', validity: { dayType: 'sunday' } }, warnings: [] })
  });
  session.setPrimaryResult(primary(schedule('Dienste Montag bis Freitag (Schule)')), file('main.pdf'));
  await session.setCompanionFile(file('companion.xlsx'));
  const validity = session.getState().primaryImport.canonicalSchedule.validity;
  assert.deepEqual([validity.dayType, validity.dayTypeSource], ['mo_fr', 'HEADER']);
});

test('Phase 9.4: a manual day type has priority over automatic title evidence for an optional companion match', () => {
  const validity = resolveJnvScheduleValidity({
    metadata: { title: 'Montag bis Freitag (Schule)' },
    manualDayType: 'saturday'
  });
  assert.deepEqual([validity.dayType, validity.confidence], ['saturday', 'exact']);
  assert.equal(validity.conflicts.includes('CONFLICTING_DAY_TYPE'), false);
  assert.equal(validity.evidence[0].code, 'MANUAL_VALIDITY_SIGNAL');
});

test('Phase 9.4: validity controls are present, readable and connected to the existing reanalysis flow', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../js/v2/pdf-import-bootstrap.js', import.meta.url), 'utf8');
  assert.match(html, /id="schedule-validity-controls"/);
  assert.match(html, /id="schedule-daytype-select"/);
  assert.match(html, /Montag–Freitag/);
  assert.match(bootstrap, /setManualDayType/);
  assert.match(bootstrap, /renderAndAnalyze\(session\.setManualDayType/);
  assert.match(bootstrap, /Bitte Tagesart auswählen/);
});
