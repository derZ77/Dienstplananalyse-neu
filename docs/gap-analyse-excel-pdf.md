# Gap-Analyse: Excel- vs. PDF-Importpfad

Stand: 2026-07-20. Reine Analyse, kein Code, keine Refactorings, keine neue
Architektur. Ziel: eindeutig festhalten, welche bestehenden Auswertungsblöcke
noch angepasst werden müssen, damit die Anwendung unabhängig vom Importweg
(Excel / PDF / Wagenkarte) identische Ergebnisse liefert.

---

## 0. Kernbefund (Management Summary)

**Beim Import eines PDF-Dienstplans wird heute KEIN einziger bestehender
Auswertungsblock befüllt.**

Der Grund ist nicht, dass einzelne Blöcke „Excel-only" wären, sondern ein
**Wiring-Bruch**: Es existieren zwei getrennte, nicht verbundene Welten.

1. **Legacy-Welt (`index.html`)** – die produktiv genutzte App. Sie füllt die
   Blöcke 1–10 ausschließlich über die eigenen Parser `parseTabular` (Excel)
   und `parseWagenkarte` (Wagenkarte). Sie kennt weder `CanonicalSchedule`
   noch V2.
2. **V2-Welt (`js/v2/…`)** – vollständig implementiert **und durch Tests
   abgesichert**, aber **an keiner Stelle mit der Live-UI verbunden**. Die
   gesamte Kette PDF → CanonicalSchedule → AnalysisCore → CheckRunner →
   CheckReport wird nur in Tests aufgerufen.

Der PDF-Import in der Live-UI (`pdf-import-controller.js`) macht heute
ausschließlich **Profilerkennung** und schreibt den Status
*„Unterstütztes PDF erkannt … Noch keine Analyse durchgeführt."* Danach passiert
nichts mehr.

Konsequenz: Die Gap-Analyse ist zu ~85 % eine **Integrations-/Verdrahtungs-
aufgabe**, nicht eine Frage fehlender Fachdaten. Die CanonicalSchedule aus dem
PDF-Pfad liefert feldgleich dieselben Daten wie aus dem Excel-Pfad.

---

## 1. Ist-Zustand: die zwei getrennten Welten

### 1.1 Legacy-Welt (`index.html`)

| Aspekt | Fundstelle |
|---|---|
| Datei-Handler, Format-Weiche | `index.html:2919–2980` |
| **PDF wird sofort verworfen** (`return`) | `index.html:2921–2923` |
| Format-Detektor Excel vs. Wagenkarte | `index.html:1505–1516` (`detectWorkbookFormat`, prüft Zelle B1 == „Dienst-Nr.:") |
| Excel-Parser | `parseTabular` `index.html:726` |
| Wagenkarte-Parser | `parseWagenkarte` `index.html:2621` |
| Ausgabe in die Blöcke 1–10 | `index.html:2962–2976` (nur Text-/HTML-Strings) |

Beide Legacy-Parser liefern **dasselbe Ergebnis-Objekt** (identische Feldnamen:
`planTypeText, countText, sharedText, reserveText, longText, locText,
segmentText, realDrivingTimeText, shiftText/shiftHtml, routeText, pauseHtml,
planHinweis`). Die Blöcke werden als **fertig gerenderte Strings** gefüllt –
es gibt hier kein strukturiertes Datenmodell.

Wichtig: Innerhalb der Legacy-Welt sind Excel und Wagenkarte also **bereits
vereinheitlicht** – sie speisen dieselben DOM-Container.

### 1.2 V2-Welt (`js/v2/…`) – vorhanden, aber nicht verdrahtet

Vollständige, getestete Kette (jeder Pfeil = eigene Funktion + Integrationstest):

```
PDF-Bytes
  → extractPdfLayoutDocument()      pdf/pdf-core.js
  → normalizePdfLayoutDocument()    pdf/document-normalizer.js
  → mapPdfDocumentToSchedule()      pdf/schedule-mapper.js        (ScheduleDocument)
  → buildCanonicalSchedule()        pdf/canonical-schedule-builder.js (CanonicalSchedule)
  → analyzeCanonicalSchedule[WithMigratedLegacyChecks]()  analysis/analysis-core.js (AnalysisResult)
  → runCheckModules(analysis, [bv…])  checks/check-runner.js       (CheckReport)
  → CustomEvent 'dienstplan:v2-check-report'  →  Review Dashboard + Check Explorer
```

Excel hat den symmetrischen Einstieg
`adaptExcelRowsToCanonicalSchedule()` (`excel/excel-canonical-adapter.js`) →
**ab hier identischer Pfad**.

**Belege für den Wiring-Bruch:**

- `dienstplan:v2-check-report` wird **nirgends** dispatcht – nur der Listener
  existiert (`check-explorer-bootstrap.js:19`). Review Dashboard und Check
  Explorer sind im DOM gemountet, bekommen aber **nie** Daten.
- `buildCanonicalSchedule`, `analyzeCanonicalSchedule`, `runCheckModules`,
  `adaptExcelRowsToCanonicalSchedule` werden außerhalb von `tests/`
  **nirgends aufgerufen** (nur exportiert).
- `index.html` enthält **null** Referenzen auf `CanonicalSchedule`, `v2`,
  `analyzeCanonical`, `CheckRunner` (per grep verifiziert).
- Der Live-PDF-Handler `pdf-import-controller.js` ruft nur
  `detectPdfDocumentProfile` und setzt einen Statustext.

---

## 2. Wie wird jeder Block HEUTE befüllt?

Legende: ✅ befüllt · ⚠️ befüllt, aber inhaltlich eingeschränkt · ❌ leer / „Warte…".

| # | Block (UI) | Excel-tabellarisch | Wagenkarte | **PDF (heute)** |
|---|---|:--:|:--:|:--:|
| 1 | Anzahl eindeutige Dienste + Plan-Typ | ✅ | ✅ | ❌ |
| 2 | Anzahl geteilte Dienste | ✅ | ✅ | ❌ |
| 3 | Reserve-Dienste | ✅ | ✅ | ❌ |
| 4 | Dienste > 08:30 h | ✅ | ✅ | ❌ |
| 5 | Unterschiedliche Anfangs-/Endorte | ✅ | ✅ | ❌ |
| 6 | Dienstteilstück > 04:30 h + Linie/Kurs | ✅ | ✅ | ❌ |
| 7 | **Lenkzeit real vor/nach Pause** | ⚠️ *„für tabellarische Pläne nicht verfügbar"* (`index.html:1495`) | ✅ (`buildWagenkarteRealDrivingTimeText`) | ❌ |
| 8 | Schichtzuweisung (Dienstbeginn) | ✅ | ✅ | ❌ |
| 9 | Dienste nach Linie/Kurs | ✅ | ✅ | ❌ |
| 10 | Pausen 30–120 min | ✅ | ✅ | ❌ |
| — | **Review Dashboard / Dienstübersicht** (V2) | ❌* | ❌* | ❌ |
| — | **Check Explorer** (V2) | ❌* | ❌* | ❌ |

\* Auch im Excel-/Wagenkarte-Betrieb bleiben Review Dashboard und Check Explorer
leer, weil niemand einen `CheckReport` dispatcht. Sie sind **nicht** Excel-only –
sie sind aktuell **in jedem Importweg tot**.

**Zentrale Klarstellung zu Block 7:** „Lenkzeit real" ist **nicht** Excel-only,
sondern **Wagenkarte-only**. Der Excel-Tabellenpfad liefert hier ausdrücklich
*„nicht verfügbar"*. Der PDF-Pfad kann diese Größe – wie vom Projektstand
festgelegt – **nur** über angehängte Wagenkarten-Referenzdaten liefern (es gibt
bewusst keine Lenkzeitberechnung).

---

## 3. Datengleichheit auf CanonicalSchedule-Ebene

Excel-Adapter und PDF-Builder erzeugen **feldgleiche** CanonicalSchedules:

**Service:** `id, serviceNumber, begin{value, minutesSinceStartOfDay},
end{…}, paidTime{value, minutes}, activities[], interruptions[], source`
(Excel setzt zusätzlich `drivingTimeSource:'UNKNOWN'`; der PDF-Builder lässt es
weg – wird vom `analysis-adapter` ohnehin auf `UNKNOWN` normalisiert).

**Activity:** `id, serviceId, serviceNumber, circuitNumber, rawActivity,
departureTime{minutesSinceStartOfDay}, arrivalTime{…}, departureLocation,
arrivalLocation, source`.

### 3.1 Gemeinsame Lücke beider Pfade: `activityType` fehlt

**Weder** der Excel-Adapter **noch** der PDF-Builder setzt `activity.activityType`
oder `activity.interruptionKind`. Der `AnalysisCore` gruppiert aber genau darüber
(`workingTime`, `unpaidTime`, `trips`, `pauseCount`, Aktivitätsklassen). Ohne
Klassifikation landet alles in `activityType='unclassified'`.

Die Klassifikation ist als generische, datengetriebene `rule-engine.js`
(`applyRuleGroups`, Aktionen `set`/`annotate`/`warning`) vorhanden – aber **ohne
konkrete Regelgruppen** und **nicht verdrahtet**. Genau hierüber laufen auch die
Integrationstests `jes-rule-package` / `beu-rule-package`.

**Folge:** Alle Blöcke, die auf *klassifizierte* Zeiten angewiesen sind
(Arbeitszeit, unbezahlte Zeit, Pausen, Vor-/Nachbereitung, mehrere BV-Checks),
brauchen zusätzlich eine **aktive Regelgruppe**. Diese Lücke ist quellen-
**unabhängig** und betrifft Excel-V2 genauso wie PDF-V2.

---

## 4. Block-für-Block-Gap-Analyse

Für jeden Block: aktueller Datenlieferant · benötigte CanonicalSchedule-Daten ·
fehlende Daten · Wagenkarten erforderlich · Referenzdaten erforderlich ·
notwendige Implementierung. „Verdrahtung" = Orchestrator ruft die vorhandene
V2-Kette auf und schreibt das Ergebnis in den bestehenden Block.

---

### Block „Dienstübersicht / Review Dashboard" (V2)
- **Aktueller Datenlieferant:** keiner live. Modell: `createReviewDashboardModel(checkReport)` aus `checkReport.results`, gruppiert je `affectedServices` → Dienstnummer.
- **Benötigte CanonicalSchedule-Daten:** `services[].serviceNumber`; darauf aufbauend ein `CheckReport` (aus AnalysisResult + Checks).
- **Fehlende Daten:** keine Rohdaten fehlen – es fehlt der **erzeugte und dispatchte CheckReport**.
- **Wagenkarten erforderlich:** nein.
- **Referenzdaten erforderlich:** nur mittelbar (nur soweit die enthaltenen Checks Referenzdaten brauchen).
- **Notwendige Implementierung:** Orchestrator, der nach dem Import `runCheckModules` ausführt und `dienstplan:v2-check-report` dispatcht.

### Block „Statistik" (Blöcke 1, 2, 4 + `AnalysisCore.statistics`)
- **Aktueller Datenlieferant:** Legacy `parseTabular`/`parseWagenkarte` (`countText`, `sharedText`, `longText`). V2 `analyzeCanonicalSchedule().statistics` (nicht gerendert).
- **Benötigte CanonicalSchedule-Daten:** `services[]` (Anzahl), `serviceNumber`, `begin`, `paidTime.minutes`; für Aktivitätsstatistik `activities[]`.
- **Fehlende Daten:** Für reine Zähl-/`paidTime`-Statistik **nichts** – nur Verdrahtung. Für die Aktivitäts-Aufschlüsselung (Fahrten, Pausenzahl) fehlt `activityType` (→ Regelgruppe).
- **Wagenkarten erforderlich:** nein.
- **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** Verdrahtung; für die Aktivitätsanteile zusätzlich Regelgruppe.

### Block „Reserve" (Block 3)
- **Aktueller Datenlieferant:** Legacy `reserveText`. V2 `legacy-analysis-migrator.reserveServices` (Liste `RESERVE_SERVICE_NUMBERS`).
- **Benötigte CanonicalSchedule-Daten:** `services[].serviceNumber`.
- **Fehlende Daten:** keine – nur Verdrahtung.
- **Wagenkarten erforderlich:** nein. **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** Verdrahtung (`analyzeCanonicalScheduleWithMigratedLegacyChecks` → Block-Renderer).

### Blöcke „Linien" und „Kurse" (Block 9)
- **Aktueller Datenlieferant:** Legacy `routeText`. V2 `migrator.routes` (gruppiert `circuitNumber` im Muster `d/d` = Linie/Kurs).
- **Benötigte CanonicalSchedule-Daten:** `activities[].circuitNumber, departureTime, arrivalTime, departureLocation, arrivalLocation, serviceNumber`.
- **Fehlende Daten:** keine im Modell. **Datenqualitäts-Risiko:** Ob `circuitNumber` (PDF-Spalte 2) im PDF-Layout zuverlässig extrahiert wird, ist zu verifizieren (Layout-Rekonstruktion).
- **Wagenkarten erforderlich:** nein (Wagenkarte kann Linie/Kurs zusätzlich absichern). **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** Verdrahtung + Stichprobenvergleich PDF-`circuitNumber` gegen JES-Referenz.

### Block „Dienstteile" (Block 6)
- **Aktueller Datenlieferant:** Legacy `segmentText`. V2 `migrator.longServiceParts` (Segmente > 270 min, Kombis mit Lücke < 30 min).
- **Benötigte CanonicalSchedule-Daten:** `activities[].departureTime, arrivalTime, circuitNumber`.
- **Fehlende Daten:** keine im Modell (nutzt reine Zeiten, **kein** `activityType`). Nur Verdrahtung.
- **Wagenkarten erforderlich:** nein. **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** Verdrahtung.

### Block „Anfangs-/Endorte" (Block 5)
- **Aktueller Datenlieferant:** Legacy `locText`. V2 `migrator.differentLocationServices` (Abfahrtsort der ersten, Ankunftsort der letzten Aktivität; `EQUIVALENT_LOCATIONS` = BBU/BUP/BBN/NSL).
- **Benötigte CanonicalSchedule-Daten:** `activities[].departureLocation, arrivalLocation`.
- **Fehlende Daten:** keine im Modell. **Datenqualitäts-Risiko:** verlässliche Extraktion der Orte aus PDF-Spalten 5/7 verifizieren.
- **Wagenkarten erforderlich:** nein (Wagenkarte kann Orte präzisieren). **Referenzdaten erforderlich:** nein (Ortsäquivalenz ist als Konstante hinterlegt; erst BV-Ortslogik bräuchte `LOCATION_CATALOG`).
- **Notwendige Implementierung:** Verdrahtung + Stichprobenvergleich der Orte.

### Block „Arbeitszeit"
- **Aktueller Datenlieferant:** Legacy: reich im Wagenkarte-Pfad (`buildWagenkarteDienstteilAnalyse` u. a.), im Tabellenpfad nur indirekt (z. B. Pausen-BV-Hinweis, Spalte O). V2 `AnalysisCore`: `workingTime` = Summe aller Aktivitätsdauern außer `unpaidBreak`.
- **Benötigte CanonicalSchedule-Daten:** `activities[].departureTime, arrivalTime` **plus** `activityType` (zur Trennung bezahlter/unbezahlter Anteile).
- **Fehlende Daten:** **`activityType`-Klassifikation** (Regelgruppe). Ohne sie fällt „Arbeitszeit" mit „Bruttospanne" zusammen.
- **Wagenkarten erforderlich:** nein für die grobe Arbeitszeit; für belastbare Fahrt-/Pausenblöcke liefert die Wagenkarte höhere Genauigkeit.
- **Referenzdaten erforderlich:** nein (die Pausen-/Tätigkeitsregeln sind Regelgruppen, keine externen Stammdaten).
- **Notwendige Implementierung:** Regelgruppe (Klassifikation) + Verdrahtung + Renderer.

### Block „Bezahlte Zeit"
- **Aktueller Datenlieferant:** Legacy: Spalte „Bez. Zeit". V2: `service.paidTime.minutes` **direkt** in der CanonicalSchedule (PDF-Spalte 10 / Excel-Spalte).
- **Benötigte CanonicalSchedule-Daten:** `services[].paidTime`.
- **Fehlende Daten:** **keine** – Wert liegt im PDF-Canonical direkt vor. Nur Verdrahtung. (Bester „Quick Win".)
- **Wagenkarten erforderlich:** nein. **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** Verdrahtung.

### Block „Unbezahlte Zeit"
- **Aktueller Datenlieferant:** V2 `AnalysisCore`: `unpaidTime` = Summe der `unpaidBreak`-Dauern.
- **Benötigte CanonicalSchedule-Daten:** `activities[]` mit Zeiten **plus** `activityType='unpaidBreak'`.
- **Fehlende Daten:** **`activityType`-Klassifikation** (Regelgruppe). Ohne sie ist die unbezahlte Zeit immer 0.
- **Wagenkarten erforderlich:** nein. **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** Regelgruppe + Verdrahtung + Renderer.

### Block „Schichtzuweisung" (Block 8)
- **Aktueller Datenlieferant:** Legacy `shiftText/shiftHtml`. V2 `migrator.shifts` (Zeitfenster F1/F2/…/N je `begin.minutesSinceStartOfDay`, Wochenend-Varianten).
- **Benötigte CanonicalSchedule-Daten:** `services[].begin.minutesSinceStartOfDay`, `serviceNumber`; Plan-Zeitraum (aus `migrator.plan`).
- **Fehlende Daten:** keine – nur Verdrahtung.
- **Wagenkarten erforderlich:** nein. **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** Verdrahtung.

### Block „Pausen 30–120 min" (Block 10)
- **Aktueller Datenlieferant:** Legacy (`pauseHtml` aus `parseTabular` bzw. `buildWagenkartePauseHtml`). **Nicht** im `legacy-analysis-migrator` enthalten.
- **Benötigte CanonicalSchedule-Daten:** aufeinanderfolgende `activities[].arrivalTime → departureTime` (Lückenberechnung) je Dienst.
- **Fehlende Daten:** Lücke im V2-Modell – es gibt **keine** Pausen-30–120-Auswertung. Rohdaten (Zeiten) sind vorhanden; die Auswertung fehlt. Für den BV-Hinweis „Arbeitszeit vor Pause" zusätzlich `activityType`.
- **Wagenkarten erforderlich:** nein (Wagenkarte liefert genauere Pausenkontexte). **Referenzdaten erforderlich:** nein.
- **Notwendige Implementierung:** kleine, additive Auswertungsfunktion auf Basis der Aktivitätslücken (analog zur bestehenden `longServiceParts`-Logik) + Verdrahtung.

### Block „Warnungen"
- **Aktueller Datenlieferant:** Legacy: Inline-BV-Hinweise als Strings in den Blocktexten (z. B. Pausen-BV-Konformität, `index.html:1466–1480`). V2: `canonicalSchedule.warnings` (aus Buildern **leer**), Warnungen der `rule-engine` (Aktion `warning`), sowie Check-Ergebnisse mit Severity `WARNING`/`ERROR`/`VIOLATION`.
- **Benötigte CanonicalSchedule-Daten:** `warnings[]`; mittelbar die Felder der jeweils prüfenden Regeln/Checks.
- **Fehlende Daten:** Es werden aktuell keine Warnungen erzeugt, weil weder Regelgruppen noch Checks live laufen.
- **Wagenkarten erforderlich:** nein. **Referenzdaten erforderlich:** teils (referenzbasierte BV-Checks, s. u.).
- **Notwendige Implementierung:** Regelgruppen/Checks aktiv schalten + Warnungen in den Block überführen.

### Blöcke „Check Explorer" & „Review Dashboard" (BV-Checks)
- **Aktueller Datenlieferant:** `CheckReport` aus `runCheckModules(analysisResult, [bv001…bv014])`.
- **Benötigte CanonicalSchedule-Daten:** je Check unterschiedlich; Basis sind `services[]`/`activities[]` mit Zeiten. **Mehrere BV-Checks setzen `activityType` voraus** (z. B. BV001 nutzt `preparation`/`postprocessing`, `bv001.js:60–63`).
- **Fehlende Daten:**
  1. **Kein dispatchter CheckReport** (Orchestrator + Event).
  2. **`activityType`-Klassifikation** für die tätigkeitsbezogenen Checks.
  3. **`ReferenceDataContext`** für referenzbasierte Checks: BV001 verlangt `LOCATION_CATALOG` (Ortsstamm) **und** `PLAN_METADATA.fuelingServiceIds`; ohne diese liefert der Check sauber `NOT_APPLICABLE`, aber eben kein Ergebnis.
- **Wagenkarten erforderlich:** nur für wagenkartenbezogene Prüfungen (Kategorie `WAGENKARTE`, Lenkzeit/Haltestellenfolge). Für BV001–BV014 nicht.
- **Referenzdaten erforderlich:** **ja**, für die referenzbasierten BV-Checks (Bereiche u. a. `LOCATION_CATALOG`, `PLAN_METADATA`; weitere Bereiche verfügbar: `TRAVEL_TIMES, EXCEPTION_APPROVALS, ROTATION_DATA, PERSONNEL_DATA, BV_APPENDICES, WAGENKARTE`).
- **Notwendige Implementierung:** Orchestrator (Checks ausführen, Event dispatchen) + Klassifikations-Regelgruppe + Aufbau eines `ReferenceDataContext` aus geladenen Quellen.

---

## 5. Übergreifende Lücken (die eigentliche Ursache)

Nicht die einzelnen Blöcke sind das Problem, sondern sechs strukturelle Lücken.
Werden sie geschlossen, füllen sich fast alle Blöcke quellenunabhängig.

| # | Lücke | Betrifft | Charakter |
|---|---|---|---|
| L1 | **Kein Live-Orchestrator** PDF→Canonical→Analysis→Checks | alle Blöcke, PDF | Verdrahtung |
| L2 | **Kein Dispatch** von `dienstplan:v2-check-report` | Check Explorer, Review Dashboard (alle Wege) | Verdrahtung |
| L3 | **Keine Brücke** V2-Ergebnis → Legacy-Blöcke 1–10 | Blöcke 1–10, PDF | Verdrahtung/Adapter |
| L4 | **`activityType`-Klassifikation nicht aktiv** (Regelgruppe fehlt) | Arbeitszeit, unbezahlte Zeit, Pausen-BV, mehrere BV-Checks | quellenunabhängig |
| L5 | **Kein `ReferenceDataContext` in der Live-UI** | referenzbasierte BV-Checks | Verdrahtung + Datenpflege |
| L6 | **Keine Pausen-30–120-Auswertung im V2-Modell** | Block 10 | kleine additive Funktion |
| L7 | **Block 7 (Lenkzeit) ohne Wagenkarte generell nicht möglich** | Block 7 | fachlich gewollt |

Datenqualitäts-Verifikation (kein Code, aber vor der Umsetzung zu prüfen):
zuverlässige PDF-Extraktion von **`circuitNumber` (Linie/Kurs)** und
**Abfahrts-/Ankunftsort** – davon hängen die Blöcke 5, 6 und 9 ab. Die
Integrationstests (`jes-rule-package`, `schedule-mapper.integration`) und der
Debug-Vergleich `compareCanonicalSchedules` (Dienst 751) sind die
vorhandenen Werkzeuge dafür.

---

## 6. Ergebnis: Welche Blöcke müssen angepasst werden?

**Alle** – aber differenziert nach Aufwandstyp:

**A. Reine Verdrahtung (Daten vollständig vorhanden, feldgleich zu Excel):**
Reserve (3), Dienste > 08:30 h (4), Anfangs-/Endorte (5), Dienstteile (6),
Schichtzuweisung (8), Linien/Kurse (9), Anzahl-/Plan-Statistik (1, 2),
**Bezahlte Zeit**. → sobald der Orchestrator (L1–L3) steht, sofort befüllt.

**B. Verdrahtung + `activityType`-Regelgruppe (L4):**
Arbeitszeit, Unbezahlte Zeit, Pausen-BV-Hinweis, sowie die tätigkeitsbezogenen
BV-Checks.

**C. Verdrahtung + Referenzdaten (L5):**
referenzbasierte BV-Checks in Check Explorer / Review Dashboard
(z. B. BV001: `LOCATION_CATALOG` + `PLAN_METADATA`).

**D. Kleine additive Auswertung (L6):**
Pausen 30–120 min (10).

**E. Nur mit Wagenkarte möglich (L7, fachlich so gewollt):**
Lenkzeit real vor/nach Pause (7).

**Kein Block ist tatsächlich „für immer Excel-only".** Was heute wie Excel-only
aussieht, ist Folge des fehlenden PDF-Orchestrators. Der einzige Block, der ohne
Zusatzquelle nicht aus dem PDF darstellbar ist, ist Block 7 – und der ist auch
im Excel-Tabellenpfad „nicht verfügbar", also **Wagenkarte-only**, nicht
Excel-only.

---

## 7. Nächster Schritt

Vorschlag für die Umsetzungsreihenfolge (bewusst noch kein Code): zuerst L1–L3
(ein Orchestrator, ein Block-Adapter, ein Event-Dispatch) – damit springt
Gruppe A geschlossen an und PDF liefert dieselben Blöcke wie Excel. Danach L4
(eine Klassifikations-Regelgruppe) für Gruppe B, anschließend L5/L6, zuletzt die
Wagenkarten-Anreicherung (L7) als reine Referenz-Ergänzung ohne eigene
Oberfläche.
