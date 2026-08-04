import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Phase 3I.1 – data-readiness guards. These tests pin the AUDIT findings so a later phase cannot
// silently assume data that does not exist. They evaluate no rule and register no check.
import { createUmlauftafelDocument, createValidity, createCirculation, createSegment, createStopEvent, UMLAUFTAFEL_MODE_VALUES, DAY_TYPE_VALUES, SEGMENT_TYPE_VALUES } from '../js/v2/umlauftafel/umlauftafel-contract.js';

// ===== what the contracts DO provide =====
test('mode (bus/tram) is part of the Umlauftafel contract', () => {
  assert.deepEqual([...UMLAUFTAFEL_MODE_VALUES].sort(), ['bus', 'tram']);
  const doc = createUmlauftafelDocument({ mode: 'tram', validity: createValidity({ dayType: 'saturday' }), circulations: [] });
  assert.equal(doc.mode, 'tram');
});
test('weekend day types exist in the day-type vocabulary', () => {
  for (const day of ['saturday', 'sunday']) assert.ok(DAY_TYPE_VALUES.includes(day), `${day} missing`);
});
test('a line can be carried per segment, so line 18 is representable', () => {
  const seg = createSegment({ type: 'service_trip', sequence: 1, line: '18' });
  assert.equal(seg.line, '18');
});
test('stop events carry a name and sequence, so a stop SEQUENCE is available', () => {
  const stop = createStopEvent({ sequence: 1, name: 'Zentrum', role: 'departure' });
  assert.equal(stop.name, 'Zentrum');
  assert.equal(stop.sequence, 1);
});

// ===== what the contracts DO NOT provide (the audit's core findings) =====
test('NO stop distance is modelled anywhere in the stop-event contract', () => {
  const stop = createStopEvent({ sequence: 1, name: 'Zentrum', role: 'departure' });
  const keys = Object.keys(stop);
  assert.ok(!keys.some(k => /dist|km|meter|geo|coord|length/i.test(k)),
    `stop event unexpectedly carries a distance-like field: ${keys.join(', ')}`);
});
test('NO average stop distance can be derived: neither stops nor segments carry a length', () => {
  const seg = createSegment({ type: 'service_trip', sequence: 1, line: '12', stops: [createStopEvent({ sequence: 1, name: 'A' }), createStopEvent({ sequence: 2, name: 'B' })] });
  assert.ok(!Object.keys(seg).some(k => /dist|km|meter|length/i.test(k)));
});
test('NO combined-driver (Kombifahrer) attribute exists in the Umlauftafel contract', () => {
  const seg = createSegment({ type: 'service_trip', sequence: 1 });
  const circ = createCirculation({ code: '12100', mode: 'bus', segments: [seg] });
  const text = JSON.stringify({ seg, circ });
  assert.doesNotMatch(text, /kombi|combined|driverType|fahrertyp/i);
});
test('driver and vehicle changes exist only as unproven boolean flags (default false)', () => {
  const seg = createSegment({ type: 'service_trip', sequence: 1 });
  assert.equal(seg.driverChange, false);
  assert.equal(seg.vehicleChange, false);
  assert.equal(seg.vehicle, null);
});
test('NO turnaround (Wendezeit) entity exists: it is not a reference-backed segment type', () => {
  assert.ok(!SEGMENT_TYPE_VALUES.includes('turnaround'), 'a turnaround segment type must not be invented');
  assert.ok(!SEGMENT_TYPE_VALUES.includes('break'), 'a break segment type is not reference-backed either');
});
test('NO holiday/calendar contract exists in the day-type vocabulary', () => {
  assert.ok(!DAY_TYPE_VALUES.includes('holiday'), 'a public-holiday day type must not be assumed');
});

// ===== the readiness verdict is pinned =====
const AUDIT = new URL('../PHASE-3I.1-JNV-1-6-FACHREGELVERTRAG-DATENREIFE-AUDIT.md', import.meta.url);
test('the audit documents an overall NOT_READY verdict', () => {
  const doc = readFileSync(AUDIT, 'utf8');
  assert.match(doc, /NOT_READY/);
  assert.doesNotMatch(doc, /Gesamtstatus:\s*\*{0,2}READY\*{0,2}\s*$/m, 'the audit must not claim overall readiness');
});
test('the audit names the blocking gaps', () => {
  const doc = readFileSync(AUDIT, 'utf8');
  for (const token of ['Haltestellenabstand', 'Kombifahrer', 'Wendezeit']) assert.match(doc, new RegExp(token));
});

// ===== real-reference readiness probe (honest, skips when unavailable) =====
globalThis.DOMMatrix ||= class DOMMatrix {};
let xlsxReady = false;
try {
  const sb = {}; sb.global = sb; sb.globalThis = sb; sb.window = sb; sb.self = sb; sb.process = process; sb.Buffer = Buffer; sb.console = console;
  createContext(sb);
  runInContext(readFileSync(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url), 'utf8'), sb);
  globalThis.XLSX = sb.XLSX;
  xlsxReady = Boolean(sb.XLSX && typeof sb.XLSX.read === 'function');
} catch { /* ignore */ }

test('the real Umlauftafel provides mode, lines and stop names but NO distances', async (t) => {
  const XLSX_PATH = '/Volumes/Philips SSD/docker/openclaw/workspace/PWA /Umlauftafeln/FB_20260706_Mo-Fr_Ferien.xlsx';
  const present = async (p) => { try { await access(p); return true; } catch { return false; } };
  if (!(xlsxReady && (await present(XLSX_PATH)))) return t.skip('real Umlauftafel / XLSX not available');

  const { analyzeExcelImport } = await import('../js/v2/import/excel-import-controller.js');
  const fileOf = (p, type) => ({ name: p.split('/').pop(), type, arrayBuffer: async () => new Uint8Array(readFileSync(p)).buffer.slice(0) });
  const result = await analyzeExcelImport(fileOf(XLSX_PATH, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const doc = result.document;
  const segments = (doc.circulations || []).flatMap(c => c.segments || []);
  const stops = segments.flatMap(s => s.stops || []);

  assert.ok(['bus', 'tram'].includes(doc.mode), 'mode is available');
  assert.ok(segments.some(s => s.line != null), 'line assignment is available');
  assert.ok(stops.length > 0 && stops.every(s => 'name' in s), 'a stop sequence with names is available');
  assert.ok(!stops.some(s => Object.keys(s).some(k => /dist|km|meter|geo|coord/i.test(k))), 'no stop distance is available');
  assert.equal(segments.filter(s => s.driverChange).length, 0, 'driver changes are not populated by the real source');
  assert.equal(segments.filter(s => s.vehicleChange).length, 0, 'vehicle changes are not populated by the real source');
});
