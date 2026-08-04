export function assertInputs(analysisResult, canonicalSchedule) {
  if (analysisResult?.type !== 'AnalysisResult') throw new TypeError('BV checks accept only an AnalysisResult.');
  if (canonicalSchedule?.type !== 'CanonicalSchedule') throw new TypeError('BV checks require a CanonicalSchedule context.');
}

export function durationMinutes(activity) {
  const start = activity?.departureTime?.minutesSinceStartOfDay;
  const end = activity?.arrivalTime?.minutesSinceStartOfDay;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  return end >= start ? end - start : (24 * 60) - start + end;
}

export function result(id, name, category, severity, status, message, details = {}, affectedServices = [], affectedActivities = [], sourceReferences = []) {
  return { id, name, category, severity, status, message, details, affectedServices, affectedActivities, sourceReferences };
}

export function sourceReferences(activities) {
  return activities.map(activity => activity.source).filter(Boolean);
}

export function normalized(value) {
  return String(value || '').trim();
}
