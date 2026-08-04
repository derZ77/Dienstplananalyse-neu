/**
 * Small, dependency-free rule-configuration validator (Phase 2). Validates the
 * JSON parameter envelope and parameter leaves. It enforces the parameter/algorithm
 * boundary: configuration may contain values only, NEVER executable code. No
 * external schema framework is used (offline / CSP / no new dependency).
 */

export const RULE_SET_STATUSES = Object.freeze(['draft', 'reviewed', 'approved', 'deprecated']);
export const PARAMETER_STATUSES = Object.freeze(['confirmed', 'provisional', 'open']);
export const KNOWN_ORGANIZATIONS = Object.freeze(['JES', 'JNV', 'LEGACY', 'SHARED']);
export const PARAMETER_UNITS = Object.freeze(['minutes', 'meters', 'ratio', 'weekdays', 'lines', 'flag', 'text', 'none']);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CODE_LIKE_RE = /(=>|\bfunction\b|\beval\b|\brequire\b|\bimport\b|\$\{|`)/;

function issue(code, message, path) { return { code, message, path }; }

/**
 * @returns {{valid: boolean, errors: Array<{code,message,path}>, warnings: Array<{code,message,path}>}}
 */
export function validateRuleConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: [issue('INVALID_CONFIG', 'Rule config must be an object.', '')], warnings };
  }

  // Envelope
  requireString(config, 'schemaVersion', errors);
  requireString(config, 'ruleSetId', errors);
  requireString(config, 'organization', errors);
  requireString(config, 'status', errors);
  if (config.status !== undefined && !RULE_SET_STATUSES.includes(config.status)) {
    errors.push(issue('INVALID_STATUS', `Unknown ruleSet status: ${config.status}`, 'status'));
  }
  if (config.organization !== undefined && !KNOWN_ORGANIZATIONS.includes(config.organization)) {
    errors.push(issue('UNKNOWN_ORGANIZATION', `Unknown organization: ${config.organization}`, 'organization'));
  }
  if (!('validFrom' in config) || (config.validFrom !== null && typeof config.validFrom !== 'string')) {
    errors.push(issue('INVALID_VALID_FROM', 'validFrom must be a string or null.', 'validFrom'));
  }
  if (!Array.isArray(config.sourceReferences)) {
    errors.push(issue('INVALID_SOURCE_REFERENCES', 'sourceReferences must be an array.', 'sourceReferences'));
  }
  if (!('approvedBy' in config) || (config.approvedBy !== null && typeof config.approvedBy !== 'string')) {
    errors.push(issue('INVALID_APPROVED_BY', 'approvedBy must be a string or null.', 'approvedBy'));
  }
  if (!config.parameters || typeof config.parameters !== 'object' || Array.isArray(config.parameters)) {
    errors.push(issue('INVALID_PARAMETERS', 'parameters must be an object.', 'parameters'));
  }

  // Parameter leaves
  const openParamPaths = [];
  if (config.parameters && typeof config.parameters === 'object' && !Array.isArray(config.parameters)) {
    walkParameters(config.parameters, 'parameters', errors, warnings, openParamPaths);
  }

  // Approval gate: only fully-sourced, approved-by, no-open-parameter configs may be "approved".
  if (config.status === 'approved') {
    if (!Array.isArray(config.sourceReferences) || config.sourceReferences.length === 0) {
      errors.push(issue('APPROVED_WITHOUT_SOURCE', 'An approved rule set requires at least one sourceReference.', 'sourceReferences'));
    }
    if (!config.approvedBy) {
      errors.push(issue('APPROVED_WITHOUT_APPROVER', 'An approved rule set requires approvedBy.', 'approvedBy'));
    }
    if (openParamPaths.length) {
      errors.push(issue('APPROVED_WITH_OPEN_PARAMETERS', `An approved rule set must not contain open parameters: ${openParamPaths.join(', ')}`, 'parameters'));
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function walkParameters(node, path, errors, warnings, openParamPaths) {
  for (const [key, child] of Object.entries(node)) {
    const childPath = `${path}.${key}`;
    if (child && typeof child === 'object' && !Array.isArray(child) && 'value' in child) {
      validateLeaf(child, childPath, errors, warnings, openParamPaths);
    } else if (child && typeof child === 'object' && !Array.isArray(child)) {
      walkParameters(child, childPath, errors, warnings, openParamPaths);
    } else {
      errors.push(issue('INVALID_PARAMETER_NODE', 'Each parameter must be a {value,status,...} leaf or a group object.', childPath));
    }
  }
}

function validateLeaf(leaf, path, errors, warnings, openParamPaths) {
  const status = leaf.status;
  if (status === undefined || !PARAMETER_STATUSES.includes(status)) {
    errors.push(issue('INVALID_PARAMETER_STATUS', `Parameter status must be one of ${PARAMETER_STATUSES.join('/')}.`, path));
  }
  if (leaf.unit !== undefined && !PARAMETER_UNITS.includes(leaf.unit)) {
    errors.push(issue('INVALID_PARAMETER_UNIT', `Unknown unit: ${leaf.unit}`, path));
  }

  // Executable-code guard (parameter/algorithm boundary).
  if (containsExecutableCode(leaf.value)) {
    errors.push(issue('EXECUTABLE_CODE_FORBIDDEN', 'Rule configuration must not contain executable code.', path));
  }

  if (status === 'open') {
    if (leaf.value !== null) errors.push(issue('OPEN_PARAMETER_NOT_NULL', 'An open parameter must have value null.', path));
    openParamPaths.push(path);
    return; // no further value checks for open parameters
  }

  if (leaf.format === 'time') {
    if (typeof leaf.value !== 'string' || !TIME_RE.test(leaf.value)) {
      errors.push(issue('INVALID_TIME_FORMAT', `Time value must match HH:MM: ${leaf.value}`, path));
    }
  }
  if (leaf.unit === 'minutes' || leaf.unit === 'meters') {
    if (typeof leaf.value !== 'number' || Number.isNaN(leaf.value) || leaf.value < 0) {
      errors.push(issue('INVALID_NUMERIC_BOUND', `${leaf.unit} value must be a number ≥ 0: ${leaf.value}`, path));
    }
  }
}

function containsExecutableCode(value) {
  if (typeof value === 'function') return true;
  if (typeof value === 'string') return CODE_LIKE_RE.test(value);
  if (Array.isArray(value)) return value.some(containsExecutableCode);
  return false;
}

function requireString(obj, key, errors) {
  if (typeof obj[key] !== 'string' || !obj[key]) {
    errors.push(issue('MISSING_FIELD', `Missing or invalid field: ${key}`, key));
  }
}
