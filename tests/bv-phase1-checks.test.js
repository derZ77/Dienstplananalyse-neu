import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheckModules } from '../js/v2/checks/check-runner.js';
import { createBv003Check } from '../js/v2/checks/bv/bv003.js';
import { createBv005Check } from '../js/v2/checks/bv/bv005.js';
import { createBv007Check } from '../js/v2/checks/bv/bv007.js';
import { createBv010Check } from '../js/v2/checks/bv/bv010.js';
import { createBv012Check } from '../js/v2/checks/bv/bv012.js';
import { createBv014Check } from '../js/v2/checks/bv/bv014.js';

const analysisResult = { type: 'AnalysisResult', document: {}, services: [], statistics: {}, issues: [], warnings: [], metadata: {} };

function time(value) {
  if (!value) return { value: null, minutesSinceStartOfDay: null };
  const [hours, minutes] = value.split(':').map(Number);
  return { value, minutesSinceStartOfDay: hours * 60 + minutes };
}

function service({ id = 'service:1', number = '1103', begin = '03:00', end = '12:00', paidMinutes = 510, activities = [] } = {}) {
  return { id, serviceNumber: number, begin: time(begin), end: time(end), paidTime: { minutes: paidMinutes }, activities, source: { service: id } };
}

function activity({ id = 'activity:1', serviceId = 'service:1', type = 'serviceDrive', rawActivity = 'Dienst', departure = '03:00', arrival = '04:00', departureLocation = 'A', arrivalLocation = 'A', source = { activity: id } } = {}) {
  return { id, serviceId, activityType: type, rawActivity, departureTime: time(departure), arrivalTime: time(arrival), departureLocation, arrivalLocation, source };
}

function schedule(services) {
  return { type: 'CanonicalSchedule', document: {}, services, activities: services.flatMap(item => item.activities), interruptions: [], warnings: [], metadata: {} };
}

async function run(module) {
  const report = await runCheckModules(analysisResult, [module]);
  return report.results;
}

test('BV003: Normalfall, Grenzfall, nicht anwendbar und Fehlerfall', async () => {
  const normal = schedule([service({ activities: [activity({ departureLocation: 'A', arrivalLocation: 'A' })] })]);
  assert.equal((await run(createBv003Check({ canonicalSchedule: normal })))[0].status, 'PASS');
  const boundary = schedule([service({ activities: [activity({ departureLocation: 'A', arrivalLocation: 'B' })] })]);
  assert.equal((await run(createBv003Check({ canonicalSchedule: boundary })))[0].status, 'FAIL');
  const unavailable = schedule([service({ activities: [activity({ departureLocation: '', arrivalLocation: '' })] })]);
  assert.equal((await run(createBv003Check({ canonicalSchedule: unavailable })))[0].status, 'NOT_APPLICABLE');
  const errorReport = await runCheckModules(analysisResult, [createBv003Check()]);
  assert.equal(errorReport.errors.length, 1);
});

test('BV005: Normalfall, Grenzfall, nicht anwendbar und Fehlerfall', async () => {
  const normal = schedule([service({ paidMinutes: 510 })]);
  assert.equal((await run(createBv005Check({ canonicalSchedule: normal, planMetadata: { timeframe: 'Mo–Fr Schule' } })))[0].status, 'PASS');
  const boundary = schedule([service({ paidMinutes: 511 })]);
  assert.equal((await run(createBv005Check({ canonicalSchedule: boundary, planMetadata: { timeframe: 'Mo–Fr Schule' } })))[0].status, 'FAIL');
  assert.equal((await run(createBv005Check({ canonicalSchedule: normal })))[0].status, 'SKIP');
  const errorReport = await runCheckModules(analysisResult, [createBv005Check({ planMetadata: { timeframe: 'Samstag' } })]);
  assert.equal(errorReport.errors.length, 1);
});

test('BV007: Normalfall, Grenzfall, nicht anwendbar und Fehlerfall', async () => {
  const normal = schedule([service({ id: 'split:1', number: '1140', begin: '04:45', end: '19:00' })]);
  const normalResults = await run(createBv007Check({ canonicalSchedule: normal, planMetadata: { splitServiceIds: ['split:1'] } }));
  assert.deepEqual(normalResults.map(item => item.status), ['PASS', 'PASS']);
  const boundary = schedule([service({ id: 'split:1', begin: '04:44', end: '19:01' })]);
  const boundaryResults = await run(createBv007Check({ canonicalSchedule: boundary, planMetadata: { splitServiceIds: ['split:1'] } }));
  assert.equal(boundaryResults[1].status, 'FAIL');
  const unavailableResults = await run(createBv007Check({ canonicalSchedule: normal }));
  assert.equal(unavailableResults[1].status, 'SKIP');
  const errorReport = await runCheckModules(analysisResult, [createBv007Check()]);
  assert.equal(errorReport.errors.length, 1);
});

test('BV010: Normalfall, Grenzfall, nicht anwendbar und Fehlerfall', async () => {
  const normal = schedule([service({ activities: [activity({ type: 'unpaidBreak', rawActivity: 'Pause', departure: '08:00', arrival: '08:30' })] })]);
  assert.equal((await run(createBv010Check({ canonicalSchedule: normal })))[0].status, 'PASS');
  const boundary = schedule([service({ activities: [activity({ type: 'unpaidBreak', rawActivity: 'Pause', departure: '08:00', arrival: '08:29' })] })]);
  assert.equal((await run(createBv010Check({ canonicalSchedule: boundary })))[0].status, 'FAIL');
  assert.equal((await run(createBv010Check({ canonicalSchedule: schedule([service()]) })))[0].status, 'NOT_APPLICABLE');
  const errorReport = await runCheckModules(analysisResult, [createBv010Check()]);
  assert.equal(errorReport.errors.length, 1);
});

test('BV012: Normalfall, Grenzfall, nicht anwendbar und Fehlerfall', async () => {
  const normal = schedule([service({ activities: [activity({ type: 'unpaidBreak', rawActivity: 'Pause', departure: '08:00', arrival: '08:33' })] })]);
  assert.equal((await run(createBv012Check({ canonicalSchedule: normal })))[0].status, 'PASS');
  const boundary = schedule([service({ activities: [activity({ type: 'unpaidBreak', rawActivity: 'Pause', departure: '08:00', arrival: '08:32' })] })]);
  assert.equal((await run(createBv012Check({ canonicalSchedule: boundary })))[0].status, 'FAIL');
  assert.equal((await run(createBv012Check({ canonicalSchedule: schedule([service()]) })))[0].status, 'NOT_APPLICABLE');
  const errorReport = await runCheckModules(analysisResult, [createBv012Check()]);
  assert.equal(errorReport.errors.length, 1);
});

test('BV014: Normalfall, Grenzfall, nicht anwendbar und Fehlerfall', async () => {
  const normal = schedule([service({ activities: [activity({ type: 'unpaidBreak', rawActivity: 'Pause' })] })]);
  assert.equal((await run(createBv014Check({ canonicalSchedule: normal })))[0].status, 'PASS');
  const boundary = schedule([service({ activities: [activity({ type: 'unpaidBreak', rawActivity: '', source: null })] })]);
  assert.equal((await run(createBv014Check({ canonicalSchedule: boundary })))[0].status, 'FAIL');
  assert.equal((await run(createBv014Check({ canonicalSchedule: schedule([service()]) })))[0].status, 'NOT_APPLICABLE');
  const errorReport = await runCheckModules(analysisResult, [createBv014Check()]);
  assert.equal(errorReport.errors.length, 1);
});

test('BV-Phase-1-Module verändern weder AnalysisCore, Legacy-Migration noch CheckRunner', async () => {
  const [core, legacy, runner] = await Promise.all([
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../js/v2/analysis/analysis-core.js', import.meta.url), 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../js/v2/analysis/legacy-analysis-migrator.js', import.meta.url), 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../js/v2/checks/check-runner.js', import.meta.url), 'utf8'))
  ]);
  assert.doesNotMatch(core, /bv00[3|5|7]|bv010|bv012|bv014/i);
  assert.doesNotMatch(legacy, /bv00[3|5|7]|bv010|bv012|bv014/i);
  assert.doesNotMatch(runner, /bv00[3|5|7]|bv010|bv012|bv014/i);
});
