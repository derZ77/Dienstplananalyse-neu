# Phase 8.4C – BV-Verstöße visuell hervorheben

**Ausgangsbasis:** `6bbc898 fix: simplify review report and detail views`
**Umfang:** reine Darstellung vorhandener Block- und CheckReport-Ergebnisse.
**Nicht geändert:** Fachregeln, CheckRunner, CanonicalSchedule, Parser, Blöcke 1–10 als Fachlogik und Export.

## 1. Status-Farbvertrag

Die Oberfläche verwendet einen gemeinsamen, begrenzten Farbvertrag. Farbe ist stets ein Zusatz zum sichtbaren Status-Text:

| Vorhandene Aussage / Status | Klasse | Darstellung |
|---|---|---|
| `FAIL`, `BV-Verstoß`, „nicht zulässig“, „nicht BV-konform“ | `status-fail` | hellrot, roter linker Rand, dunkelrote Statusschrift |
| „Prüfung erforderlich“, „nicht abschließend“ | `status-warning` | hellgelb, orangefarbener linker Rand, dunkle gelb-braune Schrift |
| `PASS`, `BV eingehalten`, „zulässiger 1/6-Dienst“ | `status-pass` | sehr dezentes Grün, grüner linker Rand |
| `SKIP`, `NOT_APPLICABLE` bzw. vorhandene neutrale Blockaussagen | `status-neutral` | hellgrau, grauer linker Rand |

`FAIL` bleibt auch dann rot, wenn die zugehörige Severity `WARNING` lautet: Der fachliche Checkstatus ist bereits ein echtes fehlgeschlagenes Ergebnis. Eine bloße Warnung ohne `FAIL` wird nicht als BV-Verstoß dargestellt.

## 2. Betroffene Ansichten

### Blöcke 1–10

Der gemeinsame Blockrenderer gruppiert vorhandene Absätze der Blockausgabe nur visuell. Er escaped den Ausgangstext und erkennt ausschließlich bereits ausgegebene Ergebnisformulierungen. Für Block 4, 6 und 10 werden damit einzelne Ergebnisgruppen statt des gesamten Blocks markiert. Es findet keine Berechnung oder Statusänderung statt.

### Auffälligkeitsübersicht

Eine Dienstzeile mit einem vorhandenen `FAIL` erhält `status-fail`: hellroter Hintergrund und roter linker Rand. Die sichtbare Beschriftung bleibt „Prüfauffälligkeit“. Dienste ohne Regelauffälligkeit bleiben neutral.

### Prüfbericht

Die bestehenden Statuslabels bleiben sichtbar. Die Ergebnis-Karte und ihr Status-Badge erhalten dieselbe Klasse:

- `Prüfauffälligkeit` / `FAIL`: rot,
- `Bestanden` / `PASS`: dezent grün,
- `Übersprungen` und `Nicht anwendbar`: neutral grau.

Technische Fehler bleiben ein separater technischer Detailbereich und werden nicht als fachlicher BV-Verstoß eingefärbt.

### Detailprüfung einzelner Regeln

Eine CheckResult-Zeile mit `FAIL` erhält `check-tone-fail status-fail`; `PASS` erhält die positive, `SKIP`/`NOT_APPLICABLE` die neutrale Klasse. Betroffene Dienste, Begründung und die vorhandenen Detailwerte bleiben unverändert und ohne Rohdaten sichtbar.

## 3. Accessibility und Lesbarkeit

- Alle Bedeutungen bleiben über sichtbaren Text zugänglich: „Prüfauffälligkeit“, „Bestanden“, „Übersprungen“, „Nicht anwendbar“ sowie die vorhandenen BV-Texte.
- Keine Vollflächenfarbe über einen ganzen Themenblock; Markierung ist auf Ergebnisgruppe, Zeile oder Karte begrenzt.
- Kontraststärkere dunkle Schrift und linker Rand ergänzen die Pastellflächen.
- Bestehende Statussymbole im Prüfbericht bleiben erhalten.

## 4. Mobile Darstellung

Bei 390 px Breite wurden JNV-Ergebnisse geprüft:

- `status-fail` bleibt auf der ersten Dashboard-Zeile erhalten.
- Dashboard, Prüfbericht und Detailprüfung bleiben innerhalb ihrer Container.
- Kein globaler horizontaler Seitenüberlauf.
- Die optionale Explorer-Tabelle darf weiterhin innerhalb ihres eigenen Containers scrollen.

## 5. Tests und Acceptance

Neue Testdatei: `tests/phase8-4c-bv-visual-highlighting.test.js`.

Sie prüft:

- Fehler-, Warn-, Pass- und Neutralklasse für vorhandene Blockformulierungen,
- unveränderte `FAIL/PASS/SKIP/NOT_APPLICABLE`-Semantik im Prüfbericht,
- rote FAIL-Klasse in Dashboard und Detailprüfung,
- keine rote Klasse für PASS, SKIP oder NOT_APPLICABLE,
- mobile Statusgruppen und gekapselten Tabellenüberlauf.

Browser-Acceptance:

- JNV-PDF: BV003 trägt in Dashboard, Prüfbericht und Detailprüfung die Klasse `status-fail`; Status bleibt „Prüfauffälligkeit“.
- JES-PDF: leerer gültiger CheckReport, keine rote Statusmarkierung.
- Keine relevanten Browser-Konsolenfehler.
- Vollständige Regression: `npm test` – **2257 bestanden, 0 Fehler, 0 Skips**.
  Die bekannten Node-/PDF.js-Umgebungshinweise (`@napi-rs/canvas`,
  `ImageData`, `Path2D`, `standardFontDataUrl`) blieben ohne Auswirkung auf
  die Testergebnisse.

## 6. Verbleibende Punkte

- Ein Block kann nur markieren, was seine bestehende Ausgabe als Ergebnis ausweist. Keine freie Textpassage wird zu einem neuen BV-Ergebnis aufgewertet.
- Block 7 bleibt fachlich unverändert und hat ohne Wagenkarte keine Ergebnisbewertung.
- Die technische Bedeutung einer Severity bleibt im Explorer verfügbar; die visuelle Fehlerentscheidung basiert für CheckResults ausschließlich auf dem vorhandenen Status `FAIL`.
