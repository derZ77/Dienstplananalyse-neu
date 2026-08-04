/**
 * Dependency-free validation for the JNV bundle matcher input (Phase 3G.1).
 *
 * Structural only — it makes no fachliche claim and performs no matching. Returns the
 * established `{ valid, errors:[{code,path}] }` shape. It checks that a schedule match view
 * (serviceRegime/dayType/umlaeufe) and an Umlauftafel document (validity/circulations) are
 * present and well-shaped; an optional `bundle` is type-checked only.
 */

export function validateJnvMatchInput(input) {
  const errors = [];
  const push = (code, path) => errors.push({ code, path });
  const inp = input && typeof input === 'object' ? input : {};
  const { schedule, umlauftafel, bundle } = inp;

  if (!schedule || typeof schedule !== 'object') {
    push('MISSING_SCHEDULE', 'schedule');
  } else {
    if (typeof schedule.serviceRegime !== 'string') push('MISSING_SCHEDULE_REGIME', 'schedule.serviceRegime');
    if (typeof schedule.dayType !== 'string') push('MISSING_SCHEDULE_DAYTYPE', 'schedule.dayType');
    if (!Array.isArray(schedule.umlaeufe)) push('INVALID_SCHEDULE_UMLAEUFE', 'schedule.umlaeufe');
  }

  if (!umlauftafel || typeof umlauftafel !== 'object') {
    push('MISSING_UMLAUFTAFEL', 'umlauftafel');
  } else {
    if (!umlauftafel.validity || typeof umlauftafel.validity !== 'object') push('MISSING_UMLAUFTAFEL_VALIDITY', 'umlauftafel.validity');
    if (!Array.isArray(umlauftafel.circulations)) push('INVALID_UMLAUFTAFEL_CIRCULATIONS', 'umlauftafel.circulations');
  }

  if (bundle !== undefined && bundle !== null && typeof bundle !== 'object') push('INVALID_BUNDLE', 'bundle');

  return { valid: errors.length === 0, errors };
}
