/** Isolated, advisory PDF-only check; does not alter existing blocks or BV reports. */
const normalized = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
const locations = new Map([
  ['bth. burgau', 'burgau'],
  ['betriebshof jena-burgau', 'burgau'],
  ['betriebshof eisenberg', 'eisenberg']
]);
const clockMinutes = clock => {
  const match = String(clock?.value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export function assessAbruestzeit(schedule, detection) {
  const title = detection?.title || '';
  const jes = detection?.profile?.id === 'jes-regionalbus-v1';
  const jnv = detection?.profile?.id === 'beu-stadtbus-v1';
  if (schedule?.document?.sourceType !== 'pdf' || detection?.status !== 'supported'
      || (!jes && !jnv) || !/\b(?:Stadtbus|Regionalbus)\b/i.test(title)
      || /Straßenbahn|\bTram\b/i.test(title)) {
    return { applicable: false, findings: [] };
  }
  const findings = [];
  for (const service of schedule.services || []) {
    const end = clockMinutes(service.end);
    if (end !== null && end < 16 * 60) continue;
    for (const activity of service.activities || []) {
      const label = normalized(activity.rawActivity);
      if (label !== 'abrüsten' && !(jes && /^nachbereitungszeit(?: jes)?(?:\s+\d+)?$/.test(label))) continue;
      const departure = normalized(activity.departureLocation);
      const arrival = normalized(activity.arrivalLocation);
      const allowed = place => jes ? locations.get(place) : place === 'bth. burgau' ? 'burgau' : null;
      if (!allowed(departure) || allowed(departure) !== allowed(arrival)) continue;
      const startMinutes = clockMinutes(activity.departureTime);
      const endMinutes = clockMinutes(activity.arrivalTime);
      // Backward times are ambiguous; never turn them into a passing duration.
      const minutes = startMinutes !== null && endMinutes !== null && endMinutes >= startMinutes
        ? endMinutes - startMinutes : null;
      findings.push({
        serviceNumber: service.serviceNumber,
        serviceEnd: service.end?.value || 'unbekannt',
        departureLocation: activity.departureLocation.trim(),
        arrivalLocation: activity.arrivalLocation.trim(),
        start: activity.departureTime?.value || '?',
        end: activity.arrivalTime?.value || '?',
        minutes,
        missingMinutes: minutes === null ? null : Math.max(0, 15 - minutes),
        page: activity.source?.pageNumber ?? null,
        status: end === null || minutes === null ? 'unresolved' : minutes < 15 ? 'warning' : 'pass'
      });
    }
  }
  return { applicable: true, findings };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

export function renderAbruestzeitBlock(schedule, detection, { document = globalThis.document } = {}) {
  const target = document?.getElementById?.('abruestzeit-result');
  if (!target) return;
  if (!schedule) { target.textContent = 'Warte auf PDF-Dienstplan …'; return; }
  const assessment = assessAbruestzeit(schedule, detection);
  if (!assessment.applicable) {
    target.textContent = 'Nicht anwendbar: ausschließlich erkannte JES-/JNV-Busdienstpläne aus PDF.';
    return;
  }
  if (!assessment.findings.length) {
    target.textContent = 'Keine relevanten Abrüstvorgänge gefunden. Voraussetzung: Dienstende ab 16:00 Uhr und beide Orte der Abrüstzeile am zugelassenen Betriebshof. Fehlende Abrüstzeilen können damit nicht bewertet werden.';
    return;
  }
  const warnings = assessment.findings.filter(row => row.status !== 'pass').length;
  target.innerHTML = `<p>${assessment.findings.length} Abrüstvorgänge · ${warnings} zur Prüfung · Sollzeit mindestens 15 Minuten</p>`
    + assessment.findings.map(row => {
      const message = row.status === 'unresolved' ? 'Zeitangaben nicht eindeutig prüfbar – Prüfung erforderlich.'
        : row.status === 'warning' ? `Abrüstzeit zu kurz – ${row.missingMinutes} Minuten fehlen. Prüfung erforderlich.`
          : 'Abrüstzeit ausreichend.';
      const detail = `Dienst ${row.serviceNumber} | Dienstende ${row.serviceEnd} | ${row.departureLocation} → ${row.arrivalLocation} | Abrüsten ${row.start}–${row.end} | ${row.minutes === null ? 'Dauer unbekannt' : `${row.minutes} Minuten`}${row.page === null ? '' : ` | PDF-Seite ${row.page}`}`;
      return `<div class="result-status ${row.status === 'pass' ? 'status-pass' : 'status-warning'}">${escapeHtml(detail)}<br>${escapeHtml(message)}</div>`;
    }).join('');
}
