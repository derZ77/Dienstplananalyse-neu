import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('PDF-Infrastruktur ist lokal und der Dateinput akzeptiert PDF', async () => {
  const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../js/v2/import/pdf-import-controller.js', import.meta.url), 'utf8');

  await access(new URL('../vendor/pdfjs/pdf.mjs', import.meta.url));
  await access(new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url));
  assert.match(indexHtml, /accept="\.xlsx,\.xls,\.pdf,application\/pdf"/);
  assert.match(indexHtml, /type="module" src="js\/v2\/pdf-import-bootstrap\.js"/);
  assert.doesNotMatch(controller, /https?:\/\//);
  assert.doesNotMatch(controller, /fetch\s*\(/);
});
