# Phase 7.7 – GitHub Pages Cache-Bereinigung und Export-Sichtbarkeit Acceptance

## Ergebnis

**GO – GitHub-Pages-Testversion liefert die produktive Dienstübersicht-Exportfunktion aus.**

## Deployment-Abgleich

- Lokaler `main` und `origin/main`: `8b4120f feat: connect dienstuebersicht xlsx export`
- GitHub Pages: `https://derz77.github.io/Dienstplananalyse-neu/`
- `index.html` referenziert die vendorisierte XLSX-Bibliothek und `js/v2/pdf-import-bootstrap.js` über relative, Pages-kompatible Pfade.
- Der ausgelieferte Bootstrap importiert `createDienstuebersichtExportController` und aktualisiert ihn mit dem Sitzungszustand.
- Das ausgelieferte Modul `js/v2/export/dienstuebersicht-export-ui.js` ist erreichbar und enthält den sichtbaren Text `Dienstübersicht XLSX`.

## Cache-Analyse

GitHub Pages liefert für `index.html` und die JavaScript-Module einen `Cache-Control`-Wert von `max-age=600`. In Phase 7.6 verwendete die Browserinstanz noch eine ältere, zwischengespeicherte Modulantwort; deshalb war die neue Schaltfläche dort nicht sichtbar.

Es gibt keine Service-Worker-Registrierung oder anwendungseigene Cache-Schicht für diesen Ablauf. Nach einer frischen Navigation mit Cache-brechendem Seitenaufruf wurde die aktuelle Modulversion geladen.

## Browser-Acceptance

Mit dem JES-Referenz-PDF wurde auf GitHub Pages geprüft:

1. Startseite lädt.
2. PDF-Upload ist möglich.
3. JES-Dienstplan wird erkannt und analysiert.
4. Die Blöcke 1–10 werden dargestellt.
5. Der bisherige Export bleibt sichtbar.
6. **„Dienstübersicht XLSX“** ist sichtbar und aktiv.
7. Der Export wurde ausgelöst; die Seite bestätigt: „Die Dienstübersicht wurde lokal als Excel-Datei erzeugt.“
8. Es gab keine Browser-Konsolenfehler.

Die Browser-Automation signalisiert lokale Downloads nicht als auswertbares Downloadobjekt. Der erzeugte Browserstatus bestätigt jedoch die lokale Dateiübergabe. Die bytegenaue XLSX-Struktur (Blatt `Dienstübersicht`, 12 Spalten, Kopf-, Aktivitäts- und Trennzeilen, Querformat) ist bereits durch den Phase-7.5-Workbook-Roundtrip abgedeckt.

## Einschränkungen

Nach einem Deployment kann ein bereits geöffneter Browser bis zu zehn Minuten alte Modulantworten verwenden. Für die Annahme eines gerade aktualisierten Stands ist daher eine frische Navigation oder ein vollständiges Neuladen erforderlich.
