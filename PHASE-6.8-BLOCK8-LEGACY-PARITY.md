# Phase 6.8 – Block 8 Legacy Parity

## Legacy-Soll

**Überschrift:** `8. Schichtzuweisung anhand des Dienstbeginns`

Der tabellarische Legacy-Pfad ordnet jeden Dienst anhand seines Dienstbeginns
einer Schichtlage zu. Nicht geteilte Dienste werden für Mo–Fr in F1, F2, F3,
S1, S2 und N gezählt; für Wochenenden gelten WE-F1, WE-F2, S1, S2 und N.
Geteilte Dienste erhalten eine getrennte Schichtlage mit Präfix `G` (etwa GF1
oder GWE-F1).

Die Legacy-Ausgabe enthält:

- getrennte Summen für nicht geteilte und geteilte Dienste;
- sortierte Zuteilung je Dienstnummer;
- die Kennzeichnung `(geteilt)` je geteiltem Dienst;
- eine separate gruppierte, farblich klassifizierte HTML-Darstellung nach
  Schichtlage.

Block 8 hat keine eigene Warnlogik und keine eigenen Filter. Die globale
Volltextsuche der PWA bleibt die einzige Filtermöglichkeit.

## Aktueller Zustand vor der Umsetzung

Die Berechnung in `legacyAnalyses.shifts` war bereits vorhanden. Der
Block-Orchestrator vermischte jedoch die regulären und geteilten Summen und
lieferte keine Gruppenansicht (`shiftHtml` war leer). Mehrfach vorkommende
Dienstnummern wurden außerdem mehrfach ausgegeben, während der Legacy-Pfad nur
die erste Zuordnung je Dienstnummer führt.

## Datenfluss und Klassifikation

```text
CanonicalSchedule.services.begin + serviceNumber
  → legacyAnalyses.shifts
  → Block-8-Projektion (shiftText / shiftHtml)
  → Original-Renderer (#shift-result)
```

| Legacy-Feld | Verfügbarkeit | Vorher | Klasse | Nachher |
| --- | --- | --- | --- | --- |
| Dienstnummer | CanonicalSchedule | vorhanden | E | unverändert |
| Dienstbeginn | CanonicalSchedule | vorhanden | E | unverändert |
| Schichtlage | `legacyAnalyses.shifts` | vorhanden | E | unverändert |
| reguläre Summen | vorhandene Zuteilungen | mit geteilten vermischt | B/D | getrennt |
| geteilte Summen | vorhandene Zuteilungen | mit regulären vermischt | B/D | getrennt |
| Zuteilung je Dienst | vorhandene Zuteilungen | doppelte IDs möglich | D | eindeutig/sortiert |
| Gruppen-Markup | Daten vorhanden | nicht verwendet | B/D | wiederhergestellt |
| Bewertung/Ausnahme | keine dienstbezogene Zuordnung in diesem Block | nicht vorhanden | A | bewusst nicht erfunden |

## Umsetzung

Geändert wurden nur die vorhandene Block-8-Projektion und der Original-Block-
Renderer:

- reguläre und geteilte Schichtlagen werden getrennt gezählt;
- die erste vorhandene Zuordnung je Dienstnummer wird im Legacy-Sinn verwendet;
- `shiftHtml` gruppiert bestehende Zuteilungen mit den bereits vorhandenen
  Legacy-CSS-Klassen;
- der Renderer verwendet für Block 8 dieses vorhandene, escaped Markup;
  ohne Markup bleibt die bisherige Textdarstellung erhalten.

Es wurden keine Parser, Datenquellen, Fachregeln oder Zuordnungen zu BV-/JNV-
Bewertungen verändert.

## Erweiterungen gegenüber Legacy

Es gibt keine fachliche Erweiterung. Insbesondere wird eine Feststellung wie
`GF2` nicht durch eine Bewertung ersetzt. Da Block 8 derzeit keine bestehende,
dienstbezogene BV- oder JNV-Bewertung führt, erscheint auch kein leerer oder
vermuteter Bewertungsabschnitt.

## Tests

- Legacy-Referenzfall: F1, F2, Unbekannte und GF1 werden getrennt gezählt,
  zugeordnet und im Gruppen-Markup dargestellt.
- Echte JES-Referenz: Excel und PDF erzeugen denselben Block-8-Text und
  dieselbe Gruppenansicht.
- Echtes JNV-PDF: GF2 (3), GF3 (8), eine unbekannte geteilte Lage sowie die
  Detailzuordnung bleiben als Feststellungen erhalten; ohne Datenverknüpfung
  erscheint keine Bewertung.
- Vollständige Regression: siehe Testlauf dieser Phase.

## Offene Punkte

Falls künftig eine bewertende BV-/JNV-Information für eine konkrete
Schichtzuordnung verfügbar wird, kann sie separat unter einer Überschrift
`Bewertung` ergänzt werden. Dafür wäre eine explizite, bestehende Zuordnung
zwischen Dienst, Schichtfeststellung und Bewertung erforderlich; diese Phase
führt keine solche Zuordnung neu ein.
