import { assertInputs, normalized, result, sourceReferences } from './bv-check-helpers.js';

/** § 3 Abs. 3: only the direct equality of first and last location. */
export function createBv003Check({ canonicalSchedule } = {}) {
  return {
    id: 'bv003', name: 'BV003 Gleiche Anfangs- und Endorte', category: 'BV', priority: 300,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const comparable = canonicalSchedule.services.flatMap(service => {
        const activities = service.activities || [];
        const first = activities.find(activity => normalized(activity.departureLocation));
        const last = [...activities].reverse().find(activity => normalized(activity.arrivalLocation));
        return first && last ? [{ service, first, last }] : [];
      });
      if (!comparable.length) return result('BV003', 'Gleiche Anfangs- und Endorte', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine Dienste mit vollständigen Anfangs- und Endorten vorhanden.');
      const deviations = comparable.filter(({ first, last }) => normalized(first.departureLocation) !== normalized(last.arrivalLocation));
      return deviations.length
        ? result('BV003', 'Gleiche Anfangs- und Endorte', 'BV', 'WARNING', 'FAIL', 'Anfangs- und Endorte weichen bei mindestens einem Dienst ab.', { deviations: deviations.map(({ service, first, last }) => ({ serviceNumber: service.serviceNumber, start: normalized(first.departureLocation), end: normalized(last.arrivalLocation) })) }, deviations.map(({ service }) => service.id), [], sourceReferences(deviations.flatMap(({ first, last }) => [first, last])))
        : result('BV003', 'Gleiche Anfangs- und Endorte', 'BV', 'INFO', 'PASS', 'Anfangs- und Endorte sind bei allen vergleichbaren Diensten gleich.');
    }
  };
}
