# Arbeitspaket 12: einheitliche Analyse-Schnittstelle

## Zweck und Abgrenzung

`js/v2/analysis/analysis-adapter.js` ist die einzige V2-Eingangsschnittstelle für spätere gemeinsame Auswertungen. Sie akzeptiert ausschließlich ein Objekt mit `type: "CanonicalSchedule"`, erstellt eine Kopie und prüft den nachstehenden Vertrag. Sie enthält bewusst keine Auswertungs-, Warn-, Regel- oder PDF-/Excel-Logik.

```text
Excel-Rohzeilen (SheetJS) -> excel-canonical-adapter -> CanonicalSchedule --+
                                                                          +-> analysis-adapter -> spätere gemeinsame Analyse
PDF-Kern -> Normalisierung -> Mapper -> CanonicalSchedule ---------------+
```

Der bestehende Handler in `index.html`, `parseTabular`, `parseWagenkarte` sowie ihre Ausgabe bleiben unberührt. Der Excel-Adapter ist absichtlich noch nicht an diesen Handler angeschlossen. Damit sind dessen produktive Ergebnisse unverändert.

## Verbindlicher Analysevertrag

Jeder Eingabedienst besitzt mindestens `id`, `serviceNumber`, `begin`, `end`, `paidTime`, `activities`, `source` und `drivingTimeSource`. `begin`/`end` sind Zeitobjekte (`raw`, `value`, `minutesSinceStartOfDay`), `paidTime` besitzt zusätzlich bzw. alternativ `minutes`. Jede Aktivität besitzt mindestens `id`, `serviceId`, `rawActivity` und `source`. Auf Schedule-Ebene sind `services`, `activities`, `interruptions` und `warnings` immer Arrays.

`drivingTimeSource` gehört zum Dienst, nicht zu einer berechneten Dauer. Zulässige Werte sind:

- `UNKNOWN`: keine belastbare Lenkzeitquelle vorhanden (Voreinstellung des Excel-Adapters und der PDF-Pipeline vor einer fachlichen Zuordnung).
- `PDF`: später nur setzen, wenn alle als Lenkzeit zählenden PDF-Aktivitäten regelbasiert eindeutig bestimmt wurden.
- `WAGENKARTE`: explizite Wagenkartenquelle bzw. deren Fahrtenfolge.
- `CALCULATED`: späteres, nachvollziehbar berechnetes Ergebnis.

Die Voreinstellung erzeugt keine Lenkzeit und verändert keine bestehende Auswertung.

## Excel-Adapter und Verlustfreiheit

`adaptExcelRowsToCanonicalSchedule(rows, options)` erwartet die bereits vorhandene SheetJS-Rohzeilenmatrix (`XLSX.utils.sheet_to_json(..., { header: 1 })`). Unterstützt werden getrennt:

1. die neue, in den Referenz-Arbeitsmappen vorhandene Zehn-Spalten-Dienstübersicht (`Dienst`, `Umlauf`, `Tätigkeit`, `Abfahrt`, `Abfahrtsort`, `Ankunft`, `Ankunftsort`, `Beginn`, `Ende`, `Bez. Zeit`),
2. das historische Tabellenlayout des Legacy-Parsers (Dienstnummer C, Kurs E, Fahrt F–K, Dienstzeiten O–Q).

Alle Originalzellen einer Dienstkopfreihe und jeder Aktivitätsreihe bleiben in `source.rawCells` bzw. `service.source.excelRows` erhalten. Der Adapter fasst keine Zeiten zusammen und interpretiert keine Tätigkeiten. Das ist eine verlustfreie Überführung der im jeweiligen Rohzeilen-Import verfügbaren Daten; Excel-spezifische Formatierung, Formeln, Zellkommentare und Druckparameter sind kein Bestandteil des bisherigen Analyse-Datenbestands und daher nicht Teil des CanonicalSchedule.

## Vergleich: JES-Referenz (Dienst 751)

Verglichen wurden die erste vollständige Excel-Zeile aus `20260713_Dienstuebersicht_FDA_v2.xlsx` und die JES-Referenz-PDF. Semantisch stimmen Dienstnummer, Beginn (`03:53`), Ende (`12:28`), bezahlte Zeit (`08:05`) sowie alle fünf Aktivitäten einschließlich Umlauf, Orten und Zeiten überein. Der Debug-Vergleich normalisiert nur umbruch- und geometriebedingte Leerzeichen des PDF-Textes und ignoriert ausschließlich IDs und Quellenpositionen.

Dokumentierte Unterschiede:

- PDF-Quellen enthalten Seite, Tabelle, Zeile und Bounding Box; Excel-Quellen enthalten Datei, Tabellenblatt, Zeile und vollständige `rawCells`.
- PDF.js liefert an mehreren Texten führende Leerzeichen aus der geometrischen Rekonstruktion; Excel liefert die Zellen ohne diese Zeichen.
- PDF bewahrt Seitengeometrie, Excel bewahrt die Rohzellfolge. Keines davon wird als fachliche Abweichung gewertet.

`compareCanonicalSchedules` und `toCanonicalComparisonDebugJson` sind reine Debug-Werkzeuge. Abweichende Zeiten, Aktivitäten, Umläufe oder Orte werden als strukturierte Differenzen ausgegeben; es erfolgt keine automatische Korrektur.

## Wagenkarten und Lenkzeit

Wagenkarten liefern gegenüber den Referenz-PDF-Dienstübersichten zusätzlich bzw. belastbarer:

- explizite Haltestellenfolge je Linien- oder Leerfahrt mit `ab`/`an`,
- konkrete Fahrtklassifikation (Linienfahrt/Leerfahrt),
- die im Kopf ausgewiesene offizielle Gesamtlenkzeit,
- eine vollständige Fahrtfolge, mit der Lenkzeitblöcke vor und nach Unterbrechungen berechnet werden können.

Aus den neuen PDF-Dienstübersichten sind bereits vollständig überführbar: Dienstnummer, Umlauf, Tätigkeits-Rohtext, Abfahrts- und Ankunftszeit, Abfahrts- und Ankunftsort sowie Dienstbeginn, -ende und bezahlte Zeit. Nach der vorhandenen Regelzuordnung lassen sich als `serviceDrive` oder `deadRun` klassifizierte Zeitabschnitte addieren. Das ist jedoch **keine** heute eingeführte Lenkzeitberechnung und ersetzt weder die Wagenkarten-Haltestellenfolge noch eine ausdrücklich ausgewiesene Lenkzeit.

Empfehlung: Wagenkarten für rechts- oder betriebsverbindliche Lenkzeit-, Haltestellenfolgen- und Blockprüfungen vorerst beibehalten (`WAGENKARTE`). Die PDF-Dienstübersicht genügt für dienst-, umlauf-, aktivitäts-, zeit- und ortsbezogene Auswertungen; für eine spätere berechnete Lenkzeit ist eine explizite Regel- und Validierungsphase erforderlich.

## Teststrategie

- Unit-Tests prüfen die ausschließliche CanonicalSchedule-Eingabe, den unveränderten Eingabezustand, den Default `UNKNOWN` und die Debug-Ausgabe.
- Excel-Tests prüfen beide Excel-Layouts und erhaltene Rohzellen anhand der echten Spaltenstruktur der JES-Referenz-Arbeitsmappe.
- Der vorhandene Legacy-Regressionstest bleibt Teil von `npm test` und schützt `parseTabular` sowie `parseWagenkarte` unverändert.
- Die bereits vorhandenen PDF- und Regelpaket-Tests validieren weiterhin die PDF-Pipeline; dieses Arbeitspaket ändert sie nicht.
