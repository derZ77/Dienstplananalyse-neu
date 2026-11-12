import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessAbruestzeit, renderAbruestzeitBlock } from '../js/v2/blocks/abruestzeit-block.js';
const detection = { status: 'supported', title: 'Dienste Stadtbus', profile: { id: 'beu-stadtbus-v1' } };
function schedule({ end = '16:00', start = '15:45', arrival = '16:00', from = 'Bth. Burgau', to = from, label = 'Abrüsten' } = {}) {
  return { document: { sourceType: 'pdf' }, services: [{ serviceNumber: '123', end: { value: end }, activities: [{ rawActivity: label, departureLocation: from, arrivalLocation: to, departureTime: { value: start }, arrivalTime: { value: arrival }, source: { pageNumber: 2 } }] }] };
}
const jes = { ...detection, title: 'Dienste Regionalbus', profile: { id: 'jes-regionalbus-v1' } };
test('Dienstende und 15-Minuten-Grenze sind inklusive', () => {
 assert.equal(assessAbruestzeit(schedule({end:'15:59'}), detection).findings.length, 0);
 assert.equal(assessAbruestzeit(schedule(), detection).findings[0].status, 'pass');
 const row = assessAbruestzeit(schedule({start:'15:46'}), detection).findings[0];
 assert.equal(row.status, 'warning'); assert.equal(row.missingMinutes, 1);
 assert.equal(assessAbruestzeit(schedule({start:'15:40'}), detection).findings[0].status, 'pass');
});
test('beide Orte und Betreiber müssen passen; Burgaupark zählt nicht', () => {
 for (const options of [{to:'Holzmarkt'}, {from:'Burgaupark'}, {from:'Betriebshof Eisenberg'}])
  assert.equal(assessAbruestzeit(schedule(options), detection).findings.length, 0);
 for (const from of ['Bth. Burgau', 'Betriebshof Jena-Burgau', 'Betriebshof Eisenberg'])
  assert.equal(assessAbruestzeit(schedule({from,label:'Nachbereitungszeit JES'}), jes).findings.length, 1);
 assert.equal(assessAbruestzeit(schedule({from:'Betriebshof Eisenberg',to:'Bth. Burgau'}), jes).findings.length, 0);
 assert.equal(assessAbruestzeit(schedule({label:'Nachbereitung'}), detection).findings.length, 0);
 assert.equal(assessAbruestzeit(schedule({from:'Betriebshof Eisenberg',label:'Nachbereitungszeit'}), jes).findings.length, 1);
});
test('nur PDF und sichere Busprofile; fehlende Zeiten ergeben kein PASS', () => {
 const excel = schedule(); excel.document.sourceType='excel';
 assert.equal(assessAbruestzeit(excel,detection).applicable,false);
 for (const title of ['Dienste Straßenbahn', 'Dienste Tram', 'Unbekannt'])
  assert.equal(assessAbruestzeit(schedule(),{...detection,title}).applicable,false);
 for (const options of [{end:null}, {arrival:null}, {start:'17:00',arrival:'16:00'}])
  assert.equal(assessAbruestzeit(schedule(options),detection).findings[0].status,'unresolved');
});
test('mehrere Zeilen werden einzeln bewertet, einschließlich früherer Abrüstung im späten Dienst', () => {
 const s=schedule({start:'08:00',arrival:'08:05'});s.services[0].activities.push({...s.services[0].activities[0]});
 assert.deepEqual(assessAbruestzeit(s,detection).findings.map(x=>x.minutes),[5,5]);
});
test('gelber Hinweis, Belegstelle, HTML escaping und Rücksetzen', () => {
 const target={textContent:'',innerHTML:''};const document={getElementById:id=>id==='abruestzeit-result'?target:null};
 const s=schedule({start:'15:50'});s.services[0].serviceNumber='<script>';
 renderAbruestzeitBlock(s,detection,{document});
 assert.match(target.innerHTML,/status-warning/);assert.match(target.innerHTML,/5 Minuten fehlen/);
 assert.match(target.innerHTML,/PDF-Seite 2/); assert.doesNotMatch(target.innerHTML,/<script>/);
 renderAbruestzeitBlock(null,null,{document});assert.match(target.textContent,/Warte/);
});
test('vorhandene JES-/JNV-PDFs liefern prüfbare Abrüstzeilen im produktiven Import', async () => {
 globalThis.DOMMatrix ||= class DOMMatrix {};
 const {analyzePdfImport}=await import('../js/v2/import/pdf-analysis-controller.js');
 for(const name of ['jes-schedule.pdf','jnv-schedule.pdf']) {
  const bytes=await readFile(new URL(`./fixtures/${name}`,import.meta.url));
  const result=await analyzePdfImport({name,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  const assessed=assessAbruestzeit(result.canonicalSchedule,result.detection);
  assert.equal(assessed.applicable,true);assert.ok(assessed.findings.length>0,name);
  assert.ok(assessed.findings.every(row=>row.page>0 && row.serviceNumber && row.minutes!==null));
 }
});
