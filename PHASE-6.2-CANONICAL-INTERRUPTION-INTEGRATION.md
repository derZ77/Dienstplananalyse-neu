# Phase 6.2 – CanonicalSchedule-Unterbrechungsintegration

**Ausgangsstand:** `736c1f3` (`docs: approve v1.1.0 release candidate`)

## Ergebnis

Erkannte PDF-Dienstunterbrechungen werden jetzt in dieselbe CanonicalSchedule-Datenbasis übernommen, die der Excel-Import für Unterbrechungen verwendet. Der ursprüngliche Block-Orchestrator benötigt keine PDF-spezifische Auswertung: Block 10 liest unverändert `schedule.interruptions` sowie `service.interruptions`.

Die vorhandene JNV-Härtung bleibt Erkennungsquelle und Regelgrundlage. Die neue Integrationsstufe übernimmt ausschließlich ihre bereits als valide erkannten Unterbrechungen in das quellneutrale Modell. PDF-Parser, Prüfregeln, JNV-1/6-Logik und JES-Logik wurden nicht verändert.

## Gemeinsamer Vertrag

`js/v2/schedule/canonical-interruption.js` definiert die gemeinsame Form für Zeitereignisse in `CanonicalSchedule.interruptions` und `service.interruptions`:

| Feld | Bedeutung |
| --- | --- |
| `type` | Bestehender technischer Typ, aktuell `serviceInterruption` |
| `kind` | Fachliche Kategorie: `pause`, `turnaround`, `interruption` oder `walkingTime` |
| `start`, `end` | Normalisierte Uhrzeiten mit Minutenwert |
| `durationMinutes` | Dauer ohne Schätzung |
| `location` | `{ start, end }`; unbekannte Orte bleiben leer |
| `source` | Quellprovenienz des Imports |
| `serviceId`, `serviceNumber` | Dienstbezug |

Die bestehenden Felder `startLocation` und `endLocation` bleiben aus Kompatibilitätsgründen erhalten. Der Vertrag modelliert damit Pausen, Wendezeiten, Unterbrechungen und Wegezeiten einheitlich, ohne eine nicht belegte Kategorie zu erfinden.

## Datenfluss vorher / nachher

```text
Vorher
JNV-PDF → Härtung → hardened.interruptions
                    └─ Block 10 sieht diese Daten nicht

Nachher
JNV-PDF → Härtung → validierte Unterbrechungen
                         ↓
                   CanonicalSchedule.interruptions
                   CanonicalSchedule.services[].interruptions
                         ↓
                   gemeinsamer Original-Block-Orchestrator
```

Excel erzeugt seine zeitlichen Lücken weiterhin mit der bestehenden Ableitung; diese nutzt nun denselben kanonischen Vertrag. Eine deklarierte Excel-Blockpause bleibt weiterhin nur dann `unpaidBreak`, wenn sie in der Excel-Dienstübersicht tatsächlich erklärt ist. Eine PDF-Unterbrechung wird nicht als unbezahlte Pause geraten.

## Geänderte Module

- `js/v2/schedule/canonical-interruption.js`: gemeinsamer, rein struktureller Unterbrechungsvertrag und nicht-mutierende Einbindung in den CanonicalSchedule.
- `js/v2/excel/excel-break-import.js`: Excel-Unterbrechungen nutzen den gemeinsamen Vertrag; bestehende Ableitung und Pausenregeln bleiben gleich.
- `js/v2/import/pdf-analysis-controller.js`: übernimmt nur bereits valide JNV-Härtungsunterbrechungen in die gemeinsamen Listen.
- `tests/phase6-2-canonical-interruption-integration.test.js`: Referenz- und Paritätstests.

Am Block-Orchestrator war keine Änderung erforderlich: Er konsumiert bereits ausschließlich die gemeinsamen Canonical-Felder und verhält sich damit automatisch gleich für Excel und PDF.

## Tests

Die neuen Tests prüfen:

1. Das echte JNV-Referenz-PDF liefert seine erkannten Unterbrechungen im Basis-CanonicalSchedule sowie je Dienst.
2. Ein Excel-Referenzdienst erzeugt dieselbe Unterbrechungsform mit Zeit, Dauer, Ort, Quelle und Dienstbezug.
3. Dieselbe Canonical-Unterbrechung erzeugt für Excel- und PDF-Quelltyp dieselbe Original-Block-10-Darstellung.

Testlauf außerhalb der Sandbox, damit die drei vorhandenen localhost-Smoke-Tests ihren Server binden können:

```text
npm test
2180 Tests bestanden
0 Fehler
0 Skips
```

Die PDF.js-Hinweise zur optionalen Canvas-/Schrift-Unterstützung bleiben bekannte, bestehende Testausgaben; sie verursachen keine Testfehler und betreffen nicht die Text-/Tabellenextraktion.

## Restpunkt

Diese Phase integriert ausschließlich bereits explizit erkannte Unterbrechungen. Die Klassifizierung weiterer PDF-Rohaktivitäten als Pause, Wendezeit oder Wegezeit ist nicht Teil dieser Umsetzung und bleibt der in Phase 6.1 priorisierte nächste, separate Normalisierungsschritt.
