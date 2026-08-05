# Phase 5.7 - Final Release Candidate Re-Approval

**Datum:** 2026-08-05
**Freigabestand:** `45ba6ee test: normalize fixture paths for clean clones`
**Geprüfter Branch:** `main`

## Prüfumfang

- Repository-Zustand, Release-Historie, Remote und Tags
- Versionierte Test-Fixtures und Ausschluss privater Quelldokumente
- Frischer Archiv-Checkout mit lokalem Browser-Einstieg
- Vollständige Testsuite im frischen Checkout
- JES Excel, JES PDF, JNV PDF, Original-Blöcke 1-10 und XLSX-Export
- README und Release-Vorbereitung

## Repository-Ergebnis

Der Audit begann mit sauberem Arbeitsbaum. Die Release-relevanten Commits sind
vorhanden:

- `305315a feat: unify schedule block orchestration`
- `b36d9f6 fix: classify JES ten-column schedules`
- `45ba6ee test: normalize fixture paths for clean clones`

Es bestehen keine Tags. Der konfigurierte Remote verweist auf das öffentliche
GitHub-Repository `derZ77/Dienstplananalyse-neu`. Getrackte PDF- und
Excel-Dateien liegen ausschließlich unter `tests/fixtures/` und sind
testnotwendige, auf personenbezogene Textmarker geprüfte Referenzartefakte.

## Clean-Clone- und Browser-Nachweis

Aus dem gestagten Release-Candidate-Stand wurde ein frischer Archiv-Checkout
erstellt. Der lokale Entwicklungsserver startete ohne zusätzliche lokale
Abhängigkeiten und lieferte `index.html` per HTTP 200. Die Seite referenziert
die versionierten Bibliotheken `vendor/xlsx/xlsx.full.min.js`, `vendor/pdfjs`
sowie die Excel-/PDF-Startmodule.

Die vollständige Testsuite lief in diesem frischen Checkout:

| Kennzahl | Ergebnis |
| --- | --- |
| Tests | 2.177 |
| Bestanden | 2.177 |
| Fehlgeschlagen | 0 |
| Übersprungen | 0 |
| Dauer | 13,8 s |

PDF.js meldet in der Node-Umgebung weiterhin optionale Canvas- und
Standardfont-Warnungen. Die Parser-, Akzeptanz- und Exporttests sind davon
nicht beeinträchtigt.

## Funktionale Freigabe

| Bereich | Ergebnis |
| --- | --- |
| JES Excel | Erkennung, CanonicalSchedule, Original-Blöcke 1-10 und Analyse bestätigt |
| JES PDF | Erkennung, CanonicalSchedule und Blockparität mit Excel bestätigt |
| JNV PDF | Erkennung, Regelanalyse und CheckReport bestätigt |
| XLSX-Export | Dienstplan- und Prüfberichtexport durch Tests bestätigt |
| README | Projektbeschreibung, Installation, Browser-Nutzung, Entwicklungsstart und Testausführung vorhanden |

## Release-Vorbereitung

**Release-Name:** Dienstplananalyse PWA v1.1.0
**Vorgeschlagener Tag:** `v1.1.0`

### Vorgeschlagene Release Notes

- PDF-Dienstpläne können zusätzlich zu Excel-Dienstplänen analysiert werden.
- Excel und PDF verwenden nach der Normalisierung dieselbe Blockarchitektur.
- JES-Zehnspalten-Exceldateien und JES-PDF-Dienstpläne werden unterstützt.
- JNV-PDF-Dienstpläne liefern Regelanalyse und CheckReport.
- Dienstplandaten können als XLSX exportiert werden.
- Die Verarbeitung erfolgt lokal im Browser; Test-Fixtures sind versioniert und
  von produktiven Personaldaten getrennt.

## Freigabeentscheidung

**GO Release.**

Alle Release-Candidate-Prüfkriterien sind erfüllt. Es wurde bewusst kein
Release-Tag erstellt. Die Tag-Erstellung erfolgt erst nach expliziter Freigabe.
