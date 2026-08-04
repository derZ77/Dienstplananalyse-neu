# WP26A — JES Join Strategy (Analyse)

Stand: 2026-07-21. **Reine Analyse. Keine Implementierung, keine Felder, keine
Commits.** Frage: Wie lassen sich JES-Dienstübersicht und JES-Wagenkarte
**eindeutig** verbinden?

---

## 0. Untersuchte Datenquellen

| Quelle | Datei | Rolle |
|---|---|---|
| JES-Dienstübersicht (real) | `20260713_Dienstübersicht_FDA.pdf` | Primärimport → CanonicalSchedule (19 Dienste, 139 Aktivitäten) |
| Wagenkarte (real) | `20260526_Eisenberg_Schule.xlsx`, Blatt „602" | Referenz-/Umlaufkarte derselben Familie (Umlauf + Linie/Fahrt-Nr.) |
| V2-Referenzvertrag | `js/v2/wagenkarten-reference-validator.js` | heutiges `WAGENKARTE`-Datenmodell |

Hinweis: Es lag **keine JES-spezifische** Wagenkarte vor. Die reale Eisenberg-
Wagenkarte verwendet jedoch dieselbe Notation (4-stellige Umlaufkennung,
„Linie / Fahrt-Nr.") und ist daher als struktureller Stellvertreter belastbar.

### Empirischer Befund Dienstübersicht (real, gemessen)
- **serviceNumber ist NICHT eindeutig**: `757` erscheint als **zwei** Dienstblöcke.
- **Ein Dienst kann mehrere Umläufe haben**: Dienst `753` → Kennungen `7531` **und** `7532` (Umlauf 1 und 2).
- **Grobe Granularität**: „Dienst"-Aktivitäten sind mehrstündige Arbeitsblöcke zwischen Pausen (z. B. 04:08→07:03), je Block **viele Fahrten** — **keine** Fahrten-Einzelzeilen.
- Jede fahrbezogene Aktivität trägt `ServiceIdentity` (`753/1`, `753/2`), aber **keine** `RouteIdentity`. Innerhalb eines Dienstes keine doppelten Abfahrtszeiten.

### Empirischer Befund Wagenkarte (real, gemessen, Blatt „602")
- Kopf: `Dienst-Nr.: 602`, `Umlauf 6021`, Dienstbeginn/-ende, `Bezahlte Zeit`, **`Lenkzeit 04:55`**.
- Je Fahrt explizit **`Linie / Fahrt-Nr.`**: `460 / 1`, `470 / 1`, `410 / 17`, `450 / 9` … (ausdrücklich **Fahrt**-Nr., nicht Kurs).
- Vollständige **Haltestellenfolge** je Fahrt mit Zeiten; **Leerfahrten**; Wende-/Bereitstellungs-/Pausenzeiten.
- **`Umlauf 6021`** = Dienst 602 / Umlauf 1 — **dieselbe 4-stellige DDDU-Kodierung** wie die Dienstübersichts-Kennung `7531` (= 753/1).

**Kernbeobachtung:** Die 4-stellige Umlaufkennung existiert **wörtlich in beiden
Quellen** — in der Dienstübersicht als `circuitNumber` (→ `ServiceIdentity`), in der
Wagenkarte als Feld **`Umlauf`**.

---

## 1. Aufgabe 1 — Vergleichstabelle Dienstübersicht ↔ Wagenkarte

| Information | JES-Dienstübersicht (CanonicalSchedule) | JES-Wagenkarte (real) | In beiden? |
|---|---|---|---|
| **Dienst-Nr.** | `service.serviceNumber` (751) | Kopf `Dienst-Nr.: 602` | ✅ beide |
| **Umlauf (4-stellig)** | `activity.circuitNumber` → `ServiceIdentity{dienst,umlauf}` (7531) | Kopf `Umlauf 6021` | ✅ beide |
| Dienstbeginn/-ende | `service.begin` / `end` | Kopf Dienstbeginn/Dienstende | ✅ beide |
| Bezahlte Zeit | `service.paidTime` | Kopf `Bezahlte Zeit` | ✅ beide |
| Abfahrts-/Ankunftszeit | je **grobem Block** (`activity.departure/arrivalTime`) | je **Fahrt/Halt** | ⚠ beide, andere Granularität |
| Abfahrts-/Ankunftsort | je grobem Block (mit Whitespace-Rauschen) | je Halt (Haltestellenname) | ⚠ beide, andere Granularität + Benennung |
| Tätigkeitsart | `rawActivity` (Dienst/Pause/Vorbereitung…) | implizit (Leerfahrt/Linienfahrt) | teils |
| **Linie / Fahrt** | ❌ nicht vorhanden | ✅ `Linie / Fahrt-Nr. 460/1` | **nur Wagenkarte** |
| Haltestellenfolge | ❌ (nur Blockendpunkte) | ✅ vollständig | **nur Wagenkarte** |
| Lenkzeit | ❌ | ✅ Kopf `Lenkzeit` | **nur Wagenkarte** |
| Fahrzeug | ❌ | (Wagenkartenkonzept) | nur Wagenkarte |

**Gemeinsame, verlässliche Schlüsselfelder:** **Dienst-Nr.** und **Umlauf** — beide
semantisch, in beiden Quellen wörtlich vorhanden, und in der 4-stelligen Kennung
(`7531` / `6021`) bereits zusammengefasst.

---

## 2. Aufgabe 2 — Bewertung der Join-Strategien

Legende: ✅ gut · ⚠ bedingt · ❌ untauglich.

| Strategie | eindeutig? | robust? | fehlertolerant? | dauerhaft? | Bewertung |
|---|:--:|:--:|:--:|:--:|---|
| **A) serviceNumber** | ❌ | ⚠ | ⚠ | ❌ | serviceNumber ist empirisch **nicht eindeutig** (757×2) und **nicht umlauf-spezifisch** (753→7531/7532). Ein Dienst hat mehrere Umläufe → grob mehrdeutig. |
| **B) serviceNumber + umlauf** | ✅ | ✅ | ✅ | ✅ | Entspricht der 4-stelligen Kennung (`ServiceIdentity` ↔ Wagenkarten-`Umlauf`). Semantischer Schlüssel, wörtlich in beiden Quellen. Löst 757×2 und Mehrfach-Umläufe. Unabhängig von Zeiten/Orten. |
| **C) serviceNumber + departureTime** | ⚠ | ❌ | ❌ | ❌ | Bindet an **exakte Zeitgleichheit**. Grobe Blöcke (Blockstart) ≠ feine Fahrten (erste Fahrt); Auf-/Abrüst-/Leerfahrtvorlauf verschiebt Zeiten. Zeiten wiederholen sich planweit. Fragil. |
| **D) serviceNumber + departureTime + departureLocation** | ⚠ | ❌ | ❌ | ❌ | Zusätzliche Ortsbindung, aber Ortsnamen weichen ab (Dienstübersicht „Betriebshof Jena-Burgau" vs. Wagenkarte-Halt/Steig) und tragen Whitespace-Rauschen. Erhöht Bruchgefahr statt sie zu senken. |
| **E) B + Zeitfenster-Validierung** | ✅ | ✅ | ✅ | ✅ | **Verfeinerung von B**: Join über Dienst+Umlauf (semantisch); der Dienst-Zeitrahmen (`begin`/`end`) dient nur als **Kreuzprüfung** zur Erkennung von Fehlzuordnungen. |
| E') Wagenkarten-`id`/`vehicle` | ❌ | — | — | — | Fahrzeug/id identifiziert die Karte, nicht die fachliche Zuordnung zum Dienst/Umlauf. Kein gemeinsamer Schlüssel mit der Dienstübersicht. |

**Zeit-/ortsbasierte Strategien (C/D) scheitern an der Granularitätslücke**
(grober Block ↔ viele Fahrten) und an Benennungs-/Rundungsunterschieden. **Nur der
semantische Umlaufschlüssel (B/E) ist eindeutig und stabil.**

---

## 3. Aufgabe 3 — Mehrdeutigkeiten & Risiken

| Risiko | Beobachtung / Wirkung | Vom B/E-Join betroffen? |
|---|---|---|
| **Gleicher Dienst, mehrere Umläufe** | Bestätigt: 753 → 7531 + 7532. serviceNumber allein mehrdeutig. | **Gelöst** durch Umlaufanteil. |
| **serviceNumber nicht eindeutig** | Bestätigt: 757 als zwei Blöcke (7571/7572). | **Gelöst** — Join über 4-stellige Kennung, nicht über die Blocknummer. |
| **Gleiche Abfahrtszeiten** | Planweit häufig; nur zeitbasierte Joins (C/D) gefährdet. | **Irrelevant** für B/E (kein Zeitschlüssel). |
| **Mitfahrten** | `rawActivity = Mitfahrt`: Fahrer fährt mit, steuert nicht → gehört zu **fremdem** Fahrzeug/Umlauf. Zeit-/Ortsjoin würde sie fälschlich einer Fahrtkarte zuordnen. | **Vermieden** — Mitfahrten tragen keine eigene Umlaufkennung; B/E ordnet nur echte Umläufe zu. |
| **Teilfahrten** | Eine Fahrt über eine Dienst-/Umlaufgrenze hinweg. Zeitjoin unklar. | **Vermieden** — Zuordnung erfolgt über Umlauf, nicht über einzelne Fahrtgrenzen. |
| **Dienstwechsel** (Fahrzeugübergabe) | Ein Fahrzeug wird nacheinander von mehreren Diensten gefahren. Ein rein fahrzeug-/zeitbezogener Join würde Dienste vermischen. | **Vermieden**, solange die Umlaufkennung dienstbezogen ist (`6021` = Dienst 602/Umlauf 1); B/E bindet an Dienst+Umlauf, nicht an das Fahrzeug. |
| **Verstärkerfahrten** | Zusätzliche Fahrten/Kurse in Spitzenzeiten, oft gleiche Linie, andere Fahrt-Nr. | **Unterscheidbar** über die Fahrt-Nr. der Wagenkarte; für den *Join* unkritisch (Umlaufebene). |
| **Restrisiko B/E** | Der Join steht und fällt mit der **Umlaufkennung in der Wagenkarte**. Fehlt sie im Datenmodell, greift B nicht (siehe §4). | Modell-, kein Datenrisiko. |

**Fazit Risiken:** Alle klassischen Mehrdeutigkeiten sind **zeit-/ortsbasiert** und
werden vom **semantischen Umlaufjoin (B/E) umgangen**. Das einzige verbleibende
Risiko ist ein **Modellrisiko** (Umlaufkennung im `WAGENKARTE`-Vertrag), kein
Datenrisiko.

---

## 4. Aufgabe 4 — Reichen die Wagenkartenfelder für RouteIdentity `LINE_TRIP`?

**Daten: ja. Aktuelles V2-Modell: nein.**

- Die **reale** Wagenkarte enthält je Fahrt ausdrücklich **`Linie / Fahrt-Nr.`**
  (`460 / 1`) — also Linie **und** Fahrt, exakt die Eingaben für `RouteIdentity`
  `LINE_TRIP` (`line`, `trip`, `kind=LINE_TRIP`, `LT:460|1`). Zusätzlich Umlauf,
  Haltestellenfolge und Zeiten.
- Der **V2-`WAGENKARTE`-Vertrag** bildet das **nicht sauber** ab:
  1. **Kein `umlauf`-Feld** — der Join-Schlüssel fehlt. Zudem verbietet der Validator
     doppelte `serviceNumber` (`wagenkarten-reference-validator.js:30`), sodass ein
     Dienst mit **mehreren Umläufen** gar nicht als mehrere Karten darstellbar ist.
  2. **Fahrt als `course` fehlbenannt** — `SERVICE`-Fahrten erzwingen `course`
     (`:81`). Für JES ist es eine **Fahrt**, kein Kurs; ohne `fahrt`/`kind`-Kennzeichen
     entstünde fälschlich `LINE_COURSE` statt `LINE_TRIP`.

**Fehlende Informationen im Modell (nicht in den Daten):**
- `umlauf` (4-stellige Kennung) — als Join-Schlüssel.
- ein **Fahrt-/`routeKind`-Feld**, das Linie/Fahrt von Linie/Kurs unterscheidet.

(Beides deckt sich mit den in `docs/block9-parity-analysis.md` §4 genannten
Ergänzungen a/b. **In WP26A wird nichts davon umgesetzt.**)

---

## 5. Aufgabe 5 — Empfehlung (genau eine Strategie)

**Empfohlen: B) `serviceNumber + umlauf` — konkret der Join über die 4-stellige
Umlaufkennung (`ServiceIdentity.normalizedKey` `DU:753|1` ↔ Wagenkarten-`Umlauf`
`7531`), abgesichert durch den Dienst-Zeitrahmen als Kreuzprüfung (Variante E).**

### Warum fachlich korrekt
Eine Wagenkarte **ist** ein Umlauf (Fahrzeugrotation). Die Dienstübersicht benennt
über die 4-stellige Kennung ausdrücklich **Dienst + Umlauf**. Der Join auf genau
dieser Ebene trifft die reale fachliche Einheit. `serviceNumber` allein ist
empirisch weder eindeutig (757×2) noch umlaufscharf (753→2 Umläufe); Zeit/Ort sind
Artefakte grober Blöcke, keine Identität.

### Warum langfristig stabil
Der semantische Schlüssel driftet nicht mit Fahrplanzeiten, Rundungen,
Haltestellenbenennung oder PDF-Layout. Er funktioniert im **Übergangsformat**
(Kennung `7531` liegt vor) und bleibt gültig, wenn JES später **Linie/Fahrt** nativ
führt — dann liefert die Dienstübersicht die Route direkt, die Dienst+Umlauf-
Identität bleibt als Bindeglied bestehen. Zeit-/ortsbasierte Joins wären dagegen
bei jedem Fahrplanwechsel neu zu justieren.

### Warum ungefährlich für Alt / Neu / BEU
Der Join wird **ausschließlich** für Aktivitäten mit `ServiceIdentity` ausgelöst
(nur JES-Übergangskennung erzeugt eine `ServiceIdentity`). Alt/Neu/BEU tragen
`RouteIdentity` (`LINE_COURSE`) und **keine** `ServiceIdentity` → **kein** Wagenkarten-
Join, **keine** Berührung. Das Verfahren ist damit strukturell auf JES begrenzt.

### Voraussetzung (für eine spätere Umsetzung, hier nur benannt)
Der `WAGENKARTE`-Vertrag muss die **Umlaufkennung** (`umlauf`) als Join-Schlüssel
und ein **Fahrt-/`routeKind`-Feld** aufnehmen (§4). Die realen Wagenkartendaten
enthalten beides bereits; es ist eine Modell-, keine Datenlücke.

---

## Zusammenfassung

- Untersucht: reale JES-Dienstübersicht, reale Wagenkarte (Eisenberg), V2-`WAGENKARTE`-Vertrag.
- Gemeinsamer, verlässlicher Schlüssel: **Dienst + Umlauf** (4-stellige Kennung, wörtlich in beiden Quellen).
- Zeit-/ortsbasierte Joins (C/D) sind an Granularität und Benennung fragil.
- Alle klassischen Mehrdeutigkeiten sind zeit-/ortsbasiert → vom Umlaufjoin umgangen.
- Wagenkartendaten genügen für `LINE_TRIP`; das V2-Modell fehlt `umlauf` + Fahrt-Kennzeichen.
- **Empfehlung: B/E — semantischer Umlaufjoin, zeitfenstervalidiert.**
