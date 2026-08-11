# Phase 8.6 – BV-Pausenbewertung und Ausgabeoptimierung

**Ausgangsbasis:** `0c7af58 docs: validate phase8 github test deployment`

## 1. Block 10 – BV-Pausenlagenprüfung

Die vorhandene Berechnung wurde nicht parallel neu implementiert. Sie nutzt
weiterhin zuerst strukturierte Arbeitszeitanteile vor der Pause und nur bei
fehlenden Zeitanteilen die bereits bestehende Zeitdifferenz zwischen
Dienstbeginn und Pausenbeginn.

Die Ausgabe je regulärer Blockpause (30–120 Minuten) enthält nun:

- Dienst, Beginn, Ende und Dauer der Pause,
- `Mindestpause erfüllt: Ja` für die bereits als reguläre Blockpause
  klassifizierte Pause (mindestens 30 Minuten),
- Arbeitszeit vor Pause und Berechnungsgrundlage,
- eindeutige `BV-Bewertung`.

Statusdarstellung:

| Datenlage / Ergebnis | Darstellung |
| --- | --- |
| strukturierte Arbeitszeit, 03:30–04:30 h | grün: `BV eingehalten` |
| strukturierte Arbeitszeit außerhalb des Bereichs | rot: `BV-Verstoß` |
| fehlende vollständige Arbeitszeitdaten | gelb: `BV-Prüfung erforderlich` plus Fallback-Hinweis |

Kurze Unterbrechungen unter 30 Minuten und lange Unterbrechungen über 120
Minuten bleiben außerhalb der regulären Blockpausenprüfung und verändern
weder Block 6 noch die 1/6-Logik.

## 2. Block 6

Jeder bereits ermittelte Dienstteil über 04:30 h erhält jetzt zusätzlich den
gelben Hinweis:

> Arbeitszeit über 04:30 h – BV-Prüfung erforderlich.

Ein roter Status wird nicht erzeugt. Rot bleibt ausschließlich vorhandenen,
eindeutig ausgewiesenen Fachresultaten vorbehalten, etwa einem bestehenden
`1/6-Dienst nicht zulässig`.

## 3. Block 9

Die Folgefahrt wurde aus der vorigen Fahrtzeile entfernt. Jede Fahrt erscheint
jetzt nur einmal im klaren Format:

`ID | Zeitbereich | Start → Ziel`

Linie/Kurs bleiben weiterhin die vorhandenen Gruppierungen; Analyse und
Datenmodell wurden nicht geändert.

## 4. PDF- und Mobilabnahme

Lokaler Browsertest mit echten Fixtures:

- JNV-PDF: Analyse erfolgreich; Block 6 enthält gelbe 04:30-h-Hinweise,
  Block 9 zeigt das neue Einmalformat, lange Unterbrechungen bleiben von
  Block 10 getrennt.
- JES-PDF: Analyse erfolgreich; Block 6 enthält die gelbe Prüfmarkierung;
  Block 10 bleibt bei fehlenden regulären Pausen korrekt leer.
- 390 px: kein globaler horizontaler Überlauf; Block-6-, Block-9- und
  Block-10-Ausgabe passen in die verfügbare Breite.
- Keine relevanten Browser-Konsolenfehler.

Die beiden bereitgestellten Referenz-PDFs enthalten keine reguläre Pause im
Bereich 30–120 Minuten. Die grüne, rote und gelbe Block-10-Ausgabe wurde
deshalb zusätzlich durch gezielte CanonicalSchedule-Acceptance-Tests
abgesichert.

## 5. Tests

Neue Testdatei:

`tests/phase8-6-bv-pause-and-output.test.js`

Sie prüft Mindestpause, strukturierte grüne Bewertung, roten Verstoß, gelben
Fallback, Block-6-Hinweis samt Farbklasse und das Block-9-Einmalformat.

Vollständige Regression:

- `npm test`: **2261 bestanden, 0 Fehler, 0 Skips**.
- Die bekannten Node-/PDF.js-Umgebungshinweise zu Canvas, `ImageData`,
  `Path2D` und Standardfonts hatten keinen Einfluss auf das Ergebnis.

## 6. Geänderte Bereiche

- `js/v2/blocks/block-orchestrator.js`
- Block-6-, Block-9- und Block-10-Regressionstests
- `tests/phase8-6-bv-pause-and-output.test.js`

Keine Parser, CanonicalSchedule-Verträge, CheckRunner-Regeln oder
Exportlogik wurden geändert.
