import { assertInputs, durationMinutes, result, sourceReferences } from './bv-check-helpers.js';

const DEPOT = 'DEPOT';

/**
 * § 3 Abs. 1. The check evaluates only activities whose depot classification
 * and fueling flag are explicitly supplied by ReferenceDataContext.
 */
export function createBv001Check({ canonicalSchedule, referenceDataContext } = {}) {
  return {
    id: 'bv001', name: 'BV001 Vor-/Nachbereitungszeit am Betriebshof', category: 'BV', priority: 310,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const reference = resolveBv001ReferenceData(referenceDataContext);
      if (!reference.available) {
        return result('BV001', 'Vor-/Nachbereitungszeit am Betriebshof', 'BV', 'INFO', 'NOT_APPLICABLE', reference.reason, reference.details);
      }
      const assessment = collectDepotActivities(canonicalSchedule.services, reference.locationIndex);
      if (assessment.unmapped.length) {
        return result('BV001', 'Vor-/Nachbereitungszeit am Betriebshof', 'BV', 'INFO', 'NOT_APPLICABLE', 'Mindestens eine Vor- oder Nachbereitungsaktivität kann keinem Ortsstamm-Eintrag zugeordnet werden.', { unmappedActivityIds: assessment.unmapped.map(activity => activity.id) }, [...new Set(assessment.unmapped.map(activity => activity.serviceId))], assessment.unmapped.map(activity => activity.id), sourceReferences(assessment.unmapped));
      }
      if (!assessment.activities.length) {
        return result('BV001', 'Vor-/Nachbereitungszeit am Betriebshof', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine Vor- oder Nachbereitungsaktivität an einem als Betriebshof klassifizierten Ort vorhanden.');
      }
      const missingTimes = assessment.activities.filter(({ activity }) => durationMinutes(activity) === null);
      if (missingTimes.length) {
        return result('BV001', 'Vor-/Nachbereitungszeit am Betriebshof', 'BV', 'ERROR', 'SKIP', 'Mindestens eine relevante Vor- oder Nachbereitungsaktivität hat keine vollständigen Zeitwerte.', {}, [...new Set(missingTimes.map(({ activity }) => activity.serviceId))], missingTimes.map(({ activity }) => activity.id), sourceReferences(missingTimes.map(({ activity }) => activity)));
      }
      const violations = assessment.activities.filter(({ activity, kind }) => durationMinutes(activity) !== expectedMinutes(activity, kind, reference.fuelingServiceIds));
      return violations.length
        ? result('BV001', 'Vor-/Nachbereitungszeit am Betriebshof', 'BV', 'VIOLATION', 'FAIL', 'Eine Vor- oder Nachbereitungszeit am Betriebshof entspricht nicht der explizit referenzierten Sollzeit.', { violations: violations.map(({ activity, kind }) => ({ serviceNumber: activity.serviceNumber, activityId: activity.id, kind, actualMinutes: durationMinutes(activity), expectedMinutes: expectedMinutes(activity, kind, reference.fuelingServiceIds) })) }, [...new Set(violations.map(({ activity }) => activity.serviceId))], violations.map(({ activity }) => activity.id), sourceReferences(violations.map(({ activity }) => activity)))
        : result('BV001', 'Vor-/Nachbereitungszeit am Betriebshof', 'BV', 'INFO', 'PASS', 'Alle referenzierbaren Vor- und Nachbereitungszeiten am Betriebshof entsprechen der Sollzeit.', { preparationMinutes: 10, postprocessingMinutes: 10, fueledPostprocessingMinutes: 20 });
    }
  };
}

function resolveBv001ReferenceData(context) {
  const catalog = resolveLocationCatalog(context);
  if (!catalog.available) return catalog;
  if (!hasContextArea(context, 'PLAN_METADATA')) {
    return unavailable('Planmetadaten mit explizitem fuelingServiceIds-Feld fehlen.', { requiredAreas: ['LOCATION_CATALOG', 'PLAN_METADATA'] });
  }
  let metadata;
  try {
    metadata = context.get('PLAN_METADATA');
  } catch {
    return unavailable('Planmetadaten können nicht über den ReferenceDataContext gelesen werden.', { requiredAreas: ['PLAN_METADATA'] });
  }
  if (!Array.isArray(metadata?.fuelingServiceIds) || !metadata.fuelingServiceIds.every(value => typeof value === 'string' || typeof value === 'number')) {
    return unavailable('Planmetadaten benötigen ein explizites Array fuelingServiceIds; ein Betankungszuschlag wird nicht geschätzt.', { requiredField: 'PLAN_METADATA.fuelingServiceIds' });
  }
  return { available: true, locationIndex: catalog.locationIndex, fuelingServiceIds: new Set(metadata.fuelingServiceIds.map(String)) };
}

function collectDepotActivities(services, locationIndex) {
  const activities = [];
  const unmapped = [];
  for (const service of services) {
    for (const activity of service.activities || []) {
      const kind = activity.activityType === 'preparation' ? 'preparation'
        : activity.activityType === 'postprocessing' ? 'postprocessing' : null;
      if (!kind) continue;
      const location = kind === 'preparation' ? activity.departureLocation : activity.arrivalLocation;
      const classification = locationIndex.get(normalizeLocation(location));
      if (!classification) {
        unmapped.push(activity);
      } else if (classification === DEPOT) {
        activities.push({ activity, kind });
      }
    }
  }
  return { activities, unmapped };
}

function expectedMinutes(activity, kind, fuelingServiceIds) {
  return kind === 'postprocessing' && (fuelingServiceIds.has(String(activity.serviceId)) || fuelingServiceIds.has(String(activity.serviceNumber))) ? 20 : 10;
}

function resolveLocationCatalog(context) {
  if (!hasContextArea(context, 'LOCATION_CATALOG')) {
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
    if (!location || typeof location.name !== 'string' || ![DEPOT, 'ROUTE'].includes(location.classification)) {
      return unavailable('Ortsstamm enthält keinen gültigen name/classification-Eintrag.', { requiredField: 'LOCATION_CATALOG.locations[].classification' });
    }
    const names = [location.name, ...(Array.isArray(location.aliases) ? location.aliases : [])];
    for (const name of names) {
      if (typeof name !== 'string' || !normalizeLocation(name) || locationIndex.has(normalizeLocation(name))) {
        return unavailable('Ortsstamm enthält leere oder mehrdeutige Ortsnamen bzw. Aliase.', { requiredField: 'LOCATION_CATALOG.locations[].aliases' });
      }
      locationIndex.set(normalizeLocation(name), location.classification);
    }
  }
  return { available: true, locationIndex };
}

function hasContextArea(context, area) {
  return context?.type === 'ReferenceDataContext' && typeof context.has === 'function' && typeof context.get === 'function' && context.has(area);
}

function unavailable(reason, details = {}) {
  return { available: false, reason, details };
}

function normalizeLocation(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}
