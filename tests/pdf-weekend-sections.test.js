import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.DOMMatrix ||= class DOMMatrix {};
const { attachSectionValidity } = await import('../js/v2/import/pdf-analysis-controller.js');

const saturday = 'Dienste Regionalbus Samstag, ab 12.10.2026';
const sunday = 'Dienste Regionalbus Sonn- und Feiertag, ab 12.10.2026';
test('mehrere Tagesarten auf derselben Seite bleiben ihren Diensten zugeordnet', () => {
  const input = {
    services: [
      { id: 'sa', source: { pageNumber: 1, lineRange: { start: 1 } } },
      { id: 'so', source: { pageNumber: 1, lineRange: { start: 4 } } }
    ],
    validity: { dayType: 'saturday', validFrom: '2026-10-12' }, metadata: { dayType: 'saturday' }, warnings: []
  };
  const layout = { pages: [{ number: 1, lines: [
    { index: 0, text: saturday }, { index: 1, text: 'Dienst Umlauf' },
    { index: 3, text: sunday }, { index: 4, text: 'Dienst Umlauf' }
  ] }] };
  const result = attachSectionValidity(input, layout);
  assert.equal(result.services[0].validity.dayType, 'saturday');
  assert.equal(result.services[1].validity.dayType, 'sunday_holiday');
  assert.equal(result.validity.dayType, 'unknown');
  assert.deepEqual(result.validity.dayTypes, ['saturday', 'sunday_holiday']);
  assert.equal(result.validity.validFrom, '2026-10-12');
  assert.equal(input.services[0].validity, undefined);
});
