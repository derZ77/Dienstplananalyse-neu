# Dienstplananalyse PWA

Browserbasierte Analyse von Dienstplänen aus Excel- und PDF-Dateien. Beide
Eingänge werden in einen gemeinsamen Dienstplan überführt und in derselben
Ergebnisansicht ausgewertet.

## Voraussetzungen

- Eine aktuelle Node.js-LTS-Version (für die Prüfung wurde Node.js 22 verwendet)
- Ein aktueller Desktop-Browser

Die Laufzeitbibliotheken für Excel und PDF liegen im Verzeichnis `vendor/`.
Für die Nutzung der Anwendung sind keine externen Webdienste und keine
zusätzlichen Testdateien erforderlich.

## Start

```bash
git clone https://github.com/derZ77/Dienstplananalyse-neu.git
cd Dienstplananalyse-neu
npm install
npm start
```

Danach im Browser `http://127.0.0.1:8080` öffnen. Der Entwicklungsserver bindet
absichtlich nur an den lokalen Rechner. Bei Bedarf kann ein anderer Port
verwendet werden:

```bash
PORT=8081 npm start
```

`npm run dev` ist ein Alias für denselben lokalen Entwicklungsserver.

## Nutzung

1. Eine unterstützte Excel-Datei (`.xlsx` oder `.xls`) oder einen Dienstplan als
   PDF auswählen.
2. Die erkannte Datei importieren.
3. Die Ergebnisblöcke 1–10 und den Prüfbericht in der Anwendung ansehen.
4. Falls angeboten, die Dienstplandaten als XLSX exportieren.

Excel- und PDF-Import verwenden nach der Normalisierung denselben
Canonical-Schedule- und Block-Orchestrierungsweg. Optional vorhandene
Zusatzunterlagen können die Erkennung ergänzen; ein einzelner Dienstplan wird
eigenständig verarbeitet.

## Tests

```bash
npm test
```

Ein Teil der fachlichen Akzeptanztests verwendet echte, bewusst nicht
versionierte Referenzdokumente. Diese Dateien sind durch `.gitignore`
ausgeschlossen und gehören nicht zum Repository. Die Anwendung selbst lässt
sich aus einem sauberen Checkout starten; für die vollständige lokale
Akzeptanztestsuite werden die entsprechenden Referenzdaten benötigt.

## Datenschutz und lokale Verarbeitung

Die Anwendung wird lokal über den Entwicklungsserver ausgeliefert. Importierte
Dienstpläne werden nicht an einen externen Dienst übertragen. Persönliche
Dokumente sowie Excel- und PDF-Testdaten sind vom Repository ausgeschlossen.
