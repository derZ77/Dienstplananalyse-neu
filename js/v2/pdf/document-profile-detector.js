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
    label: 'BEU Stadtbus Mo–Fr (Schule)'
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

/**
 * Classifies only the currently supported document profiles. This intentionally
 * returns no schedule data and performs no business analysis.
 */
export function detectPdfDocumentProfile({ text, pageCount = 0 }) {
  const normalized = normalizePdfText(text);
  const title = normalized.match(/Dienste\s+(?:Regionalbus|Stadtbus)\s+Montag\s+bis\s+Freitag\s+\((?:Ferien|Schule)\),\s+ab\s+\d{2}\.\d{2}\.\d{4}/)?.[0] || '';
  const tableHeaderFound = hasTableHeader(normalized);

  const jesSignals = [
    /Dienste Regionalbus Montag bis Freitag \((?:Ferien|Schule)\), ab \d{2}\.\d{2}\.\d{4}/.test(normalized),
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

  const beuSignals = [
    /Dienste Stadtbus Montag bis Freitag \(Schule\), ab \d{2}\.\d{2}\.\d{4}/.test(normalized),
    tableHeaderFound,
    /Aufrüsten|Abrüsten|Mitfahrt|Vorbereitung/.test(normalized)
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
    signals: { tableHeaderFound, jesSignals, beuSignals }
  };
}
