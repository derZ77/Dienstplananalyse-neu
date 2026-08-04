import { assertInputs, result } from './bv-check-helpers.js';

/** § 3 Abs. 4: direct time limits; split-specific limits only with supplied split status. */
export function createBv007Check({ canonicalSchedule, planMetadata = {}, legacyAnalyses = null } = {}) {
  return {
    id: 'bv007', name: 'BV007 Zeitgrenzen geteilter Dienste', category: 'BV', priority: 280,
    async run(analysisResult) {
      assertInputs(analysisResult, canonicalSchedule);
      const startResult = checkEarliestStart(canonicalSchedule.services);
      const splitIds = resolveSplitServiceIds(planMetadata, legacyAnalyses);
      const splitResult = splitIds === null
        ? result('BV007-SPLIT', 'Zeitgrenzen geteilter Dienste', 'BV', 'INFO', 'SKIP', 'Kein Teilungsstatus in Planmetadaten oder Legacy-Migration vorhanden.')
        : checkSplitBounds(canonicalSchedule.services.filter(service => splitIds.has(service.id) || splitIds.has(service.serviceNumber)));
      return [startResult, splitResult];
    }
  };
}

function checkEarliestStart(services) {
  const known = services.filter(service => Number.isInteger(service.begin?.minutesSinceStartOfDay));
  if (!known.length) return result('BV007-START', 'Frühester Dienstbeginn', 'BV', 'INFO', 'NOT_APPLICABLE', 'Keine Dienste mit Beginn vorhanden.');
  const violations = known.filter(service => service.begin.minutesSinceStartOfDay < 180);
  return violations.length
    ? result('BV007-START', 'Frühester Dienstbeginn', 'BV', 'VIOLATION', 'FAIL', 'Ein Dienst beginnt vor 03:00 Uhr.', { minimumMinutes: 180 }, violations.map(service => service.id), [], violations.map(service => service.source).filter(Boolean))
    : result('BV007-START', 'Frühester Dienstbeginn', 'BV', 'INFO', 'PASS', 'Kein Dienst beginnt vor 03:00 Uhr.', { minimumMinutes: 180 });
}

function checkSplitBounds(services) {
  if (!services.length) return result('BV007-SPLIT', 'Zeitgrenzen geteilter Dienste', 'BV', 'INFO', 'NOT_APPLICABLE', 'Der vorhandene Teilungsstatus enthält keine Dienste dieses Plans.');
  const violations = services.flatMap(service => {
    const entries = [];
    if (Number.isInteger(service.begin?.minutesSinceStartOfDay) && service.begin.minutesSinceStartOfDay < 285) entries.push('begin-before-04:45');
    if (Number.isInteger(service.end?.minutesSinceStartOfDay) && service.end.minutesSinceStartOfDay > 1140) entries.push('end-after-19:00');
    return entries.length ? [{ service, entries }] : [];
  });
  return violations.length
    ? result('BV007-SPLIT', 'Zeitgrenzen geteilter Dienste', 'BV', 'VIOLATION', 'FAIL', 'Ein geteilter Dienst liegt außerhalb der Zeitgrenzen 04:45 bis 19:00.', { violations: violations.map(({ service, entries }) => ({ serviceNumber: service.serviceNumber, entries })) }, violations.map(({ service }) => service.id), [], violations.map(({ service }) => service.source).filter(Boolean))
    : result('BV007-SPLIT', 'Zeitgrenzen geteilter Dienste', 'BV', 'INFO', 'PASS', 'Alle markierten geteilten Dienste liegen innerhalb 04:45 bis 19:00.');
}

function resolveSplitServiceIds(planMetadata, legacyAnalyses) {
  if (Array.isArray(planMetadata.splitServiceIds)) return new Set(planMetadata.splitServiceIds.map(String));
  if (Array.isArray(legacyAnalyses?.sharedServices)) return new Set(legacyAnalyses.sharedServices.flatMap(service => [String(service.id), String(service.serviceNumber)]));
  return null;
}
