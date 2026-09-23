/**
 * JES Wagenkarte Block 7 projection (Phase 9.7B).
 *
 * This projects observed trip intervals and independent official L5 values.
 * It deliberately does not claim vehicle-motion-only real driving time or
 * apply legal thresholds, create CanonicalSchedule data, or handle JNV cards.
 */

const TRIP_SEGMENT_TYPES = new Set(['LINE_SERVICE', 'DEADHEAD']);
const RELEVANT_BREAK_TYPES = new Set(['UNPAID_BREAK', 'SERVICE_INTERRUPTION']);
const ADDITIONAL_TIME_KEYS = Object.freeze(['turnaround', 'provisioning', 'preparation', 'postprocessing', 'standby']);
const text = value => String(value ?? '').trim();
const minutes = value => Number.isInteger(value?.minutes) ? value.minutes : null;
const timeline = value => Number.isInteger(value?.timelineMinutes) ? value.timelineMinutes : null;

/**
 * Calculate observed trip time for one Wagenkarten section.
 * Only documented LINE_SERVICE and DEADHEAD intervals contribute to Fahrtenzeit.
 * A relevant recorded unpaid break or service interruption splits
 * adjacent driving segments when it lies entirely in their time gap.
 */
export function analyzeVehicleCardDrivingTime(service) {
  const tripSegments = (service?.segments || [])
    .filter(segment => TRIP_SEGMENT_TYPES.has(segment?.type))
    .filter(segment => minutes(segment?.duration) !== null)
    .slice()
    .sort(byStart);
  const relevantBreaks = [...(service?.breaks || []), ...(service?.interruptions || [])]
    .filter(item => RELEVANT_BREAK_TYPES.has(item?.type))
    .filter(item => timeline(item?.start) !== null && timeline(item?.end) !== null)
    .slice()
    .sort(byStart);
  const blocks = buildTripBlocks(tripSegments, relevantBreaks);
  const observedTripMinutes = tripSegments.reduce((sum, segment) => sum + minutes(segment.duration), 0);
  const officialL5Minutes = minutes(service?.officialL5 ?? service?.officialDrivingTime);
  const tripTimeMinutes = Number.isInteger(service?.tripTime?.minutes) ? service.tripTime.minutes : observedTripMinutes;
  const verifiedTripTimeMinutes = service?.assignmentStatus === 'UNRESOLVED' ? null : tripTimeMinutes;
  const differenceMinutes = officialL5Minutes === null || verifiedTripTimeMinutes === null ? null : officialL5Minutes - verifiedTripTimeMinutes;
  const relevantBreak = longestBreak(relevantBreaks);
  const [tripBeforeRelevantBreakMinutes, tripAfterRelevantBreakMinutes] = tripAroundBreak(blocks, relevantBreak);
  const maxContinuousTripBlockMinutes = blocks.reduce((maximum, block) => Math.max(maximum, block.tripMinutes), 0);
  const additionalTimes = summarizeAdditionalTimes(service, relevantBreaks);

  return {
    service,
    tripSegments,
    relevantBreaks,
    blocks,
    tripTimeMinutes: verifiedTripTimeMinutes,
    officialL5Minutes,
    l5DifferenceMinutes: differenceMinutes,
    realDrivingTime: 'UNKNOWN',
    l5Components: { driving: 'UNKNOWN', turnaround: 'UNKNOWN', provision: 'UNKNOWN', other: 'UNKNOWN', unexplained: 'UNKNOWN' },
    relevantBreak,
    tripBeforeRelevantBreakMinutes,
    tripAfterRelevantBreakMinutes,
    maxContinuousTripBlockMinutes,
    warnings: service?.warnings || [],
    additionalTimes
  };
}

/** Creates the legacy-facing Block-7 payload; the existing renderer owns markup. */
export function createVehicleCardBlock7ViewModel(vehicleCardSchedule) {
  const sectionServices = (vehicleCardSchedule?.services || []).flatMap(service =>
    Array.isArray(service?.sections) && service.sections.length
      ? service.sections.map(section => ({ ...service, ...section, parentServiceNumber: service.serviceNumber }))
      : [service]);
  const analyses = sectionServices
    .map(analyzeVehicleCardDrivingTime)
    .sort((left, right) => compareServiceNumbers(left.service?.serviceNumber, right.service?.serviceNumber));

  const lines = [
    'Wagenkarten-Fahrtenzeiten und offizieller L5-Vergleich:',
    '',
    'Hinweis:',
    'Fahrtenzeit ist die Summe der erkannten Linienfahrten und Leerfahrten; sie belegt nicht automatisch die tatsächliche Fahrzeugbewegungszeit.',
    'Offizieller L5 wird unabhängig aus dem jeweiligen Abschnittskopf gelesen. Differenz = L5 − Fahrtenzeit; unbelegte Komponenten bleiben UNKNOWN.',
    'Reale Lenkzeit: nicht bestimmt. Keine Rechts- oder Tarifprüfung wird hier vorgenommen.',
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

function buildTripBlocks(segments, breaks) {
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
      current.tripMinutes += minutes(segment.duration);
      current.segments.push(segment);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function makeBlock(segment) {
  return { start: segment.start, end: segment.end, tripMinutes: minutes(segment.duration), segments: [segment] };
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

function tripAroundBreak(blocks, breakItem) {
  if (!breakItem) return [null, null];
  const breakStart = timeline(breakItem.start);
  const breakEnd = timeline(breakItem.end);
  if (breakStart === null || breakEnd === null) return [null, null];
  let before = 0;
  let after = 0;
  for (const block of blocks) {
    if (timeline(block.end) <= breakStart) before += block.tripMinutes;
    else if (timeline(block.start) >= breakEnd) after += block.tripMinutes;
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
  const sectionLabel = service.validity?.dayQualifier?.label || service.validity?.rawLabel || (service.source?.sectionIndex != null ? `Abschnitt ${service.source.sectionIndex + 1}` : '');
  lines.push(`ID ${text(service.parentServiceNumber || service.serviceNumber) || '-'}${sectionLabel ? ` — ${sectionLabel}` : ''}:`);
  lines.push(`Fahrtenzeit: ${formatMinutes(analysis.tripTimeMinutes)}`);
  lines.push(`Offizieller L5: ${formatMinutes(analysis.officialL5Minutes)}`);
  lines.push(`Differenz L5 − Fahrtenzeit: ${formatMinutes(analysis.l5DifferenceMinutes)}`);
  lines.push('Reale Lenkzeit: nicht bestimmt (UNKNOWN). L5-Komponenten (Fahrten/Wende/Bereitstellung/sonstige/ungeklärt): UNKNOWN.');
  if (analysis.relevantBreak && analysis.tripBeforeRelevantBreakMinutes !== null && analysis.tripAfterRelevantBreakMinutes !== null) {
    lines.push(`Fahrtenzeit vor Unterbrechung: ${formatMinutes(analysis.tripBeforeRelevantBreakMinutes)}`);
    lines.push(`Fahrtenzeit nach Unterbrechung: ${formatMinutes(analysis.tripAfterRelevantBreakMinutes)}`);
    lines.push(`Relevante Unterbrechung: ${breakLabel(analysis.relevantBreak)}`);
  } else {
    lines.push('Keine relevante Pause/Dienstunterbrechung gefunden.');
  }
  lines.push(`Maximaler zusammenhängender Fahrtenblock: ${formatMinutes(analysis.maxContinuousTripBlockMinutes)}`);
  if (analysis.warnings.includes('SECTION_BOUNDARY_AMBIGUOUS')) lines.push('Warnung: Abschnittszuordnung an Tabellenkopf mehrdeutig; Fahrtenzeit ist nicht vollständig verifiziert.');
  lines.push('Weitere getrennt erkannte Zeitarten:');
  lines.push(`Wendezeit: ${formatMinutes(additional.turnaround)}`);
  lines.push(`Bereitstellungszeit: ${formatMinutes(additional.provisioning)}`);
  lines.push(`Vorbereiten: ${formatMinutes(additional.preparation)}`);
  lines.push(`Nachbereiten: ${formatMinutes(additional.postprocessing)}`);
  lines.push(`Dienstbereitschaft: ${formatMinutes(additional.standby)}`);
  lines.push(`Arbeitsnahe Zusatzzeiten gesamt: ${formatMinutes(additional.workAdjacentMinutes)}`);
  lines.push(`Pausen/Dienstunterbrechungen: ${formatMinutes(additional.normalBreakMinutes + additional.interruptionMinutes)}`);
  lines.push('');
}

export function resolveVehicleCardScheduleForBlock7(state) {
  const candidates = [
    state?.primaryImport?.importResult?.data,
    state?.primaryImport?.data,
    state?.companionImport?.importResult?.data,
    state?.companionImport?.data
  ];
  return candidates.find(candidate => candidate?.type === 'VehicleCardSchedule' && candidate?.organization === 'JES') || null;
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
