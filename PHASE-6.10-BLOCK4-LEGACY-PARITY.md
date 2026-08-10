# Phase 6.10 – Block 4 Legacy Parity Audit und Wiederherstellung

## 1. Legacy-Soll

Die ursprüngliche PWA bezeichnet Block 4 als **„Dienste > 08:30h“**. Er gibt
dem BR eine kompakte Liste der Dienste, deren bezahlte Zeit die Grenze von
08:30 Stunden überschreitet.

Legacy-Berechnung:

1. Dienstnummer aus der Tabellenspalte C übernehmen;
2. bezahlte Zeit aus Spalte Q auswerten;
3. nur Werte strikt größer als 08:30h aufnehmen;
4. Dienstnummern numerisch aufsteigend ausgeben.

Die Legacy-Ausgabe besteht ausschließlich aus einer Textzeile:

`Dienste >08:30h: <ID-Liste>`

Es gibt keine Tabelle, keine Spalten, keine Detailzeilen, keine Summe außer der
impliziten Liste, keine Warnstufe, keine Filteroption und keine Zusatzbewertung.
Im Leerfall bleibt die ID-Liste leer; die Legacy-PWA ergänzt kein Wort wie
„keine“.

## 2. Ist-Zustand und Abweichung

Die Datenbasis und die Berechnung waren bereits gleichwertig:

- `CanonicalSchedule.services[].paidTime` enthält die bezahlte Zeit;
- `legacy.longPaidServices` verwendet die strikte Grenze `> 510` Minuten;
- die Blockprojektion sortiert numerisch.

Die einzige Abweichung war Darstellungsklasse **B**: Der aktuelle Renderer
fügte im Leerfall den nicht vorhandenen Legacy-Ersatzwert `keine` ein. Dadurch
war der Block sichtbar und inhaltlich korrekt, aber nicht vollständig
darstellungsidentisch.

## 3. Datenfluss

`CanonicalSchedule.services → analyzeMigratedLegacyChecks.longPaidServices → createOriginalBlockViewModel.longText → #long-result`

| Feld / Verhalten | Bewertung | Begründung |
| --- | --- | --- |
| Dienstnummer | A | kommt aus CanonicalSchedule und wird übernommen |
| bezahlte Zeit | A | vorhandenes `paidTime` ist die Legacy-Berechnungsgrundlage |
| Grenze > 08:30h | A | strikt größer als 510 Minuten, wie Legacy |
| Sortierung | A | numerisch aufsteigend |
| Leerfall | B → A | Ersatzwert `keine` entfernt |
| Tabelle/Warnungen/Zusatzbewertung | A | im Legacy-Soll nicht vorhanden |

Es bestehen keine fehlende Berechnung (C) und keine fehlende Datenbasis (D).

## 4. Änderung

In `js/v2/blocks/block-orchestrator.js` wurde ausschließlich der
Leerfall-Ersatzwert entfernt. Parser, CanonicalSchedule, Fachregeln,
JNV-/JES-Logik, Legacy-Analyse und Renderer-Ziel blieben unverändert.

Es wurden keine zusätzlichen Fachinformationen ergänzt: Für Block 4 existiert
keine vorhandene, eindeutig zuordenbare Bewertung, die von der
Legacy-Feststellung getrennt dargestellt werden könnte.

## 5. Tests

Neu: `tests/phase6-10-block4-legacy-parity.test.js`.

Abgedeckt sind:

- die strikte 08:30-h-Grenze (08:30 nicht, 08:31 schon);
- numerische Sortierung;
- der exakte Legacy-Leerfall;
- gleiche Block-4-Darstellung für JES-Excel und JES-PDF;
- eine JNV-PDF-Referenz ohne erfundene Zusatzbewertung.

Gezielter Lauf: 8 bestanden, 0 Fehler. Vollständige Regression: `npm test`
mit 2.200 bestandenen Tests, 0 Fehlern und 0 Skips. Die bekannten
PDFJS-Canvas-/Standardfont-Hinweise der Node-Testumgebung traten auf, ohne ein
Testergebnis zu beeinflussen.

## 6. Offene Punkte

Keine für Block 4. Die Aussage entspricht wieder der ursprünglichen PWA.
