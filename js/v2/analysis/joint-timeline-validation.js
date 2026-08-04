/**
 * Dependency-free structural validator for the joint timeline (Phase 3H.1).
 *
 * `{ valid, errors:[{code,path}] }`, no mutation, no auto-repair. Structure only — it makes
 * NO fachliche claim and evaluates no rule. A not-applicable timeline (metadata === null,
 * empty circulations) is valid.
 */

const SERVICE_REGIMES = ['school', 'holidays', 'regular', 'special', 'unknown'];
const DAY_TYPES = ['mo_fr', 'mo_do', 'friday', 'saturday', 'sunday', 'weekend', 'school_days', 'holidays', 'unknown'];
const KINDS = ['service', 'deadhead', 'layover', 'break', 'unknown'];
const UNSAFE_SOURCE_KEYS = ['originalText', 'rawText', 'rawCells', 'cells', 'boundingBox', 'coordinates', 'path', 'filePath', 'file', 'bytes', 'buffer', 'blob'];

const numberOrNull = (v) => v === null || typeof v === 'number';

export function validateJointTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) {
    return { valid: false, errors: [{ code: 'NOT_A_TIMELINE', path: '' }] };
  }

  const errors = [];
  const push = (code, path) => errors.push({ code, path });

  if (timeline.metadata !== null) {
    const m = timeline.metadata;
    if (!m || typeof m !== 'object') {
      push('INVALID_METADATA', 'metadata');
    } else {
      if (!SERVICE_REGIMES.includes(m.serviceRegime)) push('INVALID_SERVICE_REGIME', 'metadata.serviceRegime');
      if (!DAY_TYPES.includes(m.dayType)) push('INVALID_DAY_TYPE', 'metadata.dayType');
      if (typeof m.generatedFrom !== 'string') push('INVALID_GENERATED_FROM', 'metadata.generatedFrom');
      if (typeof m.circulationCount !== 'number') push('INVALID_CIRCULATION_COUNT', 'metadata.circulationCount');
    }
  }

  if (!Array.isArray(timeline.warnings)) push('INVALID_WARNINGS', 'warnings');

  if (!Array.isArray(timeline.circulations)) {
    push('INVALID_CIRCULATIONS', 'circulations');
    return { valid: errors.length === 0, errors };
  }

  const seen = new Set();
  timeline.circulations.forEach((c, i) => {
    const base = `circulations[${i}]`;
    if (typeof c?.code !== 'string' || !c.code) {
      push('INVALID_CODE', `${base}.code`);
    } else {
      if (seen.has(c.code)) push('DUPLICATE_CODE', `${base}.code`);
      seen.add(c.code);
    }
    if (!Array.isArray(c?.services) || !c.services.every(x => typeof x === 'string')) push('INVALID_SERVICES', `${base}.services`);
    if (!c?.statistics || typeof c.statistics !== 'object') push('INVALID_STATISTICS', `${base}.statistics`);
    if (!Array.isArray(c?.segments)) {
      push('INVALID_SEGMENTS', `${base}.segments`);
    } else {
      c.segments.forEach((s, j) => {
        const sb = `${base}.segments[${j}]`;
        if (!KINDS.includes(s?.kind)) push('INVALID_KIND', `${sb}.kind`);
        if (!numberOrNull(s?.durationMinutes)) push('INVALID_DURATION', `${sb}.durationMinutes`);
        if (typeof s?.dayOffset !== 'number') push('INVALID_DAY_OFFSET', `${sb}.dayOffset`);
        if (s?.source && typeof s.source === 'object' && UNSAFE_SOURCE_KEYS.some(k => k in s.source)) push('UNSAFE_SOURCE', `${sb}.source`);
      });
    }
  });

  return { valid: errors.length === 0, errors };
}
