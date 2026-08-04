export const CHECK_CATEGORIES = Object.freeze(['BV', 'ARBZG', 'FPERSV', 'INTERNAL', 'WAGENKARTE', 'CUSTOM']);
export const CHECK_SEVERITIES = Object.freeze(['INFO', 'WARNING', 'ERROR', 'VIOLATION']);
export const CHECK_STATUSES = Object.freeze(['PASS', 'FAIL', 'SKIP', 'NOT_APPLICABLE']);

/**
 * Runs independent CheckModules against an AnalysisResult. The runner knows
 * only this technical interface, never the meaning of a category or check.
 */
export async function runCheckModules(analysisResult, modules = [], options = {}) {
  assertAnalysisResult(analysisResult);
  const startedAt = performance.now();
  const normalizedOptions = normalizeOptions(options);
  const report = {
    type: 'CheckReport',
    analysisMetadata: structuredClone(analysisResult.metadata || {}),
    results: [],
    errors: [],
    disabledModules: [],
    moduleRuns: [],
    summary: null,
    metadata: {
      schemaVersion: '1.0',
      categories: normalizedOptions.categories ? [...normalizedOptions.categories] : null
    }
  };

  const orderedModules = normalizeModules(modules);
  for (const module of orderedModules) {
    const disableReason = getDisableReason(module, normalizedOptions);
    if (disableReason) {
      report.disabledModules.push(moduleDescriptor(module, disableReason));
      continue;
    }
    await runModule(analysisResult, module, report);
  }

  const totalDurationMs = Number((performance.now() - startedAt).toFixed(3));
  report.summary = {
    moduleCount: orderedModules.length,
    executedModuleCount: report.moduleRuns.length,
    resultCount: report.results.length,
    hitCount: report.results.filter(result => result.status === 'FAIL').length,
    errorCount: report.errors.length,
    disabledModuleCount: report.disabledModules.length,
    totalDurationMs
  };
  report.metadata.totalDurationMs = totalDurationMs;
  return report;
}

export function toCheckReportDebugJson(checkReport, spacing = 2) {
  if (checkReport?.type !== 'CheckReport') throw new TypeError('Expected a CheckReport.');
  return JSON.stringify(checkReport, null, spacing);
}

function normalizeModules(modules) {
  if (!Array.isArray(modules)) throw new TypeError('CheckRunner expects an array of CheckModules.');
  const ids = new Set();
  return modules.map((module, index) => {
    assertCheckModule(module);
    if (ids.has(module.id)) throw new TypeError(`Duplicate CheckModule id: ${module.id}`);
    ids.add(module.id);
    return { ...module, priority: Number.isFinite(module.priority) ? module.priority : 0, sourceIndex: index };
  }).sort((left, right) => right.priority - left.priority || left.sourceIndex - right.sourceIndex);
}

async function runModule(analysisResult, module, report) {
  const startedAt = performance.now();
  try {
    const rawResults = await module.run(analysisResult);
    const results = (Array.isArray(rawResults) ? rawResults : [rawResults]).filter(result => result != null);
    results.forEach(result => report.results.push(normalizeCheckResult(result, module)));
    report.moduleRuns.push({
      ...moduleDescriptor(module),
      durationMs: elapsed(startedAt),
      resultCount: results.length,
      status: 'COMPLETED'
    });
  } catch (error) {
    report.errors.push({
      module: moduleDescriptor(module),
      message: error instanceof Error ? error.message : String(error),
      durationMs: elapsed(startedAt)
    });
    report.moduleRuns.push({
      ...moduleDescriptor(module),
      durationMs: elapsed(startedAt),
      resultCount: 0,
      status: 'ERROR'
    });
  }
}

function normalizeCheckResult(result, module) {
  if (!result || typeof result !== 'object') throw new TypeError(`CheckModule ${module.id} returned no CheckResult.`);
  const normalized = {
    id: result.id,
    name: result.name,
    category: result.category ?? module.category,
    severity: result.severity,
    status: result.status,
    message: result.message,
    details: result.details ?? null,
    affectedServices: result.affectedServices ?? [],
    affectedActivities: result.affectedActivities ?? [],
    sourceReferences: result.sourceReferences ?? []
  };
  for (const field of ['id', 'name', 'category', 'severity', 'status', 'message']) {
    if (typeof normalized[field] !== 'string' || !normalized[field]) {
      throw new TypeError(`Invalid CheckResult field "${field}" from module ${module.id}.`);
    }
  }
  if (!CHECK_CATEGORIES.includes(normalized.category)) throw new TypeError(`Unsupported CheckResult category: ${normalized.category}`);
  if (!CHECK_SEVERITIES.includes(normalized.severity)) throw new TypeError(`Unsupported CheckResult severity: ${normalized.severity}`);
  if (!CHECK_STATUSES.includes(normalized.status)) throw new TypeError(`Unsupported CheckResult status: ${normalized.status}`);
  for (const field of ['affectedServices', 'affectedActivities', 'sourceReferences']) {
    if (!Array.isArray(normalized[field])) throw new TypeError(`CheckResult.${field} must be an array.`);
  }
  return normalized;
}

function getDisableReason(module, options) {
  if (module.enabled === false) return 'module-disabled';
  if (options.disabledModuleIds.has(module.id)) return 'disabled-by-option';
  if (options.enabledModuleIds && !options.enabledModuleIds.has(module.id)) return 'not-enabled-by-option';
  if (options.categories && !options.categories.has(module.category)) return 'category-filtered';
  return null;
}

function normalizeOptions(options) {
  const categories = options.categories == null ? null : new Set(options.categories);
  if (categories) categories.forEach(category => {
    if (!CHECK_CATEGORIES.includes(category)) throw new TypeError(`Unsupported check category filter: ${category}`);
  });
  return {
    categories,
    disabledModuleIds: new Set(options.disabledModuleIds || []),
    enabledModuleIds: options.enabledModuleIds == null ? null : new Set(options.enabledModuleIds)
  };
}

function assertCheckModule(module) {
  if (!module || typeof module !== 'object') throw new TypeError('CheckModule must be an object.');
  for (const field of ['id', 'name', 'category']) {
    if (typeof module[field] !== 'string' || !module[field]) throw new TypeError(`CheckModule requires a string ${field}.`);
  }
  if (!CHECK_CATEGORIES.includes(module.category)) throw new TypeError(`Unsupported CheckModule category: ${module.category}`);
  if (typeof module.run !== 'function') throw new TypeError(`CheckModule ${module.id} requires run(analysisResult).`);
}

function assertAnalysisResult(value) {
  if (value?.type !== 'AnalysisResult') throw new TypeError('CheckRunner accepts only an AnalysisResult.');
}

function moduleDescriptor(module, reason = null) {
  return {
    id: module.id,
    name: module.name,
    category: module.category,
    priority: module.priority,
    ...(reason ? { reason } : {})
  };
}

function elapsed(startedAt) {
  return Number((performance.now() - startedAt).toFixed(3));
}
