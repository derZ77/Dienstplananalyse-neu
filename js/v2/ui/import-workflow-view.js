/** Presentation-only summary of the current in-memory import session. */

const text = value => String(value ?? '').trim();

export function getImportFileCount(state) {
  return (state?.primaryImport ? 1 : 0) + (state?.companionImport ? 1 : 0);
}

export function buildImportWorkflowSummary(state) {
  const primary = state?.primaryImport;
  if (!primary) return 'Noch keine Datei ausgewählt.';

  const lines = [`Dateien: ${getImportFileCount(state)}`];
  const primaryName = text(state?.primaryFileName);
  const companionName = text(state?.companionFileName);
  if (primaryName) lines.push(`Hauptdokument: ${primaryName}`);
  if (state?.companionImport && companionName) lines.push(`Begleitdokument: ${companionName}`);

  const profileLabel = text(primary?.detection?.profile?.label);
  const documentType = text(primary?.classification?.type);
  if (profileLabel) lines.push(`Erkennung: ${profileLabel}`);
  else if (documentType) lines.push(`Dokumenttyp: ${documentType}`);

  if (primary?.canonicalSchedule?.type === 'CanonicalSchedule') {
    const incompatibleCompanion = state?.companionImport
      && state?.bundle?.compatibility?.status !== 'exact';
    lines.push(state?.checkReport
      ? 'Analyse: abgeschlossen.'
      : incompatibleCompanion
        ? 'Analyse: für diese Dokumentkombination nicht verfügbar.'
        : 'Analyse: wird durchgeführt …');
  }
  return lines.join('\n');
}
