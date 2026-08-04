import { createReferenceDataContext, createReferenceDataReport } from './reference-data.js';
import { validateReferenceDataSources } from './reference-data-validator.js';

/**
 * Normalizes already local reference-data envelopes, validates them and only
 * creates a context when the complete set is safe for later check access.
 * No network, storage, UI or domain-specific parsing is performed here.
 */
export function loadReferenceDataContext(rawSources = [], options = {}) {
  if (!Array.isArray(rawSources)) throw new TypeError('Reference-data loader expects an array of data sources.');
  const sources = rawSources.map(source => structuredClone(source));
  const validationReport = validateReferenceDataSources(sources, options);
  const report = createReferenceDataReport(validationReport);
  if (!validationReport.valid) {
    if (options.throwOnError) throw new TypeError(`Reference data cannot be loaded: ${validationReport.errors.map(error => error.code).join(', ')}`);
    return { context: null, report };
  }
  return { context: createReferenceDataContext(sources, options), report };
}

export function toReferenceDataContextDebugJson(context, spacing = 2) {
  if (context?.type !== 'ReferenceDataContext') throw new TypeError('Expected a ReferenceDataContext.');
  return JSON.stringify({
    type: context.type,
    schemaVersion: context.schemaVersion,
    availableData: context.listAvailableAreas(),
    report: context.getReport()
  }, null, spacing);
}
