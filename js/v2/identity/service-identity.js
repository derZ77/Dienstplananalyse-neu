/**
 * ServiceIdentity describes exclusively the Dienstzugehörigkeit (Dienst/Umlauf).
 * It never carries Fahrweg information — that belongs to RouteIdentity. It has
 * no `kind`, because Dienst/Umlauf is currently a single form; a later form could
 * add one additively.
 *
 * This factory is pure and operator-agnostic: notation-specific interpretation
 * happens solely in `identity-normalization.js`. `service.serviceNumber` remains
 * the authority for the Dienst; this object is the parsed-from-notation view.
 */
export function createServiceIdentity({ raw = '', dienst = null, umlauf = null } = {}) {
  const normalizedDienst = normalizeToken(dienst);
  const normalizedUmlauf = normalizeToken(umlauf);

  return Object.freeze({
    type: 'ServiceIdentity',
    raw: String(raw ?? ''),
    dienst: normalizedDienst,
    umlauf: normalizedUmlauf,
    normalizedKey: normalizedDienst !== null && normalizedUmlauf !== null
      ? `DU:${keyToken(normalizedDienst)}|${keyToken(normalizedUmlauf)}`
      : null
  });
}

function normalizeToken(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

function keyToken(value) {
  const text = String(value).trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}
