import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule } = await import('../js/v2/pdf/schedule-mapper.js');
const { buildCanonicalSchedule } = await import('../js/v2/pdf/canonical-schedule-builder.js');
const { applyRuleGroups } = await import('../js/v2/rules/rule-engine.js');

const beuPdfPath = '/Users/joergziegler/Downloads/B_20260817_MoFr_Schule_BEU.pdf';
const ruleDirectory = new URL('../js/v2/rules/beu/v1/', import.meta.url);
const jesRuleDirectory = new URL('../js/v2/rules/jes/v1/', import.meta.url);

async function loadRules(directory) {
  return Promise.all(['activities.json', 'interruptions.json', 'warnings.json'].map(async name =>
    JSON.parse(await readFile(new URL(name, directory), 'utf8'))
  ));
}

async function buildBeuSchedule() {
  const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(beuPdfPath)));
  return buildCanonicalSchedule(mapPdfDocumentToSchedule(normalizePdfLayoutDocument(layout)));
}

function ruleStatistics(schedule) {
  const matchesByRule = Object.fromEntries(schedule.metadata.ruleEngine.matches.reduce((counts, match) => {
    counts.set(match.ruleId, (counts.get(match.ruleId) || 0) + 1);
    return counts;
  }, new Map()));
  const activityTypes = Object.fromEntries(schedule.activities.reduce((counts, activity) => {
    counts.set(activity.activityType, (counts.get(activity.activityType) || 0) + 1);
    return counts;
  }, new Map()));
  return {
    matchesByRule,
    activityTypes,
    unknownRawActivities: [...new Set(schedule.activities.filter(activity => activity.activityType === 'unknown').map(activity => activity.rawActivity))],
    warnings: schedule.warnings
  };
}

test('BEU v1 erkennt alle bekannten Tätigkeiten über dieselbe Engine und CanonicalSchedule-Struktur', async () => {
  const schedule = applyRuleGroups(await buildBeuSchedule(), await loadRules(ruleDirectory));
  const statistics = ruleStatistics(schedule);
  const knownRawActivities = ['Dienst', 'Vorbereitung', 'Aufrüsten', 'Nachbereitung', 'Abrüsten', 'Mitfahrt', 'Wegezeit', 'Pause (bezahlt)', 'Pause'];

  assert.equal(schedule.type, 'CanonicalSchedule');
  assert.ok(schedule.activities.some(activity => activity.activityType === 'preparation'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'postprocessing'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'serviceDrive'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'rideAlong'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'walkingTime'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'paidBreak'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'unpaidBreak'));
  assert.ok(schedule.activities.filter(activity => knownRawActivities.includes(activity.rawActivity.trim())).every(activity => activity.activityType !== 'unknown'));
  assert.ok(schedule.activities.filter(activity => activity.rawActivity.trim().startsWith('Pause')).every(activity => activity.interruptionKind === 'break'));
  assert.ok(statistics.matchesByRule['beu-activity-service-drive'] > 0);
  assert.ok(statistics.warnings.some(warning => warning.ruleId === 'beu-warning-missing-departure-time'));
  assert.ok(statistics.warnings.some(warning => warning.ruleId === 'beu-warning-unknown-activity'));
  assert.ok(statistics.unknownRawActivities.includes(''));
});

test('BEU v1 besteht ausschließlich aus Daten, verändert JES nicht und nutzt die vorhandene Engine', async () => {
  const [beuRules, jesRules] = await Promise.all([loadRules(ruleDirectory), loadRules(jesRuleDirectory)]);
  assert.equal(typeof applyRuleGroups, 'function');
  assert.deepEqual(Object.keys(await buildBeuSchedule()).sort(), ['activities', 'document', 'interruptions', 'metadata', 'services', 'type', 'warnings']);
  assert.ok(beuRules.every(group => Array.isArray(group.rules)));
  assert.ok(jesRules.every(group => group.id.startsWith('jes-v1-')));
  for (const name of ['activities.json', 'interruptions.json', 'warnings.json']) {
    const content = await readFile(new URL(name, ruleDirectory), 'utf8');
    JSON.parse(content);
    assert.doesNotMatch(content, /\bfunction\b|\bif\s*\(/);
    assert.doesNotMatch(content, /\bJES\b/i);
  }
});
