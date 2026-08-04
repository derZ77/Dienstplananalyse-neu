export const REFERENCE_DATA_AREAS = Object.freeze([
  'PLAN_METADATA',
  'LOCATION_CATALOG',
  'TRAVEL_TIMES',
  'EXCEPTION_APPROVALS',
  'ROTATION_DATA',
  'PERSONNEL_DATA',
  'BV_APPENDICES',
  'WAGENKARTE'
]);

export const REFERENCE_DATA_SCHEMA_VERSION = '1.0';

/**
 * Validates generic reference-data envelopes only. Area-specific rules belong
 * to later data providers or check modules, never to this infrastructure.
 */
export function validateReferenceDataSources(sources, options = {}) {
  const hasValidSourceSet = Array.isArray(sources);
  const values = hasValidSourceSet ? sources : [];
  const requiredAreas = normalizeRequiredAreas(options.requiredAreas);
  const sourceReports = values.map((source, index) => validateReferenceDataSource(source, index));
  const errors = sourceReports.flatMap(report => report.errors);
  const warnings = sourceReports.flatMap(report => report.warnings);
  if (!hasValidSourceSet) errors.push(issue('INVALID_SOURCE_SET', 'Referenzdaten müssen als Array übergeben werden.', 'sources'));
  const ids = new Map();
  const activeAreas = new Map();

  sourceReports.forEach((report, index) => {
    if (report.id && ids.has(report.id)) {
      errors.push(issue('DUPLICATE_ID', `Referenzdaten-ID ist nicht eindeutig: ${report.id}`, report.id));
    } else if (report.id) {
      ids.set(report.id, index);
    }
    if (!report.valid) return;
    if (report.active) {
      const entries = activeAreas.get(report.area) || [];
      entries.push(report.id);
      activeAreas.set(report.area, entries);
    }
  });

  for (const [area, idsForArea] of activeAreas) {
    if (idsForArea.length > 1) {
      errors.push(issue('AMBIGUOUS_ACTIVE_SOURCE', `Mehrere aktive Datenquellen für ${area}: ${idsForArea.join(', ')}`, area));
    }
  }

  const availableAreas = [...activeAreas.keys()];
  const missingAreas = REFERENCE_DATA_AREAS.filter(area => !availableAreas.includes(area));
  const requiredMissingAreas = requiredAreas.filter(area => !availableAreas.includes(area));
  requiredMissingAreas.forEach(area => errors.push(issue('REQUIRED_AREA_MISSING', `Erforderliche Referenzdaten fehlen: ${area}`, area)));

  return {
    type: 'ReferenceDataValidationReport',
    schemaVersion: REFERENCE_DATA_SCHEMA_VERSION,
    valid: errors.length === 0,
    sourceReports,
    availableAreas,
    missingAreas,
    requiredMissingAreas,
    versions: sourceReports.filter(report => report.valid).map(report => ({ id: report.id, area: report.area, version: report.version, schemaVersion: report.schemaVersion })),
    warnings,
    errors
  };
}

export function validateReferenceDataSource(source, index = 0) {
  const errors = [];
  const warnings = [];
  const value = isPlainObject(source) ? source : {};
  const id = value.id;
  const area = value.area;
  const version = value.version;
  const schemaVersion = value.schemaVersion;
  const active = value.active !== false;

  if (!isPlainObject(source)) errors.push(issue('INVALID_SOURCE', `Datenquelle ${index} muss ein Objekt sein.`, String(index)));
  if (value.type !== 'ReferenceDataSource') errors.push(issue('INVALID_TYPE', 'type muss ReferenceDataSource sein.', String(id || index)));
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9:._-]*$/i.test(id)) errors.push(issue('INVALID_ID', 'id muss eine eindeutige, technische Kennung sein.', String(id || index)));
  if (!REFERENCE_DATA_AREAS.includes(area)) errors.push(issue('INVALID_AREA', `Nicht unterstützter Referenzdatenbereich: ${String(area)}`, String(id || index)));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) errors.push(issue('INVALID_VERSION', 'version muss semantisch versioniert sein, z. B. 1.0.0.', String(id || index)));
  if (schemaVersion !== REFERENCE_DATA_SCHEMA_VERSION) errors.push(issue('INVALID_SCHEMA_VERSION', `schemaVersion muss ${REFERENCE_DATA_SCHEMA_VERSION} sein.`, String(id || index)));
  if (typeof value.optional !== 'boolean') errors.push(issue('INVALID_OPTIONAL_FLAG', 'optional muss explizit true oder false sein.', String(id || index)));
  if (!Object.hasOwn(value, 'data') || value.data == null || (typeof value.data !== 'object')) errors.push(issue('INVALID_DATA', 'data muss ein Array oder Objekt sein.', String(id || index)));
  if (Object.hasOwn(value, 'active') && typeof value.active !== 'boolean') errors.push(issue('INVALID_ACTIVE_FLAG', 'active muss true oder false sein, falls angegeben.', String(id || index)));
  if (value.optional === false && active === false) warnings.push(issue('INACTIVE_REQUIRED_SOURCE', 'Eine nicht optionale Datenquelle ist inaktiv.', String(id || index)));

  return {
    index,
    id: typeof id === 'string' ? id : null,
    area: REFERENCE_DATA_AREAS.includes(area) ? area : null,
    version: typeof version === 'string' ? version : null,
    schemaVersion: typeof schemaVersion === 'string' ? schemaVersion : null,
    optional: value.optional === true,
    active,
    valid: errors.length === 0,
    warnings,
    errors
  };
}

export function toReferenceDataReportDebugJson(report, spacing = 2) {
  if (report?.type !== 'ReferenceDataValidationReport' && report?.type !== 'ReferenceDataReport') {
    throw new TypeError('Expected a ReferenceDataValidationReport or ReferenceDataReport.');
  }
  return JSON.stringify(report, null, spacing);
}

function normalizeRequiredAreas(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('requiredAreas must be an array.');
  value.forEach(area => {
    if (!REFERENCE_DATA_AREAS.includes(area)) throw new TypeError(`Unsupported required reference-data area: ${area}`);
  });
  return [...new Set(value)];
}

function issue(code, message, target) {
  return { code, message, target };
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
