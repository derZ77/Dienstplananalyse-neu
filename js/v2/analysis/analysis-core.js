import { prepareCanonicalScheduleForAnalysis } from './analysis-adapter.js';
import { analyzeMigratedLegacyChecks } from './legacy-analysis-migrator.js';

const UNPAID_ACTIVITY_TYPES = new Set(['unpaidBreak']);
const TRIP_ACTIVITY_TYPES = new Set(['serviceDrive', 'deadRun']);

/**
 * Produces document-independent descriptive metrics from a CanonicalSchedule.
 * It does not add rules, warnings, legal assessments, or derived compliance
 * decisions. Durations are solely reconstructed from existing activity times.
 */
export function analyzeCanonicalSchedule(canonicalSchedule) {
  const startedAt = performance.now();
  const schedule = prepareCanonicalScheduleForAnalysis(canonicalSchedule);
  const services = schedule.services.map(analyzeService);
  const statistics = aggregateStatistics(schedule, services);

  return {
    type: 'AnalysisResult',
    document: structuredClone(schedule.document),
    services,
    statistics,
    issues: [],
    warnings: structuredClone(schedule.warnings),
    metadata: {
      schemaVersion: '1.0',
      canonicalScheduleSchemaVersion: schedule.metadata.schemaVersion || null,
      sourceType: schedule.document.sourceType,
      analysisDurationMs: Number((performance.now() - startedAt).toFixed(3))
    }
  };
}

/**
 * Composes the unchanged generic AnalysisResult with the explicitly migrated
 * legacy checks. Consumers can opt in without changing generic analysis data.
 */
export function analyzeCanonicalScheduleWithMigratedLegacyChecks(canonicalSchedule) {
  return {
    ...analyzeCanonicalSchedule(canonicalSchedule),
    legacyAnalyses: analyzeMigratedLegacyChecks(canonicalSchedule)
  };
}

export function toAnalysisResultDebugJson(analysisResult, spacing = 2) {
  if (analysisResult?.type !== 'AnalysisResult') {
    throw new TypeError('Expected an AnalysisResult.');
  }
  return JSON.stringify(analysisResult, null, spacing);
}

function analyzeService(service) {
  const activities = service.activities.map(activity => analyzeActivity(activity));
  const activityTypes = aggregateActivityTypes(activities);
  const unpaidTime = sumDurations(activities.filter(activity => UNPAID_ACTIVITY_TYPES.has(activity.activityType)));
  const workingTime = sumDurations(activities.filter(activity => !UNPAID_ACTIVITY_TYPES.has(activity.activityType)));
  const flaggedInterruptions = activities.filter(activity => activity.interruptionKind).length;

  return {
    id: service.id,
    serviceNumber: service.serviceNumber,
    begin: structuredClone(service.begin),
    end: structuredClone(service.end),
    paidTime: structuredClone(service.paidTime),
    drivingTimeSource: service.drivingTimeSource,
    activityCount: activities.length,
    interruptionCount: service.interruptions.length || flaggedInterruptions,
    pauseCount: activities.filter(activity => activity.activityType === 'paidBreak' || activity.activityType === 'unpaidBreak').length,
    workingTime,
    unpaidTime,
    activityTypes,
    source: structuredClone(service.source)
  };
}

function analyzeActivity(activity) {
  return {
    activityType: activity.activityType || 'unclassified',
    interruptionKind: activity.interruptionKind || null,
    duration: durationBetween(activity.departureTime, activity.arrivalTime)
  };
}

function aggregateStatistics(schedule, services) {
  const activities = schedule.activities.map(activity => analyzeActivity(activity));
  const activityTypes = aggregateActivityTypes(activities);
  const flaggedInterruptions = activities.filter(activity => activity.interruptionKind).length;
  const interruptionCount = schedule.interruptions.length || flaggedInterruptions;

  return {
    serviceCount: schedule.services.length,
    activityCount: schedule.activities.length,
    interruptionCount,
    pauseCount: countActivityTypes(activities, new Set(['paidBreak', 'unpaidBreak'])),
    workingTime: sumDurations(activities.filter(activity => !UNPAID_ACTIVITY_TYPES.has(activity.activityType))),
    paidTime: sumPaidTimes(schedule.services),
    unpaidTime: sumDurations(activities.filter(activity => UNPAID_ACTIVITY_TYPES.has(activity.activityType))),
    preparation: activityTypes.preparation || emptyActivityTypeMetric(),
    postprocessing: activityTypes.postprocessing || emptyActivityTypeMetric(),
    walkingTime: activityTypes.walkingTime || emptyActivityTypeMetric(),
    rideAlong: activityTypes.rideAlong || emptyActivityTypeMetric(),
    trips: aggregateTripMetrics(activities),
    activityTypes
  };
}

function aggregateActivityTypes(activities) {
  return activities.reduce((metrics, activity) => {
    const type = activity.activityType;
    const metric = metrics[type] ||= emptyActivityTypeMetric();
    metric.count += 1;
    if (activity.duration.minutes !== null) {
      metric.duration.minutes += activity.duration.minutes;
      metric.duration.value = formatDuration(metric.duration.minutes);
      metric.duration.knownCount += 1;
    }
    return metrics;
  }, {});
}

function aggregateTripMetrics(activities) {
  const tripActivities = activities.filter(activity => TRIP_ACTIVITY_TYPES.has(activity.activityType));
  const duration = sumDurations(tripActivities);
  return {
    count: tripActivities.length,
    duration,
    serviceDrive: activityMetric(activities, 'serviceDrive'),
    deadRun: activityMetric(activities, 'deadRun')
  };
}

function activityMetric(activities, activityType) {
  const matching = activities.filter(activity => activity.activityType === activityType);
  return {
    count: matching.length,
    duration: sumDurations(matching)
  };
}

function countActivityTypes(activities, types) {
  return activities.filter(activity => types.has(activity.activityType)).length;
}

function sumPaidTimes(services) {
  const known = services.filter(service => Number.isInteger(service.paidTime?.minutes));
  const minutes = known.reduce((sum, service) => sum + service.paidTime.minutes, 0);
  return durationMetric(minutes, known.length);
}

function sumDurations(activities) {
  const known = activities.filter(activity => activity.duration.minutes !== null);
  const minutes = known.reduce((sum, activity) => sum + activity.duration.minutes, 0);
  return durationMetric(minutes, known.length);
}

function emptyActivityTypeMetric() {
  return { count: 0, duration: durationMetric(0, 0) };
}

function durationMetric(minutes, knownCount) {
  return {
    minutes,
    value: formatDuration(minutes),
    knownCount
  };
}

function durationBetween(departureTime, arrivalTime) {
  const start = departureTime?.minutesSinceStartOfDay;
  const end = arrivalTime?.minutesSinceStartOfDay;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { minutes: null, value: null };
  }
  const minutes = end >= start ? end - start : (24 * 60) - start + end;
  return { minutes, value: formatDuration(minutes) };
}

function formatDuration(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
