# Phase 6.7 – Block 6 Legacy Parity

## Legacy-Soll

**Überschrift:** `6. Dienste mit Dienstteilstück >04:30h und Linie/Kurs`

Der tabellarische Legacy-Pfad berücksichtigt keine Reserve-Dienste und bildet
aus aufeinanderfolgenden Zeitsegmenten je Dienst:

- Einzelsegmente mit einer Dauer über 04:30 Stunden;
- kombinierte Nachbarsegmente, wenn ihre Unterbrechung unter 30 Minuten liegt
  und ihre gemeinsame Dauer über 04:30 Stunden beträgt.

Die Ausgabe enthält eine Anzahl betroffener Dienste und ist numerisch nach
Dienstnummer sortiert. Je Dienst zeigt sie:

- `Einzelsegment`: Beginn, Ende, Linie/Kurs und Dauer;
- `Kombiniert`: beide Zeitsegmente, beide Linie/Kurs-Werte, Pausenlänge und
  Gesamtdauer;
- bei mindestens einem Teil über 06:00 Stunden den bestehenden Hinweis, die
  Fahrtafel sowie die 1/6-Dienst- und Standzeitbasis zu prüfen.

Bei keinem Treffer wird ein expliziter Leerstatus ausgegeben. Block 6 hat keine
eigenen Filter; nur die globale Volltextsuche der PWA filtert Ergebnisblöcke.

## Datenfluss und Befund

```text
CanonicalSchedule.services.activities
  → legacyAnalyses.longServiceParts
  → Block-6-Projektion
  → segment-result
```

| Legacy-Information | Canonical / legacyAnalyses | Zustand vor Phase 6.7 | Klassifikation | Zustand danach |
| --- | --- | --- | --- | --- |
| Dienstnummer und Sortierung | vorhanden | Zeilen je Service, gleiche Nummern mehrfach | B/D | eindeutige Dienstgruppierung, sortiert |
| Reservenausschluss | im Migrator vorhanden | korrekt | E | unverändert |
| Einzelteil, Zeit und Dauer | vorhanden | verkürzter Rohtext | B/D | Legacy-Detailzeile |
| Linie/Kurs | `circuitNumber` vorhanden | ohne Legacy-Klammerformat | D | Legacy-Format |
| Kombinierter Teil | `first`, `second`, `gap`, `duration` vorhanden | Pause und vollständige Zeitfolge fehlten | B/D | vollständige Detailzeile |
| >06:00-Hinweis | `exceedsSixHours` vorhanden | nicht angezeigt | B/D | einmal je Dienst angezeigt |
| Anzahl/Leerstatus | vorhandene Finding-Gruppen | nicht angezeigt | D | Legacy-Format |

Die Berechnung der Segmente, der 30-Minuten-Grenze, der 04:30- und
06:00-Schwellen sowie der Reservebehandlung wurde nicht geändert.

## Umsetzung

Geändert wurde ausschließlich `js/v2/blocks/block-orchestrator.js`:

- bestehende `longServiceParts` werden pro Dienstnummer gruppiert;
- bestehende Einzel- und Kombinations-Findings werden im Legacy-Textvertrag
  projiziert;
- vorhandene Pausenlänge und der vorhandene 1/6-Hinweis werden dargestellt.

Es wurden keine Parser, Canonical-Felder, Datenquellen, Fachregeln,
Wagenkarten- oder Umlaufkartenpfade verändert.

## Testnachweise

- Legacy-Referenzfall: ein Einzelsegment (04:40), ein kombinierter Teil
  (07:30, Pause 10 Minuten), beide Kurse und der >06:00-Hinweis stimmen mit
  `parseTabular` überein.
- Echte JES-Referenz: XLSX und PDF erzeugen denselben Block-6-Text.
- Echtes JNV-PDF: Dienst 2150 zeigt das vorhandene Segment 13:48–18:26,
  Kurs 11200 und die Dauer 04:38 im Legacy-Format.
- Vollständige Regression: siehe den Testlauf dieser Phase.

## Verbleibende Unterschiede

Diese Phase stellt die tabellarische Legacy-Aussage wieder her. Sie ergänzt
keine Wagenkarten-Arbeitsblöcke, keine neue Fahrtklassifikation und keine
zusätzlichen Daten, wenn PDF- oder Excel-Quellen Zeiten oder Kurswerte nicht
liefern. Solche fehlenden Quellinformationen bleiben weiterhin sichtbar,
statt durch Annahmen ersetzt zu werden.
