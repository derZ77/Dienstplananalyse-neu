export const ROUTE_IDENTITY_KINDS = Object.freeze(['LINE_COURSE', 'LINE_TRIP', 'UNKNOWN']);

/**
 * RouteIdentity describes exclusively the Fahrweg (line/course or line/trip).
 * It never carries Dienst/Umlauf information — that belongs to ServiceIdentity.
 *
 * This factory is pure and operator-agnostic: it validates and freezes a value
 * object and derives the equivalence `normalizedKey`. All notation-specific
 * interpretation happens solely in `identity-normalization.js`, never here.
 */
export function createRouteIdentity({ raw = '', line = null, course = null, trip = null, kind } = {}) {
  if (!ROUTE_IDENTITY_KINDS.includes(kind)) {
    throw new TypeError(`Unsupported RouteIdentity kind: ${kind}`);
  }

  const normalizedLine = normalizeToken(line);
  const normalizedCourse = normalizeToken(course);
  const normalizedTrip = normalizeToken(trip);

  return Object.freeze({
    type: 'RouteIdentity',
    raw: String(raw ?? ''),
    line: normalizedLine,
    course: normalizedCourse,
    trip: normalizedTrip,
    kind,
    normalizedKey: buildNormalizedKey(kind, normalizedLine, normalizedCourse, normalizedTrip)
  });
}

/**
 * The key is prefixed with the kind so that a LINE_COURSE never collides with a
 * LINE_TRIP. Two notations of the same Fahrweg (e.g. "12/1" and "12100") yield an
 * identical key; UNKNOWN or incomplete route identities have no comparable key.
 */
function buildNormalizedKey(kind, line, course, trip) {
  if (kind === 'LINE_COURSE' && line !== null && course !== null) {
    return `LC:${keyToken(line)}|${keyToken(course)}`;
  }
  if (kind === 'LINE_TRIP' && line !== null && trip !== null) {
    return `LT:${keyToken(line)}|${keyToken(trip)}`;
  }
  return null;
}

function normalizeToken(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

function keyToken(value) {
  const text = String(value).trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}
