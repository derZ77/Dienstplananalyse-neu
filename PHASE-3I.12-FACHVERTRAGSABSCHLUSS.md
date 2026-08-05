# Phase 3I.12 – Fachvertragsabschluss Nachtschicht und Leerfahrten + erneutes Freigabeaudit

**Stand:** 2026-08-02 · Branch `master`, HEAD `2fa399ed` · **Kein Commit. Keine Freigabe. Keine
Aktivierung.** Regelset weiterhin `draft` / `enabled:false` / `approvedBy:null`.

**Freigabeaudit-Ergebnis: `READY_FOR_APPROVAL`** — mit einer benannten Auflage vor der Aktivierung
(§9).

> **Nachtrag Phase 3I.13 (2026-08-02):** Die Auflage aus §6/§8 ist **erledigt**. Der Nutzer hat
> entschieden: Eine Leerfahrt ohne Liniennummer gilt als **regulär**. Umgesetzt in
> `PHASE-3I.13-DEADHEAD-LINE-CLASSIFICATION-ABSCHLUSS.md`; das Freigabeaudit ist seither
> `READY_FOR_APPROVAL` **ohne** Aktivierungsauflage.

## 1. Ausgangslage
Phase 3I.11 schloss mit `BLOCKED`. Blockierend waren zwei Punkte: die **mehrdeutige Bedeutung der
Nachtschicht-Ausnahme** (der Vertragssatz „Ausnahmen: Nachtschichten und Linie 18" ließ beide
Wirkungsrichtungen zu) und der **vorläufige** Parameter `deadheadTreatment`. Beide sind jetzt
verbindlich entschieden.

## 2. Fachentscheidungen (verbindlich)

### A — Nachtschicht
Nachtschichten werden **zusätzlich** nach der 1/6-Regel geprüft. Ein Mo–Fr-Dienst, der als
Nachtschicht klassifiziert ist (Dienstbeginn ab **19:20 einschließlich**), unterliegt der Regel.
Die Nachtschicht ist damit eine Ausnahme **zugunsten** der Geltung — anders als die Linie-18-Ausnahme,
die Abschnitte **aus** der Regel herausnimmt. Genau diese Asymmetrie war offen und ist nun geklärt.

### B — Wochenend-Nachtschicht
Eine Nachtschicht am Samstag, Sonntag oder Feiertag wird **genauso** geprüft wie jeder andere
Wochenenddienst. **Keine Sonderbehandlung** — die Nachtschichteigenschaft ändert am Wochenende
nichts, weil die Tagesart die Geltung dort bereits begründet.

### C — Leerfahrten
Leerfahrten zählen **vollständig** als Lenkzeit und gehören vollständig zur `drivingMinutes`-Basis.
**Keine Sondergewichtung, keine Herausrechnung.**

## 3. Konfigurationsänderungen
Genau zwei Änderungen an `js/v2/rules/config/organizations/jnv-one-sixth.v1.json`:

| Feld | vorher | nachher |
|---|---|---|
| `calculation.deadheadTreatment.status` | `provisional` | **`confirmed`** (Wert `counts_as_driving_time` unverändert) |
| `sourceReferences` | 8 Einträge | **11** (3I.11, 3I.12 und die Nutzerangaben aus 3I.12 ergänzt) |

**Nicht geändert, weil bereits korrekt:** `nightShiftIsException` war seit Phase 3I.8 `confirmed`
(Wert `true`) — offen war nie sein *Status*, sondern seine *Bedeutung*. Entscheidung A bestätigt die
bereits implementierte Lesart; der Parameter bleibt unverändert. Ebenso unverändert:
`nightShiftStart` (`19:20`), `nightShiftStartInclusive` (`true`), `nightShiftStartBasis`
(`duty_start_time`), alle Linie-18-Parameter und der gesamte übrige Vertrag.

`status`, `enabled` und `approvedBy` sind **unangetastet**. Kein Parameter des Regelsets ist noch
`provisional`; Open-Count bleibt **0**.

## 4. Dokumentationsänderungen
`PHASE-3I.11-…-FREIGABEAUDIT.md`: Nachtrag im Kopf, §19 als „aufgehoben durch Phase 3I.12"
gekennzeichnet, §23 als erledigt markiert. Das ursprüngliche Audit-Urteil bleibt als Historie
lesbar — es wird eingeordnet, nicht überschrieben. Checkliste um den 3I.12-Abschnitt ergänzt.

## 5. Verhältnis zum Code
**Am Code wurde nichts geändert.** Alle drei Entscheidungen bestätigen Verhalten, das bereits
implementiert war:

- **A/B:** `evaluateOneSixthEligibility()` lässt eine Mo–Fr-Nachtschicht zu (`nightShift === true`
  überstimmt die nicht zugelassene Tagesart) und wertet Wochenenddienste unabhängig vom Dienstbeginn.
- **C:** Die Driving Projection führt `DRIVING_KINDS = { service, deadhead }` — eine Leerfahrt ist
  ein Fahrsegment und geht mit ihrer vollen Dauer in `drivingMinutes` ein. Empirisch belegt:
  30 min Leerfahrt + 396 min Linienfahrt → `drivingMinutes 426`, `requiredMinutes ceil(426/6) = 71`.

Damit ist der Vertrag jetzt **deckungsgleich** mit der Umsetzung — vorher war er an diesen drei
Stellen schlicht nicht festgeschrieben.

## 6. Befund: Was Entscheidung C sichtbar macht — **geschlossen durch Phase 3I.13**
Eine Leerfahrt wird per Konstruktion **genau dann** als `depotDuty` klassifiziert, wenn **weder** ein
Umlaufcode **noch** eine bekannte Linienidentität vorliegt (`jnv-schedule-hardening.js`: `circuit ||
routeKnown` ergibt immer `serviceDrive`). Ein Leerfahrtsegment trägt also **niemals** eine Linie.

Die Linie-18-Ausnahmeprüfung (Phase 3I.9) bewertet eine **teilweise unbekannte** Linienzuordnung
konservativ als `INCONCLUSIVE` (`SEGMENT_LINE_AMBIGUOUS`) — sie darf die Ausnahmegrenze nicht raten.
Beides zusammen ergibt, empirisch belegt:

> Ein Umlauf mit mindestens einer Leerfahrt **und** mindestens einer Linienfahrt — der Normalfall
> jedes Dienstes mit Depotfahrt — wird nach einer Aktivierung **INCONCLUSIVE**.

Kein falsches Urteil, keine Violation — aber praktisch auch kein bewertbarer Dienst. Der Effekt
bestand schon vorher; er wird durch Entscheidung C nur unübersehbar, weil die Leerfahrt jetzt
vertraglich fest zur Lenkzeitbasis gehört.

Fachlich naheliegend wäre: Bei einer Leerfahrt ist die fehlende Linie **kein Informationsmangel**,
sondern der strukturelle Normalfall — eine Leerfahrt *hat* keine Linie und kann deshalb auch keine
Linie-18-Fahrt sein. Diese Entscheidung steht dem Nutzer zu und wurde hier **nicht** vorweggenommen;
`one-sixth-rule.js` ist in dieser Phase ausdrücklich gesperrt.

> **Frage vor der Aktivierung:** Soll ein Leerfahrtsegment ohne Linie als **regulär** (also nicht
> von der Linie-18-Ausnahme betroffen) behandelt werden, statt den ganzen Umlauf unentscheidbar zu
> machen?
>
> **Beantwortet in Phase 3I.13: ja.** Eine Leerfahrt ohne Linie ist regulär und evaluierbar; eine
> Linienfahrt ohne Linie bleibt unverändert INCONCLUSIVE.

## 7. Tests
**34 neue Tests**, Gesamtsuite **1109/1109** (0 Skips, 0 todo):

- `phase3i12-night-shift-contract.test.js` (12): Nachtschicht Montag/Freitag anwendbar, gewöhnlicher
  Werktagsdienst nicht, Grenze 19:19/19:20/19:21, unbekannter Beginn weiterhin INCONCLUSIVE,
  Samstag/Sonntag/Feiertag-Nachtschicht identisch zum jeweiligen Tagesdienst, Nachtschicht entfernt
  nie einen Wochenenddienst aus der Regel, Parameter `confirmed`, Quellenangabe, gespiegelter
  Produktivdefault weiterhin deaktiviert.
- `phase3i12-deadhead-contract.test.js` (11): Projektion klassifiziert Leerfahrt als Fahrsegment
  (30 + 396 = 426), volle Anrechnung mit und ohne `eligibility`, keine Abwertung, mehrere
  Leerfahrten, unbekannte Leerfahrtdauer weiterhin INCONCLUSIVE, Leerfahrt **auf** Linie 18 wird wie
  jedes andere Linie-18-Segment ausgenommen, Parameter `confirmed`, kein `provisional` mehr, und der
  Befund aus §6 als Verhalten festgenagelt.
- `phase3i12-approval-unblocked.test.js` (11): Vertragsaussagen dokumentiert, 3I.11-Urteil
  eingeordnet, kein `provisional`/kein offener Parameter, Quellenangabe, weiterhin
  `draft`/`disabled`/`approvedBy:null` (auch im Rohtext), Produktivdefault liefert DISABLED,
  aktiviertes Regelset wäre valide, die Auflage aus §6 ist dokumentiert, kein Engine-/Regel-/
  Validator-/Adapter-/Runner-/Explorer-/Projection-Code trägt eine 3I.12-Änderung, Config ohne
  ausführbare Logik und ohne Pfade.

Angepasst: drei `OPEN READING`-Tests und der `provisional`-Test in
`phase3i11-approval-readiness-audit.test.js` — als `SUPERSEDED BY PHASE 3I.12` markiert und durch
die nun **verbindlichen** Aussagen ersetzt. Keine Schutzaussage wurde ersatzlos entfernt.

## 8. Freigabeaudit
| Bedingung | Status |
|---|---|
| Alle Fachparameter bestätigt | ✅ kein `provisional`, Open-Count 0 |
| Blocker aus 3I.11 entfernt | ✅ Nachtschicht-Semantik und Leerfahrten entschieden |
| Statuskorrektur aus 3I.11 grün | ✅ |
| Alle Tests grün | ✅ 1109/1109 |
| Konfigurationsvalidator akzeptiert ein aktiviertes Regelset | ✅ |
| Regel weiterhin `draft` / `enabled:false` / `approvedBy:null` | ✅ |

**Ergebnis: `READY_FOR_APPROVAL`.** Ausdrücklich **nicht** erreicht: `APPROVED`, `ACTIVE`,
`PRODUCTION_ENABLED`.

**Auflage vor der Aktivierung** (nicht vor der Freigabe): der Befund aus §6 — sonst ist nach dem
Einschalten praktisch jeder Dienst mit Depotfahrt INCONCLUSIVE. **Erledigt durch Phase 3I.13.**

## 9. Keine Aktivierung
`status: draft`, `enabled: false`, `approvedBy: null` unverändert. Keine Migration, keine
UI-Änderung, kein Schalter, keine Engine-, Regel-, Validator-, Adapter-, Runner-, Orchestrator-,
Projection-, Session-, Bootstrap- oder Explorer-Änderung. `server.js` und die Package-Dateien
unberührt.

## 10. Datenschutz
Die Konfiguration enthält keine ausführbare Logik, keine Pfade, keine Personendaten — per Test
abgesichert. Die neuen Tests lesen ausschließlich versionierte Projektdateien; keine Referenzdatei
wurde übernommen, im App-Verzeichnis liegt keine.

## 11. Bekannte Grenzen
- Der Befund aus §6 (Leerfahrt ohne Linie → INCONCLUSIVE) ist **durch Phase 3I.13 geschlossen**.
- Der **gemischte** Linie-18-Übergang bleibt INCONCLUSIVE (der Vertrag entscheidet ihn nicht).
- Sind alle Einheiten ausgenommen, bleibt `services: []` (Phase 3I.11, §7).
- Die Joint-Timeline-**Statistik** zählt `drivingMinutes` weiterhin nur über `kind === service`,
  die Driving Projection dagegen inklusive `deadhead`. Für die 1/6-Regel ist ausschließlich die
  Projektion maßgeblich; die Kennzahl der Joint Timeline wird von keiner Regel gelesen. Zwei
  Definitionen desselben Begriffs im selben Datenpfad bleiben trotzdem eine Stolperstelle.
- Kein realer Samstags-/Sonntags- und kein Straßenbahn-Referenzsatz; ein realer End-to-End-Nachweis
  mit passender Dienstplan-/Umlauftafel-Paarung steht weiterhin aus.

## 12. Nächste Phase
**Phase 3I.13 – Entscheidung zur Linienzuordnung von Leerfahrten** (Frage aus §6) — **erledigt**, danach
**Phase 3I.14 – Freigabe** (`status: approved`, `approvedBy`) und erst anschließend eine Aktivierung
mit realem End-to-End-Nachweis.

## 13. Commit-Empfehlung (KEIN Commit)
```
js/v2/rules/config/organizations/jnv-one-sixth.v1.json
tests/phase3i12-*.test.js (3 neu) · tests/phase3i11-approval-readiness-audit.test.js (angepasst)
PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md · PHASE-3I.11-…-FREIGABEAUDIT.md · Checkliste
```
`docs(rules): finalize JNV night shift and deadhead contract`
