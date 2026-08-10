# Phase 7.3 – XLSX Dienstübersicht Implementation

## Umsetzung

`dienstuebersicht-xlsx-export.js` ergänzt einen getrennten Exportweg:

```text
CanonicalSchedule → DienstübersichtExportModel → Dienstübersicht-Arbeitsmappe
```

Das Modell enthält die zwölf Referenzspalten, Dienstkopfzeilen,
Aktivitätszeilen und eine Leerzeile nach jedem Dienst. Der Renderer erzeugt
das einzelne Blatt `Dienstübersicht`, Titelverbund A1:L1, Referenzbreiten,
Drucktitel Zeile 2 und Querformat. Der generische PDF-Analyseexport bleibt
unverändert.

## Datenquellen

Dienstnummer, Beginn, Ende und bezahlte Zeit kommen vom Service. Umlauf, ggf.
Handover, Tätigkeit, Zeiten und Orte kommen ausschließlich aus Aktivitäten.
Nicht vorhandene Felder bleiben leer; es gibt keine neue Fachlogik.

## Tests

Der neue Vertragstest belegt für einen identischen CanonicalSchedule dieselbe
Dienstübersicht-Projektion aus Excel- und PDF-Quelle, Spaltenreihenfolge,
Dienstkopf, Aktivität und Trennzeile.

Vollständige Regression: `npm test` – **2221 bestanden, 0 Fehler, 0 Skips**.

## Restpunkte

Eine UI-Anbindung für den neuen Exportmodus und ein vollständiger Vergleich
mit den echten JES-/JNV-Referenzimports folgen als getrennte Erweiterung.
