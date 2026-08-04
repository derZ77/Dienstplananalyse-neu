import { assertInputs, normalized, result, sourceReferences } from './bv-check-helpers.js';

/** § 4 Abs. 4: data-level proof that an unpaid break remains explicitly represented. */
export function createBv014Check({ canonicalSchedule } = {}) {
  return {
    id: 'bv014', name: 'BV014 Ausweis unbezahlter Pausen', category: 'BV', priority: 250,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const pauses = canonicalSchedule.activities.filter(activity => activity.activityType === 'unpaidBreak');
      if (!pauses.length) return result('BV014', 'Ausweis unbezahlter Pausen', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine ausdrücklich klassifizierte unbezahlte Pause vorhanden.');
      const missingRepresentation = pauses.filter(activity => !normalized(activity.rawActivity) || !activity.source);
      return missingRepresentation.length
        ? result('BV014', 'Ausweis unbezahlter Pausen', 'BV', 'ERROR', 'FAIL', 'Mindestens eine unbezahlte Pause besitzt keinen ausweisbaren Rohtext oder Quellenbezug.', {}, [...new Set(missingRepresentation.map(activity => activity.serviceId))], missingRepresentation.map(activity => activity.id), sourceReferences(missingRepresentation))
        : result('BV014', 'Ausweis unbezahlter Pausen', 'BV', 'INFO', 'PASS', 'Alle klassifizierten unbezahlten Pausen besitzen Rohtext und Quellenbezug.', {}, [...new Set(pauses.map(activity => activity.serviceId))], pauses.map(activity => activity.id), sourceReferences(pauses));
    }
  };
}
