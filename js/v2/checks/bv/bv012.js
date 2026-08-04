import { assertInputs, durationMinutes, result, sourceReferences } from './bv-check-helpers.js';

/** § 4 Abs. 2: checks the explicit 33-minute threshold; no deduction field is invented. */
export function createBv012Check({ canonicalSchedule } = {}) {
  return {
    id: 'bv012', name: 'BV012 Abzug und Puffer bei Blockpausen', category: 'BV', priority: 260,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const pauses = canonicalSchedule.activities.filter(activity => activity.activityType === 'unpaidBreak');
      if (!pauses.length) return result('BV012', 'Abzug und Puffer bei Blockpausen', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine ausdrücklich klassifizierte unbezahlte Pause vorhanden.');
      const unknown = pauses.filter(activity => durationMinutes(activity) === null);
      if (unknown.length) return result('BV012', 'Abzug und Puffer bei Blockpausen', 'BV', 'ERROR', 'SKIP', 'Mindestens eine unbezahlte Pause hat keine vollständigen Zeitwerte.', {}, [], unknown.map(activity => activity.id), sourceReferences(unknown));
      const violations = pauses.filter(activity => durationMinutes(activity) < 33);
      return violations.length
        ? result('BV012', 'Abzug und Puffer bei Blockpausen', 'BV', 'VIOLATION', 'FAIL', 'Eine ausdrücklich unbezahlte Pause unterschreitet den 33-Minuten-Puffer.', { minimumMinutes: 33, maximumDeductibleMinutes: 30, deductionAmountAvailable: false }, [...new Set(violations.map(activity => activity.serviceId))], violations.map(activity => activity.id), sourceReferences(violations))
        : result('BV012', 'Abzug und Puffer bei Blockpausen', 'BV', 'INFO', 'PASS', 'Alle ausdrücklich unbezahlten Pausen erfüllen den 33-Minuten-Puffer.', { minimumMinutes: 33, maximumDeductibleMinutes: 30, deductionAmountAvailable: false });
    }
  };
}
