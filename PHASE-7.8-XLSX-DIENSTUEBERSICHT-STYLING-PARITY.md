# Phase 7.8 – XLSX Dienstübersicht Layout und Styling Parity

## Ergebnis

Die Dienstübersicht verwendet jetzt die belegten visuellen Grundelemente der Referenzdatei `B_20260817_MoFr_Schule_BEU.xlsx`, ohne Datenmodell, Parser oder Fachlogik zu verändern.

## Übernommene Darstellung

- Blatt `Dienstübersicht` und Titelverbund A1:L1.
- Referenzspalten und Breitenwirkung: zwölf Spalten, Ortsfelder breit, Zeit- und Kennungsspalten kompakt.
- Titel: Calibri, fett, 14 pt, linksbündig.
- Kopfzeile: dunkelblau `#1F4E78`, weiße fette Schrift, zentriert und umbrechbar.
- Dienstkopfzeilen: hellblau `#D9E1F2`, fett, klar vom Aktivitätsbereich getrennt.
- Aktivitätszeilen: weiß, 10 pt, Orts-/Tätigkeitsfelder linksbündig und umbrechbar; Zeiten und Kennungen zentriert.
- Dünne Rahmen an Datenzellen sowie reduzierte Höhe der Leertrennzeilen.
- A4-Querformat, Referenzränder, Anpassung auf eine Seitenbreite, Druckbereich und Wiederholung der Kopfzeile.

## Technische Umsetzung

Der vorhandene SheetJS-Writer übernimmt Daten, Verbünde und Spaltenbreiten. Seine Version verwirft Zellstile jedoch beim XLSX-Schreiben. Deshalb ergänzt der Renderer ausschließlich die zugehörigen OpenXML-Präsentationsdateien im fertigen XLSX-Paket: Stildefinitionen, Zellstilzuordnungen, Seitenlayout und Druckdefinitionen.

Es werden keine zusätzlichen Daten exportiert und keine Analyse-, Parser- oder Fachkomponenten verändert.

## Tests

Neue Tests prüfen:

- Titel-, Kopf-, Dienstkopf- und Aktivitätsformate.
- Referenzfarben und tatsächliche Stilzuordnungen im erzeugten XLSX-Paket.
- Druckbereich, Ränder, A4-Querformat und Wiederholungszeile.
- Einheitliche Darstellung für JES-Excel, JES-PDF und JNV-PDF.

`npm test`: **2226 bestanden, 0 Fehler, 0 Skips**.

## Einschränkung

Die Referenz enthält mehrere weitere, semantisch nicht allgemein ableitbare Füllfarben. Diese werden nicht willkürlich auf Canonical-Daten übertragen. Die übernommene Titel-, Kopf-, Dienstkopf- und Aktivitätsformatierung bildet die wiederkehrende, quellunabhängige Vorlage ab.
