/**
 * Dependency-free structural validator for the driving projection (Phase 3H.2).
 *
 * `{ valid, errors:[{code,path}] }`, no mutation, no auto-repair, structure only — no rule
 * or evaluation fields. A not-applicable projection (metadata === null, empty circulations)
 * is valid.
 */

const SERVICE_REGIMES = ['school', 'holidays', 'regular', 'special', 'unknown'];
const DAY_TYPES = ['mo_fr', 'mo_do', 'friday', 'saturday', 'sunday', 'weekend', 'school_days', 'holidays', 'unknown'];
const CLASSIFICATIONS = ['break', 'layover', 'service_interruption', 'gap', 'unknown'];
const UNSAFE_SOURCE_KEYS = ['originalText', 'rawText', 'rawCells', 'cells', 'boundingBox', 'coordinates', 'path', 'filePath', 'file', 'bytes', 'buffer', 'blob'];

const numberOrNull = (v) => v === null || typeof v === 'number';
const nonNegativeOrNull = (v) => v === null || (typeof v === 'number' && v >= 0);

export function validateDrivingProjection(projection) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return { valid: false, errors: [{ code: 'NOT_A_PROJECTION', path: '' }] };
  }

  const errors = [];
  const push = (code, path) => errors.push({ code, path });
  const checkSourceRefs = (refs, path) => {
    if (!Array.isArray(refs)) return;
    refs.forEach((r, k) => { if (r && typeof r === 'object' && UNSAFE_SOURCE_KEYS.some(u => u in r)) push('UNSAFE_SOURCE_REF', `${path}[${k}]`); });
  };
  const checkInterval = (iv, path, withClassification) => {
    if (!numberOrNull(iv?.startMinutes)) push('INVALID_START', `${path}.startMinutes`);
    if (!numberOrNull(iv?.endMinutes)) push('INVALID_END', `${path}.endMinutes`);
    if (!nonNegativeOrNull(iv?.durationMinutes)) push('INVALID_DURATION', `${path}.durationMinutes`);
    if (withClassification && !CLASSIFICATIONS.includes(iv?.classification)) push('INVALID_CLASSIFICATION', `${path}.classification`);
  };

  if (projection.metadata !== null) {
    const m = projection.metadata;
    if (!m || typeof m !== 'object') {
      push('INVALID_METADATA', 'metadata');
    } else {
      if (!SERVICE_REGIMES.includes(m.serviceRegime)) push('INVALID_SERVICE_REGIME', 'metadata.serviceRegime');
      if (!DAY_TYPES.includes(m.dayType)) push('INVALID_DAY_TYPE', 'metadata.dayType');
      if (typeof m.generatedFrom !== 'string') push('INVALID_GENERATED_FROM', 'metadata.generatedFrom');
      if (typeof m.circulationCount !== 'number') push('INVALID_CIRCULATION_COUNT', 'metadata.circulationCount');
    }
  }

  if (!Array.isArray(projection.warnings)) push('INVALID_WARNINGS', 'warnings');
  if (!Array.isArray(projection.circulations)) {
    push('INVALID_CIRCULATIONS', 'circulations');
    return { valid: errors.length === 0, errors };
  }

  const blockIds = new Set();
  projection.circulations.forEach((c, i) => {
    const base = `circulations[${i}]`;
    if (typeof c?.code !== 'string' || !c.code) push('INVALID_CODE', `${base}.code`);
    for (const coll of ['drivingSegments', 'drivingBlocks', 'interruptionIntervals', 'nonDrivingIntervals']) {
      if (!Array.isArray(c?.[coll])) push('INVALID_COLLECTION', `${base}.${coll}`);
    }
    if (!c?.statistics || typeof c.statistics !== 'object') push('INVALID_STATISTICS', `${base}.statistics`);

    (Array.isArray(c?.drivingBlocks) ? c.drivingBlocks : []).forEach((blk, j) => {
      const bp = `${base}.drivingBlocks[${j}]`;
      if (typeof blk?.id !== 'string' || !blk.id) push('INVALID_BLOCK_ID', `${bp}.id`);
      else { if (blockIds.has(blk.id)) push('DUPLICATE_BLOCK_ID', `${bp}.id`); blockIds.add(blk.id); }
      if (!numberOrNull(blk?.startMinutes)) push('INVALID_START', `${bp}.startMinutes`);
      if (!numberOrNull(blk?.endMinutes)) push('INVALID_END', `${bp}.endMinutes`);
      if (!nonNegativeOrNull(blk?.durationMinutes)) push('INVALID_DURATION', `${bp}.durationMinutes`);
      if (typeof blk?.circulationCode !== 'string') push('INVALID_BLOCK_CODE', `${bp}.circulationCode`);
      if (!Array.isArray(blk?.serviceNumbers) || !blk.serviceNumbers.every(x => typeof x === 'string')) push('INVALID_SERVICE_NUMBERS', `${bp}.serviceNumbers`);
      checkSourceRefs(blk?.sourceRefs, `${bp}.sourceRefs`);
    });

    (Array.isArray(c?.interruptionIntervals) ? c.interruptionIntervals : []).forEach((iv, j) => {
      const ip = `${base}.interruptionIntervals[${j}]`;
      checkInterval(iv, ip, false);
      checkSourceRefs(iv?.sourceRefs, `${ip}.sourceRefs`);
    });
    (Array.isArray(c?.nonDrivingIntervals) ? c.nonDrivingIntervals : []).forEach((iv, j) => checkInterval(iv, `${base}.nonDrivingIntervals[${j}]`, true));
    (Array.isArray(c?.drivingSegments) ? c.drivingSegments : []).forEach((s, j) => checkSourceRefs(s?.source ? [s.source] : [], `${base}.drivingSegments[${j}].source`));
  });

  return { valid: errors.length === 0, errors };
}
