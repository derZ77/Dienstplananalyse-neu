# Phase 7.9 – Stabile Testbasis

## Ausgangspunkt

Die stabile Testbasis umfasst die Dienstübersicht-XLSX-Ausgabe aus Phase 7.8 bis 7.8.2. Die Änderungen beschränken sich auf Exportmodell, Renderer und zugehörige Tests.

## Enthaltene Funktionen

- Produktive Exportoption **Dienstübersicht XLSX** zusätzlich zum bestehenden Export.
- Einheitlicher Exportweg für Excel- und PDF-Importe auf Basis des CanonicalSchedule.
- Referenznahes Dienstübersicht-Layout mit 12 Spalten, Druckbereich, Querformat und wiederholter Kopfzeile.
- Hervorgehobene Dienstkopfzeilen und gelb markierte Pausenaktivitäten.
- Dynamischer Dokumenttitel aus der vorhandenen Importerkennung, getrennt für JES und JNV/BEU.
- Verdichtetes Layout: breitere Tätigkeitsspalte und leicht vergrößerte Trennzeilen zwischen Dienstblöcken.

## Teststand

Vor dem Commit wurde `npm test` ausgeführt:

- 2.229 Tests bestanden
- 0 Fehler
- 0 Skips

Die bekannten, nicht-fatalen PDF-Testumgebungswarnungen zu optionalem Canvas bzw. Standard-Font-Daten beeinflussen weder die Analyseergebnisse noch den XLSX-Export.

## Repository-Hygiene

Lokale XLSX-Vorschauen, temporäre Excel-Sperrdateien und sonstige Ausgaben unter `outputs/` werden nicht versioniert. Es wurden keine persönlichen Dokumente oder Quelldateien in den Commit aufgenommen.

## Bekannte offene Punkte

- Feinschliff der letzten drei Ergebnisblöcke.
- Block 7: Wagenkarten- und Umlauftafeln benötigen weiterhin eine belastbare Datenbasis.
- Weitere Detailverbesserungen bei Darstellung und Export können auf dieser stabilen Testbasis aufsetzen.

## Entscheidung

GO als stabile GitHub-Testbasis. Es wird kein Release-Tag erstellt.
