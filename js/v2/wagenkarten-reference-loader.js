import { validateWagenkartenReferenceSource } from './wagenkarten-reference-validator.js';

/**
 * Accepts a local Wagenkarten ReferenceDataSource envelope and preserves its
 * observed records. It performs no timing aggregation or Lenkzeit calculation.
 */
export function loadWagenkartenReferenceSource(rawSource, options = {}) {
  const source = structuredClone(rawSource);
  const report = validateWagenkartenReferenceSource(source);
  if (!report.valid) {
    if (options.throwOnError) throw new TypeError(`Wagenkarten reference data cannot be loaded: ${report.errors.map(error => error.code).join(', ')}`);
    return { source: null, report };
  }
  return { source, report };
}
