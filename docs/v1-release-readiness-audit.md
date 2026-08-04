# V1 Release Readiness Audit — Excel/PDF/Wagenkarten-Parität

Stand: 2026-07-20. **Reine Analyse — kein Code, keine Implementierung, keine
Refactorings, keine neue Architektur.** Ziel: eindeutig zeigen, welche
bestehenden Auswertungsblöcke noch angepasst werden müssen, damit V1 für Excel,
PDF, Wagenkarten und Umlaufkarten denselben Informationsumfang liefert.

Dieses Audit ist **empirisch** — jede Bewertung wurde durch Ausführen der echten
V2-Pipeline (`node`, vendored PDF.js, `xlsx`) auf den fünf gelieferten
Referenzdateien belegt, nicht nur aus dem Code abgeleitet. Alle 65
Bestandstests sind grün.

---

## 1. Kurzfazit

1. **Der Live-PDF-Import füllt heute keinen einzigen Block** — der Legacy-Handler
   verwirft PDFs (`index.html:2921`), der V2-PDF-Controller macht nur
   Profilerkennung. Die komplette V2-Kette existiert und ist getestet, ist aber
   nicht mit der UI verdrahtet (kein Orchestrator, kein CheckReport-Dispatch).
2. **Parität ist keine reine „PDF nachziehen"-Aufgabe.** Die Messung zeigt eine
   **spiegelbildliche Lücke**: Der PDF-Weg ist bei manchen Feldern *besser* als
   der Excel-Weg (bezahlte Zeit, Dienstende, Tätigkeits-Klassifikation), bei
   anderen *schlechter* (Linie/Kurs). Keine Quelle ist Obermenge der anderen.
3. **Die Aktivitätsklassifikation ist bereits vorhanden** (Regel-Engine +
   `js/v2/rules/{beu,jes}/v1/activities.json`) und für PDF getestet — sie ist nur
   nicht verdrahtet. Für den Excel-MICROBUS-Weg greift sie mangels
   Tätigkeits-Labels **nicht**.
4. **Eine der beiden „PDF-Dienstpläne" ist gar kein Dienstplan:** die Datei
   `FB … Ferien …pdf` ist eine **Umlaufkarte** (Haltestellenfolge, Leerfahrten,
   Linie/Route je Dienst) → gehört fachlich zu „Wagenkarten/Umlaufkarten"
   (Referenzdaten) und wird korrekt als „unsupported" erkannt.
5. **Für keinen der beiden Excel-Dienstpläne ist der V2-Excel-Adapter voll
   tauglich:** bezahlte Zeit und Dienstende gehen bei mehrzeiligen Diensten
   verloren (Kopfzeilen-Annahme). Der Legacy-`parseTabular` bleibt vorerst die
   einzige verlässliche Excel-Auswertung.

---

## 2. Empirische Testgrundlage — die 5 Referenzdateien

Gemessen über die reale Pipeline (`extractPdfLayoutDocument → normalize → map →
buildCanonicalSchedule → analyzeCanonicalScheduleWithMigratedLegacyChecks`, bzw.
`adaptExcelRowsToCanonicalSchedule`).

| Datei | Tatsächlicher Typ | Import-Weg | Ergebnis der echten Pipeline |
|---|---|---|---|
| `B_20251018_Mo-Fr_Schule.xlsx` | Excel-Dienstübersicht (MICROBUS, Blatt „Diensterklärung") | Excel | 70 Dienste, 159 Aktivitäten; Linie/Kurs 47 Routen ✅; **bez. Zeit nur 6/70, Ende fehlt** ❌; Plan „nicht erkannt" (100er-Nummern) |
| `B_20251215_MoFrSchule 2.xlsx` | Excel-Dienstübersicht (MICROBUS) | Excel | 61 Dienste, 147 Aktivitäten; 41 Routen ✅; **bez. Zeit nur 4/61** ❌; Plan „Bus – Mo–Fr Schule" ✅ |
| `20260526_Eisenberg_Schule.xlsx` | **Wagenkarte** (B1 „Dienst-Nr.:", je Dienst ein Blatt, Lenkzeit, Haltestellen) | Wagenkarte | Legacy `parseWagenkarte` zuständig; **kein V2-Loader** Excel-Wagenkarte → `WAGENKARTE`-ReferenceDataSource |
| `B_20260817_MoFr_Schule_BEU.pdf` | PDF-Dienstübersicht (BEU Stadtbus) | PDF | **supported**; 62 Dienste, 656 Aktivitäten; **bez. Zeit 62/62 ✅**, Orte/Zeiten ~96 % ✅; Plan „Bus – Mo–Fr Schule" ✅; **Linie/Kurs 0 Routen** ❌; alle Aktivitäten „unclassified" (Regeln nicht verdrahtet) |
| `FB … Ferien … 23.07.2026.pdf` | **Umlaufkarte** (je Dienst: Linie/Route + Haltestellenfolge + Leerfahrten) | (PDF) | **unsupported** — kein 10-Spalten-Tabellenkopf; Layout-Rekonstruktion erzeugt Unsinn (Dienst 0 = „Leerfahrt", 0/409 bez. Zeit). Fachlich Referenzdaten, kein Dienstplan |

**Zentrale Messwerte im Direktvergleich** (Excel-MICROBUS vs. BEU-PDF, beide über
CanonicalSchedule):

| Feld / Auswertung | Excel `Diensterklärung` | BEU-PDF |
|---|:--:|:--:|
| Dienste erkannt | 70 / 61 ✅ | 62 ✅ |
| `serviceNumber`, `begin` | ✅ | ✅ |
| `end` (Dienstende) | ❌ (Summenzeile nicht gelesen) | ✅ |
| `paidTime` (bez. Zeit) | ❌ 6/70, 4/61 | ✅ 62/62 |
| `departureLocation`/`arrivalLocation` | ✅ ~97 % | ✅ ~96 % |
| `departureTime`/`arrivalTime` | ✅ ~96 % | ✅ ~96 % |
| `circuitNumber` als Linie/Kurs (`d/d`) | ✅ „65/5" → 47 Routen | ❌ 5-stellig „12100" → 0 Routen |
| Tätigkeits-Labels (`rawActivity`) | ❌ = Linien-Nr., keine Labels | ✅ 9 Labels (Vorbereitung, Pause …) |
| `activityType`-Klassifikation | ❌ kein Regelpaket, keine Labels | ✅ (Regelpaket vorhanden, nur unverdrahtet) |
| Reserve / Schicht / lange Teilstücke | ✅ | ✅ |

---

## 3. Aufgabe 1 & 2 — Vollständiges Block-Inventar (gesamte App)

### 3.1 Legacy-Oberfläche (`index.html`, Strings aus `parseTabular`/`parseWagenkarte`)

| # | Block | Zweck | Angezeigte Informationen |
|---|---|---|---|
| B0 | Datei-Auswahl & Import-Status | Datei laden, Format melden | Dateiname; PDF-Profilstatus |
| BS | Suche in den Auswertungen | Ergebnis-Blöcke clientseitig filtern | Volltextfilter über gerenderte Blocktexte |
| B1 | Anzahl eindeutige Dienste + Plan-Typ | Grundzählung & Planerkennung | Plan-Label (Fahrzeug + Zeitraum); Anzahl eindeutiger Dienste |
| B2 | Anzahl geteilte Dienste | geteilte Dienste zählen | Anzahl/Liste geteilter Dienste (ID-Bereiche) |
| B3 | Reserve-Dienste | Reservedienste ausweisen | Liste der Reserve-IDs |
| B4 | Dienste > 08:30 h | überlange Dienste | IDs mit bez. Zeit > 8:30 |
| B5 | Untersch. Anfangs-/Endorte | Ortswechsel Start↔Ende | Dienste, deren erster Abfahrts- ≠ letzter Ankunftsort |
| B6 | Dienstteilstück > 04:30 h + Linie/Kurs | lange Teilstücke | Teilstücke > 4:30 (einzeln/kombiniert) mit Linie/Kurs |
| B7 | Lenkzeit real vor/nach Pause | echte Lenkzeit (nur Wagenkarte) | Lenkzeitblöcke vor/nach Pause; tabellarisch: „nicht verfügbar" |
| B8 | Schichtzuweisung | Schicht je Dienstbeginn | F1/F2/…/N-Zuordnung + Zählung |
| B9 | Dienste nach Linie/Kurs | Gruppierung Linie/Kurs | je Linie/Kurs die Dienste mit Zeiten/Orten |
| B10 | Pausen 30–120 min | Pausen + BV-Hinweis | Pausen je Dienst; BV-Konformität (Arbeitszeit vor Pause) |
| B11 | KI-Fragen | Freitext-Fragen zur Auswertung | KI-Antwort auf Basis der Blocktexte |
| BC | KI-Chat-Widget | dialogische Hilfe | Chatverlauf, „Aktueller Plan" |

### 3.2 V2-Oberfläche (`js/v2/ui`, aus `CheckReport` via Event `dienstplan:v2-check-report`)

| Block | Zweck | Angezeigte Informationen |
|---|---|---|
| Review Dashboard / **Dienstübersicht** | Prüfergebnisse je Dienst priorisieren | je Dienst: Gesamtstatus, Anzahl Checks, PASS/WARNING/ERROR/VIOLATION, höchste Severity |
| Check Explorer | Prüfergebnisse filtern/sortieren/gruppieren | Tabelle aller CheckResults (Kategorie, Check-ID, Name, Status, Severity, Dienst, Nachricht) + Statistik |

### 3.3 Fachlich genannte, aber nicht als eigener Live-Block gerenderte Auswertungen

| Auswertung | Wo heute | Angezeigte Informationen |
|---|---|---|
| **Statistik** | `AnalysisCore.statistics` (kein Live-Renderer) | serviceCount, activityCount, Pausen-/Fahrtenzahl, Aktivitätsklassen |
| **Arbeitszeit** | `statistics.workingTime` + Wagenkarte-Subanalyse | Summe Arbeitszeit (klassifikationsabhängig) |
| **Bezahlte Zeit** | `service.paidTime` / `statistics.paidTime` | Summe bez. Zeit |
| **Unbezahlte Zeit** | `statistics.unpaidTime` | Summe unbezahlter Pausen (klassifikationsabhängig) |
| **Warnungen** | Inline-BV-Hinweise (Legacy) + `rule-engine`-Warnungen + Check-WARNING | Regelverstöße/Hinweise |

### 3.4 Wagenkarten-Subanalysen (nur bei Wagenkarte-Eingabe, speisen B5–B7, B10)

`buildWagenkartePausenAnalyse`, `buildWagenkarteDienstteilAnalyse`,
`buildWagenkarteLenkzeitAnalyse`, `buildWagenkarteSegmentText`,
`buildWagenkarteZeitGrenzenDiagnose` — liefern Lenkzeit, Haltestellenkontext,
Dienstteil- und Pausenfeinauswertung.

---

## 4. Aufgabe 3 & 4 — Herkunft je Information & Abdeckung durch Canonical/Analysis/CheckReport/Reference

Legende Quelle: **E**=Excel, **P**=PDF, **W**=Wagenkarte, **U**=Umlaufkarte,
**R**=Referenzdaten, **M**=mehrere.

| Information | Quelle | Liefert CanonicalSchedule? | Liefert AnalysisResult? | Liefert CheckReport? | Braucht ReferenceContext? |
|---|:--:|---|---|---|---|
| Dienstnummer | M (E/P/W) | ✅ `service.serviceNumber` | ✅ | via `affectedServices` | – |
| Dienstbeginn | M | ✅ `service.begin` | ✅ | – | – |
| Dienstende | M | ⚠ E: fehlt bei Mehrzeilern; ✅ P | ✅ (soweit vorhanden) | – | – |
| Bezahlte Zeit | M | ⚠ E: 6/70; ✅ P 62/62 | ✅ `statistics.paidTime` | – | – |
| Abfahrts-/Ankunftsort | M | ✅ ~96 % | ✅ | – | (BV-Ortslogik: R `LOCATION_CATALOG`) |
| Abfahrts-/Ankunftszeit | M | ✅ ~96 % | ✅ | – | – |
| Umlauf/Linie/Kurs | M | ⚠ E `d/d` ✅ / P 5-stellig, kein `d/d` | ⚠ Routen nur bei `d/d` | – | (U-Umlaufkarte kann Linie/Route liefern) |
| Tätigkeitsart (Vor-/Nachbereitung, Pause, Fahrt) | P (Labels); E ohne | ✅ Rohtext; ❌ `activityType` unverdrahtet | ⚠ hängt an `activityType` | mehrere BV-Checks | – |
| Arbeitszeit / unbezahlte Zeit | abgeleitet | ✅ Zeiten; ❌ Trennung ohne `activityType` | ⚠ | – | – |
| Reserve/Schicht/lange Dienste/Teilstücke/Orte-Diff | M | ✅ (`legacy-analysis-migrator`) | ✅ | – | – |
| **Reale Lenkzeit** (B7) | W/U | ❌ (bewusst keine Lenkzeitberechnung) | ❌ | – | **R `WAGENKARTE`** |
| Haltestellenfolge / Leerfahrten | W/U | ❌ | ❌ | – | **R `WAGENKARTE`** |
| Prüf-/Warnstatus je Dienst (Dashboard/Explorer) | abgeleitet | – | – | ✅ (nur bei laufenden Checks) | teils R (referenzbasierte BV) |

---

## 5. Aufgabe 5 & 6 — Status je Block + fehlende Felder

Status: ✅ vollständig über Canonical · ⚠ teilweise · ❌E Excel-abhängig ·
❌W Wagenkarten fehlen · ❌R Referenzdaten fehlen · ❌V nur Verdrahtung fehlt.

| Block | Status PDF | Fehlendes Feld / Ursache | Herkunft | Zu erweiternde Bestandskomponente |
|---|:--:|---|---|---|
| B1 Anzahl/Plan-Typ | ⚠ | Plan-Label bei „100er"-Nummern nicht erkannt | `service.serviceNumber` | `legacy-analysis-migrator.detectLegacyPlan` (Nummernraster ergänzen) — **Daten, kein Umbau** |
| B2 geteilte Dienste | ✅V | — | Canonical | nur Verdrahtung |
| B3 Reserve | ✅V | — | Canonical | nur Verdrahtung |
| B4 Dienste > 08:30 h | ✅V (P) | für Excel: `paidTime` unvollständig | `service.paidTime` | (PDF ok) / Excel-Adapter (s. B „bez. Zeit") |
| B5 Anfangs-/Endorte | ✅V | — | `activity.departure/arrivalLocation` | nur Verdrahtung |
| B6 Dienstteilstücke | ✅V | — | Aktivitätszeiten | nur Verdrahtung |
| B7 Lenkzeit real | ❌W | reale Lenkzeit/Haltestellenfolge fehlen | `WAGENKARTE`-Referenz | Loader Wagenkarte(Excel/PDF)→`WAGENKARTE`-Source + Konsument |
| B8 Schichtzuweisung | ✅V | (GF-Gruppen an geteilt-Erkennung) | `service.begin` | nur Verdrahtung |
| B9 Dienste nach Linie/Kurs | ❌ | BEU-`circuitNumber` ist 5-stellig, kein `d/d` → 0 Routen | Umlaufspalte / U-Umlaufkarte | `groupLegacyRoutes`-Erkennung erweitern **oder** Linie/Route aus Umlaufkarte (R) |
| B10 Pausen 30–120 | ⚠ | keine Pausen-30–120-Auswertung im V2-Modell; BV-Hinweis braucht `activityType` | Aktivitätslücken + `activityType` | additive Auswertung analog `longServiceParts` + Regelverdrahtung |
| Arbeitszeit | ⚠ | `activityType` unverdrahtet → Arbeitszeit überzählt Pausen | Regelpaket vorhanden | `rule-engine` im Orchestrator aufrufen |
| Unbezahlte Zeit | ⚠ | `activityType='unpaidBreak'` nicht gesetzt → 0 | Regelpaket vorhanden | dito |
| Bezahlte Zeit | ✅ (P) / ❌E | Excel: Summenzeile nicht gelesen | `service.paidTime` | `excel-canonical-adapter` (Ende/paidTime aus letzter/ Summenzeile) |
| Warnungen | ⚠ | keine Warnungen ohne laufende Regeln/Checks | `warnings` / CheckReport | Regeln+Checks im Orchestrator, Ausgabe in Block |
| Review Dashboard | ❌V | kein CheckReport dispatcht | CheckReport | Orchestrator + Event-Dispatch |
| Check Explorer | ❌V/❌R | kein CheckReport; referenzbasierte BV brauchen `LOCATION_CATALOG`, `PLAN_METADATA` | CheckReport + R | Orchestrator + `ReferenceDataContext` aufbauen |

---

## 6. Aufgabe 7 — Readiness-Matrix

| Block | Benötigte Daten | Quelle | Canonical vorhanden | Status | Aufwand |
|---|---|:--:|:--:|:--:|:--:|
| Anzahl/Plan-Typ | serviceNumber | M | ja | ⚠ Plan-Raster | S |
| Geteilte Dienste | serviceNumber | M | ja | ✅ nur Verdrahtung | S |
| Reserve | serviceNumber | M | ja | ✅ nur Verdrahtung | S |
| Dienste > 08:30 h | paidTime | M | ja (P) / lückenhaft (E) | ✅P / ⚠E | S–M |
| Anfangs-/Endorte | dep/arr Location | M | ja | ✅ nur Verdrahtung | S |
| Dienstteilstücke | Aktivitätszeiten | M | ja | ✅ nur Verdrahtung | S |
| Lenkzeit real | Lenkzeit, Haltestellenfolge | W/U | **nein** | ❌ Wagenkarten | L |
| Schichtzuweisung | begin | M | ja | ✅ nur Verdrahtung | S |
| Linie/Kurs | Linie/Kurs-Paar | E ✅ / P ❌ | teilweise | ❌ PDF | M |
| Pausen 30–120 | Aktivitätslücken (+ activityType) | M | Zeiten ja | ⚠ neue Auswertung | M |
| Arbeitszeit | activityType | Regelpaket | Rohtext ja | ⚠ Regeln verdrahten | S–M |
| Unbezahlte Zeit | activityType | Regelpaket | Rohtext ja | ⚠ Regeln verdrahten | S–M |
| **Bezahlte Zeit** | paidTime/Ende | M | ja (P) / **nein (E)** | ✅P / ❌E | M |
| Warnungen | warnings/CheckReport | abgeleitet | via Regeln/Checks | ⚠ | M |
| Review Dashboard | CheckReport | abgeleitet | via Checks | ❌ Verdrahtung | M |
| Check Explorer | CheckReport (+R) | abgeleitet | via Checks + R | ❌ Verdrahtung + R | M–L |

Aufwand: S = klein (Verdrahtung/Daten), M = mittel (Adapter/Auswertung
erweitern), L = groß (neue Quelle/Loader).

---

## 7. Aufgabe 8 — Priorisierung

### Priorität A — sofort umsetzbar (Daten in Canonical vorhanden, nur Verdrahtung)
- **A0 (Voraussetzung für alles):** Orchestrator im Live-Import — nach dem Import
  `buildCanonicalSchedule` (PDF) bzw. `adaptExcelRowsToCanonicalSchedule` (Excel)
  → `analyzeCanonicalScheduleWithMigratedLegacyChecks` → Ergebnis in die
  Blockcontainer; zusätzlich `runCheckModules` → Event `dienstplan:v2-check-report`.
- **A1:** Blöcke B2, B3, B5, B6, B8 (und B1 mit kleiner Plan-Raster-Ergänzung).
- **A2:** Aktivitätsklassifikation über `rule-engine` + vorhandenes
  `rules/{beu,jes}/v1/activities.json` einschalten → schaltet **Arbeitszeit,
  unbezahlte Zeit, B10-BV-Hinweis** und tätigkeitsbezogene BV-Checks frei
  (für PDF; getestet).
- **A3:** Review Dashboard + Check Explorer über den dispatchten CheckReport
  befüllen (ohne referenzbasierte Checks).

### Priorität B — benötigt Wagenkarten/Umlaufkarten
- **B1:** Loader Wagenkarte/Umlaufkarte (Excel `Eisenberg`, PDF `FB … Ferien`)
  → `WAGENKARTE`-`ReferenceDataSource` (JSON-Vertrag existiert). Ohne ihn keine
  reale Lenkzeit (Block B7) und keine PDF-Umlaufkarten-Übernahme.
- **B2:** Block B7 „Lenkzeit real" und Linie/Route-Anreicherung (hilft auch B9
  für BEU) aus der `WAGENKARTE`-Source speisen.

### Priorität C — benötigt Referenzdaten
- **C1:** `ReferenceDataContext` in der Live-UI aufbauen und referenzbasierte
  BV-Checks aktivieren (z. B. BV001 braucht `LOCATION_CATALOG` +
  `PLAN_METADATA.fuelingServiceIds`). Betrifft Vollständigkeit von Check
  Explorer / Review Dashboard und „Warnungen".

### Priorität D — benötigt neue Fachlogik (kleine, additive Erweiterungen bestehender Komponenten)
- **D1:** Excel-Adapter: Dienstende und bez. Zeit aus Summen-/Schlusszeile je
  Dienst übernehmen (heute nur Kopfzeile) → behebt ❌E bei „Bezahlte Zeit",
  „Dienste > 08:30 h", Dienstende.
- **D2:** B9 Linie/Kurs für PDF: Linie/Kurs aus 5-stelligem Umlaufcode ableiten
  **oder** aus Umlaufkarte (B) beziehen; `groupLegacyRoutes`-Muster erweitern.
- **D3:** Pausen-30–120-Auswertung (Block B10) im V2-Modell ergänzen
  (analog `longServiceParts`).
- **D4:** FB-Ferien-artige Umlaufkarten-PDFs: eigenes Profil/Loader als
  Referenzquelle (nicht als Dienstplan).

---

## 8. Aufgabe 9 — Verbliebene Excel-Abhängigkeiten

Die **gesamte produktive Auswertung läuft heute an CanonicalSchedule vorbei.**
Was künftig ausschließlich über CanonicalSchedule laufen sollte:

1. **`index.html` Datei-Handler** (`2919–2980`): liest `XLSX` direkt, verzweigt in
   `parseTabular`/`parseWagenkarte`, verwirft PDF. → soll pro Quelle nur noch
   CanonicalSchedule erzeugen und den gemeinsamen Analyse-/Render-Pfad speisen.
2. **`parseTabular`** (`726`) und **`parseWagenkarte`** (`2621`) samt allen
   `buildWagenkarte*`-Funktionen: erzeugen fertige Block-Strings direkt aus den
   Rohzeilen. → fachlich in `AnalysisCore` + `legacy-analysis-migrator`
   gespiegelt; die Block-Strings müssten aus dem AnalysisResult gerendert werden.
3. **`detectWorkbookFormat`** (`1505`, B1=„Dienst-Nr.:"): Excel-spezifische
   Wagenkarten-Weiche. → Wagenkarte soll als `WAGENKARTE`-Referenzquelle laufen,
   nicht als zweiter Analysepfad.
4. **KI-Block/Chat** (`buildDienstplanPrompt`, `3031`) und **Such-Block**: arbeiten
   auf den gerenderten Block-Strings. → funktionieren automatisch quellenneutral,
   sobald die Blöcke aus dem gemeinsamen AnalysisResult stammen.
5. **`SheetNames[0]`-Annahme**: Der Handler liest Blatt 0. Bei den echten
   MICROBUS-Dateien ist Blatt 0 = „Diensterklärung" (korrekt), bei anderen Exporten
   kann das abweichen → Blattwahl explizit absichern.

Hinweis: Der V2-`excel-canonical-adapter` deckt das **„Diensterklärung"-Layout**
ab (70/61 Dienste), verliert aber Ende/bez. Zeit bei Mehrzeilern (D1). Das Blatt
`DUe_MoDo` (mit Spalten **Lenk-zeit**, **Arb.-zeit**, **bez. Zeit**) wird heute gar
nicht genutzt — potenzielle Lenkzeitquelle ohne Wagenkarte, aber außerhalb dieses
Paritätsziels.

---

## 9. Gesamtfazit — was fehlt für V1

**Ein Fundament (A0) schaltet den Großteil frei:** Sobald ein Orchestrator die
vorhandene, getestete V2-Kette live aufruft und das Ergebnis in die bestehenden
Blöcke schreibt, springen B1–B3, B5, B6, B8 und (mit dem vorhandenen Regelpaket)
Arbeitszeit/unbezahlte Zeit sowie Review Dashboard/Check Explorer für PDF
geschlossen an.

**Danach bleiben gezielte, quellenspezifische Lücken:**
- PDF-Seite: Linie/Kurs (B9), reale Lenkzeit (B7 → Wagenkarte).
- Excel-Seite: Dienstende + bezahlte Zeit bei Mehrzeilern (Adapter, D1).
- Beide: Pausen-30–120-Auswertung (D3), referenzbasierte BV-Checks (C1).
- Sonderfall: die Umlaufkarten-PDF (`FB … Ferien`) ist Referenz-, kein Plan-Import.

**Kein Block ist dauerhaft „nur Excel".** Die einzige echte fachliche Grenze ist
B7 (reale Lenkzeit) — die ist wagenkartengebunden, auch im Excel-Tabellenweg
(„nicht verfügbar"), und damit kein Excel-Vorsprung, sondern eine Wagenkarten-
Abhängigkeit.

Empfohlene Reihenfolge: **A0 → A1/A2/A3 → D1 (Excel-Parität bez. Zeit) → D2/D3 →
B (Wagenkarten) → C (Referenzdaten)**.
