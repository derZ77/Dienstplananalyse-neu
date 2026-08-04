# Arbeitspaket 14 – Migration bestehender Fachanalysen

## Ergebnis

Die tabellarischen Legacy-Blöcke 1–8 wurden als [CanonicalSchedule-basierte, strukturierte Auswertung](../js/v2/analysis/legacy-analysis-migrator.js) ergänzt. `analyzeCanonicalScheduleWithMigratedLegacyChecks(...)` komponiert diese optional mit dem unveränderten generischen `AnalysisResult`. Konstanten, Nummernbereiche, Zeitgrenzen und die Zuordnung der Schichtlagen wurden unverändert übernommen. Es gibt keine UI-Ausgabe, keine neuen Regeln und keine Änderungen an `index.html`.

| Legacy-Prüfung | Eingaben / Excel-Felder | Alte Ausgabe | CanonicalSchedule-Zuordnung | Status |
|---|---|---|---|---|
| 1 Planerkennung und Dienstanzahl | C (Dienstnummer) | Planart, Anzahl IDs | `services[].serviceNumber` | übernommen |
| 2 Geteilte Dienste | C, O Beginn, P Ende; Nummernbereiche | IDs, Schichtdauer, >12:00 | `serviceNumber`, `begin`, `end` | übernommen |
| 3 Reserve | C; feste Reservenummern | Reserve-IDs | `serviceNumber` | übernommen |
| 4 Bezahlte Zeit >08:30 | Q | Dienst-IDs | `paidTime.minutes` | übernommen |
| 5 Unterschiedliche Orte | G erster Ort, K letzter Ort | Dienst-IDs | erste `departureLocation`, letzte `arrivalLocation` | übernommen |
| 6 Dienstteilstücke >04:30 | E, F, J; Lücke <30 | Einzel-/kombinierte Segmente, >06:00-Hinweis | `circuitNumber`, `departureTime`, `arrivalTime` | übernommen |
| 7 Schichtzuweisung | C, O; Wochenendplan aus Planart | F1–N bzw. WE-F1–N | `serviceNumber`, `begin` | übernommen |
| 8 Linie/Kurs | C, E, F, G, J, K | Dienste nach Linie/Kurs | `serviceNumber`, `circuitNumber`, Zeiten, Orte | übernommen |
| 9 Pausen 30–120 und BV-Hinweise | C, E, F, G, J, K, O; HLZ/TGR/LGR, 33/39 Min, 3:30–4:30 | HTML-/BV-Hinweis | nicht verlustfrei aus dem neutralen Modell rekonstruierbar | nicht übernommen |

## Feldmapping

| Excel Altbestand | Bedeutung | CanonicalSchedule |
|---|---|---|
| C / Index 2 | Dienstnummer | `services[].serviceNumber` |
| E / Index 4 | Linie/Kurs | `activities[].circuitNumber` |
| F / Index 5 | Abfahrt | `activities[].departureTime` |
| G / Index 6 | Abfahrtsort | `activities[].departureLocation` |
| J / Index 9 | Ankunft | `activities[].arrivalTime` |
| K / Index 10 | Ankunftsort | `activities[].arrivalLocation` |
| O / Index 14 | Dienstbeginn | `services[].begin` |
| P / Index 15 | Dienstende | `services[].end` |
| Q / Index 16 | Bezahlte Zeit | `services[].paidTime` |

Die 10-Spalten-Dienstübersicht wird durch den Excel-Adapter auf dieselben Canonical-Felder abgebildet: Dienst → `serviceNumber`, Umlauf → `circuitNumber`, Tätigkeit → `rawActivity`, Abfahrt/Ankunft und Orte → die entsprechenden Aktivitätsfelder, Beginn/Ende/Bez. Zeit → Dienstfelder.

## Nicht übernommene Analysen

### Wagenkarten erforderlich

Die folgenden vorhandenen Wagenkartenprüfungen wurden vollständig inventarisiert, aber nicht migriert. Sie bleiben im Legacy-Pfad unverändert aktiv.

| Wagenkartenprüfung | Eingaben / Excel-Felder | Ausgabe |
|---|---|---|
| Plan- und Dienstanzahl | B1 Formatkennung, D1 Dienstnummer, J1 Zeitraum | Planhinweis, Dienstanzahl, IDs |
| Geteilter Dienst | L3 Schichtdauer, strukturierte Aktivitäten „unbezahlte Pause“/„geteilter Dienst“ | Dienst bei >10:00 Schichtdauer und >02:00 Unterbrechung |
| Reserve | D1 Dienstnummer | Reserve-IDs |
| Bezahlte Zeit >08:30 | L4 | lange Dienste |
| Unterschiedliche Orte | erkannte erste/letzte relevante Fahrt, Haltestellenregionen | Dienste mit abweichendem Anfangs-/Endort |
| Dienstteile | D4/D5, Aktivitäten, Fahrten, Pausen | Teile >04:30, Trennung und Linien/Kurse |
| Reale Lenkzeit | L5, Linienfahrten/Leerfahrten, Pausen, Zusatzzeiten | Gesamt-, Vor-/Nachpausen- und Maximalblock-Lenkzeit, 04:30-Hinweis |
| Schichtzuweisung | D4, J1, geteilter-Dienst-Ergebnis | F1–N bzw. WE-F1–N |
| Linien/Kurse | strukturierte Fahrtfolge, Linie/Fahrt-Nr., Haltestellen und Zeiten | Dienste nach Linie/Kurs |
| Pausen / Unterbrechungen | explizite Pausenaktivitäten, D4, Fahrtfolge | Pausen 30–120, geteilte Unterbrechungen, Arbeitszeit-vor-Pause-Hinweis |
| Zeitgrenzen-Diagnose | D4/D5, Aktivitäten und Fahrten | Einträge außerhalb der Dienstgrenzen |

- reale Lenkzeit vor/nach Pause und offizieller Lenkzeitkopf,
- Fahrtfolge mit Haltestellen (`ab`/`an`), Linienfahrt vs. Leerfahrt,
- Wagenkarten-Pausenanalyse und Dienstteilbildung,
- Zeitgrenzendiagnose außerhalb des Dienstbeginns/-endes,
- Wagenkarten-spezifische Definition geteilter Dienste (Schichtdauer >10:00 und Unterbrechung >02:00).

Die Felder stammen aus Wagenkartenkopf (D1, D3–D5, L3–L5) und den strukturierten Wagenkartenregionen. Der derzeitige CanonicalSchedule enthält diese Daten nicht vollständig; eine Wagenkarten-Canonical-Adapterphase ist dafür erforderlich.

### BV-Regeln erforderlich

Der nicht migrierte Legacy-Block 9 benötigt die bisherigen fachlichen Konstanten und Sonderorte. Die beigefügten Screenshots bestätigen den fachlichen Kontext (u. a. 30-Minuten-Blockpause, Zeitfenster 3,5–4,5 Stunden, Regeln zu Dienstunterbrechungen), sind aber **keine** Grundlage für neue Implementierungen in diesem Arbeitspaket. Außerdem fehlen für die vollständige Prüfung zulässige Pausenorte, technische Wendezeiten, Verspätungsdaten und die Anlagen der BV.

Weitere BV-Felder aus den Screenshots – Vor-/Nachbereitungszeit nach Ort, maximale bezahlte Zeit, Teil- und Schichtlängen, Ruhezeit, 1/6-Regel und Turnusregeln – sind in der bestehenden Anwendung nicht als vollständige Legacy-Prüfungen implementiert und wurden deshalb nicht neu ergänzt.

## Regression

`tests/legacy-analysis-migrator.test.js` führt den vorhandenen `parseTabular`-Code unverändert in einer VM aus und vergleicht seine Ergebnisse mit dem neuen CanonicalSchedule-Migrator für Planart, Dienstanzahl, geteilte Dienste, Reserve, lange Dienste, Orte, Segmente, Schichten und Linie/Kurs. Damit wird keine neue Fachlogik gegen den Altbestand eingeführt.
