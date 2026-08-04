import { assertInputs, result } from './bv-check-helpers.js';

const LIMITS = new Map([
  ['Mo–Fr Schule', 510], ['Mo–Fr Ferien', 510],
  ['Samstag', 540], ['Sonntag', 540], ['Feiertag', 540]
]);

/** § 3 Abs. 4: no exception handling; only an explicitly available plan period is used. */
export function createBv005Check({ canonicalSchedule, planMetadata = {}, legacyAnalyses = null } = {}) {
  return {
    id: 'bv005', name: 'BV005 Maximale bezahlte Arbeitszeit', category: 'BV', priority: 290,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const timeframe = planMetadata.timeframe || legacyAnalyses?.plan?.timeframe || null;
      const limitMinutes = LIMITS.get(timeframe);
      if (!limitMinutes) return result('BV005', 'Maximale bezahlte Arbeitszeit', 'BV', 'INFO', 'SKIP', 'Kein unterstützter Planzeitraum in den vorhandenen Planmetadaten.', { timeframe });
      const known = canonicalSchedule.services.filter(service => Number.isInteger(service.paidTime?.minutes));
      if (!known.length) return result('BV005', 'Maximale bezahlte Arbeitszeit', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine Dienste mit bezahlter Zeit vorhanden.', { timeframe, limitMinutes });
      const violations = known.filter(service => service.paidTime.minutes > limitMinutes);
      return violations.length
        ? result('BV005', 'Maximale bezahlte Arbeitszeit', 'BV', 'VIOLATION', 'FAIL', 'Die bezahlte Zeit überschreitet die für den vorhandenen Planzeitraum geltende Grenze.', { timeframe, limitMinutes, violations: violations.map(service => ({ serviceNumber: service.serviceNumber, paidTimeMinutes: service.paidTime.minutes })) }, violations.map(service => service.id), [], violations.map(service => service.source).filter(Boolean))
        : result('BV005', 'Maximale bezahlte Arbeitszeit', 'BV', 'INFO', 'PASS', 'Die bezahlte Zeit liegt innerhalb der für den Planzeitraum verfügbaren Grenze.', { timeframe, limitMinutes });
    }
  };
}
