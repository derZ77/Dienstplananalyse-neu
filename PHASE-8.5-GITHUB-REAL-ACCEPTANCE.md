# Phase 8.5 – GitHub-Testdeployment und reale Browser-Abnahme

**Datum:** 11.08.2026
**Ausgangscommit:** `bcd4021 feat: highlight BV violations in analysis views`
**Ergebnis:** **GO für GitHub-Teststand**

## 1. Git- und Remote-Stand

- Branch: `main`
- Remote: `https://github.com/derZ77/Dienstplananalyse-neu.git`
- Lokaler und veröffentlichter Commit: `bcd402176480e7b3368658f96c514facfb269e90`
- `outputs/` blieb ungetrackt und wurde nicht veröffentlicht.
- Getrackte PDF-/XLSX-Dateien liegen ausschließlich unter `tests/fixtures/` und sind Testfixtures; persönliche Quelldokumente wurden nicht eingecheckt.

## 2. Regression

`npm test` wurde außerhalb der Sandbox ausgeführt, weil die drei HTTP-Smoke-Tests eine lokale `127.0.0.1`-Bindung benötigen:

- **2257 bestanden**
- **0 Fehler**
- **0 Skips**

Die bekannten Node-/PDF.js-Hinweise zu `@napi-rs/canvas`, `ImageData`, `Path2D` und `standardFontDataUrl` blieben ohne Einfluss auf das Ergebnis.

## 3. GitHub-Pages-Deployment

Testseite: `https://derz77.github.io/Dienstplananalyse-neu/`

- Startseite: HTTP 200.
- Aktuelles Inline-CSS mit `status-fail` wird ausgeliefert.
- Die produktiven Module `pdf-import-bootstrap`, `check-explorer-bootstrap`, `review-dashboard` und `check-report-view` werden jeweils mit HTTP 200 ausgeliefert.
- PDF.js (`vendor/pdfjs/pdf.mjs`) und SheetJS (`vendor/xlsx/xlsx.full.min.js`) sind erreichbar.
- Die ausgelieferten Modulquellen enthalten die aktuelle FAIL-Klasse im Dashboard sowie im Prüfbericht.

## 4. Reale Import- und UI-Abnahme

In der GitHub-Pages-Oberfläche wurden die vorhandenen Testfixtures geladen:

| Eingang | Ergebnis |
| --- | --- |
| JNV-PDF (`jnv-schedule.pdf`) | als unterstütztes BEU-Stadtbus-Dokument erkannt; Analyse und Blöcke 1–10 sichtbar |
| JES-PDF (`jes-schedule.pdf`) | als JES-Regionalbus-Dokument erkannt; Analyse und Blöcke 1–10 sichtbar |
| JES-Excel (`jes-ten-column-schedule.xlsx`) | als Legacy-Excel-Dienstplan erkannt; Blöcke 1–10 und Suche verfügbar |

Für die PDF-Eingänge waren beide Exportaktionen sichtbar und aktiv. Der Klick auf den generischen Excel-Export und auf „Dienstübersicht XLSX“ wurde ohne Browser-Konsolenfehler ausgelöst. Die verwendete Browserumgebung meldet Downloads nicht als beobachtbares Download-Ereignis zurück; dies ist keine Fehlermeldung der Anwendung. Die Export-Regression und der XLSX-Roundtrip sind durch die vollständige Testsuite abgedeckt.

## 5. Block 2 und Block 10

- JNV zeigt geteilte Dienste und lange Unterbrechungen getrennt von regulären Blockpausen.
- Der sichtbare JNV-Lauf enthielt keine Pause im Bereich 30–120 Minuten; lange Unterbrechungen wurden als zusätzliche Canonical-Unterbrechungen ausgegeben.
- Die Grenzfall- und BV-Pausenlage-Tests (30/120 Minuten sowie 3:30–4:30 h) sind Teil der grünen Regression.

## 6. Statusfarben und die letzten drei Ansichten

Der ausgelieferte Code enthält den gemeinsamen Statusvertrag:

- `FAIL` / BV-Verstoß: hellrot, roter linker Rand, dunkler Textstatus.
- Prüfung erforderlich: gelb/orange.
- `PASS`: dezent positiv.
- `SKIP` und `NOT_APPLICABLE`: neutral grau.

Die aktuelle In-App-Browser-Sitzung hielt trotz hartem Reload alte JavaScript-Module aus einem früheren Service-Worker-/Modulcache. Das war an der früheren Dashboard-Zählung und am alten Block-2-Text erkennbar. Der direkte Abruf derselben Pages-Assets bestätigte dagegen den neuen Commit und die neue Statuslogik. Dieser lokale Cachebefund wird deshalb nicht als Deployment- oder Fachfehler gewertet.

## 7. Mobile

Bei 390 × 844 px (effektive Seitenbreite 375 px) wurden Uploadbereich, Exportbereich und Suche geprüft. Es trat kein globaler horizontaler Seitenüberlauf auf; alle drei Container blieben innerhalb der verfügbaren Breite.

## 8. Offene Punkte

- Für eine manuelle Sichtprüfung der zuletzt ausgelieferten Styles sollte ein Browserprofil ohne den alten Service-Worker-/Modulcache verwendet werden.
- Die Browser-Automation liefert in dieser Umgebung kein Download-Ereignis; ein manuelles Öffnen der erzeugten XLSX-Datei in Excel/LibreOffice bleibt der letzte visuelle Endanwendernachweis.

## 9. Freigabeentscheidung

**GO – GitHub-Teststand aktualisiert.**

Der veröffentlichte Remote-Commit und die produktiv ausgelieferten Assets entsprechen dem geprüften Stand. Es wurde kein Release-Tag und keine Release-Erstellung vorgenommen.
