/**
 * JES Wagenkarte Block 7 projection (Phase 9.7B).
 *
 * This is a direct migration of the legacy `buildWagenkarteLenkzeitAnalyse`
 * contract to the VehicleCardSchedule produced in Phase 9.7A. It deliberately
 * does not create CanonicalSchedule data and is not used for JNV Umlauftafeln.
 */

const DRIVING_TYPES = new Set(['LINE_SERVICE', 'DEADHEAD']);
const RELEVANT_BREAK_TYPES = new Set(['UNPAID_BREAK', 'SERVICE_INTERRUPTION']);
const ADDITIONAL_TIME_KEYS = Object.freeze(['turnaround', 'provisioning', 'preparation', 'postprocessing', 'standby']);
const text = value => String(value ?? '').trim();
const minutes = value => Number.isInteger(value?.minutes) ? value.minutes : null;
const timeline = value => Number.isInteger(value?.timelineMinutes) ? value.timelineMinutes : null;

/**
 * Migrated legacy Lenkzeit calculation for exactly one JES vehicle-card service.
 * Only documented LINE_SERVICE and DEADHEAD segments contribute to calculated
 * driving time. A relevant recorded unpaid break or service interruption splits
 * adjacent driving segments when it lies entirely in their time gap.
 */
export function analyzeVehicleCardDrivingTime(service) {
  const drivingSegments = (service?.segments || [])
    .filter(segment => DRIVING_TYPES.has(segment?.type))
    .filter(segment => minutes(segment?.duration) !== null)
    .slice()
    .sort(byStart);
  const relevantBreaks = [...(service?.breaks || []), ...(service?.interruptions || [])]
    .filter(item => RELEVANT_BREAK_TYPES.has(item?.type))
    .filter(item => timeline(item?.start) !== null && timeline(item?.end) !== null)
    .slice()
    .sort(byStart);
  const blocks = buildDrivingBlocks(drivingSegments, relevantBreaks);
  const calculatedDrivingMinutes = drivingSegments.reduce((sum, segment) => sum + minutes(segment.duration), 0);
  const officialDrivingMinutes = minutes(service?.officialDrivingTime);
  const differenceMinutes = officialDrivingMinutes === null ? null : calculatedDrivingMinutes - officialDrivingMinutes;
  const relevantBreak = longestBreak(relevantBreaks);
  const [drivingBeforeRelevantBreakMinutes, drivingAfterRelevantBreakMinutes] = drivingAroundBreak(blocks, relevantBreak);
  const maxDrivingBlockMinutes = blocks.reduce((maximum, block) => Math.max(maximum, block.drivingMinutes), 0);
  const additionalTimes = summarizeAdditionalTimes(service, relevantBreaks);

  return {
    service,
    drivingSegments,
    relevantBreaks,
    blocks,
    calculatedDrivingMinutes,
    officialDrivingMinutes,
    differenceMinutes,
    relevantBreak,
    drivingBeforeRelevantBreakMinutes,
    drivingAfterRelevantBreakMinutes,
    maxDrivingBlockMinutes,
    drivingTimeLimitStatus: maxDrivingBlockMinutes <= 270 ? 'OK' : 'REVIEW_REQUIRED',
    l5DifferenceNotice: differenceMinutes !== null && Math.abs(differenceMinutes) > 10
      ? 'Hinweis: Die berechnete Fahr-/Leerfahrzeit weicht vom L5-Kopfwert ab. L5 kann je nach Wagenkarte weitere Zeitarten enthalten. Bitte fachlich prüfen.'
      : null,
    additionalTimes
  };
}

/** Creates the legacy-facing Block-7 payload; the existing renderer owns markup. */
export function createVehicleCardBlock7ViewModel(vehicleCardSchedule) {
  const analyses = (vehicleCardSchedule?.services || [])
    .map(analyzeVehicleCardDrivingTime)
    .sort((left, right) => compareServiceNumbers(left.service?.serviceNumber, right.service?.serviceNumber));

  const lines = [
    'Lenkzeit real vor/nach Pause laut Wagenkarte:',
    '',
    'Hinweis:',
    'Die berechnete Lenkzeit vor/nach Pause zählt nur Linienfahrten und Leerfahrten.',
    'Wendezeit, Bereitstellungszeit, Vor-/Nachbereitung, Dienstbereitschaft sowie Pausen/Dienstunterbrechungen werden nicht in diese berechnete Fahr-/Leerfahrzeit eingerechnet.',
    'Die offizielle Lenkzeit laut Wagenkarte aus L5 wird separat angezeigt.',
    ''
  ];

  if (!analyses.length) lines.push('Keine Wagenkarten-Dienste erkannt.');
  for (const analysis of analyses) appendServiceText(lines, analysis);

  return {
    type: 'VehicleCardBlock7ViewModel',
    documentType: 'wagenkarte',
    analyses,
    realDrivingTimeText: lines.join('\n').trim()
  };
}

function buildDrivingBlocks(segments, breaks) {
  const blocks = [];
  let current = null;
  for (const segment of segments) {
    if (!current) {
      current = makeBlock(segment);
      continue;
    }
    if (breaks.some(item => splitsDrivingBlocks(current.end, segment.start, item))) {
      blocks.push(current);
      current = makeBlock(segment);
    } else {
      current.end = segment.end;
      current.drivingMinutes += minutes(segment.duration);
      current.segments.push(segment);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function makeBlock(segment) {
  return { start: segment.start, end: segment.end, drivingMinutes: minutes(segment.duration), segments: [segment] };
}

function splitsDrivingBlocks(previousEnd, nextStart, breakItem) {
  const previousEndTimeline = timeline(previousEnd);
  const nextStartTimeline = timeline(nextStart);
  const breakStart = timeline(breakItem?.start);
  const breakEnd = timeline(breakItem?.end);
  return previousEndTimeline !== null && nextStartTimeline !== null && breakStart !== null && breakEnd !== null
    && breakStart >= previousEndTimeline && breakEnd <= nextStartTimeline;
}

function longestBreak(items) {
  return items.reduce((longest, item) => {
    if (!longest) return item;
    return (minutes(item.duration) ?? 0) > (minutes(longest.duration) ?? 0) ? item : longest;
  }, null);
}

function drivingAroundBreak(blocks, breakItem) {
  if (!breakItem) return [null, null];
  const breakStart = timeline(breakItem.start);
  const breakEnd = timeline(breakItem.end);
  if (breakStart === null || breakEnd === null) return [null, null];
  let before = 0;
  let after = 0;
  for (const block of blocks) {
    if (timeline(block.end) <= breakStart) before += block.drivingMinutes;
    else if (timeline(block.start) >= breakEnd) after += block.drivingMinutes;
  }
  return [before, after];
}

function summarizeAdditionalTimes(service, relevantBreaks) {
  const additional = service?.additionalTimes || {};
  const grouped = Object.fromEntries(ADDITIONAL_TIME_KEYS.map(key => [key, sumMinutes(additional[key]) ]));
  const workAdjacentMinutes = ADDITIONAL_TIME_KEYS.reduce((sum, key) => sum + grouped[key], 0);
  const normalBreakMinutes = sumMinutes((service?.breaks || []).filter(item => item?.type === 'UNPAID_BREAK'));
  const interruptionMinutes = sumMinutes((service?.interruptions || []).filter(item => item?.type === 'SERVICE_INTERRUPTION'));
  return { ...grouped, workAdjacentMinutes, normalBreakMinutes, interruptionMinutes, relevantBreakMinutes: sumMinutes(relevantBreaks) };
}

function sumMinutes(items) {
  return (items || []).reduce((sum, item) => sum + (minutes(item?.duration) ?? 0), 0);
}

function appendServiceText(lines, analysis) {
  const service = analysis.service || {};
  const additional = analysis.additionalTimes;
  lines.push(`ID ${text(service.serviceNumber) || '-'}:`);
  lines.push(`Lenkzeit gesamt laut Wagenkarte: ${formatMinutes(analysis.officialDrivingMinutes)}`);
  if (analysis.relevantBreak && analysis.drivingBeforeRelevantBreakMinutes !== null && analysis.drivingAfterRelevantBreakMinutes !== null) {
    lines.push(`Lenkzeit vor Pause/Dienstunterbrechung: ${formatMinutes(analysis.drivingBeforeRelevantBreakMinutes)}`);
    lines.push(`Lenkzeit nach Pause/Dienstunterbrechung: ${formatMinutes(analysis.drivingAfterRelevantBreakMinutes)}`);
    lines.push(`Relevante Unterbrechung: ${breakLabel(analysis.relevantBreak)}`);
  } else {
    lines.push('Keine relevante Pause/Dienstunterbrechung gefunden.');
  }
  lines.push(`Max. Lenkzeitblock: ${formatMinutes(analysis.maxDrivingBlockMinutes)}`);
  lines.push(`Prüfung 04:30h: ${analysis.drivingTimeLimitStatus === 'OK' ? 'OK' : 'Prüfung erforderlich'}`);
  lines.push('Zusätzlich erkannte Zeiten, nicht in berechneter Fahr-/Leerfahrzeit enthalten:');
  lines.push(`Wendezeit: ${formatMinutes(additional.turnaround)}`);
  lines.push(`Bereitstellungszeit: ${formatMinutes(additional.provisioning)}`);
  lines.push(`Vorbereiten: ${formatMinutes(additional.preparation)}`);
  lines.push(`Nachbereiten: ${formatMinutes(additional.postprocessing)}`);
  lines.push(`Dienstbereitschaft: ${formatMinutes(additional.standby)}`);
  lines.push(`Arbeitsnahe Zusatzzeiten gesamt: ${formatMinutes(additional.workAdjacentMinutes)}`);
  lines.push(`Pausen/Dienstunterbrechungen: ${formatMinutes(additional.normalBreakMinutes + additional.interruptionMinutes)}`);
  if (analysis.l5DifferenceNotice) lines.push(analysis.l5DifferenceNotice);
  lines.push('');
}

function breakLabel(item) {
  return `${displayType(item.type)} ${text(item.start?.value) || '-'}–${text(item.end?.value) || '-'} (${formatMinutes(minutes(item.duration))})`;
}

function displayType(type) {
  return type === 'UNPAID_BREAK' ? 'unbezahlte Pause'
    : type === 'SERVICE_INTERRUPTION' ? 'Dienstunterbrechung'
      : text(type) || 'Unterbrechung';
}

function formatMinutes(value) {
  if (!Number.isInteger(value)) return '-';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function byStart(left, right) {
  return (timeline(left?.start) ?? Number.MAX_SAFE_INTEGER) - (timeline(right?.start) ?? Number.MAX_SAFE_INTEGER);
}

function compareServiceNumbers(left, right) {
  return text(left).localeCompare(text(right), 'de', { numeric: true });
}
