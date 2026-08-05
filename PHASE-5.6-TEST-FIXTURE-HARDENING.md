# Phase 5.6 - Test Fixture Path Normalization

**Datum:** 2026-08-05
**Ausgangsstand:** `b36d9f6 fix: classify JES ten-column schedules`

## Ziel und Umfang

Diese Änderung betrifft ausschließlich Testinfrastruktur, versionierte
Test-Fixtures und die zugehörige Dokumentation. Anwendungscode, Importpfade,
CanonicalSchedule, Block-Orchestrator, Analyse und Export wurden nicht
verändert.

## Gefundene feste Pfade

Der Audit fand 57 Testdateien mit festen lokalen Benutzer- oder Volume-Pfaden:

```text
analysis-adapter.test.js
analysis-core.test.js
beu-rule-package.integration.test.js
block-parity-excel-pdf.test.js
canonical-schedule-builder.integration.test.js
document-normalizer.integration.test.js
identity-integration.test.js
jes-rule-package.integration.test.js
pdf-core.integration.test.js
phase3a2-live-wiring.test.js
phase3a2b-productive-import.test.js
phase3b2-umlauftafel-validation.test.js
phase3c1-xlsx-loader.test.js
phase3c2-xlsx-import.test.js
phase3c3-excel-classifier.test.js
phase3c3-productive-routing.test.js
phase3d-central-excel-routing.test.js
phase3f-bundle-integration.test.js
phase3g1-jnv-bundle-matcher.test.js
phase3g2-schedule-match-view.test.js
phase3g3-real-bundle-matching.test.js
phase3h1-joint-timeline.test.js
phase3h2-driving-projection-validation.test.js
phase3h3-driving-time-limit-validation.test.js
phase3h5-live-bv008-registration.test.js
phase3h6-check-explorer-live-wiring.test.js
phase3i1-one-sixth-readiness.test.js
phase3i2-one-sixth-fallback-readiness.test.js
phase3i3-turnaround-real-reference.test.js
phase3i32-bv003-real-audit.test.js
phase3i32-handover-chain-audit.test.js
phase3i33-bv003-import-regression.test.js
phase3i33-repeated-header-filter.test.js
phase3i34-check-report-view-model.test.js
phase3i34-report-session-integration.test.js
phase3i35-bv003-live-handover.test.js
phase3i35-report-backward-compatibility.test.js
phase3i35-report-live-context.test.js
phase3i36-print-view.test.js
phase3i36-report-export-file.test.js
phase3i36-report-export-model.test.js
phase3i4-one-sixth-real-pipeline.test.js
phase4-1-pdf-to-xlsx-contract.test.js
phase4-1-pdf-to-xlsx-mapping.test.js
phase4-2-document-detection-regression.test.js
phase4-2-jes-real-detection.test.js
phase4-3-jes-xlsx-projection.test.js
phase4-3-jnv-xlsx-projection.test.js
phase4-3-xlsx-model-security.test.js
phase4-4-dienstplan-csv-fallback.test.js
phase4-4-dienstplan-xlsx-download.test.js
phase4-4-dienstplan-xlsx-export-contract.test.js
phase4-4-dienstplan-xlsx-workbook.test.js
phase4-5-dienstplan-export-delegation.test.js
phase5-3-block-parity-acceptance.test.js
phase5-4-jes-excel-classifier-real.test.js
schedule-mapper.integration.test.js
```

## Fixture-Migration

Die folgenden für den Testlauf benötigten, auf offensichtliche personenbezogene
Textmarker geprüften Referenzartefakte sind nun unter `tests/fixtures/`
versioniert:

| Datei | Verwendung |
| --- | --- |
| `jes-schedule.pdf` | JES-PDF-Erkennung, CanonicalSchedule und Blockparität |
| `jes-acceptance.pdf` | JES-Akzeptanzanalyse |
| `jes-school-acceptance.pdf` | JES-Schulprofil-Akzeptanzanalyse |
| `jnv-schedule.pdf` | JNV-PDF-Erkennung, Analyse und XLSX-Projektion |
| `jnv-umlauftafel.pdf` | Negativtest der Dienstplanerkennung |
| `legacy-schedule.xlsx` | Legacy-Excel-, Report- und BV-Regressionstests |
| `jes-ten-column-schedule.xlsx` | JES-Zehnspaltenklassifikation und Excel/PDF-Parität |
| `bus-umlauftafel.xlsx` | Bus-Umlauftafel- und Bundle-Tests |
| `tram-umlauftafel.xlsx` | Tram-Umlauftafel-Tests |

`tests/fixtures/paths.js` ist die einzige Pfadauflösung für diese Dateien. Alle
betroffenen Tests referenzieren die Fixtures über diese relative,
projektgebundene Quelle. `.gitignore` enthält gezielte Ausnahmen ausschließlich
für diese versionierten Test-Fixtures.

Die vorhandene Fixture-Dokumentation und das Manifest wurden auf die
verfügbaren Referenzen aktualisiert. Die 2,8-MB-Umlauftafel-PDF bleibt enthalten,
weil sie den produktiven Negativtest der PDF-Erkennung abdeckt; sie ist keine
unbenutzte Binärdatei.

## Sicherheitsnachweis

Ein rekursiver Suchlauf über `tests/` liefert keine Treffer mehr für feste
Benutzer-, Volume-, Desktop- oder Download-Pfade. Zusätzlich sichert
`tests/phase5-6-test-fixture-paths.test.js` diese Regel dauerhaft gegen
Regression ab. Künstliche Leckagewerte in Export-Sicherheitstests werden zur
Laufzeit zusammengesetzt, damit sie weiterhin denselben Sanitizer-Fall testen,
ohne einen lokalen Pfad fest zu hinterlegen.

## Testresultat

Ausgeführt: `npm test`

| Kennzahl | Ergebnis |
| --- | --- |
| Tests | 2.177 |
| Bestanden | 2.177 |
| Fehlgeschlagen | 0 |
| Übersprungen | 0 |
| Dauer | 19,7 s |

Der vollständig gestagte Stand wurde zusätzlich aus einem frischen
Archiv-Checkout auf dem Workspace-Volume ausgeführt: **2.177/2.177**, 0 Fehler,
0 Skips, 13,5 s. Damit wurde die Reproduzierbarkeit ohne die vorherigen lokalen
Referenzdateien praktisch nachgewiesen.

PDF.js gibt in der Node-Umgebung weiterhin Warnungen zu optionalem Canvas und
Standardfont-Daten aus. Die Parser- und Akzeptanztests sind davon nicht
beeinträchtigt und sämtlich erfolgreich.

## Ergebnis

Die Tests verwenden keine fest codierten lokalen Referenzpfade oder extern
ignorierten Akzeptanzdaten mehr und können mit den eingecheckten Fixtures aus
einem frischen Clone reproduziert werden.

Der isolierte Clone-Test hat zusätzlich vier von bestehenden Tests gelesene
Fachvertrags-Audits sichtbar gemacht. Diese reinen Textdokumente werden deshalb
ebenfalls versioniert: `PHASE-3I.1-JNV-1-6-FACHREGELVERTRAG-DATENREIFE-AUDIT.md`,
`PHASE-3I.2-JNV-1-6-FACHVERTRAGSKORREKTUR-FALLBACKSTRATEGIE.md`,
`PHASE-3I.11-LINIE18-STATUSKORREKTUR-FREIGABEAUDIT.md` und
`PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md`.

Es wurde kein Release-Tag erstellt.
