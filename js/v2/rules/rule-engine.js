const MATCH_OPERATORS = Object.freeze({
  exact: (value, expected, ignoreCase) => compare(value, expected, ignoreCase) === 0,
  contains: (value, expected, ignoreCase) => normalize(value, ignoreCase).includes(normalize(expected, ignoreCase)),
  prefix: (value, expected, ignoreCase) => normalize(value, ignoreCase).startsWith(normalize(expected, ignoreCase)),
  suffix: (value, expected, ignoreCase) => normalize(value, ignoreCase).endsWith(normalize(expected, ignoreCase)),
  regex: (value, expected, ignoreCase, match) => createRegex(expected, ignoreCase, match.flags).test(String(value ?? ''))
});

/**
 * Applies data-only rule groups to a CanonicalSchedule. The engine has no
 * document-profile knowledge and makes no activity-specific decisions.
 */
export function applyRuleGroups(canonicalSchedule, ruleGroups = []) {
  if (canonicalSchedule?.type !== 'CanonicalSchedule') {
    throw new TypeError('Expected a CanonicalSchedule.');
  }

  const schedule = structuredClone(canonicalSchedule);
  const warnings = [...schedule.warnings];
  const matches = [];
  const groups = normalizeGroups(ruleGroups);

  for (const group of groups) {
    for (const rule of orderedRules(group)) {
      for (const target of selectTargets(schedule, rule.target)) {
        if (!matchesRule(target.value, rule.match)) continue;
        const match = {
          ruleId: rule.id,
          ruleGroupId: group.id,
          targetType: target.type,
          targetId: target.value.id || null,
          priority: rule.priority || 0,
          source: target.value.source || null
        };
        matches.push(match);
        applyAction(target.value, rule.action, match, warnings);
      }
    }
  }

  schedule.warnings = warnings;
  schedule.metadata = {
    ...schedule.metadata,
    ruleEngine: {
      appliedGroupIds: groups.map(group => group.id),
      matchCount: matches.length,
      warningCount: warnings.length,
      matches
    }
  };
  return schedule;
}

function normalizeGroups(ruleGroups) {
  const groups = Array.isArray(ruleGroups) ? ruleGroups : [ruleGroups];
  return groups
    .filter(Boolean)
    .map((group, index) => ({
      id: group.id || `rule-group-${index + 1}`,
      priority: group.priority || 0,
      rules: Array.isArray(group.rules) ? group.rules : []
    }))
    .sort((left, right) => right.priority - left.priority);
}

function orderedRules(group) {
  return group.rules
    .map((rule, index) => ({ ...rule, priority: rule.priority || 0, sourceIndex: index }))
    .sort((left, right) => right.priority - left.priority || left.sourceIndex - right.sourceIndex);
}

function selectTargets(schedule, targetType = 'activities') {
  const collections = {
    activities: schedule.activities,
    services: schedule.services,
    interruptions: schedule.interruptions
  };
  if (!collections[targetType]) throw new TypeError(`Unsupported rule target: ${targetType}`);
  return collections[targetType].map(value => ({ type: targetType, value }));
}

function matchesRule(target, match = {}) {
  const operator = MATCH_OPERATORS[match.operator];
  if (!operator) throw new TypeError(`Unsupported match operator: ${match.operator}`);
  return operator(readPath(target, match.field), match.value, Boolean(match.ignoreCase), match);
}

function applyAction(target, action = {}, match, warnings) {
  if (action.type === 'annotate') {
    target.ruleAnnotations ||= [];
    target.ruleAnnotations.push({ ruleId: match.ruleId, ruleGroupId: match.ruleGroupId, value: action.value ?? null });
    return;
  }
  if (action.type === 'warning') {
    warnings.push({
      id: `warning:${match.ruleGroupId}:${match.ruleId}:${match.targetId ?? match.targetType}`,
      ruleId: match.ruleId,
      ruleGroupId: match.ruleGroupId,
      targetType: match.targetType,
      targetId: match.targetId,
      message: action.message || '',
      source: match.source
    });
    return;
  }
  if (action.type === 'set') {
    writePath(target, action.path, action.value);
    return;
  }
  throw new TypeError(`Unsupported rule action: ${action.type}`);
}

function readPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function writePath(value, path, nextValue) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) throw new TypeError('Rule action "set" requires a path.');
  const finalKey = keys.pop();
  const target = keys.reduce((current, key) => current[key] ||= {}, value);
  target[finalKey] = nextValue;
}

function normalize(value, ignoreCase) {
  const text = String(value ?? '');
  return ignoreCase ? text.toLocaleLowerCase() : text;
}

function compare(left, right, ignoreCase) {
  return normalize(left, ignoreCase).localeCompare(normalize(right, ignoreCase));
}

function createRegex(expression, ignoreCase, flags = '') {
  const normalizedFlags = new Set(String(flags).split(''));
  if (ignoreCase) normalizedFlags.add('i');
  normalizedFlags.delete('g');
  normalizedFlags.delete('y');
  return new RegExp(expression, [...normalizedFlags].join(''));
}
