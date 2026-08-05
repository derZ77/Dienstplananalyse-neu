# Phase 3I.1 – JNV-1/6-Fachregelvertrag und Datenreife-Audit (Abschluss)

**Stand:** 2026-08-01 · **Nur Fachregelvertrag (Parameter + Freigabestatus) und Datenreifeprüfung.
KEIN 1/6-Algorithmus, keine CheckModule-Registrierung, keine UI-Anbindung, kein Commit.**
Branch `master`, HEAD `34edffbf`.

## 1. Ausgangslage
Produktiv vorhanden: JNV-Dokumentverbund, exact strukturelles Matching, Joint Timeline, Driving
Projection, BV008-Fachregel inkl. CheckModule/CheckRunner/CheckReport und CheckExplorer-Anbindung.
Für 1/6 existierten bislang nur Parameter im **bestehenden** `jnv.v1.json` (Status `draft`) sowie
Katalogeinträge BV015–BV018 — kein eigener, vollständiger Fachregelvertrag und keine Datenreifeprüfung.

## 2. Scope und Nicht-Ziele
Additiv: eine fokussierte 1/6-Regelkonfiguration + Vertrags-/Datenreifetests + dieses Audit.
**Nicht** umgesetzt: `one-sixth-rule.js`, 1/6-Algorithmus, CheckModule, Runner-Registrierung,
PASS/FAIL, Verstoßstruktur, UI-Status, Explorer-Zeile, Commit.

## 3. Bestätigte Fachregeln (Nutzerangaben, verbindlich)
1. 1/6 gilt **nur** für JNV (nicht JES). 2. Bus **und** Straßenbahn, für **Kombifahrer**.
3. Alternative im Linienverkehr mit durchschnittlichem Haltestellenabstand **< 3 km**.
4. Anrechenbare Wendezeit: **≥ 10 Minuten + 1 technische Minute** → technisch **≥ 11 Minuten**
   beobachtete Zeitspanne. 5. Die technische Minute ist **keine** Erholungszeit.
6. Eine tarifliche Absenkung auf **8 Minuten darf nicht automatisch** angenommen werden.
7. Dienste grundsätzlich **nur am Wochenende** in 1/6. 8. Ausnahmen: **Nachtschichten** und
**Linie 18**. 9. Nachtschicht **vorläufig** ab Dienstbeginn **19:20**. 10. Nicht für JES.
11. Bloße rechnerische Lücken sind **keine** anrechenbaren Wendezeiten. 12. Die 4:30-Prüfung
(BV008) bleibt eine **eigenständige** Regel.

## 4. Inventurergebnis
1. **Bereits vorhanden:** Organisation/Profil, Modus (Umlauftafel `mode`), Linienzuordnung
   (Dienstplan `routeIdentity.line`, Umlauftafel `segment.line`), Haltestellen**folge** mit Namen,
   Dienst-/Fahrtzeiten, Fahrsegmente/Fahrblöcke (Driving Projection), Umlaufcodes.
2. **Nur indirekt:** Tagesart (aus Titel/Validity, real teils `unknown`), Dienstbeginn (frühester
   Aktivitätsbeginn — Definition offen), „reine Lenkzeit" (Projektion umfasst `service`+`deadhead`).
3. **Fehlt vollständig:** Haltestellen**abstände**/Entfernungen, Kombifahrer-Merkmal,
   Feiertagskalender, Wendezeit-Entität, Tarifabsenkungs-Nachweis.
4. **Darf nicht geschätzt werden:** Entfernungen aus Fahrzeit/Namen, Kombifahrer aus Organisation,
   Wochenende aus Dateiname, Wendezeit aus beliebiger Lücke, Erholungsqualität aus Dauer, Feiertag
   aus Datum, Tarifabsenkung, technische Minute als Erholung.
5. **Quellen:** Dienstplan-PDF (Dienste, Aktivitäten, Linien, Zeiten, Orte), Umlauftafel-XLSX
   (Modus, Umläufe, Segmente, Linien, Haltestellenfolge, Validity), Konfiguration (Grenzwerte).
6. **Ebenen:** Dienst (Service), Umlauf (Circulation), Fahrt (Segment/Aktivität), Haltestelle
   (StopEvent). Distanz wäre Haltestellen-Paar-Ebene — nicht vorhanden.
7. **Rechtlich unzureichend qualifiziert:** `driverChange`/`vehicleChange` (Vertragsflags, real
   nirgends gesetzt), `stopEvent.name` (kein Entfernungsbezug), Lücken der Projektion (keine
   Wendezeit), `dayType` (real `unknown`), Nachtschichtgrenze 19:20 (`provisional`).

## 5. Datenquellen (empirisch geprüft, read-only)
Reale Umlauftafel (Bus, „Ferien"): `mode:"bus"`, 34 Umläufe, 1042 Segmente (875 mit Linie,
Linien u. a. 10–18, 43, 47, 48), **3980 StopEvents – alle mit Namen**, **kein einziges
Distanzfeld**, `driverChange`/`vehicleChange` **0×** gesetzt, `vehicle` 0×, `validity.dayType`
**`unknown`** (nur `serviceRegime:"holidays"` aus dem Label).
Realer JNV-Dienstplan („Montag bis Freitag (Schule)"): 62 Dienste, 629 Aktivitäten, Hardening
angewandt, `dutyKind` ∈ {serviceDrive, depotDuty, genericDuty}, 16 Linien **inkl. Linie 18**,
Startzeiten 00:01–23:49, 629 Aktivitäten mit Orten, `dayQualifiers` **leer**, Unterbrechungen 0,
**kein** Kombifahrer-Feld, **kein** Distanzfeld.

## 6. Datenreife-Matrix

| Fachfeld | Quelle | Status | Qualität | Für definitive Prüfung ausreichend? | Offene Arbeit |
|---|---|---|---|---|---|
| Organisation JNV | Profil/Dokumenttyp | AVAILABLE_EXACT | hoch | ja | – |
| Modus Bus/Tram | Umlauftafel `mode` | AVAILABLE_EXACT | hoch | ja (Begleitdokument nötig) | Tram-Referenz fehlt noch |
| Kombifahrer-Status | – | **MISSING** | – | **nein** | Merkmal + Nachweisquelle definieren |
| Tagesart Mo–Fr | Titel/Validity | AVAILABLE_PARTIAL | mittel | nein | verbindliche Tagesart-Quelle |
| Tagesart Samstag | Validity-Vokabular | AVAILABLE_PARTIAL | mittel | nein | reale Sa-Referenz fehlt |
| Tagesart Sonntag | Validity-Vokabular | AVAILABLE_PARTIAL | mittel | nein | reale So-Referenz fehlt |
| Feiertag | – | **MISSING** | – | **nein** | Kalendervertrag |
| Dienstbeginn | Aktivitätszeiten | DERIVABLE_WITH_APPROVED_RULE | hoch | nein | Definition (erste Aktivität? inkl. Depot?) |
| Nachtschicht ab 19:20 | Dienstbeginn + Config | DERIVABLE_WITH_APPROVED_RULE | mittel | nein | 19:20 ist `provisional` |
| Linienzuordnung | `routeIdentity.line` / `segment.line` | AVAILABLE_EXACT | hoch | ja | – |
| Linie 18 | beide Quellen (real vorhanden) | AVAILABLE_EXACT | hoch | teilweise | Geltungsbereich der Ausnahme offen |
| reine Lenkzeit | Driving Projection | AVAILABLE_PARTIAL | hoch | nein | Basis (Leerfahrten?) offen |
| Wendezeitbeginn/-ende | – | **NOT_RELIABLY_DERIVABLE** | – | **nein** | Wendezeit-Entität + Nachweis |
| Wendezeitdauer | – | **NOT_RELIABLY_DERIVABLE** | – | **nein** | s. o. |
| technische Zusatzminute | Konfiguration | AVAILABLE_EXACT | hoch | ja (als Parameter) | – |
| Haltestellenfolge | StopEvents (3980) | AVAILABLE_EXACT | hoch | ja | – |
| Haltestellenabstände | – | **MISSING** | – | **nein** | Entfernungsquelle |
| durchschn. Haltestellenabstand | – | **NOT_RELIABLY_DERIVABLE** | – | **nein** | Quelle + Bezugsebene |
| explizite Pausen | Projektion (break/layover) | AVAILABLE_PARTIAL | niedrig | nein | produktiv nicht erzeugt (3H.2-Grenze) |
| Dienstunterbrechungen | Hardening `interruptions` | AVAILABLE_PARTIAL | mittel | nein | real 0; Qualifikation offen |
| Umlaufwechsel | `circuitNumber` / Circulations | AVAILABLE_EXACT | hoch | ja (strukturell) | fachliche Bedeutung offen |
| Fahrerwechsel | `segment.driverChange` | **NOT_RELIABLY_DERIVABLE** | niedrig | **nein** | real nie gesetzt |
| Fahrzeugwechsel | `segment.vehicleChange` | **NOT_RELIABLY_DERIVABLE** | niedrig | **nein** | real nie gesetzt |

**Gesamtstatus: NOT_READY.**
Begründung: die drei tragenden Säulen der Regel — **Haltestellenabstand** (Zulässigkeit),
**Wendezeit** (Anrechnung) und **Kombifahrer** (persönlicher Geltungsbereich) — sind nicht
belastbar verfügbar; zusätzlich ist die Berechnungsformel offen.

## 7. eligibility
Zulässig nur bei: JNV, Modus Bus/Tram, Kombifahrer, Linienverkehr mit durchschnittlichem
Haltestellenabstand < 3000 m, Tagesart Samstag/Sonntag — **Ausnahmen** Nachtschicht (ab 19:20,
vorläufig) und Linie 18. Offen: Tagesart-Nachweis, Feiertagsbehandlung, Nachtschicht-Basis,
Geltungsbereich der Linien-Ausnahme, gemischte Linien.

## 8. Wendezeitvertrag
Anrechenbar ab **10 Minuten**; zuzüglich **1 technischer Minute** ergibt sich eine beobachtete
Mindestspanne von **11 Minuten** (`10 + 1 = 11`, im Test geprüft). Eine bloße rechnerische Lücke
ist **nie** eine Wendezeit (`plainGapCountsAsTurnaround: false`). Offen: Nachweisquelle einer
Wendezeit, Behandlung mehrerer Wendezeiten, Verhältnis zu expliziten Blockpausen.

## 9. Technische Minute
`technicalMinutes = 1`, `technicalMinutesCountAsRecovery = false` — die technische Minute zählt
zur Zeitspanne, **nicht** zur Erholung. Eine tarifliche Absenkung auf 8 Minuten ist **nicht**
gesetzt (`tariffReductionMinutes: null`, Status `open`) und wird **nie** automatisch aktiviert
(`tariffReductionAutoActivate: false`).

> **Befund zum bestehenden `jnv.v1.json`:** dort steht `turnaround.tariffReducedMinutes = 8` mit
> Status `confirmed` (bei `tariffReducedAutoActivate: false`). Das widerspricht der verbindlichen
> Nutzerangabe „darf nicht automatisch angenommen werden" zumindest in der Statusbewertung. Die
> Datei liegt **außerhalb des zulässigen Scopes dieser Phase** und wurde **nicht** geändert; der
> neue Vertrag setzt den Wert bewusst auf `open`. **Klärung/Angleichung ist eine offene Aufgabe.**

## 10. Haltestellenabstand
Die Haltestellen**folge** ist vollständig verfügbar (real 3980 benannte StopEvents), es existiert
aber **kein einziges Entfernungsfeld** im gesamten System — weder in StopEvent noch Segment noch
CanonicalSchedule. Der Grenzwert 3000 m ist konfiguriert, **die Messgröße ist es nicht**. Ableitung
aus Fahrzeit oder Haltestellennamen ist ausdrücklich unzulässig. Offen: Entfernungsquelle und
Bezugsebene (Linie / Fahrt / Umlauf / Dienst).

## 11. Wochenendregel
`allowedDayTypes = [SATURDAY, SUNDAY]` (confirmed). Die reale Umlauftafel liefert jedoch
`dayType: "unknown"`, die realen `dayQualifiers` des Dienstplans sind leer — die Tagesart ist damit
heute **nicht** verbindlich belegbar. Ableitung allein aus dem Dateinamen ist unzulässig.

## 12. Nachtschicht
`nightShiftStart = "19:20"` mit Status **`provisional`** (nicht confirmed), `nightShiftIsException
= true`. Der Dienstbeginn ist aus Aktivitätszeiten ableitbar (real 00:01–23:49), seine **Definition**
(erste Aktivität, mit/ohne Depotdienst) ist jedoch offen (`nightShiftStartBasis: open`).

## 13. Linie 18
Linie 18 ist in beiden realen Quellen vorhanden und über die bestehenden Identity-/Segmentfelder
eindeutig adressierbar (`exceptionLines: ["18"]`, confirmed). **Offen** bleibt der Geltungsbereich
(`exceptionLineScope`): alle Dienste mit Linie 18, einzelne Umläufe oder einzelne Fahrten — sowie
das Verhalten bei gemischten Linien (`mixedLineHandling`).

## 14. Kombifahrer
Es existiert **kein** Kombifahrer-Merkmal — weder im Dienstplan noch in der Umlauftafel noch im
CanonicalSchedule (empirisch geprüft). `requiresCombinedDriver = true` (confirmed) beschreibt die
Anforderung, `combinedDriverEvidence` bleibt `open`. Eine Ableitung allein aus „Organisation = JNV"
ist ausdrücklich unzulässig.

## 15. Offene Berechnungsformel
`requiredRatioNumerator/Denominator = 1/6` (confirmed). **Offen** und damit blockierend:
`formula`, `drivingTimeBasis`, `deadheadTreatment` (Leerfahrten), `aggregationScope` (Dienst /
Umlauf / Fahrt), `referencePeriod`, `roundingRule`, `mixedModeHandling` (Bus/Tram im selben
Kombidienst). Es wurden **keine** Defaultwerte erfunden.

## 16. Verhältnis zur BV008-Prüfung
`independentOfContinuousDrivingRule = true`: die 4:30-/270-Minuten-Prüfung (BV008,
`shared-driving-time-limit-v1`) bleibt eine **eigenständige** Regel. 1/6 ändert weder deren
Parameter noch deren Ergebnis; beide werden später als getrennte CheckResults im selben
CheckReport erscheinen.

## 17. Config-Entwurf
`js/v2/rules/config/organizations/jnv-one-sixth.v1.json` — an die **bestehende**
Regelkonfigurationsarchitektur angepasst: Standard-Envelope (`schemaVersion`, `ruleSetId`,
`organization`, `profileIds`, `status`, `validFrom`, `sourceReferences`, `approvedBy`,
`parameters`) und ausschließlich `{value, status, unit|format}`-Parameterblätter in den Gruppen
`activation`, `scope`, `eligibility`, `turnaround`, `calculation`, `relations` sowie einer
dokumentierenden `openParameters`-Liste. Die in der Aufgabe vorgeschlagene Flachstruktur
(`scope`/`eligibility`/… auf Top-Level) wurde bewusst **in `parameters` eingebettet**, damit der
bestehende `validateRuleConfig` und das dokumentarische JSON-Schema unverändert greifen. Keine
ausführbare Logik (Guard `EXECUTABLE_CODE_FORBIDDEN` + eigener Test).

## 18. Freigabegate
`status: "draft"`, `activation.enabled: false`, `approvedBy: null`. **19 Pflichtparameter sind
`open`.** Der bestehende Validator erzwingt das Gate: eine Umstellung auf `approved` scheitert mit
`APPROVED_WITH_OPEN_PARAMETERS` (im Test belegt). Eine Freigabe ist erst zulässig bei: allen
Pflichtparametern gesetzt, dokumentierter Quelle, dokumentiertem Freigeber, Referenztests,
keinen offenen Parametern und ausreichender Datenreife.

## 19. Tests (33 neu)
`tests/phase3i1-one-sixth-contract.test.js` (20): Validierung gegen den bestehenden Validator,
draft/disabled, BV015–BV018, JNV-only + JES ausgeschlossen, Bus+Tram, Kombifahrer erforderlich,
< 3000 m, Wochenend-Tagesarten, Feiertag offen, Nachtschicht 19:20 `provisional`, Linie 18 mit
offenem Geltungsbereich, 10+1=11, technische Minute keine Erholung, **keine aktive 8-Minuten-
Absenkung**, Lücke ≠ Wendezeit, alle Berechnungsparameter offen, Unabhängigkeit von BV008,
Abgleich der `openParameters`-Liste mit den tatsächlich offenen Blättern, Freigabe-Blockade,
geschlossenes Statusvokabular, **keine ausführbare Logik**, **kein 1/6-Modul vorhanden**.
`tests/phase3i1-one-sixth-readiness.test.js` (13): was die Verträge liefern (Modus, Wochenend-
Tagesarten, Linie, Haltestellenfolge) und was **nicht** (kein Distanzfeld, kein Kombifahrer, keine
Wendezeit-/Break-Segmenttypen, kein Feiertag, Fahrer-/Fahrzeugwechsel nur als unbelegte Flags),
Verankerung des `NOT_READY`-Urteils sowie eine reale Umlauftafel-Probe.

## 20. Datenschutz
Reine Vertrags-/Metadatenarbeit: keine Originalzeilen, Zellinhalte, PDF-Koordinaten,
Personendaten, Dateipfade im Produktcode, keine Referenzdatei im Repository, keine
Extraktionsartefakte; die Probe lief read-only außerhalb des Repos.

## 21. Bekannte Grenzen
- Kein realer **Samstags-/Sonntags-** und kein realer **Straßenbahn**-Referenzsatz vorhanden —
  Wochenend- und Tram-Zweig sind unbelegt.
- `dayType` der realen Umlauftafel ist `unknown`; `dayQualifiers` des realen Dienstplans leer.
- Der Widerspruch zum `tariffReducedMinutes: 8 (confirmed)` in `jnv.v1.json` bleibt offen (Datei
  außerhalb des Scopes, bewusst unverändert).
- `break`/`layover`-Segmente entstehen produktiv nicht (bekannte 3H.2-Grenze) — explizite Pausen
  sind damit heute keine belastbare Grundlage.

## 22. Empfohlene nächste Phase
**Phase 3I.2 – Klärungs- und Beleg-Phase (ohne Code):** verbindliche Beantwortung der 19 offenen
Parameter mit Quelle und Freigeber, insbesondere (a) Entfernungsquelle für den Haltestellenabstand,
(b) Nachweis/Definition Kombifahrer, (c) Nachweis einer anrechenbaren Wendezeit, (d) Berechnungs-
formel inkl. Bezugsebene und Rundung, (e) verbindliche Tagesart-Quelle. Erst danach **3I.3**
(Datenerweiterung, falls nötig) und **3I.4** (Regelmodul analog BV008 → Adapter → Orchestrator);
die Ergebnisdarstellung ist durch 3H.6 bereits abgedeckt.

## 23. Commit-Empfehlung (KEIN Commit in dieser Phase)
Betroffene Dateien:
```
js/v2/rules/config/organizations/jnv-one-sixth.v1.json        (neu)
tests/phase3i1-one-sixth-contract.test.js                     (neu)
tests/phase3i1-one-sixth-readiness.test.js                    (neu)
PHASE-3I.1-JNV-1-6-FACHREGELVERTRAG-DATENREIFE-AUDIT.md       (neu)
DIENSTPLANANALYSE-V1-PHASEN-CHECKLISTE.md                     (geändert)
```
Vorgeschlagene Commit-Message:
```
docs(rules): add the JNV one-sixth rule contract and data-readiness audit

Add a focused, parameter-only JNV one-sixth rule configuration in the existing configuration
architecture: JNV-only scope excluding JES, bus and tram, a required combined driver, the
sub-3000-metre line-service alternative, weekend day types with night-shift and line-18 exceptions,
and a creditable turnaround of ten minutes plus one technical minute that is not recovery time.

Keep the rule set draft, disabled and unapproved, record nineteen mandatory parameters as open
(including the calculation formula, its basis, aggregation, rounding, the stop-distance source, the
combined-driver evidence, the turnaround evidence, and the holiday treatment), and never assume the
eight-minute tariff reduction.

Document the data-readiness audit with an overall NOT_READY verdict: stop distances, a combined
driver attribute, and a turnaround entity do not exist in any current source, while mode, lines,
stop sequences, and times are available.

Implement no one-sixth algorithm, no CheckModule, no runner registration, and no UI, and leave the
BV008 rule, the check architecture, and every frozen contract unchanged.

Add 33 contract and readiness tests including the approval gate and a real-reference probe; all 543
prior tests stay green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

*Nur Fachregelvertrag und Datenreife. Keine Regelimplementierung, keine Registrierung, keine UI.
Gesamtstatus **NOT_READY**. Kein Commit.*
