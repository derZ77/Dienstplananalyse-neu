const TABLE_HEADERS = [
  'Dienst',
  'Umlauf',
  'Tätigkeit',
  'Abfahrt',
  'Abfahrtsort',
  'Ankunft',
  'Ankunftsort',
  'Beginn',
  'Ende',
  'Bez. Zeit'
];

export const PDF_DOCUMENT_PROFILES = Object.freeze({
  jes: Object.freeze({
    id: 'jes-regionalbus-v1',
    label: 'JES Regionalbus Mo–Fr (Ferien)'
  }),
  beu: Object.freeze({
    id: 'beu-stadtbus-v1',
    label: 'BEU Stadtbus-Dienstplan'
  }),
  jnvUmlauftafel: Object.freeze({
    id: 'jnv-umlauftafel-pdf-v1',
    label: 'JNV Umlauftafel'
  })
});

function normalizePdfText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTableHeader(text) {
  return TABLE_HEADERS.every(header => text.includes(header));
}

function hasIndependentServiceData(text) {
  const headerPattern = new RegExp(TABLE_HEADERS.map(escapeRegExp).join('\\s+'), 'g');
  const body = text.replace(headerPattern, ' ');
  return /\b(?:Aufrüsten|Abrüsten|Mitfahrt|Vorbereitung\w*|Nachbereitung\w*|Wegezeit|Pause|Dienstunterbrechung|Dienst)\b/i.test(body);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classifies only the currently supported document profiles. This intentionally
 * returns no schedule data and performs no business analysis.
 */
export function detectPdfDocumentProfile({ text, pageCount = 0 }) {
  const normalized = normalizePdfText(text);
  const title = normalized.match(/Dienste\s+(?:Regionalbus|Stadtbus|Straßenbahn|Tram)\s+[^,]{1,100},\s+ab\s+\d{2}\.\d{2}\.\d{4}/)?.[0] || '';
  const tableHeaderFound = hasTableHeader(normalized);

  // Umlauftafeln have no ten-column Dienstübersicht header. Classification is
  // based on their repeated structured circulation header, never on the file name.
  const umlaufSignals = [
    /\bUmlauf:\s*[A-Za-z0-9]+/.test(normalized),
    /\bBeginn:\s*\d{1,2}:\d{2}/.test(normalized),
    /\bEnde:\s*\d{1,2}:\d{2}/.test(normalized),
    /\bFahrzeugtyp:\s*\S+/.test(normalized),
    /\bStartpunkt:\s*\S+/.test(normalized),
    /\bEndpunkt:\s*\S+/.test(normalized),
    /\bSeite:\s*\d+\/\d+/.test(normalized),
    /\bLinie:\s*[^\s]+\s+Route:\s*[^\s]+/.test(normalized)
  ];

  if (umlaufSignals.filter(Boolean).length >= 7) {
    return {
      status: 'supported',
      profile: PDF_DOCUMENT_PROFILES.jnvUmlauftafel,
      title: normalized.match(/(?:Montag\s*(?:bis|-|–)\s*Freitag|Samstag|Sonntag)[^\n]*/i)?.[0] || '',
      pageCount,
      signals: { tableHeaderFound, umlaufSignals }
    };
  }

  const jesSignals = [
    /Dienste Regionalbus Montag bis Freitag(?: \((?:Ferien|Schule)\))?, ab \d{2}\.\d{2}\.\d{4}/.test(normalized),
    tableHeaderFound,
    /Vorbereitungszeit(?:\s*JES)?|Nachbereitungszeit(?:\s*JES)?|JES(?:\s*Pausenort)?/.test(normalized)
  ];

  if (jesSignals.every(Boolean)) {
    return {
      status: 'supported',
      profile: PDF_DOCUMENT_PROFILES.jes,
      title,
      pageCount,
      signals: { tableHeaderFound, jesSignals }
    };
  }

  const tramSignals = [
    /Dienste\s+(?:Straßenbahn|Tram)\s+[^,]{1,100},\s+ab\s+\d{2}\.\d{2}\.\d{4}/.test(normalized),
    tableHeaderFound,
    hasIndependentServiceData(normalized)
  ];

  if (tramSignals.every(Boolean)) {
    return {
      status: 'supported',
      // Tram is an additive vehicle family on the established JNV ten-column
      // schedule path; keep the single central profile for this document type.
      profile: PDF_DOCUMENT_PROFILES.beu,
      documentFamily: 'tram',
      title,
      pageCount,
      signals: { tableHeaderFound, tramSignals }
    };
  }

  const beuSignals = [
    /Dienste Stadtbus\s+[^,]{1,100},\s+ab\s+\d{2}\.\d{2}\.\d{4}/.test(normalized),
    tableHeaderFound,
    hasIndependentServiceData(normalized)
  ];

  if (beuSignals.every(Boolean)) {
    return {
      status: 'supported',
      profile: PDF_DOCUMENT_PROFILES.beu,
      title,
      pageCount,
      signals: { tableHeaderFound, beuSignals }
    };
  }

  return {
    status: 'unsupported',
    title,
    pageCount,
    signals: { tableHeaderFound, jesSignals, tramSignals, beuSignals }
  };
}
