import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));

export const FIXTURES = Object.freeze({
  jesSchedulePdf: join(FIXTURE_ROOT, 'jes-schedule.pdf'),
  jesAcceptancePdf: join(FIXTURE_ROOT, 'jes-acceptance.pdf'),
  jesSchoolAcceptancePdf: join(FIXTURE_ROOT, 'jes-school-acceptance.pdf'),
  jnvSchedulePdf: join(FIXTURE_ROOT, 'jnv-schedule.pdf'),
  jnvUmlauftafelPdf: join(FIXTURE_ROOT, 'jnv-umlauftafel.pdf'),
  legacyScheduleXlsx: join(FIXTURE_ROOT, 'legacy-schedule.xlsx'),
  busUmlauftafelXlsx: join(FIXTURE_ROOT, 'bus-umlauftafel.xlsx'),
  tramUmlauftafelXlsx: join(FIXTURE_ROOT, 'tram-umlauftafel.xlsx'),
  jesTenColumnScheduleXlsx: join(FIXTURE_ROOT, 'jes-ten-column-schedule.xlsx')
});
