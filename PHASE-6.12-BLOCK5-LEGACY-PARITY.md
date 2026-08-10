# Phase 6.12 – Block 5 Legacy Parity und Dienstort-Informationsdarstellung

## Legacy-Soll

Block 5 der ursprünglichen PWA ist der Informationsblock
**„Dienste mit unterschiedlichen Start- und End-Orten“**. Der Legacy-Block
bildet aus der ersten Anfangs- und letzten Endortangabe eines Dienstes eine
sortierte Dienst-ID-Liste:

`Unterschiedliche Orte: <ID-Liste>`

Gleiche Anfangs- und Endorte bleiben unauffällig. Die historischen äquivalenten
Orte `BBU`, `BUP`, `BBN` und `NSL` werden ebenfalls nicht als unterschiedlicher
Ort gewertet. Es gibt keine Tabelle, keine Warnung, keine Wegezeitpauschale,
keine Entgeltberechnung und keine BV-Bewertung.

## Datenfluss und Bewertung

`CanonicalSchedule.services[].activities`

`→ legacy.findDifferentLocationServices`

`→ legacy.differentLocationServices`

`→ renderLocations → #loc-result`

| Feld / Verhalten | Bewertung | Befund |
| --- | --- | --- |
| Dienstnummer | A | vorhanden, numerisch sortiert |
| Anfangsort | A | erste vollständige Abfahrts-/Ankunftsaktivität |
| Endort | A | letzte vollständige Abfahrts-/Ankunftsaktivität |
| gleiche Orte | A | unauffällig |
| historische Ortsäquivalenz | A | unverändert im Legacy-Migrator |
| Legacy-ID-Zeile | B → A | im Leerfall kein nicht-legacynaher Ersatzwert mehr |
| Ortsdetails | B → A | als klar getrennte Zusatzinformation dargestellt |

Es bestehen keine fehlende Ortsdatenbasis und keine zusätzliche Berechnung.

## Änderung

Die erste Zeile bleibt die unveränderte Legacy-Feststellung. Unterhalb folgt
nur bei betroffenen Diensten:

`Zusätzliche Dienstort-Informationen:`

`ID <Dienst>: <Anfangsort> → <Endort>`

Diese Ergänzung nutzt ausschließlich bereits vorhandene Canonical-Ortsdaten und
ist ausdrücklich nicht als Verstoß-, Wegezeit- oder Entgeltbewertung formuliert.
Dienstbeginn, Dienstende und Dienstteile wurden nicht ergänzt, weil sie für die
Legacy-Aussage nicht erforderlich sind und keine zusätzliche Berechnung nötig
sein soll.

## Geänderte Dateien

- `js/v2/blocks/block-orchestrator.js`
- `tests/phase6-12-block5-legacy-parity.test.js`

## Tests

Die neue Acceptance-Prüfung deckt ab:

- unterschiedliche Orte: Legacy-ID-Liste und getrennte Zusatzinformation;
- gleiche Orte: Legacy-Leerfall;
- JES-Excel und JES-PDF: gleicher Block-5-Text;
- JNV-PDF: rein informative Darstellung ohne Verstoß-, BV-, Wegezeit- oder
  Entgelttext.

Gezielter Lauf: 9 bestanden, 0 Fehler. Vollständige Regression: `npm test`
mit 2.208 bestandenen Tests, 0 Fehlern und 0 Skips. Die bekannten
PDFJS-Canvas-/Standardfont-Hinweise der Node-Testumgebung traten auf, ohne ein
Testergebnis zu beeinflussen.

## Offene Punkte

Keine für die Block-5-Darstellung. Belastbare Wegezeiten, Entgeltfolgen oder
organisatorische Zulässigkeit benötigen zusätzliche Fachgrundlagen und bleiben
bewusst außerhalb dieses Informationsblocks.
