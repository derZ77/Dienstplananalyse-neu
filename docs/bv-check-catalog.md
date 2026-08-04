# BV-Prüfkatalog – Dienstplanparameter final 2025

## Geltungsbereich und Quellenlage

Dieser Katalog zerlegt die in den bereitgestellten Screenshots lesbaren §§ 3–8 der **„BV Dienstplanparameter final 2025“** in technische Prüfvorschriften. Die Screenshots zeigen die Seiten 2–5 von insgesamt 8 Seiten. §§ 1–2 sowie die in § 3 und § 4 genannten **Anlagen 1 und 2** liegen nicht vor. Dafür werden keine Inhalte geschätzt oder implementiert.

Statuswerte:

- **Vorhanden**: im Legacy-Bestand bereits fachlich gleich geprüft.
- **Teilweise**: ein Teil der Daten oder Schwelle ist vorhanden, aber Kontext/Logik fehlt.
- **Fehlt**: fachlich technisch denkbar, im Bestand nicht umgesetzt.
- **Nicht prüfbar**: notwendige Daten oder die konkrete Vorgabe fehlen.

Priorität beschreibt die empfohlene spätere Reihenfolge, nicht die Rechtsverbindlichkeit: **P0** = Daten-/Regelgrundlage zuerst klären, **P1** = hoher betrieblicher Nutzen, **P2** = nachgelagert, **P3** = Prozess-/nichttechnisch.

## Datenfähigkeitsmatrix

| Datenquelle | Heute verfügbar | Einschränkung |
|---|---|---|
| CanonicalSchedule | Dienstnummer, Beginn/Ende, bezahlte Zeit, Aktivitäten, Zeiten, Orte, Umlauf, Quellen | CheckRunner erhält derzeit nur `AnalysisResult`; aktivitätsgenaue Checks benötigen eine spätere Erweiterung des `AnalysisResult`-Vertrags oder ein entsprechendes Analyse-Teilresultat. |
| PDF-Dienstübersicht | Geplante Dienste, Aktivitäten, Zeiten, Orte, Umläufe | Keine offizielle Lenkzeit, keine vollständige Haltestellenfolge, keine Echtzeit-/Verspätungsdaten. |
| Wagenkarte | Fahrtfolge, Haltestellen, Linien-/Leerfahrten, Lenkzeitkopf, Pausen-/Dienstteilinformationen | Noch kein Wagenkarten-Canonical-Adapter. |
| Anlagen 1/2 der BV | Nicht vorliegend | Erforderlich für zulässige Pausenorte, Wegezeiten, WC-/Pausenraum- und Fahrzeugabstellbedingungen sowie zulässige Anfangs-/Endpunkte. |
| Personal-/Turnusplanung | Nicht vorliegend | Erforderlich für Ruhezeit zwischen Diensten, wöchentliche geteilte Dienste, Verfügungsdienste und freie Wochenenden. |
| Ausnahme-/Freigabedaten | Nicht vorliegend | Erforderlich für ausdrücklich vereinbarte Ausnahmen (z. B. 9-Stunden-Dienst, Baumaßnahmen). |

## Technischer Prüfkatalog

### § 3 Arbeits- und Ruhezeiten

#### BV001 – Vor-/Nachbereitungszeit am Betriebshof (§ 3 Abs. 1)

- **Kurzbeschreibung / Ziel:** Dienstbeginn und Dienstende bei Ein-/Ausfahrt Betriebshof Burgau oder Nord jeweils mit 10 Minuten Vor-/Nachbereitung; bei notwendiger Betankung zusätzlich 10 Minuten Nachbereitung.
- **Prüfbarkeit:** Teilweise. Vor- und Nachbereitungsaktivitäten und ihre Dauer sind aus PDF/Excel abbildbar; die Einstufung „Betriebshof“ benötigt einen Ortsstamm. Betankung ist nicht als Canonical-Feld vorhanden.
- **Benötigte Daten:** `activityType` Vorbereitung/Nachbereitung, Aktivitätsdauer, Start-/Endort, Ortsklassifikation, Betankungskennzeichen.
- **CanonicalSchedule ausreichend:** Teilweise. **Wagenkarte:** nein. **Weitere Dokumente:** Ortsstamm und Betankungsinformation.
- **Legacy-Status:** Teilweise – Zeiten werden angezeigt, aber nicht gegen 10/20 Minuten geprüft. **Priorität:** P1.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP21). Der Check verwendet ausschließlich `ReferenceDataContext`: `LOCATION_CATALOG.locations[]` mit expliziter Klassifikation `DEPOT` sowie `PLAN_METADATA.fuelingServiceIds`. Er prüft nur vollständig zuordenbare Vorbereitungs- und Nachbereitungsaktivitäten; ohne Ortsstamm, Betankungsliste oder Zeitwerte ist er `NOT_APPLICABLE` bzw. `SKIP` und nimmt keine Betankung an.

#### BV002 – Vor-/Nachbereitungszeit auf der Strecke (§ 3 Abs. 2)

- **Kurzbeschreibung / Ziel:** Dienstbeginn und -ende auf der Strecke jeweils mit 5 Minuten Vor-/Nachbereitung.
- **Prüfbarkeit:** Teilweise. Die Dauer ist verfügbar, „auf der Strecke“ verlangt eine belastbare Ortsklassifikation gegenüber Betriebshof.
- **Benötigte Daten:** wie BV001, zusätzlich Standortklasse.
- **CanonicalSchedule ausreichend:** Teilweise. **Wagenkarte:** nein. **Weitere Dokumente:** Ortsstamm.
- **Legacy-Status:** Teilweise – Tätigkeiten vorhanden, keine Sollzeitprüfung. **Priorität:** P1.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP21). Der Check verwendet ausschließlich `ReferenceDataContext.LOCATION_CATALOG` mit expliziter Klassifikation `ROUTE` und prüft zuordenbare Vorbereitungs-/Nachbereitungsaktivitäten gegen 5 Minuten. Nicht katalogisierte Orte werden nicht als Strecke angenommen, sondern führen zu `NOT_APPLICABLE`.

#### BV003 – Gleiche Anfangs- und Endorte (§ 3 Abs. 3)

- **Kurzbeschreibung / Ziel:** Bei der Dienstplanung sollen gleiche Anfangs- und Endorte angestrebt werden; zulässige Punkte stehen in Anlage 2, Abweichungen sind abzustimmen.
- **Prüfbarkeit:** Der reine Ortsvergleich ist prüfbar; die Zulässigkeit und genehmigte Abweichung nicht ohne Anlage/Freigabe.
- **Benötigte Daten:** erste Abfahrts- und letzte Ankunftsposition, Liste zulässiger Punkte, Abweichungsfreigabe.
- **CanonicalSchedule ausreichend:** für Gleichheit ja, für Vollprüfung nein. **Wagenkarte:** nein. **Weitere Dokumente:** Anlage 2, Freigabedaten.
- **Legacy-Status:** Teilweise – Legacy-Block 5 meldet unterschiedliche Orte mit vier fest hinterlegten Gleichwertigkeitscodes. **Priorität:** P1.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP17, dieser Commit). Technisch wird ausschließlich die direkte Gleichheit des ersten Abfahrts- und letzten Ankunftsorts geprüft; Anlage-2-Zulässigkeit und Freigaben bleiben unbewertet.

#### BV004 – Mindestdienstlänge (§ 3 Abs. 4)

- **Kurzbeschreibung / Ziel:** Mindestdienstlänge entspricht Tarifvertrag; Abweichung nur für Beschäftigte im zweiten AV und Sonderfahrten.
- **Prüfbarkeit:** Nicht prüfbar, weil der Tarifwert sowie AV- und Sonderfahrtdaten fehlen.
- **Benötigte Daten:** bezahlte Zeit, Tarifvertragsparameter, Beschäftigten-/AV-Bezug, Sonderfahrtkennzeichen.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nein. **Weitere Dokumente:** Tarifvertrag, Personal- und Sonderfahrtdaten.
- **Legacy-Status:** Nicht prüfbar. **Priorität:** P0.

#### BV005 – Maximale bezahlte Arbeitszeit (§ 3 Abs. 4)

- **Kurzbeschreibung / Ziel:** Mo–Fr Schule/Ferien maximal 8:30, Samstag/Sonntag/Feiertag 9:00; eine abgestimmte Ausnahme bis 9:00 an Mo–Fr für Bus und Straßenbahn ist möglich.
- **Prüfbarkeit:** Teilweise. Bezahlte Zeit ist vorhanden; Gültigkeitstag und Ausnahmefreigabe müssen eindeutig vorliegen.
- **Benötigte Daten:** `paidTime`, Planzeitraum/Tagtyp, Fahrzeugart, Ausnahmefreigabe.
- **CanonicalSchedule ausreichend:** teilweise (Zeit vorhanden; Zeitraum/Fahrzeug nur indirekt aus Dienstnummer). **Wagenkarte:** nein. **Weitere Dokumente:** Freigaberegister und ggf. Planmetadaten.
- **Legacy-Status:** Teilweise – Legacy-Block 4 prüft >08:30 unabhängig von Wochenend- oder Ausnahmefall. **Priorität:** P1.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP17, dieser Commit). Der Check nutzt nur vorhandene Planmetadaten bzw. die Legacy-Zeitraumzuordnung; ohne Zeitraum wird er übersprungen, Ausnahmefreigaben werden nicht bewertet.

#### BV006 – Mindest-/Maximaldauer geteilte Dienste (§ 3 Abs. 4)

- **Kurzbeschreibung / Ziel:** Teildienst mindestens 2:00, maximal 6:00; Ausnahme bei Dienstverlängerung außerhalb der Fahrtätigkeit (z. B. Gespräch/Schulung).
- **Prüfbarkeit:** Teilweise. Dienstteile und Ausnahmegründe sind im aktuellen CanonicalSchedule nicht verbindlich modelliert.
- **Benötigte Daten:** Markierung geteilter Dienst, Grenzen der Dienstteile, Aktivitätstypen, Ausnahmegrund.
- **CanonicalSchedule ausreichend:** teilweise. **Wagenkarte:** für belastbare Dienstteilgrenzen sinnvoll. **Weitere Dokumente:** Ausnahme-/Schulungsdaten.
- **Legacy-Status:** Teilweise – Legacy-Blöcke 2 und 6 erkennen Nummernbereiche bzw. lange Segmente, nicht die BV-Teildienstregel vollständig. **Priorität:** P1.

#### BV007 – Zeitgrenzen geteilte Dienste (§ 3 Abs. 4)

- **Kurzbeschreibung / Ziel:** frühester Dienstbeginn 03:00, bei geteilten Diensten 04:45; spätester Dienstschluss geteilter Dienste 19:00.
- **Prüfbarkeit:** Teilweise. Beginn/Ende sind vorhanden, die fachlich korrekte Kennzeichnung „geteilt“ fehlt außerhalb des Legacy-Nummernbereichs bzw. der Wagenkarte.
- **Benötigte Daten:** Beginn, Ende, geteilter-Dienst-Status.
- **CanonicalSchedule ausreichend:** teilweise. **Wagenkarte:** nein, sofern geteilter-Dienst-Status anderweitig verlässlich entsteht. **Weitere Dokumente:** keine.
- **Legacy-Status:** Teilweise – Beginne/Enden und Legacy-Teilungsnummern sind vorhanden; keine Grenzprüfung 03:00/04:45/19:00. **Priorität:** P1.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP17, dieser Commit). Der allgemeine Beginn wird gegen 03:00 geprüft; die Grenzen 04:45/19:00 nur bei explizitem Teilungsstatus aus Planmetadaten oder Legacy-Migration.

#### BV008 – Schichtlänge und ununterbrochene Lenkzeit geteilter Dienste (§ 3 Abs. 4)

- **Kurzbeschreibung / Ziel:** maximale Schichtlänge 12:00 und maximale ununterbrochene Lenkzeit 4:30.
- **Prüfbarkeit:** Schichtlänge teilweise, Lenkzeit nur mit belastbarer Fahrtklassifikation und Unterbrechungen.
- **Benötigte Daten:** Beginn/Ende, geteilter-Dienst-Status, `drivingTimeSource`, Fahrten/Leerfahrten, Pausen.
- **CanonicalSchedule ausreichend:** für Schichtlänge teilweise, für verbindliche Lenkzeit nein. **Wagenkarte:** ja für Lenkzeit. **Weitere Dokumente:** keine.
- **Legacy-Status:** Teilweise – Block 2 meldet bei Legacy-Teilungsnummern >12:00; Wagenkartenblock „Lenkzeit real“ prüft 04:30. **Priorität:** P1.

#### BV009 – Ruhezeit (§ 3 Abs. 5)

- **Kurzbeschreibung / Ziel:** mindestens 2:00 zwischen zwei Dienstteilen eines geteilten Dienstes und 11:00 ununterbrochen zwischen zwei Diensten.
- **Prüfbarkeit:** Die 2:00 innerhalb eines korrekt segmentierten Dienstes ist möglich; 11:00 erfordert eine zeitlich geordnete Dienstreihe je Person.
- **Benötigte Daten:** Dienstteilgrenzen, Personen-/Turnuszuordnung, Dienste über mehrere Tage.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nein. **Weitere Dokumente:** Personal- bzw. Turnusplan.
- **Legacy-Status:** Fehlt. **Priorität:** P2.

### § 4 Pausen

#### BV010 – Blockpause 30 Minuten (§ 4 Abs. 1)

- **Kurzbeschreibung / Ziel:** Regelfall einer Blockpause von 30 Minuten.
- **Prüfbarkeit:** Ja, sobald bezahlte/unbezahlte Pausen als Aktivitäten vorliegen und aktivitätsgenau an Check-Module übergeben werden.
- **Benötigte Daten:** Pausenaktivität, Beginn/Ende, Dauer, Bezahlt-Status.
- **CanonicalSchedule ausreichend:** ja. **Wagenkarte:** nein. **Weitere Dokumente:** keine.
- **Legacy-Status:** Teilweise – Block 9 betrachtet Lücken von 30–120 Minuten, jedoch nicht als vollständigen Blockpausencheck. **Priorität:** P1.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP17, dieser Commit). Ausschließlich vorhandene Aktivitäten vom Typ `unpaidBreak` werden gegen 30 Minuten geprüft.

#### BV011 – Lage der Blockpause (§ 4 Abs. 2)

- **Kurzbeschreibung / Ziel:** Pause frühestens nach 3:30 und spätestens nach 4:30; Pausenende maximal zwei Stunden vor Dienstende; bei Straßenbahn maximal zwei Dienststücke.
- **Prüfbarkeit:** Teilweise. Zeitwerte sind vorhanden; Fahrzeugart und korrekt abgeleitete Dienststücke müssen verlässlich modelliert sein.
- **Benötigte Daten:** Dienstbeginn/-ende, Pausen, Dienststücke, Fahrzeugart.
- **CanonicalSchedule ausreichend:** teilweise. **Wagenkarte:** nein für Planprüfung, sinnvoll zur Validierung der Dienststücke. **Weitere Dokumente:** Planmetadaten/Fahrzeugart.
- **Legacy-Status:** Teilweise – Block 9 enthält 3:30–4:30 als BV-Hinweis, aber nicht alle Bedingungen. **Priorität:** P1.

#### BV012 – Abzug und Puffer bei Blockpausen (§ 4 Abs. 2)

- **Kurzbeschreibung / Ziel:** maximal 30 Minuten abzugfähig; Abzug erst ab 33 Minuten Pause (Verspätungspuffer).
- **Prüfbarkeit:** Ja für planmäßige Pausendauer; nicht für reale Verspätungswirkung.
- **Benötigte Daten:** Pausenaktivität, Dauer, Bezahlt-/Abzugsstatus.
- **CanonicalSchedule ausreichend:** ja für Planprüfung. **Wagenkarte:** nein. **Weitere Dokumente:** Echtzeitdaten für Verspätungsprüfung.
- **Legacy-Status:** Teilweise – Block 9 enthält ortsabhängige 33/39-Minuten-Hinweise, aber keine Abzugsberechnung. **Priorität:** P1.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP17, dieser Commit). Der 33-Minuten-Puffer wird für explizit unbezahlte Pausen geprüft. Ein tatsächlich gebuchter Abzugsbetrag ist kein vorhandenes Datenfeld und wird deshalb weder geschätzt noch bewertet; die 30-Minuten-Obergrenze bleibt als Ergebnisdetail dokumentiert.

#### BV013 – Wegezeit bei Blockpausen (§ 4 Abs. 3)

- **Kurzbeschreibung / Ziel:** Pausenbeginn ergibt sich aus Ankunft zuzüglich gegebenenfalls Wegezeit laut Anlage 1.
- **Prüfbarkeit:** Nicht ohne Anlage 1 und einen Orts-/Wegezeitstamm.
- **Benötigte Daten:** Ankunftsort/-zeit, Pausenort/-zeit, Wegezeitmatrix Anlage 1.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nein. **Weitere Dokumente:** Anlage 1.
- **Legacy-Status:** Fehlt. **Priorität:** P0.

#### BV014 – Ausweis unbezahlter Pausen (§ 4 Abs. 4)

- **Kurzbeschreibung / Ziel:** Unbezahlte Pausen sind auf der Dienstliste auszuweisen.
- **Prüfbarkeit:** Ja als Datenvollständigkeits-/Darstellungsprüfung; eine spätere UI-/Exportprüfung liegt außerhalb dieses Katalogs.
- **Benötigte Daten:** `activityType: unpaidBreak`, Rohtext, Quelle und spätere Ausgaberepräsentation.
- **CanonicalSchedule ausreichend:** ja für Datenprüfung. **Wagenkarte:** nein. **Weitere Dokumente:** keine.
- **Legacy-Status:** Teilweise – Pausen werden analysiert und PDF-Regeln klassifizieren sie, kein allgemeiner Ausweis-Check. **Priorität:** P2.
- **Implementierungsstatus:** **IMPLEMENTIERT** (AP17, dieser Commit). Der Datencheck verlangt für jede klassifizierte unbezahlte Pause Rohtext und Quellenbezug; eine spätere UI-/Exportdarstellung wird nicht geprüft.

### § 5 Arbeitsunterbrechungen

#### BV015 – Zulässigkeit der 1/6-Regel (§ 5 Abs. 1)

- **Kurzbeschreibung / Ziel:** Anwendung nur bei Nachtdiensten, Samstag/Sonntag/Feiertag oder Buslinie 18; Ausnahmen nur im Einvernehmen.
- **Prüfbarkeit:** Nicht vollständig. Nacht/Tagtyp/Linie müssen strukturiert vorliegen, Ausnahmen benötigen Freigabedaten.
- **Benötigte Daten:** Dienstzeit, Tagtyp, Linie, Fahrzeugart, 1/6-Kennzeichen, Ausnahmefreigabe.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nicht zwingend, aber Linien-/Fahrtdaten hilfreich. **Weitere Dokumente:** Ausnahme- und Planmetadaten.
- **Legacy-Status:** Fehlt. **Priorität:** P0.

#### BV016 – Anrechenbare Wendezeit (§ 5 Abs. 2)

- **Kurzbeschreibung / Ziel:** Nach technisch erforderlicher Wendezeit für Umsetzen, Verspätungsausgleich und Fahrzeugkontrolle müssen mindestens 10 Minuten Pausenzeit verbleiben.
- **Prüfbarkeit:** Nicht prüfbar mit Planzeiten allein.
- **Benötigte Daten:** Wendezeitstamm, Fahrzeug-/Fahrtkontext, tatsächliche oder geplante Verspätung, Fahrzeugkontrollbedarf.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** hilfreich, aber nicht ausreichend. **Weitere Dokumente:** technische Wendezeit- und Betriebsdaten.
- **Legacy-Status:** Teilweise – Wagenkarte erkennt Wendezeit, keine BV-Anrechenbarkeitsprüfung. **Priorität:** P0.

#### BV017 – Verspätungsfall 1/6-Regel (§ 5 Abs. 3)

- **Kurzbeschreibung / Ziel:** Reichen durch Verspätung zehn Minuten nicht, muss Blockpause ohne Abzug organisiert werden.
- **Prüfbarkeit:** Nicht prüfbar ohne Ist-/Verspätungsdaten und Leitstellenentscheidung.
- **Benötigte Daten:** Echtzeitfahrdaten, 1/6-Status, Pausendisposition, Leitstellenmaßnahme.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nein. **Weitere Dokumente:** Leitstellen-/Echtzeitdaten.
- **Legacy-Status:** Nicht prüfbar. **Priorität:** P0.

#### BV018 – Anforderungen an 1/6-Orte (§ 5 Abs. 4)

- **Kurzbeschreibung / Ziel:** gesetzlicher 1/6-Anteil nur an Orten mit WC/Pausenraum, Anlage-1-Freigabe sowie Möglichkeit zum Verlassen/Abstellen des Fahrzeugs.
- **Prüfbarkeit:** Nicht ohne Anlage 1 und Infrastruktur-/Fahrzeugdaten.
- **Benötigte Daten:** Unterbrechungsort, Standortausstattung, Fahrzeugabstellbarkeit, Anlage 1.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** hilfreich für Ort/Fahrt, aber nicht ausreichend. **Weitere Dokumente:** Anlage 1 und Infrastrukturstamm.
- **Legacy-Status:** Nicht prüfbar. **Priorität:** P0.

### § 6 Dienstreihenfolge (Turnus)

#### BV019 – Turnusgrundsätze (§ 6 Abs. 1)

- **Kurzbeschreibung / Ziel:** gleichmäßige Schichtlagen; Beginnsdifferenz unter zwei Stunden; maximal zwei geteilte Dienste pro Woche; maximal 14 Kalendertage Verfügungsdienst; in der Regel jedes zweite Wochenende frei.
- **Prüfbarkeit:** Nicht mit einem einzelnen Dienstplan. Es ist eine personenbezogene Mehrwochen-Turnusdatenbasis nötig.
- **Benötigte Daten:** Mitarbeiter-/Turnuszuordnung, Kalender, Dienste mehrerer Wochen, Verfügungsdienstkennzeichen, geteilter-Dienst-Status.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nein. **Weitere Dokumente:** Turnus-/Personalplanung.
- **Legacy-Status:** Teilweise – Legacy-Block 7 ordnet Schichtlagen zu, prüft aber keine Turnusregel. **Priorität:** P2.

### §§ 7–8

#### BV020 – Vorlage an den Betriebsrat (§ 7 Abs. 1)

- **Kurzbeschreibung / Ziel:** Dienst- und Turnuspläne sind dem Betriebsrat rechtzeitig vorzulegen.
- **Prüfbarkeit:** Nicht als Dienstplaninhalt; nur als Prozess-/Dokumentenworkflow.
- **Benötigte Daten:** Planversion, Eingangs-/Vorlagezeitpunkt, Empfänger-/Freigabenachweis.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nein. **Weitere Dokumente:** Dokumentenmanagement/Workflow.
- **Legacy-Status:** Nicht prüfbar. **Priorität:** P3.

#### BV021 – Salvatorische Klausel (§ 8 Abs. 1)

- **Kurzbeschreibung / Ziel:** Regelung zur Teilunwirksamkeit der BV.
- **Prüfbarkeit:** Keine technische Dienstplanprüfung.
- **Benötigte Daten:** keine.
- **CanonicalSchedule ausreichend:** nein. **Wagenkarte:** nein. **Weitere Dokumente:** Rechts-/Vertragsbewertung.
- **Legacy-Status:** Nicht prüfbar. **Priorität:** P3.

## Abgleich mit Legacy-Blöcken 1–8

| Legacy-Block | Bestehende Funktion | BV-Bezug | Status |
|---|---|---|---|
| 1 | Dienstnummern, Planart, Anzahl | Kontext für BV005/BV011 | Teilweise |
| 2 | geteilte Dienste nach Nummernbereich, Schichtdauer >12:00 | BV006–BV008 | Teilweise |
| 3 | Reserve-Dienste | kein direkter sichtbarer BV-Paragraph | Vorhanden, aber kein BV-Check |
| 4 | bezahlte Zeit >08:30 | BV005 | Teilweise |
| 5 | unterschiedliche Anfangs-/Endorte | BV003 | Teilweise |
| 6 | Dienstteilstücke >04:30, Lücken <30 | BV006/BV008 nur indirekt | Teilweise |
| 7 | Schichtzuweisung | BV019 nur als Vorarbeit | Teilweise |
| 8 | Dienste nach Linie/Kurs | BV015 (Linie 18) nur als Vorarbeit | Teilweise |
| 9 (außerhalb 1–8) | Pausen 30–120, Orts-/Zeitfensterhinweise | BV010–BV012 | Teilweise |
| Wagenkarten-Lenkzeit | reale Lenkzeitblöcke vor/nach Pause | BV008 | Teilweise, Wagenkarte erforderlich |

## Zusammenfassung und nächste fachliche Voraussetzungen

- **Katalogisierte Prüfvorschriften:** 21 (BV001–BV021), davon 19 fachliche Dienstplan-/Arbeitszeitkandidaten und 2 nichttechnische Prozess-/Rechtsklauseln.
- **Ohne Wagenkarte grundsätzlich implementierbar:** BV003 (Basisvergleich), BV005 (mit Planmetadaten), BV007 (mit Teilungsstatus), BV010, BV012 und BV014; BV001, BV002, BV006 und BV011 nach Ergänzung eines Orts-/Dienststückmodells.
- **Wagenkarte erforderlich oder für eine belastbare Aussage maßgeblich:** BV008 (Lenkzeitanteil) sowie die Wagenkartenbestätigung zu BV006/BV011; Wagenkarte allein reicht bei BV016 nicht aus.
- **Bereits durch Legacy teilweise abgedeckt:** BV003, BV005–BV008, BV010–BV012, BV019.
- **Neu zu entwickeln:** sämtliche vollständigen BV-Prüfungen. Zuerst sind die fehlenden Anlagen, Zeit-/Orts-/Fahrzeugmetadaten, Ausnahme- und Turnusdaten sowie ein aktivitätsgenauer Check-Eingabevertrag zu beschaffen bzw. zu modellieren.

## AP21 – Referenzdatenstatus

| Status | Regeln | Begründung |
| --- | --- | --- |
| **IMPLEMENTIERT** | BV001, BV002 | Benötigte Ortsklassifikationen sowie – für BV001 – Betankungskennzeichen können vollständig über den vorhandenen `ReferenceDataContext` bereitgestellt werden. |
| **Bereits implementiert, unverändert** | BV003, BV005, BV007, BV010, BV012, BV014 | Diese AP17-Checks werden in AP21 weder geändert noch durch Referenzdaten ersetzt. |
| **REFERENZDATEN / Fachmodell fehlen** | BV004, BV006, BV008, BV009, BV011, BV013, BV015–BV020 | Es fehlen mindestens Tarif-/Fahrzeug-/Dienststück-, Wagenkarten-/Echtzeit-, Personen-/Turnus- oder anlagenbezogene Daten in belastbarer Verknüpfung zum bestehenden CanonicalSchedule. |
| **Nicht als technische Dienstplanregel umsetzbar** | BV021 | Salvatorische Klausel; keine Referenzdatenprüfung. |

BV001 und BV002 dokumentieren ihre jeweiligen Referenzdatenanforderungen direkt im `CheckResult.details` bei `NOT_APPLICABLE`. Die übrigen Regeln werden erst erweitert, wenn sowohl die erforderlichen Referenzdaten als auch die im Katalog genannten fachlichen Verknüpfungsfelder tatsächlich vorliegen.
