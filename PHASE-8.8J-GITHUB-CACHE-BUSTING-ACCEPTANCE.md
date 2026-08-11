# Phase 8.8J – GitHub Cache-Busting Block-10 Acceptance

## 1. Git- und Remote-Stand

- Branch: `main`
- Lokaler Commit vor dem Push: `734aaf7 fix: harden github pages module cache invalidation`
- `origin/main` stimmt nach dem Push exakt mit dem lokalen HEAD überein.
- Der Arbeitsbaum war sauber; lokale PDF-/XLSX-Dateien und Ausgaben wurden
  nicht committed.

## 2. Tests

`npm test` vor dem Push:

- 2277 bestanden
- 0 Fehler
- 0 Skips

## 3. Pages-Deployment und Asset-Version

GitHub Pages wurde nach dem Push abgewartet und lieferte anschließend die
neue Startseite aus. Im aktiven Browserlauf wurden beide Entry-Module mit
der neuen Asset-Version geladen:

- `pdf-import-bootstrap.js?v=phase8.8i`
- `check-explorer-bootstrap.js?v=phase8.8i`

Die Import-Map verweist für `block-orchestrator.js` ebenfalls auf
`?v=phase8.8i`. Die versionierten Dateien waren öffentlich mit HTTP 200
erreichbar. Es wurden keine 404- oder Konsolenfehler festgestellt.

## 4. Reale JNV-Prüfung

`jnv-schedule.pdf` wurde in der normalen Pages-URL importiert und
vollständig analysiert.

| Dienst | Zeit vor Pause | Grundlage | Bewertung |
| --- | --- | --- | --- |
| 2189 | 03:37 h | Arbeitszeitdaten | BV eingehalten |
| 2191 | 03:33 h | Arbeitszeitdaten | BV eingehalten |
| 2192 | 04:08 h | Arbeitszeitdaten | BV eingehalten |
| 2193 | 04:25 h | Arbeitszeitdaten | BV eingehalten |
| 2194 | 04:27 h | Arbeitszeitdaten | BV eingehalten |

Der alte Fehlwert `08:51 h` für 2189 war nicht mehr vorhanden.

## 5. Block-10-Darstellung

- 45 reguläre JNV-Pausen sichtbar.
- BV-Pausenlagenprüfung sichtbar.
- 61 kurze Unterbrechungen getrennt ausgewiesen.
- 12 lange Teilungsunterbrechungen getrennt ausgewiesen.
- Keine Doppelung der regulären Pausen festgestellt.
- PASS- und FAIL-Statusklassen waren getrennt vorhanden.

## 6. JES-Gegenprüfung

Der JES-Referenzdienst 761 blieb unverändert korrekt:

- Pause: 10:49–11:19
- Zeit vor Pause: 03:40 h
- Grundlage: Arbeitszeitdaten
- BV-Bewertung: BV eingehalten

## 7. Mobile

Bei 390 px:

- Viewportbreite: 390 px
- Dokumentbreite: 375 px
- Kein globaler Horizontalüberlauf
- Blockinhalte und Statusklassen blieben verfügbar.

## Ergebnis

**GO.** Der Cache-Busting-Mechanismus wird in GitHub Pages wirksam
ausgeliefert. Der Block-10-Mitternachtsfix ist im realen JNV-Browserlauf
sichtbar; der JES-Normalfall ist regressionsfrei.

Kein Release-Tag wurde erstellt.
