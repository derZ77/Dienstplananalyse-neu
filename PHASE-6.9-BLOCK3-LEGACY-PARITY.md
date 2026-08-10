# Phase 6.9 – Block 3 Legacy Parity Audit und Wiederherstellung

## Ergebnis

**Legacy-Parität erreicht.** Die Prüfung ergab keine fachliche oder
darstellerische Abweichung, die eine Produktionscodeänderung rechtfertigen
wuerde. Block 3 wird bereits vollständig aus dem gemeinsamen CanonicalSchedule
über die migrierte Legacy-Analyse erzeugt.

## Legacy-Referenz

Die ursprüngliche PWA definiert Block 3 als **„Reserve Dienste“**.

Fachlicher Zweck: Die Anwendung meldet, welche der fest vorgegebenen
Reserve-Dienstnummern im importierten Dienstplan vorkommen.

Legacy-Algorithmus:

1. feste Reserve-ID-Liste: `1, 100, 190, 90, 1101, 1102, 1201, 1202, 1301,
   1302, 1401, 1402, 2101, 2102, 2201, 2202, 2301, 2302, 2401, 2402`;
2. Schnittmenge dieser Liste mit den erkannten Dienst-IDs;
3. numerisch aufsteigend sortieren;
4. ausgeben als `Anzahl Reserve-Dienste: <n>` und `IDs: <Liste>`.

Der Legacy-Block besitzt keine Tabelle, keine Detailzeilen, keine Summen außer
der Anzahl, keine Grenzwertberechnung, keine Warnung und keine eigene
Filtermöglichkeit. Der globale Auswertungsfilter ist kein Block-3-spezifisches
Merkmal.

## Datenfluss und Feldmatrix

`CanonicalSchedule.services → analyzeMigratedLegacyChecks → legacy.reserveServices → createOriginalBlockViewModel.reserveText → #reserve-result`

| Legacy-Feld / Verhalten | Quelle | Bewertung | Nachweis |
| --- | --- | --- | --- |
| feste Reserve-ID-Liste | `RESERVE_SERVICE_NUMBERS` | A – vorhanden und korrekt | identisch zur Legacy-Liste |
| erkannte Dienstnummer | `CanonicalSchedule.services[].serviceNumber` | A – vorhanden und korrekt | nur vorhandene Dienste werden übernommen |
| Reserve-Anzahl | `legacy.reserveServices.length` | A – vorhanden und korrekt | entspricht Legacy-Schnittmenge |
| numerische Sortierung | `ordered(...)` | A – vorhanden und korrekt | aufsteigende ID-Reihenfolge |
| Textstruktur | `reserveText` | A – vorhanden und korrekt | zwei Legacy-Zeilen inklusive Leerfall |
| Renderer-Ziel | `#reserve-result` | A – vorhanden und korrekt | bestehender Original-Blockrenderer |
| Tabelle, Warnung, Zusatzbewertung | keine Legacy-Quelle | A – absichtlich nicht vorhanden | keine Informationen ergänzt |

Es liegen keine Felder der Klassen B (vorhanden, aber nicht dargestellt), C
(Berechnung fehlt) oder D (Darstellung fehlt) vor.

## Umsetzung

Es war keine Änderung an Parsern, Fachregeln, Datenquellen,
CanonicalSchedule, Orchestrator oder Renderer erforderlich. Eine solche
Änderung hätte die Vorgabe verletzt, nur tatsächliche Differenzen zu beheben.

Ergänzt wurde ausschließlich die Acceptance-Abdeckung in
`tests/phase6-9-block3-legacy-parity.test.js`.

## Testnachweise

- JES-Referenz: Excel und PDF ergeben jeweils exakt
  `Anzahl Reserve-Dienste: 0` und dieselbe leere ID-Zeile.
- JNV-Referenz: Das echte PDF ergibt exakt
  `Anzahl Reserve-Dienste: 2` mit `IDs: 2101, 2102` in Legacy-Reihenfolge.
- Gezielter Lauf: 5 bestanden, 0 Fehler.

Vollständige Regression: `npm test` mit 2.197 bestandenen Tests, 0 Fehlern
und 0 Skips. Die bekannten PDFJS-Canvas-/Standardfont-Hinweise der Node-
Testumgebung traten auf, ohne ein Testergebnis zu beeinflussen.

## Schlussfolgerung

Block 3 besitzt bereits echte Legacy-Parität, nicht nur Excel/PDF-Parität. Es
gibt keine fachlich begründete Darstellungsergänzung und keine offene
Produktionsänderung für diesen Block.
