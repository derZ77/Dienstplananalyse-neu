# Phase 6.7b – Block 6 Fachbewertung und Ausnahme-Darstellung

## Ausgangslage

Block 6 stellte nach Phase 6.7 die Legacy-Feststellung zu Dienstteilstücken über
04:30 h wieder dar: Dienstnummer, Einzel- bzw. kombinierte Teilstücke, Kurs,
Zeitspanne, Pausenlücke und Dauer. Die vorhandenen Ergebnisse der 1/6-Prüfung
(`BV015_BV018`) wurden jedoch nicht an den Blockrenderer übergeben. Geteilte
Dienste waren ebenfalls nur in Block 2 sichtbar.

## Umsetzung

Die bestehende Block-6-Feststellung bleibt unverändert die erste Ebene. Sie wird
weder ausgeblendet noch durch eine Bewertung ersetzt.

Als zweite Ebene ergänzt die vorhandene Blockprojektion je betroffenem Dienst:

- `Bewertung`;
- `Ausnahmegrund`: vorhandener geteilter Dienst oder keine vorhandene
  Ausnahmeinformation;
- den vorhandenen dienstbezogenen Status aus `BV015_BV018`, sofern ein
  CheckReport ihn enthält;
- ein lesbares Ergebnis für PASS, FAIL, NOT_APPLICABLE oder INCONCLUSIVE.

Ein geteilter Dienst wird ausdrücklich nur als zusätzliche Information zur
4:30-h-Feststellung angezeigt. Er wird nicht als 1/6-Ausnahme eingeordnet. Liegt
kein vorhandenes 1/6-Ergebnis vor, wird auch keines erzeugt oder abgeleitet.

## Datenfluss

Vorher:

`CanonicalSchedule → Legacy-Analyse → Block 6`

Nachher:

`CanonicalSchedule → Legacy-Analyse → Block 6`

`bestehender CheckReport (BV015_BV018) ────────────────┘`

Der PDF-Import-Bootstrap reicht den CheckReport der bestehenden Session nur an
den gemeinsamen Block-Orchestrator weiter. Es gibt keine PDF-Sonderprojektion;
der optionale Parameter kann ebenso für Excel verwendet werden. Ohne CheckReport
ist der Legacy-Text unverändert.

## Unveränderte Fachgrenzen

- Die Berechnung der Dienstteilstücke und die 04:30-h-Grenze bleiben vollständig
  in der vorhandenen Legacy-Analyse.
- Die 1/6-Logik (`BV015_BV018`) bleibt unverändert; Block 6 liest lediglich ihr
  bereits vorhandenes Dienst-Ergebnis.
- Parser, CanonicalSchedule, JNV-1/6-Regeln und JES-Erkennung wurden nicht
  verändert.
- Die Darstellung ersetzt keine rechtliche Gesamtbewertung der Arbeitszeit:
  sie zeigt die bestehende Legacy-Zeitspanne und vorhandene Zusatzbewertungen
  getrennt.

## Geänderte Dateien

- `js/v2/blocks/block-orchestrator.js`
- `js/v2/pdf-import-bootstrap.js`
- `tests/phase6-7b-block6-assessment-display.test.js`

## Testnachweise

Die neue Acceptance-Suite prüft:

1. eine Überschreitung bleibt sichtbar, während ein vorhandenes PASS-Ergebnis
   der 1/6-Prüfung getrennt als Bewertung ausgegeben wird;
2. ein geteilter Dienst wird als eigener Ausnahmegrund dargestellt und nicht
   als 1/6-Ausnahme behandelt;
3. JES-Excel und JES-PDF ohne CheckReport behalten identischen Legacy-Block-6-
   Text;
4. ein echtes JNV-PDF zeigt bei geteiltem Dienst keine erfundene 1/6-Prüfung.

Gezielter Lauf: 9 bestanden, 0 Fehler.

Vollständige Regression: `npm test` mit 2.195 bestandenen Tests, 0 Fehlern
und 0 Skips. Die bekannten PDFJS-Canvas-/Standardfont-Hinweise der Node-
Testumgebung traten auf, ohne ein Testergebnis zu beeinflussen.

## Verbleibende Unterschiede

Eine dienstbezogene Bewertung kann nur angezeigt werden, wenn die vorhandene
1/6-Prüfung für den Dienst einen Eintrag in `details.services` geliefert hat.
Fehlt ein passendes Begleitdokument oder Matching, bleibt die Legacy-Feststellung
sichtbar; Block 6 leitet daraus keine neue Bewertung ab.
