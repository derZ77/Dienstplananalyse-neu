# Phase 5.2 — Block Orchestrator Implementation

Stand: 2026-08-05

## Architektur

Vorher liefen die sichtbaren Original-Blöcke 1–10 nur über den Inline-Excelpfad
in `index.html`. Der PDF-Pfad erzeugte zwar Canonical Schedule, CheckReport und
XLSX, schrieb aber nicht in diese Blöcke. Zusätzlich lag der Excel-Schedule unter
`importResult.data`, der PDF-Schedule dagegen direkt unter `canonicalSchedule`.

Nachher gilt für beide Dienstplanquellen:

```text
Excel / PDF → Import-Adapter → CanonicalSchedule → Block-Orchestrator
          → OriginalBlockViewModel → vorhandene Ergebnisblöcke 1–10
```

Der Orchestrator verwendet ausschließlich die bestehende
`analyzeCanonicalScheduleWithMigratedLegacyChecks()`-Projektion. Es wurde keine
PDF-spezifische Analyseengine, keine neue Fachregel und keine neue Ergebnisfläche
eingeführt.

## Geänderte Module

- `js/v2/blocks/block-orchestrator.js`
  - zentraler CanonicalSchedule→OriginalBlockViewModel-Adapter;
  - nutzt die vorhandenen migrierten Legacy-Auswertungen für Blöcke 1–6 und 8–9;
  - hält Block 7 ohne belastbare Wagenkarten-/Driving-Projection-Evidenz beim
    bestehenden Tabellenstatus „Für tabellarische Dienstpläne nicht verfügbar.“;
  - gibt Block 10 ausschließlich aus Canonical-`interruptions` aus, ohne Pausen
    zu erfinden.
- `js/v2/blocks/block-renderer.js`
  - schreibt nur in die existierenden IDs der Original-PWA;
  - nutzt `textContent`, also keine neue HTML- oder PDF-Sonderdarstellung.
- `js/v2/import/multi-document-import-controller.js`
  - normalisiert den vorhandenen Legacy-Excel-Schedule von `importResult.data`
    nach `canonicalSchedule` an der Session-Grenze.
- `js/v2/pdf-import-bootstrap.js`
  - ruft für jeden gültigen primären Canonical Schedule denselben Orchestrator und
    Renderer auf; gilt für Excel und PDF.
- `index.html`
  - der alte Inline-Datei-Listener behält nur die Dateiauswahlmeldung. Analyse und
    Blockschreiben erfolgen nun zentral nach der Importnormalisierung.

## Block-Mapping

| Block | Canonical-Quelle |
|---|---|
| 1 Anzahl / Plantyp | `services[].serviceNumber`, vorhandene Legacy-Planprojektion |
| 2 Geteilte Dienste | Dienstnummer, Dienstbeginn/-ende |
| 3 Reserve | Dienstnummern und vorhandene Reserveliste |
| 4 >08:30 h | `services[].paidTime.minutes` |
| 5 Orte | erste/letzte Aktivität eines Dienstes |
| 6 Dienstteilstücke | Aktivitätszeiten und Kurskennung |
| 7 Lenkzeit | bestehender Nichtverfügbarkeitsstatus ohne Wagenkarten-Evidenz |
| 8 Schichten | `services[].begin` und bestehende Grenzwerte |
| 9 Linie/Kurs | `RouteIdentity` / `circuitNumber` |
| 10 Pausen | bestätigte Canonical-`interruptions` |

## Tests

Neu hinzugefügt:

- `tests/block-orchestrator.test.js`
- `tests/block-parity-excel-pdf.test.js`
- `tests/canonical-to-block-renderer.test.js`

Ergänzt:

- `tests/phase3h5-rule-analysis-session.test.js` prüft die
  Excel-ImportResult-Normalisierung.

Der fokussierte Lauf der neuen und angrenzenden Tests ergab 16/16 bestanden,
einschließlich eines echten JES-Referenzvergleichs PDF gegen Excel.
Der vollständige Lauf `npm test` ergab 2171 bestanden und 3 fehlgeschlagene
HTTP-Smoke-Tests. Die drei bekannten Fehlschläge können in der isolierten Umgebung
keinen Listener auf `127.0.0.1` öffnen (`EPERM`); sie betreffen weder den
Block-Orchestrator noch Excel-/PDF-Fachdaten.

## Bekannte Restpunkte

- Block 7 erhält erst mit einer belastbaren, optionalen Wagenkarten-/Driving-
  Projection-Anreicherung reale Lenkzeit. Bis dahin entspricht der ausgegebene Status
  der bestehenden tabellarischen Excel-Semantik.
- PDF-Unterbrechungen werden noch nicht im PDF-Builder abgeleitet. Der Renderer zeigt
  daher nur bestätigte Modellunterbrechungen und konstruiert keine Pausen aus bloßen
  Zeitlücken.
- Die Dokumente `PHASE-*.md` sind projektweit ignoriert und werden für den
  nachfolgenden Commit gezielt hinzugefügt.
