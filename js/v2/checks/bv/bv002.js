import { assertInputs, durationMinutes, result, sourceReferences } from './bv-check-helpers.js';

const ROUTE = 'ROUTE';

/**
 * § 3 Abs. 2. It uses only explicit route classifications from the shared
 * ReferenceDataContext; unmapped locations are never assumed to be route.
 */
export function createBv002Check({ canonicalSchedule, referenceDataContext } = {}) {
  return {
    id: 'bv002', name: 'BV002 Vor-/Nachbereitungszeit auf der Strecke', category: 'BV', priority: 305,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const catalog = resolveLocationCatalog(referenceDataContext);
      if (!catalog.available) return result('BV002', 'Vor-/Nachbereitungszeit auf der Strecke', 'BV', 'INFO', 'NOT_APPLICABLE', catalog.reason, catalog.details);
      const assessment = collectRouteActivities(canonicalSchedule.services, catalog.locationIndex);
      if (assessment.unmapped.length) {
        return result('BV002', 'Vor-/Nachbereitungszeit auf der Strecke', 'BV', 'INFO', 'NOT_APPLICABLE', 'Mindestens eine Vor- oder Nachbereitungsaktivität kann keinem Ortsstamm-Eintrag zugeordnet werden.', { unmappedActivityIds: assessment.unmapped.map(activity => activity.id) }, [...new Set(assessment.unmapped.map(activity => activity.serviceId))], assessment.unmapped.map(activity => activity.id), sourceReferences(assessment.unmapped));
      }
      if (!assessment.activities.length) return result('BV002', 'Vor-/Nachbereitungszeit auf der Strecke', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine Vor- oder Nachbereitungsaktivität an einem als Strecke klassifizierten Ort vorhanden.');
      const missingTimes = assessment.activities.filter(({ activity }) => durationMinutes(activity) === null);
      if (missingTimes.length) return result('BV002', 'Vor-/Nachbereitungszeit auf der Strecke', 'BV', 'ERROR', 'SKIP', 'Mindestens eine relevante Vor- oder Nachbereitungsaktivität hat keine vollständigen Zeitwerte.', {}, [...new Set(missingTimes.map(({ activity }) => activity.serviceId))], missingTimes.map(({ activity }) => activity.id), sourceReferences(missingTimes.map(({ activity }) => activity)));
      const violations = assessment.activities.filter(({ activity }) => durationMinutes(activity) !== 5);
      return violations.length
        ? result('BV002', 'Vor-/Nachbereitungszeit auf der Strecke', 'BV', 'VIOLATION', 'FAIL', 'Eine Vor- oder Nachbereitungszeit auf der Strecke entspricht nicht der Sollzeit von 5 Minuten.', { violations: violations.map(({ activity, kind }) => ({ serviceNumber: activity.serviceNumber, activityId: activity.id, kind, actualMinutes: durationMinutes(activity), expectedMinutes: 5 })) }, [...new Set(violations.map(({ activity }) => activity.serviceId))], violations.map(({ activity }) => activity.id), sourceReferences(violations.map(({ activity }) => activity)))
        : result('BV002', 'Vor-/Nachbereitungszeit auf der Strecke', 'BV', 'INFO', 'PASS', 'Alle referenzierbaren Vor- und Nachbereitungszeiten auf der Strecke entsprechen 5 Minuten.', { expectedMinutes: 5 });
    }
  };
}

function collectRouteActivities(services, locationIndex) {
  const activities = [];
  const unmapped = [];
  for (const service of services) {
    for (const activity of service.activities || []) {
      const kind = activity.activityType === 'preparation' ? 'preparation'
        : activity.activityType === 'postprocessing' ? 'postprocessing' : null;
      if (!kind) continue;
      const location = kind === 'preparation' ? activity.departureLocation : activity.arrivalLocation;
      const classification = locationIndex.get(normalizeLocation(location));
      if (!classification) unmapped.push(activity);
      else if (classification === ROUTE) activities.push({ activity, kind });
    }
  }
  return { activities, unmapped };
}

function resolveLocationCatalog(context) {
  if (context?.type !== 'ReferenceDataContext' || typeof context.has !== 'function' || typeof context.get !== 'function' || !context.has('LOCATION_CATALOG')) {
    return unavailable('Ortsstamm LOCATION_CATALOG fehlt im ReferenceDataContext.', { requiredAreas: ['LOCATION_CATALOG'] });
  }
  let data;
  try {
    data = context.get('LOCATION_CATALOG');
  } catch {
    return unavailable('Ortsstamm kann nicht über den ReferenceDataContext gelesen werden.', { requiredAreas: ['LOCATION_CATALOG'] });
  }
  if (!Array.isArray(data?.locations)) return unavailable('Ortsstamm benötigt ein locations-Array.', { requiredField: 'LOCATION_CATALOG.locations' });
  const locationIndex = new Map();
  for (const location of data.locations) {
    if (!location || typeof location.name !== 'string' || !['DEPOT', ROUTE].includes(location.classification)) {
      return unavailable('Ortsstamm enthält keinen gültigen name/classification-Eintrag.', { requiredField: 'LOCATION_CATALOG.locations[].classification' });
    }
    const names = [location.name, ...(Array.isArray(location.aliases) ? location.aliases : [])];
    for (const name of names) {
      const normalized = normalizeLocation(name);
      if (typeof name !== 'string' || !normalized || locationIndex.has(normalized)) {
        return unavailable('Ortsstamm enthält leere oder mehrdeutige Ortsnamen bzw. Aliase.', { requiredField: 'LOCATION_CATALOG.locations[].aliases' });
      }
      locationIndex.set(normalized, location.classification);
    }
  }
  return { available: true, locationIndex };
}

function unavailable(reason, details = {}) {
  return { available: false, reason, details };
}

function normalizeLocation(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}
