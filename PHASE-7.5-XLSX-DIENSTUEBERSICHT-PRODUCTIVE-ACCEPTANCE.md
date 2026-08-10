# Phase 7.5 – XLSX Dienstübersicht Produktivanbindung und Acceptance

## Ergebnis

**GO.** Die Dienstübersicht ist als zusätzliche produktive Exportoption angebunden. Der bestehende allgemeine Dienstplanexport bleibt unverändert verfügbar.

## Exportanbindung

Nach einem erfolgreichen Import wird die Exportoption **„Dienstübersicht XLSX“** angezeigt, sobald ein `CanonicalSchedule` vorliegt. Sie verwendet ausschließlich:

`CanonicalSchedule → DienstübersichtExportModel → XLSX Renderer → lokaler Browser-Download`

Die Anbindung ist quellenneutral: PDF-Importe stellen den Canonical Schedule direkt bereit; Legacy-Excel wird an der bestehenden Sitzungsgrenze normalisiert. Es gibt keine PDF-Sonderprojektion, keine neue Fachregel und keine Änderung an Parsern, Analyseblöcken oder BV-Logik.

## Acceptance-Nachweise

| Fall | Ergebnis |
| --- | --- |
| JES Excel | Klassifizierung, Canonical Schedule und 12-spaltiger Dienstübersicht-Vertrag erfolgreich |
| JES PDF | Canonical Schedule und derselbe Dienstübersicht-Vertrag erfolgreich |
| JNV PDF | Canonical Schedule und derselbe Dienstübersicht-Vertrag erfolgreich |
| XLSX-Roundtrip | XLSX wird geschrieben, wieder gelesen und bewahrt Datenzeilen und Spaltenvertrag |
| Format | Blatt `Dienstübersicht`, 12 Spalten, Titelzusammenführung, Drucktitel Zeile 2 und Querformat geprüft |

## Teststand

`npm test`: **2224 bestanden, 0 Fehler, 0 Skips**.

Die PDF-Testumgebung meldet weiterhin optionale PDF.js-/Canvas- und Standardschrift-Warnungen. Sie beeinflussen die extraktionsbasierten Tests nicht und führen zu keinem Fehler.

## Verbleibende Abweichungen

Die Exportdatei reproduziert den vereinbarten generischen Dienstübersicht-Vertrag. Vorlagenspezifische manuelle Zellzusammenführungen innerhalb einzelner Aktivitätszeilen können ohne zusätzliche, nicht im Canonical Schedule enthaltene Layoutinformation nicht identisch übernommen werden. Sie sind keine Datenverluste und liegen außerhalb der produktiven Datenprojektion.
