const DRIVING_TIME_SOURCES = new Set(['UNKNOWN', 'PDF', 'WAGENKARTE', 'CALCULATED']);

/**
 * Validates and prepares a document-independent CanonicalSchedule for a
 * future shared analysis. It deliberately performs no calculation, rule
 * evaluation, warning generation, or document parsing.
 */
export function prepareCanonicalScheduleForAnalysis(canonicalSchedule) {
  assertCanonicalSchedule(canonicalSchedule);

  const schedule = structuredClone(canonicalSchedule);
  schedule.services = schedule.services.map(service => ({
    ...service,
    drivingTimeSource: normalizeDrivingTimeSource(service.drivingTimeSource)
  }));
  schedule.metadata = {
    ...schedule.metadata,
    analysisContractVersion: '1.0'
  };

  assertAnalysisContract(schedule);
  return schedule;
}

/**
 * Returns a deterministic, debug-only comparison. Source positions and IDs
 * are intentionally excluded: they are document-specific by design.
 */
export function compareCanonicalSchedules(left, right) {
  const leftSchedule = prepareCanonicalScheduleForAnalysis(left);
  const rightSchedule = prepareCanonicalScheduleForAnalysis(right);
  const differences = [];

  compareServices(leftSchedule.services, rightSchedule.services, differences);
  return {
    leftSourceType: leftSchedule.document.sourceType,
    rightSourceType: rightSchedule.document.sourceType,
    equivalent: differences.length === 0,
    differences
  };
}

export function toCanonicalComparisonDebugJson(left, right, spacing = 2) {
  return JSON.stringify(compareCanonicalSchedules(left, right), null, spacing);
}

export function assertAnalysisContract(canonicalSchedule) {
  assertCanonicalSchedule(canonicalSchedule);
  if (!Array.isArray(canonicalSchedule.warnings)) {
    throw new TypeError('CanonicalSchedule.warnings must be an array.');
  }

  for (const service of canonicalSchedule.services) {
    for (const field of ['id', 'serviceNumber', 'begin', 'end', 'paidTime', 'source', 'activities']) {
      if (!(field in service)) throw new TypeError(`Service misses required field: ${field}.`);
    }
    if (!DRIVING_TIME_SOURCES.has(service.drivingTimeSource)) {
      throw new TypeError(`Unsupported drivingTimeSource: ${service.drivingTimeSource}.`);
    }
    for (const activity of service.activities) {
      for (const field of ['id', 'serviceId', 'rawActivity', 'source']) {
        if (!(field in activity)) throw new TypeError(`Activity misses required field: ${field}.`);
      }
    }
  }
}

function assertCanonicalSchedule(value) {
  if (value?.type !== 'CanonicalSchedule') {
    throw new TypeError('Analysis adapter accepts only a CanonicalSchedule.');
  }
  if (!Array.isArray(value.services) || !Array.isArray(value.activities)) {
    throw new TypeError('CanonicalSchedule must contain services and activities arrays.');
  }
}

function normalizeDrivingTimeSource(value) {
  return DRIVING_TIME_SOURCES.has(value) ? value : 'UNKNOWN';
}

function compareServices(leftServices, rightServices, differences) {
  const leftByNumber = groupByServiceNumber(leftServices);
  const rightByNumber = groupByServiceNumber(rightServices);
  const serviceNumbers = new Set([...leftByNumber.keys(), ...rightByNumber.keys()]);

  for (const serviceNumber of [...serviceNumbers].sort()) {
    const left = leftByNumber.get(serviceNumber) || [];
    const right = rightByNumber.get(serviceNumber) || [];
    if (left.length !== right.length) {
      differences.push({ type: 'service-count', serviceNumber, left: left.length, right: right.length });
      continue;
    }
    left.forEach((service, index) => compareService(service, right[index], differences));
  }
}

function groupByServiceNumber(services) {
  return services.reduce((groups, service) => {
    const key = normalizedText(service.serviceNumber);
    const list = groups.get(key) || [];
    list.push(service);
    groups.set(key, list);
    return groups;
  }, new Map());
}

function compareService(left, right, differences) {
  const serviceNumber = normalizedText(left.serviceNumber);
  for (const field of ['begin', 'end', 'paidTime']) {
    const leftValue = left[field]?.value || null;
    const rightValue = right[field]?.value || null;
    if (leftValue !== rightValue) {
      differences.push({ type: 'service-field', serviceNumber, field, left: leftValue, right: rightValue });
    }
  }
  if (left.activities.length !== right.activities.length) {
    differences.push({ type: 'activity-count', serviceNumber, left: left.activities.length, right: right.activities.length });
    return;
  }
  left.activities.forEach((activity, index) => compareActivity(serviceNumber, activity, right.activities[index], index, differences));
}

function compareActivity(serviceNumber, left, right, index, differences) {
  compareCircuitDimension(serviceNumber, left, right, index, differences);
  for (const field of ['rawActivity', 'departureLocation', 'arrivalLocation']) {
    const leftValue = normalizedText(left[field]);
    const rightValue = normalizedText(right[field]);
    if (leftValue !== rightValue) {
      differences.push({ type: 'activity-field', serviceNumber, activityIndex: index, field, left: leftValue, right: rightValue });
    }
  }
  for (const field of ['departureTime', 'arrivalTime']) {
    const leftValue = left[field]?.value || null;
    const rightValue = right[field]?.value || null;
    if (leftValue !== rightValue) {
      differences.push({ type: 'activity-field', serviceNumber, activityIndex: index, field, left: leftValue, right: rightValue });
    }
  }
}

// WP25: compare the circuit dimension via RouteIdentity.normalizedKey when both
// sides carry one, so 12/1 and 12100 are recognized as identical. Falls back to
// the raw circuitNumber comparison only when a RouteIdentity is absent.
function compareCircuitDimension(serviceNumber, left, right, index, differences) {
  const leftKey = left.routeIdentity?.normalizedKey ?? null;
  const rightKey = right.routeIdentity?.normalizedKey ?? null;
  const [leftValue, rightValue] = leftKey !== null && rightKey !== null
    ? [leftKey, rightKey]
    : [normalizedText(left.circuitNumber), normalizedText(right.circuitNumber)];
  if (leftValue !== rightValue) {
    differences.push({ type: 'activity-field', serviceNumber, activityIndex: index, field: 'circuitNumber', left: leftValue, right: rightValue });
  }
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
