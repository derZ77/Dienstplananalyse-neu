# Phase 6.6 – Block 2 Legacy Parity

## Ausgangslage

Ausgangsstand war Commit `9fddb29`. Die gemeinsame
`CanonicalSchedule → Block-Orchestrator`-Kette erkannte geteilte Dienste und
ihre Schichtdauer bereits korrekt. Block 2 zeigte jedoch nur eine reduzierte
Liste und verlor die fachliche Gliederung, Herkunftsangabe und die
12-Stunden-Gesamtaussage der tabellarischen Legacy-PWA.

Wagenkarten- und Umlaufkartenlogik sind nicht Teil dieser Änderung.

## Legacy-Soll

**Überschrift:** `2. Anzahl geteilte Dienste`

Der tabellarische Legacy-Pfad ermittelt geteilte Dienste über die unveränderten
Dienstnummernbereiche. Pro Dienst verwendet er die erste gültige Zeit aus
Spalte O (Dienstbeginn) und die letzte gültige Zeit aus Spalte P (Dienstende).

Die Ausgabe besteht aus:

1. Anzahl und numerisch sortierter Liste der Dienstnummern;
2. Überschrift für die Schichtdauern mit der O/P-Herkunft;
3. einer Detailzeile je Dienst: `ID`, Schichtdauer und `Spalte O → P`;
4. einer Gesamtaussage: alle Dienste maximal 12:00 Stunden oder einer
   Warnliste aller Dienste über 12:00 Stunden;
5. einem expliziten Leerstatus ohne geteilte Dienste.

Block 2 hat keine eigenen fachlichen Filter. Die PWA besitzt nur die globale
Volltextsuche über alle Ergebnisblöcke.

## Datenfluss und Klassifikation

```text
CanonicalSchedule.services (Dienstnummer, begin, end)
  → legacyAnalyses.sharedServices (Schichtdauer, >12:00-Status)
  → Block-2-Projektion
  → shared-result
```

| Legacy-Feld | CanonicalSchedule | legacyAnalyses | Vorherige Darstellung | Ergebnis |
| --- | --- | --- | --- | --- |
| Dienstnummer | vorhanden | vorhanden | vorhanden | E |
| Geteilt-Klassifikation | vorhandene Legacy-Bereiche | vorhanden | vorhanden | E |
| Erste/letzte Dienstgrenze | `begin`/`end` vorhanden | Schichtdauer vorhanden | Dauer ohne Herkunft | B/D behoben |
| Schichtdauer je Dienst | vorhanden | `shiftDuration` vorhanden | verkürzt | B/D behoben |
| >12:00-Warnung | vorhanden | `exceedsTwelveHours` vorhanden | nur Zeilenanhang | B/D behoben |
| Leerstatus | vorhanden | vorhanden | abweichend formatiert | D behoben |

Es fehlen keine Daten für den tabellarischen Block-2-Vertrag. Die
Canonical-Daten werden unverändert verwendet; die historische O/P-Formulierung
bleibt als sichtbarer Legacy-Vertrag erhalten und gilt für Excel und PDF
gleichermaßen.

## Umsetzung

`js/v2/blocks/block-orchestrator.js` projiziert die bestehenden
`legacyAnalyses.sharedServices` jetzt in die vollständige Legacy-Struktur:

- Detailüberschrift und O/P-Herkunft;
- vollständige Detailzeilen;
- getrennte, aggregierte 12-Stunden-Warnliste;
- vorhandenen Leerstatus.

Die Shared-Service-Bereiche, Zeitberechnung und Grenzwerte wurden nicht
geändert. Es wurden keine Parser, Datenquellen, Fachregeln oder
Architekturgrenzen verändert.

## Testnachweise

- Legacy-Referenztest mit zwei geteilten Diensten: 12:00 und 13:01 Stunden;
  prüft Details, Sortierung und Warnliste gegen `parseTabular`.
- Echte JES-Referenzen: XLSX und PDF erzeugen denselben Block-2-Text.
- Echtes JNV-PDF: alle 12 geteilten Canonical-Dienste erscheinen mit einer
  Schichtdauer, die aus ihren Canonical-Dienstgrenzen unabhängig nachvollzogen
  wird; die maximale Schichtdauer bleibt 12:00 Stunden.
- Vollständige Regression: siehe Testlauf dieser Phase.

## Verbleibende Unterschiede

Block 2 besitzt damit Parität für den tabellarischen Legacy-Vertrag. Die
separate Legacy-Wagenkartenregel (Schichtdauer über 10:00 Stunden plus
Unterbrechung über 02:00 Stunden) bleibt bewusst außerhalb dieser Phase, da
die benötigte Wagenkarten-Datenbasis gemäß Phase 6.5 nicht in der gemeinsamen
Kette verfügbar ist.
