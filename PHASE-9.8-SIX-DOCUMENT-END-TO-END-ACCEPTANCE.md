# Phase 9.8 – Gesamt-Acceptance der sechs Dokumentarten

## Ergebnis

**GO für den aktuellen fachlichen Teststand.** Alle sechs verbindlichen
Dokumentfamilien werden erkannt und in ihren vorgesehenen Vertrag importiert.
Es wurden keine P0- oder P1-Fehler gefunden. Die Grenzen bei Umlauftafeln und
bei Quellen ohne vollständige Dienstplandaten werden neutral ausgewiesen, nicht
als fachliche Fehler behandelt.

Die folgenden Läufe wurden mit den im Workspace vorhandenen anonymisierten
Referenzen durchgeführt; die JES-Wagenkarte wurde zusätzlich mit der real
bereitgestellten XLSX geprüft.

## Erkennung und Import

| Dokumentfamilie | Verwendete Referenz | Organisation / Typ | Vertrag | Ergebnis |
| --- | --- | --- | --- | --- |
| JNV Dienstübersicht neu PDF | `jnv-schedule.pdf` | JNV / Dienstübersicht (`beu-stadtbus-v1`) | `CanonicalSchedule`, 62 Dienste | FULL |
| JNV Dienstübersicht alt Excel | `legacy-schedule.xlsx` | JNV / `legacy_excel_schedule` | `CanonicalSchedule`, 61 Dienste | FULL im vorhandenen Alt-Excel-Vertrag |
| JNV Fahr-/Umlauftafel PDF | `jnv-umlauftafel.pdf` | JNV / Umlauftafel (`jnv-umlauftafel-pdf-v1`) | Umlauftafelvertrag, 33 Umläufe | FULL im Umlauftafelvertrag |
| JNV Fahr-/Umlauftafel Excel | `bus-umlauftafel.xlsx` | JNV / `umlaufkarte` | Umlauftafelvertrag, 34 Umläufe | FULL im Umlauftafelvertrag |
| JES Dienstübersicht neu PDF | `jes-schedule.pdf` | JES / Dienstübersicht (`jes-regionalbus-v1`) | `CanonicalSchedule`, 19 Dienste | FULL |
| JES Wagenkarten Excel | reale `20260526_Eisenberg_Schule.xlsx` | JES / Wagenkarte | `VehicleCardSchedule`, 23 Dienste | FULL für Block 7 |

## Tagesart und Gültigkeit

| Dokument | Tagesart / Variante / gültig ab | Herkunft | Bewertung |
| --- | --- | --- | --- |
| JNV Dienstübersicht PDF | Montag–Freitag / Schule / 17.08.2026 | Dokumentkopf | FULL |
| JNV Alt-Excel | unbekannt / unbekannt / 27.07.2026 | keine eindeutige Tagesart, Datum aus Kopf | korrekt: keine Annahme |
| JNV Umlauftafel PDF | Montag–Freitag / Ferien / 23.07.2026 | Dokumentkopf | FULL |
| JNV Umlauftafel Excel | unbekannt / Ferien / kein Datum | Referenz enthält keine eindeutige Tagesart | korrekt: keine Annahme |
| JES Dienstübersicht PDF | Montag–Freitag / Ferien / 13.07.2026 | Dokumentkopf | FULL |
| JES Wagenkarte Excel | Montag–Freitag / Schule / 26.05.2026 | Kopf / Workbook-Metadaten | FULL |

Die UNKNOWN-Fälle sind absichtlich nicht als Montag–Freitag bewertet. Die
manuelle Rückfallebene aus Phase 9.4 bleibt dafür der vorgesehene Weg; die
vorhandenen Tests decken UNKNOWN, Mo–Fr, Samstag, Sonntag, Override und
Dateiwechsel ab.

## Fachliche Stichproben

### JNV Dienstübersicht PDF

- 62 Dienste und 12 strukturierte Unterbrechungen importiert.
- Block 2: 12 eindeutige geteilte Dienste; keine Doppelzählung.
- Block 6: drei vorhandene Dienstteilhinweise; keine Wagenkarten-Lenkzeit
  beigemischt.
- Block 10: reguläre Pausen sowie lange Unterbrechungen getrennt. Dienst 2189
  zeigt weiterhin **03:37 h** Arbeitszeit vor Pause, Grundlage
  Arbeitszeitdaten, **BV eingehalten** – nicht den früheren Fehlwert 08:51 h.
- Block 7 bleibt neutral nicht verfügbar, weil keine Wagenkarte/Umlauftafel-
  Lenkzeitbasis vorliegt.

### JNV Alt-Excel

- Nicht mehr `unknown`; Klassifikation exakt `legacy_excel_schedule` mit
  Organisation JNV.
- 61 Dienste werden in den vorhandenen Canonical-Alt-Excel-Vertrag projiziert.
- Die Referenz enthält keine belegte Tagesart. Deshalb bleibt die Mo–Fr-
  spezifische Block-4-Bewertung neutral, bis eine manuelle Auswahl erfolgt.
- Pausen-/Unterbrechungsdetails sind nur insoweit auswertbar, wie sie die alte
  tabellarische Quelle liefert; es wird keine PDF-Datenfülle behauptet.

### JNV Umlauftafeln PDF und Excel

- PDF: 33 Umläufe; mehrseitiger Umlauf 11100 wird aus Seiten 3/4 zusammengeführt.
  Linien/Route, Fahrzeug, Zeiten, Leerfahrten und einzelne Dienstbezüge bleiben
  erhalten. Kombinierte Angabe `2247/2256` bleibt als getrennte Referenzen
  2247, 2256 und 2282 erhalten.
- Excel: 34 Umläufe im bestehenden, JNV-spezifischen Umlauftafelvertrag.
- In beiden Fällen zeigt Block 7 bewusst nur den neutralen Hinweis. Es wird
  keine JES-Wagenkarten-Lenkzeitlogik auf Umlauftafeln angewandt.

### JES Dienstübersicht PDF

- 19 Dienste, Montag–Freitag/Ferien, gültig ab 13.07.2026.
- Block 2 verwendet den gemeinsamen Canonical-Interruption-Vertrag:
  756, 758, 759 und 760 sind exakt einmal als geteilte Dienste enthalten.
- Die vier Unterbrechungen bleiben strukturiert und die Schichtspannen
  entsprechen den vorangegangenen Akzeptanzwerten.
- Block 10 enthält deklarierte Pausen; Block 7 bleibt ohne Wagenkarte neutral.

### JES Wagenkarten Excel

- Reale Datei: 23 Sheets und 23 Dienste, Montag–Freitag/Schule, gültig ab
  26.05.2026.
- Alle geprüften L5-Kopfwerte wurden unverändert übernommen.
- Pflichtfälle:
  - 602: neun Fahr-/Leerfahrsegmente, Pause 07:49–08:19, maximaler
    Lenkzeitblock **01:55**.
  - 605: Dienstunterbrechung **08:00–11:57**, zwei Lenkzeitblöcke, Maximum
    03:28.
  - 613: Pausen 08:18–08:33 und 11:43–12:13, drei Lenkzeitblöcke, Maximum
    01:53.
  - Zusätzliche Gegenproben 608 und 641: L5, Fahrtzahl und Pausenstruktur
    stimmen mit der ausführbaren Legacy-Auslesung überein.
- Zusatzzeiten bleiben getrennt von der berechneten Fahr-/Leerfahrzeit.

## Blockmatrix

`FULL` bedeutet fachlich passende Datenbasis; `PARTIAL` bedeutet, dass die
Quelle selbst nicht alle Informationen liefert. `NOT APPLICABLE` ist eine
neutrale, erwartete Dokumentgrenze.

| Dokument | B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| JNV Dienstübersicht PDF | FULL | FULL | FULL | FULL | FULL | FULL | NOT APPLICABLE | FULL | FULL | FULL |
| JNV Alt-Excel | FULL | PARTIAL | FULL | PARTIAL | FULL | PARTIAL | NOT APPLICABLE | FULL | FULL | PARTIAL |
| JNV Umlauftafel PDF | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE (neutral) | NOT APPLICABLE | PARTIAL (Linien/Route) | NOT APPLICABLE |
| JNV Umlauftafel Excel | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE (neutral) | NOT APPLICABLE | PARTIAL (Linien/Route) | NOT APPLICABLE |
| JES Dienstübersicht PDF | FULL | FULL | FULL | FULL | FULL | FULL | NOT APPLICABLE | FULL | FULL | FULL |
| JES Wagenkarte Excel | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | FULL | NOT APPLICABLE | PARTIAL (Fahrtinformationen) | NOT APPLICABLE |

Es bleibt kein `WRONG`-Status. Die partiellen Felder sind quellenseitig bzw.
vertraglich begrenzt und werden nicht als leere Vollanalyse ausgegeben.

## BV, Dashboard und Ausgaben

- Die vorhandene Mo–Fr-Block-4-Bewertung erhält die Canonical-Tagesart. Samstag,
  Sonntag und UNKNOWN werden nicht als Mo–Fr behandelt.
- Die bestehenden Tests prüfen die konsistente Statusquelle für Review Dashboard,
  Prüfbericht und Detailprüfung sowie die Anzeige echter Dienstnummern statt
  technischer IDs.
- Für Dienstübersichten ist der Dienstübersicht-XLSX-Export weiterhin über
  denselben Canonical-Vertrag belegt: Blatt `Dienstübersicht`, zwölf Spalten,
  Titel, Pausenmarkierung sowie A4-Querformat. Umlauftafeln und Wagenkarten
  werden nicht künstlich in diesen Export gepresst.
- Druckausgabe und Statusdarstellung sind durch die bestehenden Print- und
  Status-Tests abgedeckt. Es gab in diesem Audit keine Druck-/Exportänderung.

## Browser und Mobile

Eine interaktive Browser- und 390-px-Prüfung stand in dieser Umgebung nicht
zur Verfügung; sie wurde nicht simuliert. Die produktiven Importadapter wurden
jedoch mit den realen/anonymisierten Dateien End-to-End ausgeführt. Es traten
keine produktiven Importwarnungen oder JavaScript-Ausnahmen auf. Eine erneute
manuelle Browserabnahme bleibt als P3-UX-Nachweis sinnvoll, ist jedoch kein
fachlicher GO-Blocker.

## Testnachweis

`npm test` außerhalb der Sandbox: **2310 bestanden, 0 Fehler, 0 Skips**.
Der Sandbox-Lauf kann die lokalen HTTP-Smoke-Tests wegen fehlender Binderechte
auf `127.0.0.1` nicht ausführen; außerhalb der Sandbox sind auch diese Tests
grün.

## Restpunkte

1. P3: interaktive Browser-/Mobile-Sichtprüfung nach einem späteren Deployment.
2. P2, bewusst abgegrenzt: eigene Fahrzeit-/Block-7-Fachbewertung für JNV-
   Umlauftafeln; keine Fehlfunktion der bestehenden JES-Wagenkartenanalyse.
3. P3: Bei Alt-Excel bzw. Umlauftafel-Excel ohne eindeutige Tagesart kann die
   manuelle Rückfallebene genutzt werden.

## Freigabe

**GO – kein P0/P1-Befund, alle sechs Dokumentfamilien im vorgesehenen Vertrag
erfolgreich abgenommen.**
