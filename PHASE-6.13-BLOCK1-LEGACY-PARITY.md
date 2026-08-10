# Phase 6.13 – Block 1 Dienstanzahl Legacy Parity

## Ausgangslage

Block 1 ist ein reiner Informationsblock für die Vergleichbarkeit von
Dienstplänen. Die alte tabellarische PWA ermittelte hierzu eine Menge aller
positiven numerischen Dienstnummern und zeigte ausschließlich deren Anzahl an.
Eine Bewertung nach BV, Arbeitszeit oder Verstoß ist nicht Bestandteil dieses
Blocks.

## Legacy-Soll

| Merkmal | Legacy-Verhalten |
| --- | --- |
| Überschrift/Aussage | `Anzahl eindeutiger Dienst-IDs: <Anzahl>` |
| Datenbasis | Positive numerische Dienstnummern |
| Zählung | Jede Nummer nur einmal, auch bei mehrfacher Darstellung (z. B. Mo–Do/Freitag) |
| Reihen/Details | Keine Dienstliste erforderlich |
| Bewertung | Keine BV-, Arbeitszeit- oder Verstoßbewertung |

## Datenfluss und Ursache

Vor der Änderung wurde `legacy.serviceCount` aus der Anzahl aller
`CanonicalSchedule.services` bestimmt. Der Canonical-Adapter bewahrt
mehrfach dargestellte Dienste absichtlich als getrennte Dienstobjekte; dies ist
für deren Aktivitäten und weitere Blöcke korrekt. Für Block 1 führte es jedoch
zu einer Zählung der Dienstzeilen statt der eindeutigen Dienstnummern.

| Stufe | Vorher | Nachher |
| --- | --- | --- |
| CanonicalSchedule | Dienstobjekte, auch mit gleicher Nummer | unverändert |
| Legacy-Projektion | `services.length` | Menge positiver numerischer Dienstnummern |
| Block 1 Renderer | vorhandener Count-Text | unverändert |

Klassifikation: **C – Zählung fehlerhaft**. Die Datenbasis war vorhanden; nur
die Block-1-Projektion wich vom Legacy-Soll ab.

## Umsetzung

In `js/v2/analysis/legacy-analysis-migrator.js` wird `serviceCount` jetzt aus
einer Menge positiver ganzzahliger `serviceNumber`-Werte gebildet. Dienstobjekte,
Aktivitäten, Importpfade, Fachregeln und der Renderer bleiben unverändert.

Dadurch werden gleiche Dienstnummern für die Dienstanzahl zusammengeführt,
ohne die zugrunde liegenden Dienstinformationen zu verlieren.

## Testnachweise

Neue Tests in `tests/phase6-13-block1-legacy-parity.test.js` prüfen:

- drei Canonical-Dienstobjekte mit den Nummern `1103`, `1103`, `1104` ergeben
  die Legacy-Anzeige `2`;
- die echten JES-Excel- und JES-PDF-Referenzen erzeugen beide `18` eindeutige
  Dienst-IDs (bei 19 dargestellten Dienstzeilen);
- die echte JNV-PDF-Referenz erzeugt `62` eindeutige Dienst-IDs und enthält
  keine fachliche Bewertung im Block-1-Text.

Der fokussierte Lauf mit Block-Orchestrator-, Legacy-Migrator- und
Excel/PDF-Paritätstests war erfolgreich: **8 bestanden, 0 Fehler**.

Der vollständige Regressionstest `npm test` war ebenfalls erfolgreich:
**2215 bestanden, 0 Fehler, 0 übersprungen**. Die bekannten PDF.js-Warnungen
zur optionalen Canvas-/Schrift-Umgebung traten auf, beeinflussten aber keine
Testergebnisse.

## Verbleibende Unterschiede

Keine für Block 1 festgestellt. Die Zählung entspricht der tabellarischen
Legacy-PWA; der Block bleibt bewusst rein informativ.
