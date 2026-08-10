# Phase 6.4 – Block 10 Legacy Parity

## Ausgangslage

Stand der Untersuchung und Umsetzung war Commit `51221c3`.

Die gemeinsame Datenbasis enthielt nach Phase 6.2 bereits strukturierte
`CanonicalSchedule.interruptions`. Block 10 projizierte diese Daten jedoch nur
als flache Rohzeilen (`ID`, Zeitraum, Dauer). Dadurch gingen die fachliche
Einordnung der ursprünglichen PWA sowie verfügbare Kontextdaten in der
Ergebnisdarstellung verloren.

## Legacy-Referenz

Die ursprüngliche tabellarische PWA stellt in Block 10 Pausen als fachliche
Prüfaussage dar:

- normale Pausen: 30–120 Minuten;
- getrennte Dienstunterbrechungen: über 120 Minuten;
- Detailbezug: Dienstnummer, Beginn, Ende, Dauer und Ort;
- Arbeitszeitbezug: Arbeitszeit vor der Pause;
- BV-Hinweis: Mindestpause von 33 Minuten, an `HLZ`, `TGR` und `LGR`
  39 Minuten; Arbeitszeitfenster 03:30–04:30 Stunden.

Die bestehende Anzeigereihenfolge bleibt gruppiert nach normalen Pausen und
langen Dienstunterbrechungen. Für strukturierte Unterbrechungen geteilter
Dienste von 30–120 Minuten gibt es zusätzlich eine explizite Gruppe. So wird
eine bestätigte Canonical-Unterbrechung nicht verworfen; Parser oder
Fachregeln werden dabei nicht verändert.

## Ursache

Die Ursache lag ausschließlich zwischen CanonicalSchedule und Renderer:

```text
vorher: CanonicalSchedule.interruptions → flache ID/Zeit/Dauer-Zeile
nachher: CanonicalSchedule.interruptions → Block-10-Projektion → Gruppierung und Detailzeile
```

Die Datenfelder lagen bereits vor. Es gab keine Änderung am PDF-Parser,
Excel-Import, CanonicalSchedule, CheckRunner oder an JES-/JNV-Regeln.

## Datenfluss nach der Korrektur

Der gemeinsame Block-Orchestrator verwendet unverändert die vorhandenen
Canonical-Unterbrechungen und gibt pro Eintrag aus:

- Dienstbezug;
- Unterbrechungsart (`Pause`, `Wendezeit`, `Wegezeit` oder
  `Dienstunterbrechung`);
- Beginn, Ende und Dauer;
- Ort, soweit im CanonicalSchedule vorhanden;
- Arbeitszeit vor der Unterbrechung, soweit aus den vorhandenen Zeitwerten
  berechenbar;
- den bestehenden BV-Hinweis aus den Legacy-Grenzwerten.

Fehlende Orte oder Zeitindizes werden nicht ergänzt: Die Darstellung zeigt in
diesem Fall `unbekannt` beziehungsweise `nicht auswertbar`.

## Geänderte Dateien

- `js/v2/blocks/block-orchestrator.js`: ausschließliche Erweiterung der
  Block-10-Projektion und -Darstellung.
- `tests/phase6-4-block10-legacy-parity.test.js`: neue Acceptance- und
  Legacy-Referenztests mit echtem JES- und JNV-PDF.

## Testnachweise

- Legacy-Referenzfall: Excel-Canonical-Unterbrechung enthält Ort,
  Arbeitszeitbezug, ortsabhängige Mindestpause und BV-Hinweis.
- Echtes JNV-PDF: alle 12 übernommenen Canonical-Unterbrechungen erscheinen
  in Block 10 mit identischem Zeitraum und identischer Dauer.
- Echtes JES-PDF: Der korrekte Leerstatus bleibt sichtbar, wenn die Quelle
  keine Unterbrechungen liefert.
- Vollständige Regression: `npm test` – **2183 bestanden, 0 Fehler,
  0 Skips**.

Im Node-Testlauf erscheinen weiterhin bekannte PDF.js-Hinweise zu optionalen
Canvas- und Standardfont-Polyfills. Sie beeinflussen weder den Import noch die
fachlichen Assertions.

## Verbleibende Unterschiede

- Die Projektion erzeugt keine fehlenden Orte oder Unterbrechungen. Sind sie
  in einer Quelle nicht enthalten, bleibt dies sichtbar.
- Die vorhandene BV-Aussage in Block 10 folgt den Legacy-Grenzwerten. Sie ist
  keine neue Verknüpfung zu separaten CheckReport-Ergebnissen.
- Eine weitergehende optische Angleichung an historische HTML-Tabellen ist
  nicht Teil dieser Phase.
