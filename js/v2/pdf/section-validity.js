import { resolveCanonicalValidity } from '../schedule/canonical-validity.js?v=phase9.14';

/** Headings apply to following tables, including multiple day sections on one page. */
export function attachSectionValidity(schedule, layout) {
  const headings = (layout.pages || []).flatMap(page => (page.lines || [])
    .filter(line => /^Dienste\s+(?:Dienstschulung\s+)?(?:Regionalbus|Stadtbus|Straßenbahn|Tram)\s+[^,]{1,100},\s+ab\s+\d{2}\.\d{2}\.\d{4}$/.test(line.text || ''))
    .map(line => ({ page: page.number, line: line.index, text: line.text })));
  const headingDays = new Set(headings.map(heading => resolveCanonicalValidity({ headerText: heading.text }).dayType));
  if (headingDays.size <= 1) return schedule;
  const services = schedule.services.map(service => {
    const heading = headings.filter(entry => entry.page < service.source.pageNumber ||
      (entry.page === service.source.pageNumber && entry.line <= service.source.lineRange.start)).at(-1);
    return heading ? { ...service, validity: resolveCanonicalValidity({ headerText: heading.text }) } : service;
  });
  const dayTypes = [...new Set(services.map(service => service.validity?.dayType).filter(day => day && day !== 'unknown'))];
  if (dayTypes.length <= 1) return { ...schedule, services };
  const message = 'Gemischter Wochenendplan: Samstag und Sonn-/Feiertag werden je Dienstabschnitt zugeordnet. Tagesartspezifische Prüfungen für den gesamten Plan sind nicht abschließend; Prüfung erforderlich.';
  return {
    ...schedule, services,
    validity: { ...schedule.validity, dayType: 'unknown', dayTypeSource: 'HEADER', dayTypes },
    metadata: { ...schedule.metadata, dayType: 'unknown' },
    warnings: [...(schedule.warnings || []), { code: 'MIXED_DAY_TYPES', message }]
  };
}

