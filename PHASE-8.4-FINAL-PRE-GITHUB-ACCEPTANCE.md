# Phase 8.4 – Final Pre-GitHub Acceptance

## Ergebnis

**GO für das GitHub-Testupdate.**

Getestete Referenzen:

- JES PDF: `tests/fixtures/jes-schedule.pdf`
- JNV PDF: `tests/fixtures/jnv-schedule.pdf`
- JES Excel: `tests/fixtures/jes-ten-column-schedule.xlsx`

Keine Fachregel, kein Parser und keine Block-1-bis-10-Berechnung wurden verändert.

## End-to-End-Ergebnisse

| Eingang | Ergebnis |
| --- | --- |
| JES PDF | JES Regionalbus Mo–Fr (Ferien), 19 Dienste; Analyse abgeschlossen; alle Blöcke befüllt; gültiger leerer CheckReport, da keine JES-Single-Schedule-Checks registriert sind. |
| JNV PDF | BEU Stadtbus Mo–Fr (Schule), 62 Dienste; Analyse abgeschlossen; alle Blöcke befüllt; 9 CheckResults. BV003 liefert eine echte `FAIL/WARNING`-Aussage für 52 betroffene Dienste. |
| JES Excel | `legacy_excel_schedule`, 19 Dienste; CanonicalSchedule, Basisanalyse, Abschlussstatus und gültiger leerer CheckReport werden nun vollständig an die UI übergeben. |

Browserprüfung: keine JavaScript-Fehler, keine fehlenden Statusbereiche.

## Blockstatus 1–10

| Block | Status |
| --- | --- |
| 1 | eindeutige Dienstanzahl sichtbar |
| 2 | geteilte Dienste und quellneutrale Schichtspanne sichtbar |
| 3 | Reserve-Dienste nach Import sichtbar; statische Start-ID-Liste entfernt |
| 4 | >08:30 und vorhandene BV-Zählung getrennt dargestellt |
| 5 | unterschiedliche Anfangs-/Endorte sichtbar |
| 6 | Dienstteilstücke >04:30 und vorhandene Ausnahmeinformation sichtbar |
| 7 | vorgesehenes Ergebnis: für tabellarische Dienstpläne nicht verfügbar |
| 8 | Schichtzuweisung sichtbar |
| 9 | Linie/Kurs sichtbar |
| 10 | reguläre Pausen und lange Unterbrechungen getrennt |

Die neue Phase-8.4-Acceptance bestätigt für JES Excel, JES PDF und JNV PDF dieselbe Block-Projektionsform ohne technische `Warte…`-Restwerte.

## Block-10-Grenztests

Erneut geprüft in `tests/phase8-2-split-duty-and-pause-analysis.test.js`:

- <30 Minuten: keine reguläre Blockpause, möglicher 1/6-Kontext
- 30, 60 und 120 Minuten: reguläre Blockpause
- >120 Minuten: lange Unterbrechung/geteilter Dienst, keine reguläre Blockpause
- Pausenlage 03:15: BV-Verstoß
- Pausenlage 03:30 und 04:30: BV eingehalten
- Pausenlage 04:45: BV-Verstoß
- fehlende strukturierte Arbeitszeit: sichtbarer Dienstbeginn-/Pausenbeginn-Fallback

## Review Dashboard, Prüfbericht und Explorer

JNV PDF zeigt in allen drei Ansichten dieselbe vorhandene Bewertung:

- Dashboard: 52 tatsächlich von BV003 benannte Dienste als Warnungen, 0 kritisch, 0 unauffällig.
- Prüfbericht: 9 Ergebnisse, 1 Prüfauffälligkeit, 1 Warnung, 2 übersprungen, 5 nicht anwendbar.
- Explorer: ausschließlich aufgelöste Dienstnummern, keine internen Canonical-IDs.
- Explorer-Filter `BV003`: 1 Zeile; nach Reset wieder 9 Zeilen.

JES PDF und JES Excel zeigen den neutralen Leerzustand eines gültigen CheckReports und keinen vermeintlichen Filterfehler.

## Mobile Prüfung

Bei 390 px wurden Upload-/Exportbereich, Suche, Dashboard, Prüfbericht und Explorer geprüft:

- äußere Bereiche ohne horizontalen Seitenüberlauf
- Upload- und Exportaktionen bedienbar
- Dashboard-Tabelle nutzt wegen ihrer neun Spalten den vorgesehenen horizontalen Tabellen-Scrollbereich
- keine JavaScript-Fehler

## XLSX-Prüfung

Im Browser ausgelöst:

- JNV PDF: generischer Dienstplanexport und Dienstübersicht erfolgreich lokal erzeugt
- JES PDF und JES Excel: Dienstübersicht erfolgreich lokal erzeugt

Die erneut ausgeführten Exporttests bestätigen Blatt `Dienstübersicht`, 12 Spalten, dynamischen Titel, Referenzfarben einschließlich Pausenmarkierung, kompakte Zeilenhöhen, Querformat, Druckbereich, Kopfzeilenwiederholung und XLSX-Roundtrip/OpenXML-Struktur.

Eine manuelle Microsoft-Excel-/LibreOffice-Desktop-Öffnung wurde nicht erneut durchgeführt. Die grüne OpenXML- und Roundtrip-Prüfung ist kein technischer Blocker.

## Korrigierte Kleinigkeiten

1. Die statische Reserve-ID-Liste wurde aus Block 3 im leeren Startzustand entfernt.
2. Ein erkannter eigenständiger `legacy_excel_schedule` läuft jetzt durch den vorhandenen Basis-Analysepfad.
3. Das Review Dashboard unterscheidet nun einen gültigen leeren CheckReport von einem Filter-Leerzustand.

## Offene Punkte

- Block 7 bleibt bis zu einer separaten Wagenkarten-/Umlauftafelphase bewusst nicht verfügbar.
- Ohne vorhandenes Matcher-Ergebnis bleibt die Tagesart korrekt `unbekannt`; sie wird nicht geraten.

## Tests

Neu bzw. erweitert:

- `tests/phase8-4-pre-github-acceptance.test.js`
- `tests/phase3h5-rule-analysis-session.test.js`
- `tests/review-dashboard.test.js`

`npm test` außerhalb der Sandbox: **2.249 bestanden, 0 Fehler, 0 Skips**.

Bekannte PDF.js-Canvas-/Standardfont-Warnungen der Node-Testumgebung bleiben ohne Testauswirkung.
