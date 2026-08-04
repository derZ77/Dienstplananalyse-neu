import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 3A – JNV parser hardening. Additive, deterministic, local. These tests use
// only small synthetic/anonymized lines (no real schedule data, no full duties).
const {
  ROW_TYPES,
  ROW_TYPE_VALUES,
  classifyRowText,
  parseServiceInterruption,
  matchDayQualifier
} = await import('../js/v2/pdf/row-type-contract.js');
const { normalizeTimeline } = await import('../js/v2/pdf/timeline-normalization.js');
const {
  WARNING_CODES,
  DUTY_KINDS,
  classifyDuty,
  enrichJnvSchedule
} = await import('../js/v2/pdf/jnv-schedule-hardening.js');

// --- synthetic builders (minimal canonical-like shapes) ---------------------
const clock = (value) => {
  if (value == null || value === '') return { raw: '', value: null, minutesSinceStartOfDay: null };
  const [h, m] = value.split(':').map(Number);
  return { raw: value, value, minutesSinceStartOfDay: h * 60 + m };
};
const activity = (over = {}) => ({
  id: over.id || 'activity:service:1:0',
  serviceId: 'service:1',
  serviceNumber: '',
  circuitNumber: '',
  rawActivity: '',
  departureTime: clock(over.departure ?? null),
  arrivalTime: clock(over.arrival ?? null),
  departureLocation: '',
  arrivalLocation: '',
  originalText: '',
  boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
  source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 2, columnIndex: 0 },
  ...clean(over)
});
const clean = (over) => {
  const { departure, arrival, ...rest } = over;
  return rest;
};
const service = (over = {}) => ({
  id: over.id || 'service:1:0',
  serviceNumber: over.serviceNumber || '2141',
  begin: clock(over.begin ?? '04:53'),
  end: clock(over.end ?? '12:40'),
  paidTime: { raw: '06:43', value: '06:43', minutes: 403 },
  activities: over.activities || [],
  interruptions: [],
  originalText: '',
  boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
  source: { pageNumber: 1, tableIndex: 0, serviceBlockIndex: 0, lineNumber: 1 }
});
const schedule = (services) => ({
  type: 'CanonicalSchedule',
  document: { sourceType: 'pdf', pageCount: 1, source: {} },
  services,
  activities: services.flatMap(s => s.activities),
  interruptions: [],
  warnings: [],
  metadata: { schemaVersion: '1.0', serviceCount: services.length, activityCount: services.flatMap(s => s.activities).length, interruptionCount: 0 }
});

// ---------------------------------------------------------------------------
test('row-type contract exposes a frozen, closed vocabulary', () => {
  assert.ok(Object.isFrozen(ROW_TYPES));
  assert.deepEqual(
    [...ROW_TYPE_VALUES].sort(),
    ['annotation', 'day_qualifier', 'empty', 'service_data', 'service_interruption', 'table_header', 'unsupported']
  );
});

// === Group A: Dienstunterbrechung ==========================================
test('A: Dienstunterbrechung line is classified as service_interruption, not a data row', () => {
  const result = classifyRowText('Dienstunterbrechung von 08:22 Uhr bis 13:26 Uhr');
  assert.equal(result.type, ROW_TYPES.SERVICE_INTERRUPTION);
  assert.equal(result.startTime, '08:22');
  assert.equal(result.endTime, '13:26');
  assert.notEqual(result.type, ROW_TYPES.SERVICE_DATA);
});

test('A: parseServiceInterruption yields a structured model with minutes and offsets', () => {
  const model = parseServiceInterruption('Dienstunterbrechung von 08:22 Uhr bis 13:26 Uhr');
  assert.equal(model.type, 'serviceInterruption');
  assert.equal(model.startTime, '08:22');
  assert.equal(model.endTime, '13:26');
  assert.equal(model.startMinutes, 8 * 60 + 22);
  assert.equal(model.endMinutes, 13 * 60 + 26);
  assert.equal(model.dayOffsetStart, 0);
  assert.equal(model.dayOffsetEnd, 0);
  assert.equal(model.sourceText, 'Dienstunterbrechung von 08:22 Uhr bis 13:26 Uhr');
});

test('A: interruption over midnight advances the end day offset deterministically', () => {
  const model = parseServiceInterruption('Dienstunterbrechung von 23:30 Uhr bis 00:40 Uhr');
  assert.equal(model.dayOffsetStart, 0);
  assert.equal(model.dayOffsetEnd, 1);
  assert.ok(model.endMinutes + model.dayOffsetEnd * 1440 > model.startMinutes);
});

test('A: enrichment populates service.interruptions and does not treat it as a duty activity', () => {
  const interruptionRow = activity({ originalText: 'Dienstunterbrechung von 08:22 Uhr bis 13:26 Uhr' });
  const drive = activity({ rawActivity: 'Dienst', circuitNumber: '12100', departure: '05:03', arrival: '08:12', departureLocation: 'Bth. Burgau', arrivalLocation: 'Bth. Burgau', originalText: 'Dienst' });
  const enriched = enrichJnvSchedule(schedule([service({ activities: [drive, interruptionRow] })]));
  const s = enriched.services[0];
  assert.equal(s.interruptions.length, 1);
  assert.equal(s.interruptions[0].type, 'serviceInterruption');
  assert.equal(s.interruptions[0].startTime, '08:22');
  assert.equal(enriched.interruptions.length, 1, 'aggregated at top level of the hardened schedule');
  // the interruption row is not counted as a normal/duty activity
  assert.ok(s.dutyActivities.every(a => a.rowType !== ROW_TYPES.SERVICE_INTERRUPTION));
});

test('A: invalid interruption time warns without throwing and keeps the source', () => {
  assert.doesNotThrow(() => parseServiceInterruption('Dienstunterbrechung von 25:99 Uhr bis ?? Uhr'));
  const model = parseServiceInterruption('Dienstunterbrechung von 25:99 Uhr bis ?? Uhr');
  assert.equal(model.type, 'serviceInterruption');
  assert.equal(model.valid, false);
  const enriched = enrichJnvSchedule(schedule([service({ activities: [activity({ originalText: 'Dienstunterbrechung von 25:99 Uhr bis ?? Uhr' })] })]));
  assert.ok(enriched.warnings.some(w => w.code === WARNING_CODES.INVALID_SERVICE_INTERRUPTION_TIME));
});

// === Group B: Tagtyp-Qualifier =============================================
test('B: known day qualifiers map to controlled codes', () => {
  assert.equal(classifyRowText('Mo-Do').type, ROW_TYPES.DAY_QUALIFIER);
  assert.deepEqual(matchDayQualifier('Mo-Do'), { code: 'MON_THU', label: 'Mo-Do' });
  assert.deepEqual(matchDayQualifier('Freitag'), { code: 'FRIDAY', label: 'Freitag' });
});

test('B: enrichment records day qualifiers on the service, not as number/umlauf/activity', () => {
  const qualifier = activity({ serviceNumber: 'Mo-Do', originalText: 'Mo-Do' });
  const drive = activity({ rawActivity: 'Dienst', circuitNumber: '14400', departure: '05:03', arrival: '08:12', departureLocation: 'Bth. Burgau', arrivalLocation: 'Bth. Burgau', originalText: 'Dienst' });
  const enriched = enrichJnvSchedule(schedule([service({ serviceNumber: '2141', activities: [drive, qualifier] })]));
  const s = enriched.services[0];
  assert.equal(s.serviceNumber, '2141', 'the real duty number is unchanged');
  assert.equal(s.dayQualifiers.length, 1);
  assert.deepEqual({ code: s.dayQualifiers[0].code, label: s.dayQualifiers[0].label }, { code: 'MON_THU', label: 'Mo-Do' });
  assert.ok(s.dutyActivities.every(a => a.rowType !== ROW_TYPES.DAY_QUALIFIER));
});

test('B: unknown day-like token is a conservative annotation, not a fabricated qualifier', () => {
  const result = classifyRowText('Mo-Xy');
  assert.notEqual(result.type, ROW_TYPES.DAY_QUALIFIER);
  assert.equal(result.type, ROW_TYPES.ANNOTATION);
  const enriched = enrichJnvSchedule(schedule([service({ activities: [activity({ serviceNumber: 'Mo-Xy', originalText: 'Mo-Xy' })] })]));
  assert.ok(enriched.warnings.some(w => w.code === WARNING_CODES.UNSUPPORTED_DAY_QUALIFIER));
});

// === Group C: service over midnight ========================================
test('C: a night service ends on the next day with a positive normalized span', () => {
  const timeline = normalizeTimeline(['20:10', '04:44']);
  assert.equal(timeline[0].relativeMinutes, 20 * 60 + 10);
  assert.equal(timeline[1].dayOffset, 1);
  assert.equal(timeline[1].relativeMinutes, 1440 + 4 * 60 + 44);
  assert.ok(timeline[1].relativeMinutes > timeline[0].relativeMinutes);
});

test('C: enrichment marks the night service end offset; day services stay unchanged', () => {
  const night = enrichJnvSchedule(schedule([service({ begin: '20:10', end: '04:44' })])).services[0];
  assert.equal(night.begin.dayOffset, 0);
  assert.equal(night.end.dayOffset, 1);
  assert.ok(night.end.relativeMinutes > night.begin.relativeMinutes);

  const day = enrichJnvSchedule(schedule([service({ begin: '06:00', end: '14:00' })])).services[0];
  assert.equal(day.begin.dayOffset, 0);
  assert.equal(day.end.dayOffset, 0);
});

// === Group D: activities over midnight =====================================
test('D: an activity sequence across midnight stays monotone (no clock-only sort)', () => {
  const timeline = normalizeTimeline(['23:50', '00:15', '01:00']);
  assert.deepEqual(timeline.map(t => t.relativeMinutes), [1430, 1455, 1500]);
  assert.deepEqual(timeline.map(t => t.dayOffset), [0, 1, 1]);
  for (let i = 1; i < timeline.length; i += 1) {
    assert.ok(timeline[i].relativeMinutes > timeline[i - 1].relativeMinutes);
  }
});

test('D: an implausible time jump is flagged, not silently rolled multiple days', () => {
  const timeline = normalizeTimeline(['08:00', '07:59', '07:58']);
  // one rollover at most is acceptable; a second backward step is implausible
  assert.ok(timeline.some(t => t.implausible));
});

// === Group E: overloaded "Dienst" ==========================================
test('E: Dienst with a circuit is a service drive', () => {
  const kind = classifyDuty({ rawActivity: 'Dienst', circuitNumber: '12100', departureLocation: 'Bth. Burgau', arrivalLocation: 'Teichgraben Steig 1' });
  assert.equal(kind.dutyKind, DUTY_KINDS.SERVICE_DRIVE);
  assert.equal(kind.ambiguous, false);
});

test('E: Dienst depot-to-depot without a circuit is a depot duty, not a line drive', () => {
  const kind = classifyDuty({ rawActivity: 'Dienst', circuitNumber: '', departureLocation: 'Bth. Burgau', arrivalLocation: 'Bth. Burgau' });
  assert.equal(kind.dutyKind, DUTY_KINDS.DEPOT_DUTY);
});

test('E: a long depot-to-depot block is NOT auto-classified as reserve from duration', () => {
  const kind = classifyDuty({ rawActivity: 'Dienst', circuitNumber: '', departureLocation: 'Bth. Burgau', arrivalLocation: 'Bth. Burgau', begin: '03:15', end: '12:15' });
  assert.notEqual(kind.dutyKind, DUTY_KINDS.STANDBY_OR_RESERVE);
});

test('E: reserve/standby only from an explicit label', () => {
  assert.equal(classifyDuty({ rawActivity: 'Bereitschaft' }).dutyKind, DUTY_KINDS.STANDBY_OR_RESERVE);
});

test('E: an ambiguous Dienst (no circuit, different unknown places) is generic + flagged', () => {
  const kind = classifyDuty({ rawActivity: 'Dienst', circuitNumber: '', departureLocation: 'Ort A', arrivalLocation: 'Ort B' });
  assert.equal(kind.dutyKind, DUTY_KINDS.GENERIC_DUTY);
  assert.equal(kind.ambiguous, true);
  const enriched = enrichJnvSchedule(schedule([service({ activities: [activity({ rawActivity: 'Dienst', originalText: 'Dienst', departureLocation: 'Ort A', arrivalLocation: 'Ort B' })] })]));
  assert.ok(enriched.warnings.some(w => w.code === WARNING_CODES.AMBIGUOUS_GENERIC_DUTY));
});

// === Group F: free-text / non-tabular lines ================================
test('F: empty and unstructured lines are classified without crashing', () => {
  assert.equal(classifyRowText('').type, ROW_TYPES.EMPTY);
  assert.equal(classifyRowText('   ').type, ROW_TYPES.EMPTY);
  assert.equal(classifyRowText('Irgendein Hinweis ohne Struktur').type, ROW_TYPES.ANNOTATION);
});

test('F: an annotation between two normal rows is kept as annotation, data rows preserved', () => {
  const before = activity({ rawActivity: 'Vorbereitung', departure: '04:53', arrival: '04:58', originalText: 'Vorbereitung' });
  const note = activity({ originalText: 'Hinweis: siehe Aushang' });
  const after = activity({ rawActivity: 'Aufrüsten', departure: '04:58', arrival: '05:03', originalText: 'Aufrüsten' });
  const enriched = enrichJnvSchedule(schedule([service({ activities: [before, note, after] })]));
  const s = enriched.services[0];
  assert.equal(s.dutyActivities.filter(a => a.rowType === ROW_TYPES.SERVICE_DATA).length, 2, 'both real rows survive');
  assert.equal(s.annotations.length, 1);
  assert.ok(enriched.warnings.some(w => w.code === WARNING_CODES.NON_TABULAR_ANNOTATION));
});

test('F: a damaged interruption time does not abort the run', () => {
  assert.doesNotThrow(() => enrichJnvSchedule(schedule([service({ activities: [activity({ originalText: 'Dienstunterbrechung von 8 Uhr bis' })] })])));
});
