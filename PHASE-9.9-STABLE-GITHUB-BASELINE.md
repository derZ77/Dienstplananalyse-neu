# Phase 9.9 – Stable GitHub Baseline und Pages Acceptance

## Ergebnis

**GO für den GitHub-Teststand.** Der akzeptierte Phase-9-Stand wurde ohne
Historienumschreibung auf `origin/main` veröffentlicht. GitHub Pages liefert
die aktuelle Anwendung und den Phase-9.7D-Mehrregionenprojektor aus.

## Preflight

- Branch: `main`
- Ausgangs-HEAD: `3c5dc72` (Mehrregionenprojektor)
- Remote vor Push: `d6e15dc`
- Relevante Phase-9-Commits in der lokalen Historie:
  - `17c9e7e` Tagesart im Analysepfad erhalten
  - `4e7b641` manueller Tagesart-Fallback
  - `f4b92a9` JNV-Dokumenterkennung und Importabdeckung
  - `730e821` JES-Wagenkarten-Datenvertrag
  - `70e7bf5` JES-Block-7-Lenkzeit
  - `3c5dc72` JES-Wagenkarten-Mehrregionenprojektion
- Keine realen PDF-/XLSX-Referenzen, keine `outputs/`-Dateien und keine
  temporären Browserartefakte waren staged.

## Dokumentations- und finaler Commit

Der Phase-9.8-Acceptancebericht wurde bewusst separat committed:

- `5a154b1 docs: validate six document type end-to-end coverage`

Dieser Commit enthält ausschließlich
`PHASE-9.8-SIX-DOCUMENT-END-TO-END-ACCEPTANCE.md`.

## Teststand

Unmittelbar vor dem Push lief der vollständige Testlauf außerhalb der Sandbox:

- **2310 bestanden**
- **0 Fehler**
- **0 Skips**

Die Sandbox selbst kann die drei lokalen HTTP-Smoke-Tests nicht an
`127.0.0.1` binden. Außerhalb der Sandbox sind auch diese erfolgreich.

## Push und Remote-Abgleich

- Push: `main → origin/main`, kein Force-Push, kein Rebase
- Remote nach Push: `5a154b1c7e063a071a4a83907832b4375eb39d6a`
- Lokaler HEAD nach Push: identisch

## GitHub Pages

Testseite: `https://derz77.github.io/Dienstplananalyse-neu/`

HTTP-Prüfung nach Deployment:

- Einstieg `index.html`: HTTP 200
- `vendor/pdfjs/pdf.mjs`: HTTP 200
- `vendor/xlsx/xlsx.full.min.js`: HTTP 200
- `js/v2/import/wagenkarte-data-projector.js`: HTTP 200

Der öffentlich ausgelieferte Projektor enthält nachweislich den
Phase-9.7D-Code für drei parallele Wagenkartenregionen und die
chronologische links-nach-rechts-Projektion. Damit wird nicht nur ein
veralteter Phase-8-Stand ausgeliefert.

## Cache und Asset-Versionen

Die Einstiegsmodule verwenden weiter die etablierte Versionskennung
`phase8.8i`. Der frisch geladene Pages-Inhalt und der direkt abgerufene
Mehrregionenprojektor waren aktuell; ein fachlicher Auslieferungsfehler wurde
nicht festgestellt.

Hinweis: Der Versionsstring wurde in dieser Phase nicht verändert. Für eine
spätere reine Deploymenthärtung kann er bei jedem Pages-Deployment erhöht
werden, damit bereits offene Browser-Tabs unmittelbarer auf neue
Modul-URLs wechseln. Das ist kein P0/P1-Befund und wurde nicht als neue
Cache-Architektur umgesetzt.

## Fachliche Acceptances

Die vollständige reale Datenabnahme erfolgte in Phase 9.8 und ist im
verlinkten Bericht dokumentiert:

- JNV 2189: Block 10 weiterhin 03:37 h vor Pause, BV eingehalten.
- JES 756, 758, 759, 760: gemeinsame Split-Duty-Erkennung erhalten.
- reale JES-Wagenkarte: 23 Dienste; 602 max. 01:55, 605 Unterbrechung
  08:00–11:57, 613 mit mehreren Pausen und drei Blöcken.

Die öffentlichen statischen Ressourcen für diese Pfade wurden in dieser Phase
verifiziert. Eine interaktive Browserabnahme war nicht möglich, da in der
Ausführungsumgebung keine Browserverbindung verfügbar war; sie wurde nicht
simuliert.

## Weitere Dokumenttypen und Tagesart

Die sechs Dokumentfamilien sowie der Tagesart-/Fallback-Vertrag wurden vor
dem Push im vollständigen Teststand und in Phase 9.8 abgenommen. Für JNV-
Umlauftafeln bleibt die Block-7-Ausgabe neutral; es wird keine JES-
Wagenkartenlogik vorgetäuscht.

## Browser, Mobile und Konsole

- Browser- und 390-px-Interaktion: in dieser Umgebung nicht verfügbar.
- Deshalb keine simulierte Upload-/Klickabnahme und keine erfundenen
  Konsolenaussagen.
- HTTP-Ressourcenprüfung: keine 404 für Einstieg, PDF.js, XLSX oder den
  Phase-9-Projektor.

## Lokale Dateien

Bewusst nicht versioniert bleiben:

- `outputs/` (ignoriert)

Die reale JES-Wagenkarten-XLSX lag außerhalb des Repositorys und wurde nie
staged oder committed.

## Restpunkte

1. P3: manuelle Browser-/Mobile-Abnahme nach frischer Navigation bzw.
   Cache-Deaktivierung.
2. P3: Versionskennung beim nächsten Pages-Deployment fortschreiben, um
   Browser-Cache-Wechsel sichtbar zu machen.
3. Nicht Teil dieser Phase: eigene Block-7-Fachbewertung für JNV-Umlauftafeln.

## Freigabe

**GO – stabiler GitHub-Teststand auf `origin/main`, keine P0-/P1-Regression,
vollständiger Testlauf grün, aktuelle Pages-Ressourcen erreichbar.**
