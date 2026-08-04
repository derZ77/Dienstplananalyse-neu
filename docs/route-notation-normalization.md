# Kurs-/Linien-Notationen — Architektur-Prüfung & Normalisierungsbedarf

Stand: 2026-07-20. **Reine Analyse — nichts implementiert.** Prüft, ob die
bestehende Architektur die unterschiedlichen Kurs-/Linien-Darstellungen (alt vs.
neu, JES-Sonderfall) bereits korrekt abbilden kann, **ohne betriebsspezifische
Sonderlogik über die App zu verteilen** — und dokumentiert, welche
Normalisierungsschritte fehlen.

---

## 1. Kurzantwort

- **Nein, heute nicht.** Die CanonicalSchedule hält die Kursangabe nur als
  **rohen String** `activity.circuitNumber` — ohne Zerlegung in Linie/Kurs/Fahrt,
  ohne Semantik-Kennzeichen und ohne Äquivalenz. „12/1" und „12100" gelten damit
  als verschieden; JES „412/16" würde fälschlich wie ein Kurs behandelt.
- **Aber die Architektur hat den richtigen Ort dafür** — die **pro-Betrieb-
  Regelpakete** (`js/v2/rules/{beu,jes}/v1/…`) plus ein **regelgesetztes
  Zusatzfeld** an der Aktivität (genau wie `activityType`). Damit lässt sich die
  betriebsspezifische Logik an **einer** Stelle je Betrieb bündeln, statt sie zu
  verstreuen.
- **Zwei Bausteine fehlen, damit das sauber funktioniert:** (a) ein
  betriebsneutrales **Route-Modell** an der Aktivität, (b) die Fähigkeit, den Code
  tatsächlich zu **zerlegen** — die vorhandene `rule-engine` kann per `set` nur
  **feste Werte** schreiben, nichts aus dem Code berechnen. Zusätzlich fehlt die
  **Betriebs-Identität für Nicht-PDF-Quellen**.

---

## 2. Ist-Zustand der Architektur

| Baustein | Verhalten heute | Fundstelle |
|---|---|---|
| `activity.circuitNumber` | roher Text, unverändert aus Excel-Spalte / PDF-Umlaufspalte | `excel-canonical-adapter.js`, `canonical-schedule-builder.js` |
| Route-Gruppierung (Block 9) | matcht **nur** `^\d{1,2}/\d{1,2}$` (alte `d/d`-Form) | `legacy-analysis-migrator.js:171` (`groupLegacyRoutes`) |
| Alt/Neu-Vergleich | vergleicht `circuitNumber` nur whitespace-normalisiert → „12/1" ≠ „12100" | `analysis-adapter.js:124` (`compareActivity`) |
| Betriebs-Äquivalenz | **hartkodiert** `EQUIVALENT_LOCATIONS = {BBU,BUP,BBN,NSL}` im Migrator | `legacy-analysis-migrator.js:10` |
| Linie/Kurs getrennt | existiert **nur** im WAGENKARTE-Referenzmodell (`trip.line`, `trip.course`) — und setzt Linie/**Kurs** voraus | `wagenkarten-reference-validator.js:80-81` |
| Klassifikations-Regeln | setzen ausschließlich `activityType` (fester Wert); **keine** Linie/Kurs-Behandlung | `rules/{beu,jes}/v1/activities.json` |
| `rule-engine` `set`-Aktion | `writePath(target, path, action.value)` — **fester Wert**, keine Capture-Gruppen/Berechnung | `rule-engine.js:106-107` |

Das hartkodierte `EQUIVALENT_LOCATIONS` ist genau das Muster, das laut Auftrag
**nicht** weiter verstreut werden soll — es ist die Blaupause dafür, wie es
*nicht* laufen soll.

---

## 3. Empirischer Befund — vier Notationen, keine gemeinsame Semantik

Gemessen über die reale Pipeline auf den Referenzdateien:

| Kontext | Notation | Beispiele (gemessen) | Bedeutung |
|---|---|---|---|
| Alt-Excel (JNG Stadtbus) | `L/K` (`d/d`) | `12/1`, `65/5`, `16/3` | Linie / **Kurs** |
| Neu-PDF (BEU, JNG Stadtbus) | 5-stellig `LLCPP` | `12100`, `15300`, `14200`, `87200` | Linie(2) / **Kurs**(1) / „00" |
| JES-Dienstübersicht-PDF (Übergangsform) | 4-stellig | `7511`, `7532`, `7602` | **Dienst/Umlauf** (751 = Dienst, 1 = Umlauf) — **kein** Linie/Kurs/Fahrt |
| JES-Wagenkarte | `Linie/Fahrt` | `412/16` | **Linie / Fahrt** (nicht Kurs!) |

Konkrete Bruchstellen, die daraus heute schon folgen (belegt):

- **BEU-PDF → Block 9 „Dienste nach Linie/Kurs" = 0 Routen.** `groupLegacyRoutes`
  matcht nur `d/d`; die 5-stellige Form fällt komplett durch.
- **Alt↔Neu-Vergleich meldet Scheindifferenzen.** `compareCanonicalSchedules`
  wertet „12/1" ≠ „12100" als Unterschied, obwohl fachlich identisch.
- **JES-Verwechslungsgefahr.** Würde man „412/16" mit derselben `d/d`-Logik lesen,
  käme „Kurs 16" heraus — tatsächlich ist es **Fahrt 16**. Die Semantik ist
  betriebsabhängig und im rohen String nicht unterscheidbar.

Mapping der 5-stelligen Form (aus Beispielen + BEU-Daten):
`12/1 → 12100`, `13/2 → 13200` ⇒ **`LL`=Linie, `C`=Kurs, `PP`=„00"** (Subteil,
in den Daten stets 00). Die Umkehr (neu→alt) braucht die Feldbreiten des
jeweiligen Betriebs (2-stellige Linie bei JNG, 3-stellig bei JES) — also
**betriebsspezifisch**.

---

## 4. Kann die Architektur es ohne verteilte Sonderlogik abbilden?

**Im Prinzip ja — der Mechanismus ist vorhanden**, wird aber noch nicht genutzt:

1. **Pro-Betrieb-Regelpakete** (`rules/beu/v1`, `rules/jes/v1`, …) sind bereits der
   vorgesehene, gebündelte Ort für betriebsspezifisches Wissen. Die Profilerkennung
   wählt sie pro PDF. Betriebsspezifik gehört hierher, nicht in Migrator/UI.
2. **Regelgesetzte Zusatzfelder** an der Aktivität sind bereits Praxis
   (`activityType` wird per Regel gesetzt). Ein Route-Feld würde demselben Muster
   folgen — **additiv, kein neues Datenmodell**.

**Zwei Lücken verhindern die saubere Umsetzung heute:**

- **L-A: Kein betriebsneutrales Route-Modell.** Die Aktivität hat nur
  `circuitNumber` (roh). Es fehlt eine normalisierte, quellenunabhängige Struktur
  (Linie/Kurs/Fahrt + Semantik-Kennzeichen), auf die Vergleiche und Gruppierungen
  zugreifen können.
- **L-B: `rule-engine` kann nicht rechnen.** `set` schreibt feste Werte. „12100" →
  `{Linie 12, Kurs 1}` erfordert Ziffern-Zerlegung — das ist mit dem heutigen
  Regelschema (Boolescher Match + fester `value`) **nicht** ausdrückbar. Man müsste
  je Linie/Kurs eine Einzelregel schreiben (unpraktikabel) oder das Schema erweitern.
- **L-C (Voraussetzung): Betriebs-Identität nur für PDF.** `detectPdfDocumentProfile`
  liefert `jes`/`beu`. Excel und Wagenkarte haben **keine** Betriebserkennung → ohne
  sie lässt sich das richtige Normalisierungs-Regelwerk nicht auswählen.

---

## 5. Benötigte Normalisierungsschritte (dokumentiert, nicht implementiert)

Reihenfolge = geringste Eingriffstiefe zuerst. Alles additiv, kein Umbau der
eingefrorenen Komponenten.

1. **Betriebsneutrales Route-Feld definieren** (additiv an der Aktivität, analog
   `activityType`), z. B.:
   ```
   activity.route = {
     raw:    "12100",           // unverändert erhalten
     line:   "12"  | null,      // BEU/JNG: 12 · JES-Wagenkarte/künftig: 412
     course: "1"   | null,      // nur bei Linie/Kurs-Betrieben (JNG)
     trip:   "16"  | null,      // nur bei JES Linie/Fahrt
     dienst: "751" | null,      // nur bei JES-Übergangsform (Dienst/Umlauf)
     umlauf: "1"   | null,      // nur bei JES-Übergangsform
     kind:   "LINE_COURSE" | "LINE_TRIP" | "DIENST_UMLAUF" | "UNKNOWN",
     key:    "LC:12|1"          // Äquivalenzschlüssel je kind (nur gleichartige kind vergleichbar)
   }
   ```
   `kind` trennt die Semantikräume sauber: Linie/Kurs (JNG), Linie/Fahrt (JES neu)
   und Dienst/Umlauf (JES Übergang) werden nie vermischt. Nur gleichartige `kind`
   werden über `key` verglichen; die JES-Übergangsform trägt **keine** Linie und ist
   damit **kein** Kandidat für „Dienste nach Linie/Kurs". `key` macht die
   Alt/Neu-Äquivalenz (`12/1` ≙ `12100`) explizit.

2. **Einen einzigen, betriebsparametrierten Normalisierungsschritt** einführen, der
   `circuitNumber` → `route` überführt und **neben** `applyRuleGroups` läuft. Die
   betriebsspezifischen Zerlegungsregeln (Feldbreiten, `d/d` vs. `LLCPP` vs.
   4-stellig vs. `Linie/Fahrt`) liegen als **Daten im jeweiligen Regelverzeichnis**
   (`rules/{betrieb}/v1/routes.json`). So bleibt die Sonderlogik **je Betrieb an
   einer Stelle** — nicht verstreut.
   - *Alternative ohne neuen Code:* die `rule-engine`-`set`-Aktion um
     Capture-Gruppen/Template-Werte erweitern (z. B. `value: "$1|$2"` aus einem
     Regex-Match). Dann könnte `routes.json` die Zerlegung rein deklarativ
     ausdrücken. Abwägung: das ist eine **Erweiterung der `rule-engine`** (bewusst
     eingefrorene Komponente) — nur wählen, wenn eine deklarative Lösung gewünscht ist.

3. **Betriebs-Identität für alle Quellen herstellen** (L-C): PDF hat sie bereits;
   für Excel/Wagenkarte ein leichtgewichtiges Signal (Dateiname/Blattmarker/
   `PLAN_METADATA`) ergänzen, das denselben Betriebsschlüssel liefert wie die
   PDF-Profilerkennung. Nur so wird pro Import das richtige `routes.json` gewählt.

4. **Konsumenten auf das normalisierte Feld umstellen** — statt roher Regexe:
   - `groupLegacyRoutes` (Block 9) liest `route.key`/`route.kind`.
   - `compareCanonicalSchedules` vergleicht `route.key` (löst die 12/1↔12100-
     Scheindifferenz).
   - Die hartkodierten Konstanten (`d/d`-Regex, perspektivisch auch
     `EQUIVALENT_LOCATIONS`) wandern in die Betriebskonfiguration und hören damit
     auf, verstreut zu sein.

5. **WAGENKARTE-Referenzmodell um dasselbe `kind`-Kennzeichen ergänzen**, damit JES
   „412/16" als `line=412, trip=16, kind=LINE_TRIP` geführt wird und **nicht** als
   `course=16` fehl-abgelegt wird (heute erzwingt der Validator `course` für jede
   Linienfahrt — für JES semantisch falsch).

---

## 6. Äquivalenz-Zieltabelle (zur Abstimmung)

| Quelle | Notation | line | course | trip | Dienst/Umlauf | kind | key |
|---|---|:--:|:--:|:--:|:--:|---|---|
| Alt-Excel (JNG) | `12/1` | 12 | 1 | – | – | LINE_COURSE | `LC:12\|1` |
| Neu-PDF (BEU/JNG) | `12100` | 12 | 1 | – | – | LINE_COURSE | `LC:12\|1` |
| JES-Wagenkarte (Zielbild) | `412/16` | 412 | – | 16 | – | LINE_TRIP | `LT:412\|16` |
| JES-Dienstübersicht (Übergang) | `7511` | – | – | – | 751 / 1 | DIENST_UMLAUF | `DU:751\|1` |
| JES-Dienstplan (künftig) | `412/16` | 412 | – | 16 | – | LINE_TRIP | `LT:412\|16` |

`LC:12\|1` (alt-Excel) und `LC:12\|1` (neu-PDF) sind identisch ⇒ Äquivalenz. `key`
ist mit `kind` präfigiert, damit ein `DIENST_UMLAUF` nie versehentlich mit einem
`LINE_COURSE` gleich-„key"-t.

---

## 7. Geklärte JES-Regel & verbindliche Leitplanken

**JES 4-stellig ist eine Übergangskennzeichnung und bedeutet Dienst/Umlauf**
(`7511` → Dienst 751 / Umlauf 1). Sie ist **nicht** Linie/Kurs und **nicht**
Linie/Fahrt und trägt **keine** Linieninformation.

JES hat damit **zwei** Notationen, die die Normalisierung anhand von **Muster bzw.
Datenquelle** unterscheiden muss:

- **Übergang** (heutige Dienstübersicht): 4-stellig → `DIENST_UMLAUF`.
- **Zielbild** (Wagenkarten heute, künftige JES-Dienstpläne): `Linie/Fahrt` → `LINE_TRIP`.

Verbindliche Leitplanken (aus dem Auftrag):

- **Genau eine zentrale Normalisierung.** Alle nachgelagerten Komponenten arbeiten
  ausschließlich mit der einheitlichen fachlichen Repräsentation `activity.route`.
- **Unterscheidung anhand Notation/Datenquelle** — **niemals** über Sonderfälle in
  `AnalysisCore` oder `CheckRunner`. Diese bleiben notationsblind und lesen nur das
  normalisierte Feld (analog dazu, wie sie heute schon `activityType` lesen, ohne
  die Klassifikationsregeln zu kennen).

**Konsequenz für Block 9 „Dienste nach Linie/Kurs":** Die JES-**Übergangs**-Dienst­
übersicht trägt keine Linie → Block 9 lässt sich daraus **nicht** befüllen; Linie/
Fahrt kommt hier aus der **Wagenkarte** (Priorität B), bis JES-Dienstpläne auf
Linie/Fahrt umstellen. Für JNG (alt `d/d` / neu 5-stellig) und künftige JES-Pläne
(`Linie/Fahrt`) ist Block 9 dagegen direkt aus `route` befüllbar.

---

## 8. Einordnung

Dieser Punkt konkretisiert **Priorität D2** aus dem
`v1-release-readiness-audit.md` (Block 9 „Linie/Kurs" für PDF). Er ist **keine neue
Architektur**, sondern das Ausformulieren eines additiven, regelpaket-gebundenen
Normalisierungsschritts entlang des bereits vorhandenen `activityType`-Musters. Die
betriebsspezifische Logik bleibt dadurch **an einer Stelle je Betrieb** gebündelt.
