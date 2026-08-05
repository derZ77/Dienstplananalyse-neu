# Phase 5.5 – Release Candidate Acceptance Audit

**Datum:** 2026-08-05
**Geprüfter Ausgangsstand:** `b36d9f6845b0825157bd00a8359dc6e08b8f652c`
**Branch:** `main`
**Remote:** `origin` → `https://github.com/derZ77/Dienstplananalyse-neu.git`

## Umfang

Dieser Durchlauf ist ein Release-Audit. Es wurden keine Funktionen,
Fachregeln, Adapter oder Architekturteile verändert. Als ausschließlich
dokumentarische Korrektur wurde `README.md` ergänzt, weil sie zuvor nur den
Inhalt `# Test2` hatte und damit keine Startanleitung für externe Nutzende
bot.

## Repository-Audit

| Prüfkriterium | Ergebnis |
| --- | --- |
| Ausgangs-HEAD | `b36d9f6` |
| Uncommitted Änderungen am Auditbeginn | keine |
| Tags | keine vorhanden |
| Getrackte PDF-, Excel-, Office-, Schlüssel-, Datenbank- oder Umgebungsdateien | keine |
| Test- bzw. Referenzdaten im Repository | keine |
| Persönliche Quelldokumente im Repository | keine |
| `.gitignore` | schließt `*.pdf`, `*.xlsx`, `*.xls`, `acceptance-data/`, Log- und temporäre Dateien aus |

Nach dem Audit besteht der Arbeitsbaum ausschließlich aus der beabsichtigten
Dokumentationsänderung `README.md`; dieser Bericht ist wegen der vorhandenen
Regel `PHASE-*.md` ebenfalls nicht versioniert.

## Startfähigkeit und PWA-/Browser-Prüfung

Ein frischer Archiv-Checkout des geprüften HEAD wurde ohne lokale
Projektdateien gestartet. Der lokale Server lieferte auf
`http://127.0.0.1:8091/` erfolgreich `HTTP 200` aus. `index.html` referenziert
die versionierten lokalen Bibliotheken
`vendor/xlsx/xlsx.full.min.js`, `vendor/pdfjs/pdf.mjs` und
`vendor/pdfjs/pdf.worker.mjs` sowie die Module
`js/v2/pdf-import-bootstrap.js` und `js/v2/check-explorer-bootstrap.js`.

In Produktivdateien (`index.html`, `js/`, `scripts/`, `server.js`) wurden keine
Pfade unter `/Users/`, `/Volumes/` oder `file:` gefunden. Die Anwendung bindet
den Entwicklungsserver absichtlich nur an `127.0.0.1` und benötigt für den
Start weder Testdaten noch einen externen Dienst.

Die README enthält jetzt Voraussetzungen, Installation, lokalen Start,
Port-Variante, Browser-Nutzung und Testhinweise.

## Fachliche Funktionsabnahme

| Eingang | Nachweis | Ergebnis |
| --- | --- | --- |
| JES Excel | Realdatei wird als `legacy_excel_schedule` mit Subtyp `jes_schedule_excel` klassifiziert; CanonicalSchedule und Original-Blöcke entstehen | bestanden |
| JES PDF | Real-PDF wird erkannt, in CanonicalSchedule überführt und erzeugt dieselben Blöcke 1–10 wie die zugehörige Excel-Datei | bestanden |
| JNV PDF | Real-PDF wird erkannt; CanonicalSchedule, profilbezogener BV-CheckReport und Basisanalyse werden erzeugt | bestanden |
| XLSX-Export | Dienstplan- und Prüfberichtexport sind durch Exporttests abgedeckt; Namen und Nutzdaten enthalten keine Quelldateipfade | bestanden |

Der Testlauf enthält insbesondere die erfolgreichen Nachweise
„Phase 5.3: Original-JES-Excel und zugehöriges PDF erzeugen identische Blöcke
1–10“, „Phase 5.4: die echte JES-Zehnspaltenmappe wird exakt geroutet und
erzeugt Original-Blöcke“, den JES-PDF-Detector-Test sowie die JNV-PDF-
CheckReport-Tests.

## Testlauf

Ausgeführt wurde `npm test` auf dem vorliegenden Arbeitsstand.

| Kennzahl | Ergebnis |
| --- | --- |
| Tests | 2.176 |
| Bestanden | 2.176 |
| Fehlgeschlagen | 0 |
| Übersprungen | 0 |
| Dauer | 18,7 s |

Es treten PDF.js-Warnungen in der Node-Testumgebung auf: Das optionale Paket
`@napi-rs/canvas` sowie `standardFontDataUrl` stehen dort nicht bereit. Sie
betreffen die Node-seitige Rendering-Polyfill-Schicht, nicht die getestete
Text-/Tabellenextraktion; alle betroffenen Akzeptanztests sind bestanden.
Die Sandbox erlaubt keine localhost-Bindung. Der Servertest wurde deshalb
außerhalb dieser Einschränkung ausgeführt und lieferte HTTP 200.

## Bekannte Einschränkung / Freigabeblockade

Die Anwendung lässt sich aus einem sauberen Checkout starten. Die vollständige
Testsuite ist jedoch **nicht reproduzierbar** in einem fremden sauberen
Checkout: 57 getrackte Testdateien enthalten absolute lokale Referenzpfade
unter `/Users/...` oder `/Volumes/...`. Einige Tests überspringen fehlende
Referenzen, andere – darunter die Phase-5-Referenztests – lesen sie unmittelbar
ein. Die Referenzdateien selbst sind korrekt nicht versioniert, aber der
Testlauf setzt damit die lokale Arbeitsumgebung des Maintainers voraus.

Dies ist keine Laufzeitabhängigkeit der PWA und kein Datenleck in den
Exportdateien. Für einen extern nachvollziehbaren GitHub-Release ist es jedoch
ein Reproduzierbarkeits- und Datenschutz-/Portabilitätsmangel: Nutzerinnen und
Nutzer können `npm test` nicht verlässlich allein aus dem Repository
wiederholen.

## Entscheidung

**NO-GO für die GitHub-Release-Freigabe in diesem Durchlauf.**

Die Anwendung selbst und die fachliche Abnahme sind grün. Vor einer
Freigabe sollten die absoluten Referenzpfade in den Tests durch einen
dokumentierten, extern konfigurierbaren Fixture-Mechanismus ersetzt oder die
betroffenen Realtests eindeutig optional gemacht werden. Das wäre eine
gezielte Testbereinigung und wurde entsprechend der Vorgabe dieses reinen
Audits nicht umgesetzt.

Es wurde kein Git-Tag erstellt.
