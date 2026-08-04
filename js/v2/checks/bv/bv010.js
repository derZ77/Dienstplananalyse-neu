import { assertInputs, durationMinutes, result, sourceReferences } from './bv-check-helpers.js';

/** § 4 Abs. 1: evaluates only explicitly classified unpaid-break activities. */
export function createBv010Check({ canonicalSchedule } = {}) {
  return {
    id: 'bv010', name: 'BV010 Blockpause 30 Minuten', category: 'BV', priority: 270,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const pauses = canonicalSchedule.activities.filter(activity => activity.activityType === 'unpaidBreak');
      if (!pauses.length) return result('BV010', 'Blockpause 30 Minuten', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine ausdrücklich klassifizierte unbezahlte Pause vorhanden.');
      const unknown = pauses.filter(activity => durationMinutes(activity) === null);
      if (unknown.length) return result('BV010', 'Blockpause 30 Minuten', 'BV', 'ERROR', 'SKIP', 'Mindestens eine unbezahlte Pause hat keine vollständigen Zeitwerte.', {}, [], unknown.map(activity => activity.id), sourceReferences(unknown));
      const violations = pauses.filter(activity => durationMinutes(activity) < 30);
      return violations.length
        ? result('BV010', 'Blockpause 30 Minuten', 'BV', 'VIOLATION', 'FAIL', 'Mindestens eine ausdrücklich unbezahlte Pause ist kürzer als 30 Minuten.', { minimumMinutes: 30 }, [...new Set(violations.map(activity => activity.serviceId))], violations.map(activity => activity.id), sourceReferences(violations))
        : result('BV010', 'Blockpause 30 Minuten', 'BV', 'INFO', 'PASS', 'Alle ausdrücklich unbezahlten Pausen dauern mindestens 30 Minuten.', { minimumMinutes: 30 });
    }
  };
}
