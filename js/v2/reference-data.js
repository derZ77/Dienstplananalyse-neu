import { REFERENCE_DATA_AREAS, REFERENCE_DATA_SCHEMA_VERSION, validateReferenceDataSources } from './reference-data-validator.js';

/**
 * Builds the only access point future check modules use for reference data.
 * Values returned by the context are cloned, so checks cannot mutate shared
 * reference data or one another's view of it.
 */
export function createReferenceDataContext(sources, options = {}) {
  const validationReport = validateReferenceDataSources(sources, options);
  if (!validationReport.valid) {
    throw new TypeError(`Reference data is invalid: ${validationReport.errors.map(error => error.code).join(', ')}`);
  }
  const activeSourcesByArea = new Map();
  for (const source of sources) {
    if (source.active !== false) activeSourcesByArea.set(source.area, structuredClone(source));
  }

  const context = {
    type: 'ReferenceDataContext',
    schemaVersion: REFERENCE_DATA_SCHEMA_VERSION,
    has(area) {
      assertArea(area);
      return activeSourcesByArea.has(area);
    },
    get(area) {
      assertArea(area);
      const source = activeSourcesByArea.get(area);
      return source ? structuredClone(source.data) : null;
    },
    getSource(area) {
      assertArea(area);
      const source = activeSourcesByArea.get(area);
      return source ? structuredClone(source) : null;
    },
    getVersion(area) {
      assertArea(area);
      return activeSourcesByArea.get(area)?.version ?? null;
    },
    listAvailableAreas() {
      return REFERENCE_DATA_AREAS.filter(area => activeSourcesByArea.has(area));
    },
    getReport() {
      return structuredClone(createReferenceDataReport(validationReport));
    }
  };
  return Object.freeze(context);
}

export function createReferenceDataReport(validationReport) {
  if (validationReport?.type !== 'ReferenceDataValidationReport') {
    throw new TypeError('ReferenceDataReport requires a ReferenceDataValidationReport.');
  }
  return {
    type: 'ReferenceDataReport',
    schemaVersion: REFERENCE_DATA_SCHEMA_VERSION,
    valid: validationReport.valid,
    availableData: validationReport.availableAreas,
    missingData: validationReport.missingAreas,
    requiredMissingData: validationReport.requiredMissingAreas,
    versions: validationReport.versions,
    warnings: validationReport.warnings,
    errors: validationReport.errors
  };
}

function assertArea(area) {
  if (!REFERENCE_DATA_AREAS.includes(area)) throw new TypeError(`Unsupported reference-data area: ${area}`);
}
