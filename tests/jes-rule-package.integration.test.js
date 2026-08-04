import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.DOMMatrix ||= class DOMMatrix {};

const { extractPdfLayoutDocument } = await import('../js/v2/pdf/pdf-core.js');
const { normalizePdfLayoutDocument } = await import('../js/v2/pdf/document-normalizer.js');
const { mapPdfDocumentToSchedule } = await import('../js/v2/pdf/schedule-mapper.js');
const { buildCanonicalSchedule } = await import('../js/v2/pdf/canonical-schedule-builder.js');
const { applyRuleGroups } = await import('../js/v2/rules/rule-engine.js');

const jesPdfPath = '/Users/joergziegler/Downloads/20260713_Dienstübersicht_FDA.pdf';
const ruleDirectory = new URL('../js/v2/rules/jes/v1/', import.meta.url);

async function loadRulePackage() {
  return Promise.all(['activities.json', 'interruptions.json', 'warnings.json'].map(async name =>
    JSON.parse(await readFile(new URL(name, ruleDirectory), 'utf8'))
  ));
}

async function buildJesSchedule() {
  const layout = await extractPdfLayoutDocument(new Uint8Array(await readFile(jesPdfPath)));
  return buildCanonicalSchedule(mapPdfDocumentToSchedule(normalizePdfLayoutDocument(layout)));
}

function createRuleStatistics(schedule) {
  const matchesByRule = Object.fromEntries(schedule.metadata.ruleEngine.matches.reduce((groups, match) => {
    groups.set(match.ruleId, (groups.get(match.ruleId) || 0) + 1);
    return groups;
  }, new Map()));
  return {
    matchesByRule,
    unrecognizedActivities: schedule.activities
      .filter(activity => activity.activityType === 'unknown')
      .map(activity => activity.rawActivity)
  };
}

test('JES v1 erkennt alle im Paket enthaltenen Tätigkeiten und erzeugt Warnungen datengetrieben', async () => {
  const rules = await loadRulePackage();
  const schedule = applyRuleGroups(await buildJesSchedule(), rules);
  const statistics = createRuleStatistics(schedule);
  const knownRawActivities = [
    'Vorbereitungszeit JES', 'Vorbereitungszeit JES 5 min',
    'Nachbereitungszeit JES', 'Nachbereitungszeit JES 5',
    'Dienst', 'Pause', 'Pause (bezahlt)', 'Wegezeit'
  ];

  assert.ok(schedule.activities.some(activity => activity.activityType === 'preparation'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'postprocessing'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'serviceDrive'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'walkingTime'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'paidBreak'));
  assert.ok(schedule.activities.some(activity => activity.activityType === 'unpaidBreak'));
  assert.ok(schedule.activities.filter(activity => activity.rawActivity.trim().startsWith('Pause')).every(activity => activity.interruptionKind === 'break'));
  assert.ok(schedule.warnings.some(warning => warning.ruleId === 'jes-warning-missing-departure-time'));
  assert.ok(schedule.warnings.some(warning => warning.ruleId === 'jes-warning-unknown-activity'));
  assert.ok(schedule.activities.filter(activity => knownRawActivities.includes(activity.rawActivity.trim())).every(activity => activity.activityType !== 'unknown'));
  assert.ok(statistics.matchesByRule['jes-activity-service-drive'] > 0);
  assert.ok(statistics.unrecognizedActivities.length > 0, 'leere oder getrennte PDF-Fragmente bleiben nachvollziehbar unknown');
});

test('JES v1-Regeldateien sind reine Regeldaten und enthalten keine BEU-Inhalte', async () => {
  for (const name of ['activities.json', 'interruptions.json', 'warnings.json']) {
    const content = await readFile(new URL(name, ruleDirectory), 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(Array.isArray(parsed.rules));
    assert.doesNotMatch(content, /\bfunction\b|\bif\s*\(/);
    assert.doesNotMatch(content, /\bBEU\b/i);
  }
});
