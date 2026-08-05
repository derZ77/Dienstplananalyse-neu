# Phase 5.4 — JES Excel Classification and Browser Acceptance

Stand: 2026-08-05
Basis: `305315a feat: unify schedule block orchestration`

## Ursache

Die originale JES-Arbeitsmappe enthält vor der Spaltenüberschrift eine Titelzeile.
Der Excel-Klassifikator prüfte die bisherige Schedule-Signatur ausschließlich in
Zeile 1. Dadurch wurde die tatsächlich vorhandene, vollständige Zehnspaltenüberschrift
in Zeile 2 nicht erkannt und die Datei als `unknown` abgewiesen.

Der vorhandene `adaptExcelRowsToCanonicalSchedule()`-Adapter war nicht betroffen:
Er erkennt das Format bereits über jede Zeile der Arbeitsmappe.

## Änderung

`js/v2/import/excel-document-classifier.js` sucht nun in jeder Zeile nach der
vollständigen, geordneten JES-Zehnspaltensignatur:

`Dienst | Umlauf | Tätigkeit | Abfahrt | Abfahrtsort | Ankunft | Ankunftsort |
Beginn | Ende | Bez. Zeit`

Eine Teilmenge der Begriffe genügt nicht. Damit bleibt die Erkennung unbekannter
oder nur ähnlich aufgebauter Dateien geschlossen. Bei erfolgreichem Volltreffer
lautet das bestehende kanonische Dokumentformat weiterhin
`legacy_excel_schedule`; der zusätzliche Subtyp `jes_schedule_excel` beschreibt
die nachgewiesene JES-Zehnspaltenform. Profile, Sicherheitsgates,
Adapterverträge, Canonical Schedule und Block-Orchestrator wurden nicht verändert.

## Testnachweis

Neu: `tests/phase5-4-jes-excel-classifier-real.test.js`

Der Test nutzt die reale Datei
`20260713_Dienstuebersicht_FDA_v2.xlsx` und prüft:

- exakte Klassifikation `legacy_excel_schedule` / `jes_schedule_excel`;
- exaktes Routing durch `analyzeExcelImport()`;
- Erzeugung eines `CanonicalSchedule` mit 19 Diensten;
- vollständige Befüllung aller sichtbaren Original-Blöcke.

Der Phase-5.3-Echtdateitest bleibt ebenfalls aktiv und beweist für die zugehörige
JES-PDF dieselben Blöcke 1–10.

Vollständiger Testlauf außerhalb der Sandbox: **2176 bestanden, 0 fehlgeschlagen**.
Die HTTP-Smoke-Tests konnten mit derselben lokalen Berechtigung ihre Testports öffnen.
Alle für diese Phase relevanten Tests einschließlich realer Excel-/PDF-Parität bestehen.

## Browser-Acceptance-Diagnose

- Der lokale statische Server wurde auf `127.0.0.1:8081` gestartet und antwortete
  per HTTP mit `200 OK`.
- Der In-App-Browser erhielt beim Zugriff dennoch `ERR_EMPTY_RESPONSE` und konnte
  deshalb keinen Dateiupload durchführen.
- Die Ursache liegt außerhalb der Anwendung: Der Browserzugriff ist von der
  lokalen Ausführungsumgebung getrennt bzw. ihr localhost nicht erreichbar.

Es war kein Anwendungsfix erforderlich. Der Browser-E2E-Test muss in einer
Umgebung wiederholt werden, in der der Browser denselben localhost-Namensraum wie
der lokale Entwicklungsserver nutzt.

## Offene Punkte

- Kein Release-Tag erstellt.
- Die reale Browser-Abnahme ist als Umgebungsnachweis offen; die fachliche
  Canonical-/Block- und produktive Excel-Importabnahme ist automatisiert belegt.
