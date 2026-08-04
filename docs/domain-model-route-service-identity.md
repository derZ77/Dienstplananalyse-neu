# Domänenmodell-Entscheidung: RouteIdentity vs. ServiceIdentity

Stand: 2026-07-20. **Reine Bewertung — keine Implementierung, keine Klassen,
Interfaces oder JSON-Dateien, keine Refactorings.** Ziel: das Domänenmodell für die
Kurs/Dienst-Kennung endgültig festlegen.

---

## 0. Empfehlung (vorab, eindeutig)

**Die Trennung in `activity.routeIdentity` und `activity.serviceIdentity` ist
fachlich überlegen und sollte dauerhaft eingefroren werden.** Das zuvor
vorgeschlagene Sammelobjekt `activity.route` mit allen Feldern (inkl.
`kind: DIENST_UMLAUF`) ist zu verwerfen.

Endmodell:

```
activity
├── routeIdentity?    // vorhanden ⇔ die Aktivität hat einen Fahrweg
│     { raw, line, course, trip, kind: LINE_COURSE | LINE_TRIP | UNKNOWN, normalizedKey }
└── serviceIdentity?  // vorhanden ⇔ die Kennung nennt Dienst/Umlauf
      { raw, dienst, umlauf, normalizedKey }
```

Beide Felder sind **optional** und **additiv** an der Aktivität (wie `activityType`).
Ihre An-/Abwesenheit ersetzt den bisherigen `kind: DIENST_UMLAUF`.

Die ausführliche Begründung folgt.

---

## 1. Die fachliche Kernunterscheidung

Zwei **verschiedene ontologische Fragen**:

| Konzept | Frage | Beispiele |
|---|---|---|
| **Route** (Fahrweg) | „Welchen Fahrweg fährt diese Aktivität?" | `12/1`, `12100`, `412/16` |
| **ServiceIdentity** (Dienstzugehörigkeit) | „Zu welchem Dienst/Umlauf gehört sie?" | `7511` → Dienst 751 / Umlauf 1 |

Diese Dimensionen sind **orthogonal** — eine ist keine Ausprägung der anderen.

**Der entscheidende empirische Beleg:** In allen vier bekannten Notationen kodiert
das Kennungsfeld der Aktivität **genau eines** der beiden Konzepte, **nie beides**:

| Notation | kodiert | das jeweils andere Konzept kommt aus … |
|---|---|---|
| `12/1` (alt JNG) | Route (Linie 12/Kurs 1) | Dienst aus `service.serviceNumber` |
| `12100` (neu JNG/BEU) | Route (Linie 12/Kurs 1) | Dienst aus `service.serviceNumber` |
| `412/16` (JES-Wagenkarte) | Route (Linie 412/Fahrt 16) | Dienst aus `service.serviceNumber` |
| `7511` (JES-Übergang) | ServiceIdentity (Dienst 751/Umlauf 1) | Route **nicht vorhanden** (später aus Wagenkarte) |

Genau das ist die Signatur zweier getrennter Konzepte: Sie treten **unabhängig**
voneinander auf. Ein Sammelobjekt, das beide zusammenzwingt, muss diese Trennung
über ein `kind`-Feld wieder künstlich herstellen — ein sicheres Zeichen dafür, dass
dort zwei Dinge vermengt wurden, die nicht zusammengehören.

---

## 2. Warum das Sammelobjekt semantisch falsch war

Der bisherige Vorschlag `route = { line, course, trip, dienst, umlauf, kind }` mit
`kind: DIENST_UMLAUF` erzeugt ein **„Route"-Objekt, das keine Route ist** (keine
Linie, kein Fahrweg). Das ist ein Widerspruch in sich (Null-Object-/Fake-
Discriminator-Smell):

- Bei `kind = DIENST_UMLAUF` sind `line/course/trip` **immer null** und
  `dienst/umlauf` gesetzt — bei `kind = LINE_COURSE` genau umgekehrt. Das Objekt
  hat also **zwei disjunkte Feldgruppen**, die sich gegenseitig ausschließen. Das
  ist die klassische Definition zweier Typen, die fälschlich in einem stecken.
- Jeder Konsument müsste die Invariante „welche Felder sind bei welchem `kind`
  gültig?" kennen und einhalten. Diese Invariante ist **implizit** und über die
  ganze App verteilt einzuhalten — genau das, was laut Auftrag vermieden werden soll.

Die Trennung kodiert dieselbe Information **strukturell statt per Konvention**:
Ist ein Fahrweg da, existiert `routeIdentity`; nennt die Kennung Dienst/Umlauf,
existiert `serviceIdentity`. Kein `kind` muss die Abwesenheit von Route mehr
„erklären".

---

## 3. Bewertung nach den vier Kriterien

### 3.1 Semantische Korrektheit — **klar für die Trennung**
Route und Dienstzugehörigkeit sind unterschiedliche Domänenobjekte (Fahrweg vs.
Aufbauorganisation des Dienstplans). Die Trennung bildet die Realität 1:1 ab: ein
Feld pro Konzept, vorhanden genau dann, wenn die Quelle es liefert. Das Sammelobjekt
erzwingt einen künstlichen Diskriminator und einen semantischen Widerspruch
(Route ohne Fahrweg). **Sieger: Trennung.**

### 3.2 Erweiterbarkeit — **klar für die Trennung**
Neue Identitätsdimensionen (siehe §5: Fahrzeugumlauf, Teilumlauf) werden zu
**additiven Geschwisterfeldern** an der Aktivität — ohne Änderung bestehender
Strukturen (Open/Closed auf Datenmodell-Ebene). Das Sammelobjekt müsste dagegen
immer weitere optionale Felder und `kind`-Werte aufnehmen und würde zum
Gott-Objekt. Zusätzlich bleibt `routeIdentity.kind` sauber auf **Route-Notationen**
beschränkt (LINE_COURSE, LINE_TRIP, künftig weitere) — ohne Vermischung mit
Dienst/Umlauf. **Sieger: Trennung.**

### 3.3 Wartbarkeit — **klar für die Trennung**
Hohe Kohäsion je Objekt; Konsumenten deklarieren **explizit**, was sie brauchen
(Block 9 → nur `routeIdentity`; Dienstübersicht → Dienst/Umlauf). Kopplungsfehler
(ein Route-Konsument liest versehentlich `dienst`) werden strukturell unmöglich.
Weniger implizite Invarianten = weniger Fehlerquellen. Die zentrale Normalisierung
bleibt in beiden Modellen gleich aufwändig; nur die **Downstream**-Wartbarkeit ist
mit der Trennung besser. **Sieger: Trennung.**

### 3.4 Kompatibilität — **beide additiv, Trennung fügt sich sauberer ein**
Beide Modelle sind additive Aktivitätsfelder (wie `activityType`) und damit ohne
Refactoring mit der eingefrorenen Architektur verträglich. Im Detail:

| Komponente | Wirkung | Bewertung |
|---|---|---|
| **CanonicalSchedule** | `circuitNumber` (roh) bleibt; Normalisierer ergänzt `routeIdentity`/`serviceIdentity` additiv | ✅ keine Änderung am Aufbau |
| **AnalysisCore** | liest heute `activityType`, Zeiten, `paidTime` — keine Kennung; bleibt notationsblind, liest bei Bedarf nur die semantischen Felder | ✅ unberührt |
| **CheckRunner** | modul-agnostisch; ein Check liest je nach Bedarf `routeIdentity` **oder** `service.serviceNumber`/`serviceIdentity` | ✅ Runner unverändert |
| **Review Dashboard** | gruppiert je Dienst (`affectedServices` → Dienstnummer) → ServiceIdentity-Domäne | ✅ passt zur Trennung |
| **Check Explorer** | filtert CheckResults (u. a. Dienstnummer); Route nicht nötig | ✅ unberührt |
| **Legacy Migration** | `groupLegacyRoutes` liest künftig `routeIdentity.normalizedKey`; Reserve/Schicht/geteilt lesen weiterhin `serviceNumber` | ✅ saubere Zuordnung |

Zusätzlicher Kompatibilitätsgewinn: Das **WAGENKARTE-Referenzmodell** trennt Linie
und Kurs bereits (`trip.line`, `trip.course`) — die `routeIdentity` bringt die
CanonicalSchedule-Aktivität mit diesem Route-Begriff **in Deckung** (dieselbe
`kind`-Verfeinerung LINE_TRIP für JES gehört auch dorthin). **Leichter Vorteil:
Trennung.**

**Ergebnis:** In allen vier Kriterien ist die Trennung mindestens gleichwertig, in
dreien klar überlegen; das Sammelobjekt gewinnt in keinem.

---

## 4. Block 9 vs. Dienstübersicht — die Konsumenten-Trennung

Die Frage bestätigt die Trennung direkt:

- **Block 9 „Dienste nach Linie/Kurs" braucht ausschließlich `routeIdentity`.** Es
  gruppiert nach Fahrweg (`routeIdentity.normalizedKey`, beschränkt auf
  `kind ∈ {LINE_COURSE, LINE_TRIP}`). Für den JES-Übergang ist `routeIdentity`
  **abwesend** → Block 9 liefert aus diesen Aktivitäten korrekt nichts (die Linie
  steckt nicht in `7511`; sie kommt erst aus der Wagenkarte). Mit der Trennung kann
  Block 9 Dienst/Umlauf **strukturell nicht** versehentlich als Route missdeuten.
- **Dienstübersicht lebt in der ServiceIdentity-Domäne** (Dienst/Umlauf). Primärer
  Dienstschlüssel ist `service.serviceNumber` (Autorität, s. §6); `serviceIdentity`
  ergänzt den **Umlauf** und trägt im JES-Übergang die geparste `7511 → 751/1`-Sicht.

Diese saubere, gegensätzliche Abhängigkeit (Block 9 ⟂ Dienstübersicht) ist mit dem
Sammelobjekt nur per Disziplin, mit der Trennung **per Struktur** garantiert.

---

## 5. Zukünftige Erweiterungen ohne Architekturänderung

„Fahrzeugumlauf" und „Teilumlauf" sind **weitere, eigenständige Identitäts­
dimensionen** (Fahrzeug-Rotation bzw. Teil-Rotation), die weder Route noch
Dienstzugehörigkeit sind. Mit dem etablierten Muster gilt:

> **Jede orthogonale Identitätsdimension = ein eigenes, additives Identity-Objekt an
> der Aktivität, erzeugt vom zentralen Normalisierer, gelesen nur von den
> Komponenten, die es brauchen.**

Ein späterer `activity.vehicleRotationIdentity` (oder eine additive Erweiterung von
`serviceIdentity` um `teilumlauf`) ist damit ein **rein additiver** Schritt —
keine Architekturänderung, keine Anpassung bestehender Konsumenten. Beim
Sammelobjekt hingegen würde jede neue Dimension das eine Objekt weiter aufblähen
und neue `kind`-Werte erzwingen — Modifikation statt Erweiterung. **Die Trennung
hält die Erweiterungswege offen.**

---

## 6. Gegenargumente (fair geprüft und entkräftet)

1. **„Zwei Objekte = mehr Null-Prüfungen/Verbosität."** Für eine Aktivität mit nur
   einer Dimension ist das *andere* Feld schlicht abwesend — sauberer als ein Objekt,
   dessen halbe Felder je nach `kind` null sind. Konsumenten berühren ohnehin nur das
   Feld, das sie brauchen. **Kein stichhaltiger Nachteil.**
2. **„`serviceIdentity.dienst` dupliziert `service.serviceNumber`."** Zutreffend und
   **bewusst**: `service.serviceNumber` bleibt die **Autorität** für den Dienst;
   `serviceIdentity` ist die aus dem Kennungsfeld **geparste Sicht** (liefert v. a.
   den **Umlauf** und ermöglicht einen Konsistenzabgleich Aktivität↔Dienstkopf). Wer
   die Redundanz ganz vermeiden will, könnte `dienst` weglassen und nur
   `{ raw, umlauf, normalizedKey }` führen — die Empfehlung behält `dienst` für
   Quelltreue und Prüfbarkeit. **Kein Modellfehler, dokumentierte Redundanz.**
3. **„Verfrühte Abstraktion (YAGNI)."** Nein: Der JES-Übergang verlangt **heute
   schon**, ServiceIdentity **ohne** RouteIdentity abzubilden. Beide Konzepte
   koexistieren bereits unabhängig in den realen Daten. Die Trennung löst ein
   **gegenwärtiges**, konkretes Problem, keine Hypothese. **Entkräftet.**
4. **„Namenskollision `service` vs. `serviceIdentity`."** Milder Wermutstropfen; die
   Konzepte sind verwandt (beide identifizieren die Dienst-/Umlaufebene) und der Name
   ist eindeutig genug. Alternativ `dutyIdentity`. **Nicht entscheidungsrelevant.**

---

## 7. Präzisierungen des einzufrierenden Modells

1. **Präsenz-Semantik ersetzt den Diskriminator:** `routeIdentity` existiert ⇔
   Fahrweg vorhanden; `serviceIdentity` existiert ⇔ Kennung nennt Dienst/Umlauf. Der
   Wert `kind: DIENST_UMLAUF` entfällt ersatzlos.
2. **`kind` nur in `routeIdentity`**, Wertebereich `{ LINE_COURSE, LINE_TRIP,
   UNKNOWN }` (reine Route-Notationen). `serviceIdentity` braucht vorerst **kein**
   `kind` (einzige Form); ein späteres `kind` wäre additiv.
3. **`normalizedKey` je Objekt, nie objektübergreifend verglichen.** Innerhalb
   `routeIdentity` mit `kind` präfigiert (z. B. `LC:12|1`, `LT:412|16`), damit
   Linie/Kurs und Linie/Fahrt nicht kollidieren. `12/1` und `12100` ⇒ gleicher
   `LC:12|1` (Äquivalenz). `serviceIdentity` z. B. `DU:751|1`.
4. **Autoritäten:** `service.serviceNumber` = Dienst-Autorität; `activity.routeIdentity`
   = Fahrweg-Autorität; `activity.serviceIdentity` = geparste Dienst/Umlauf-Sicht der
   Aktivitätskennung.
5. **Eine zentrale Normalisierung** (betriebsparametriert) erzeugt aus roher Kennung
   + Betrieb **genau eines** der beiden Objekte. `AnalysisCore`/`CheckRunner` bleiben
   notationsblind und lesen nur die semantischen Felder.

---

## 8. Endgültige Empfehlung

**Einzufrieren: die Trennung `activity.routeIdentity` + `activity.serviceIdentity`**
gemäß §0/§7. Sie ist in semantischer Korrektheit, Erweiterbarkeit und Wartbarkeit
überlegen, in der Kompatibilität mindestens gleichwertig, und sie ist die einzige
der beiden Varianten, die die orthogonalen Konzepte Fahrweg und Dienstzugehörigkeit
**strukturell** trennt — heute für den JES-Übergang notwendig, morgen offen für
Fahrzeugumlauf/Teilumlauf ohne Architekturänderung.

Das Sammelobjekt `activity.route` (mit `dienst`/`umlauf`/`DIENST_UMLAUF`) wird
**verworfen**.

> Einordnung: Diese Entscheidung präzisiert `docs/route-notation-normalization.md`
> (dort `activity.route` → hier final `routeIdentity`/`serviceIdentity`) und bleibt
> im Rahmen von Priorität D2 des `v1-release-readiness-audit.md`. Kein Code, keine
> Struktur wurde erzeugt.
