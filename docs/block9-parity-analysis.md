# Block 9 „Dienste nach Linie/Kurs" — Parität Alt/Neu/BEU/JES

Stand: 2026-07-21. **Reine Analyse, keine Implementierung.** Betrachtet
ausschließlich Block 9.

---

## 1. Welche Informationen benötigt Block 9?

Block 9 gruppiert Fahrten nach ihrer **Route** und listet je Gruppe die Dienste,
die diese Route fahren. Beleg: `groupLegacyRoutes()` (V2) sowie die Legacy-Renderer
`routeText` (Excel, `index.html:1236`) und `buildWagenkarteRouteText`
(`index.html:1740`) erzeugen dieselbe Struktur:

| Ebene | Benötigte Information |
|---|---|
| Gruppenschlüssel | **Route-Identität**: Linie + Kurs (JNG) bzw. Linie + Fahrt (JES) |
| je Eintrag | **Dienstnummer** (welcher Dienst fährt die Route) |
| je Eintrag | **Abfahrtszeit** |
| je Eintrag | **Ankunftszeit** |
| je Eintrag | **Abfahrtsort** |
| je Eintrag | **Ankunftsort** |

Optionaler Legacy-Zusatz (Excel): ein „nächste Fahrt"-Hinweis je Eintrag — aus der
Aktivitätsreihenfolge ableitbar, für die Parität nicht zwingend.

Mehr braucht Block 9 nicht: **Route-Identität + Dienst + Zeiten + Orte.**

---

## 2. Was liefern RouteIdentity / ServiceIdentity / CanonicalSchedule heute?

| Benötigt | Geliefert von | Feld |
|---|---|---|
| Gruppenschlüssel (Linie/Kurs) | **RouteIdentity** | `line`, `course`, `kind=LINE_COURSE`, `normalizedKey` |
| Gruppenschlüssel (Linie/Fahrt) | **RouteIdentity** | `line`, `trip`, `kind=LINE_TRIP`, `normalizedKey` |
| Dienstnummer | **CanonicalSchedule** | `service.serviceNumber` |
| Abfahrts-/Ankunftszeit | **CanonicalSchedule** | `activity.departureTime` / `arrivalTime` |
| Abfahrts-/Ankunftsort | **CanonicalSchedule** | `activity.departureLocation` / `arrivalLocation` |
| (Dienst/Umlauf — kein Routenwert) | **ServiceIdentity** | `dienst`, `umlauf` (nur Verbindungsschlüssel, s. u.) |

**ServiceIdentity liefert bewusst keine Route** — sie beschreibt die
Dienstzugehörigkeit. Für Block 9 ist sie nur als **Verbindungsschlüssel** relevant
(JES-Join, siehe §4).

### Abdeckung je Quelle (heute)

| Quelle | Route-Identität | Dienst/Zeiten/Orte | Block 9 heute vollständig? |
|---|---|---|---|
| **Alt JNG** (Excel `12/1`) | ✅ RouteIdentity `LINE_COURSE` (12/1) | ✅ CanonicalSchedule | **✅ ja** |
| **Neu JNG / BEU** (PDF `12100`) | ✅ RouteIdentity `LINE_COURSE` (=`LC:12\|1`, identisch zu `12/1`) | ✅ CanonicalSchedule | **✅ ja** |
| **JES Übergang** (Dienstübersicht `7511`) | ❌ **keine** RouteIdentity — nur ServiceIdentity `DU:751\|1` | ✅ CanonicalSchedule (serviceNumber, Zeiten, Orte vorhanden) | **❌ nein — Linie/Fahrt fehlt** |
| **JES Zielbild** (Dienstplan `412/16`) | ✅ RouteIdentity `LINE_TRIP` (412/16) | ✅ CanonicalSchedule | ⚠ nur wenn Block 9 `LINE_TRIP` gruppiert (s. §4) |

Nach WP25 gruppiert `groupLegacyRoutes()` **nur `LINE_COURSE`** und fasst
`12/1` ≙ `12100` korrekt zusammen. `7511` (ServiceIdentity, keine RouteIdentity)
bildet — korrekt — **keine** Route-Gruppe.

---

## 3. Welche Information fehlt ausschließlich in den Wagenkarten?

**Genau eine, und nur für JES:** die **Linie/Fahrt (Route-Identität)**.

- Die **JES-Übergangs-Dienstübersicht** trägt im Kennungsfeld nur `7511` =
  Dienst 751 / Umlauf 1. Sie enthält **keine Linien-, Kurs- oder Fahrtinformation**.
- Diese Linie/Fahrt existiert **ausschließlich in der Wagenkarte** (dort explizit
  `412/16` → Linie 412 / Fahrt 16, plus Haltestellenfolge).
- Servicenummer, Zeiten und Orte fehlen **nicht** — die liefert die
  Dienstübersicht (CanonicalSchedule) auch für JES.

Zusätzlich strukturell: die Wagenkarte ist heute eine **`ReferenceDataSource`**,
**kein CanonicalSchedule**. Sie durchläuft die Identity-Anreicherung (WP24) nicht
und ist nicht mit `groupLegacyRoutes()` verbunden. Ihr Routenwissen ist also
vorhanden, aber **an Block 9 nicht angeschlossen**.

Für Alt/Neu/BEU fehlt **nichts** in den Wagenkarten — Block 9 ist dort ohne
Wagenkarte vollständig.

---

## 4. Welche Felder müssen ergänzt werden (für identische Ergebnisse)?

### Alt / Neu / BEU — **nichts**
RouteIdentity (`LINE_COURSE`) + CanonicalSchedule decken Block 9 vollständig ab.
`12/1` (Alt) und `12100` (Neu/BEU) liefern denselben Schlüssel → dieselbe Gruppe.
Bereits erreicht (WP25).

### JES — vier Ergänzungen (drei nur im Übergang, eine dauerhaft)

**a) Wagenkarten-Modell: korrekte Fahrt-Darstellung (Feld).**
Der `WAGENKARTE`-Vertrag erzwingt heute für jede `SERVICE`-Fahrt ein `course`
(`wagenkarten-reference-validator.js:81`). Für JES ist die letzte Zahl aber eine
**Fahrt**, kein Kurs. Nötig: ein eigenes Feld (`fahrt`/`trip`) **oder** ein
`routeKind`-Kennzeichen (`LINE_COURSE` | `LINE_TRIP`), damit daraus eine
**RouteIdentity `LINE_TRIP`** (statt fälschlich `LINE_COURSE`) entsteht. Ohne das
würde JES als „Linie/Kurs" fehlinterpretiert — verboten laut Domänenmodell.

**b) Wagenkarten-Modell: expliziter Verbindungsschlüssel (Feld).**
Um eine Wagenkarten-Fahrt der richtigen Dienstübersichts-Aktivität zuzuordnen,
braucht es einen Join. Vorhanden: `serviceNumber` (Karte) + `departure{time,stop}`
(Fahrt). Empfohlen zusätzlich ein **`umlauf`** je Karte/Fahrt, passend zu
`ServiceIdentity.umlauf` (`DU:751\|1`), damit der Join robust ist (serviceNumber +
umlauf, ersatzweise + Abfahrtszeit/-ort).

**c) Anreicherungs-/Join-Schritt (Prozess, kein neues Feld).**
Ein Schritt, der die Wagenkarten-Referenz liest, ihre Fahrten per
`serviceNumber (+umlauf/Zeit)` den JES-Dienstübersichts-Aktivitäten zuordnet und
diesen eine **`RouteIdentity` (`LINE_TRIP`)** anhängt. Das Feld `activity.routeIdentity`
**existiert bereits** (WP23) — es fehlt nur die Wagenkarten-gespeiste Befüllung für
JES. (Sobald künftige JES-Dienstpläne `Linie/Fahrt` nativ führen, entfällt der Join
— dann liefert die Dienstübersicht die RouteIdentity direkt.)

**d) Block-9-Logik: `LINE_TRIP` einbeziehen (dauerhaft).**
`groupLegacyRoutes()` gruppiert heute nur `LINE_COURSE`. Für JES muss es auch
`LINE_TRIP` (Linie/Fahrt) gruppieren (Schlüssel `${line}/${trip}`). Diese
Erweiterung ist **immer** nötig — im Übergang wie im Zielbild — und war in WP25
ausdrücklich ausgeklammert.

### Zusammenfassung der Deltas

| # | Ort | Art | Gilt für | Übergang / dauerhaft |
|---|---|---|---|---|
| a | `WAGENKARTE`-Referenz | neues Feld `fahrt`/`routeKind` | JES | dauerhaft (solange Wagenkarten JES-Routen liefern) |
| b | `WAGENKARTE`-Referenz | neues Feld `umlauf` (Join) | JES | Übergang |
| c | Join/Enrichment | Prozess (Feld `routeIdentity` existiert) | JES | Übergang |
| d | `groupLegacyRoutes()` | Logik: `LINE_TRIP` gruppieren | JES | dauerhaft |

**Kernaussage:** Für Alt/Neu/BEU ist Block 9 bereits paritätisch. Für JES fehlt
Block 9 genau die **Linie/Fahrt**, die nur die Wagenkarte hat; sie muss über
`serviceNumber`/`umlauf` an die Dienstübersicht gejoint, als `LINE_TRIP`-RouteIdentity
angehängt und von Block 9 (`LINE_TRIP`-fähig) gruppiert werden. Neue Datenfelder
entstehen dabei nur im **Wagenkarten-Referenzmodell** (Fahrt + Umlauf); an
CanonicalSchedule/RouteIdentity/ServiceIdentity ist **kein** neues Feld nötig.
