# Testkonzept – Calculator API & UI (TypeScript)

## 1. Zielsetzung

Dieses Dokument beschreibt das Konzept für die automatisierte Testung der **Calculator API** (TypeScript, Node.js ≥ 24, Express 5) und der darauf aufsetzenden **Calculator UI** (React 19, Vite 8). Ziel ist die Absicherung der fachlichen Korrektheit, der Eingabevalidierung und des API-Vertrags durch automatisierte **Black-Box-API-Tests mit Playwright** (`@playwright/test`, `APIRequestContext`) gegen die laufende Anwendung, ergänzt um **Unit- und In-Process-Tests mit Vitest/Supertest** im API-Repository, **Komponenten-/Integrationstests mit Vitest, Testing Library und MSW** im UI-Repository sowie **Black-Box-UI-Tests (E2E) mit Playwright im Browser** gegen die laufende UI + API – ausgeführt in CI-Pipelines über **GitHub Actions**.

Die Tests verteilen sich auf vier Repositories:

| Repository | Inhalt | Werkzeuge |
|---|---|---|
| `calculator_api_ts` (API-Repo) | Anwendung, Unit-Tests (Service, Validierung), In-Process-API-Tests | Vitest, Supertest |
| `calculator_api_test_ts` (API-Test-Repo) | Black-Box-API-Tests gegen eine laufende API-Instanz | Playwright Test (`APIRequestContext`) |
| `calculator_ui_ts` (UI-Repo) | React-Oberfläche, Unit-/Komponenten-/Integrationstests mit emulierter API | Vitest, Testing Library, MSW |
| `calculator_ui_tests_ts` (UI-Test-Repo) | Black-Box-UI-Tests (E2E) im Browser gegen laufende UI + API | Playwright Test (Chromium), Page Object Model |

## 2. Testgegenstand

### 2.1 Calculator API

Die Calculator API stellt vier REST-Endpunkte bereit:

| Endpunkt | Methode | Operation |
|---|---|---|
| `/api/calculate/add` | POST | Addition |
| `/api/calculate/subtract` | POST | Subtraktion |
| `/api/calculate/multiply` | POST | Multiplikation |
| `/api/calculate/divide` | POST | Division |

**Request-Body:** `{ "numbers": [zahl, zahl, ...] }` – ein Array mit **mindestens zwei** Operanden (`MIN_OPERANDS = 2`, `src/types/calculator.types.ts`), alle als JSON-Zahl; keine explizite Obergrenze (begrenzt durch das Body-Limit von 10 kB). Die Operanden werden **links-assoziativ** verknüpft (`((n1 ∘ n2) ∘ n3) ∘ …`), z. B. `subtract [10, 4, 3] = 3`, `divide [100, 5, 2] = 10`.

**Response (200):** `{ "operation": string, "numbers": number[], "result": number }` – `numbers` spiegelt die Eingabe unverändert (Reihenfolge und Anzahl).

**Fehlerantwort:** `{ "error": string }` mit folgenden Statuscodes:

| Status | Ursache | `error`-Text |
|---|---|---|
| 400 | Ungültiger Body (`numbers` fehlt, kein Array, weniger als zwei Elemente, Element keine endliche Zahl oder außerhalb des Wertebereichs; auch das frühere Format `{ "a", "b" }`) | `Body must contain an array numbers with at least two finite numbers within the decimal range` |
| 400 | Syntaktisch ungültiges JSON | `Invalid JSON body` |
| 400 | Division durch null (an beliebiger Divisor-Position) | `Division by zero is not allowed` |
| 400 | Arithmetischer Überlauf (in einem beliebigen Rechenschritt) | `Arithmetic overflow: result exceeds the decimal range` |
| 404 | Unbekannte Route oder nicht unterstützte HTTP-Methode | `Not found` |
| 413 | Body größer als 10 kB (`express.json({ limit: "10kb" })`) | `Request rejected` |
| 500 | Unerwarteter Fehler | `Internal server error` |

**Zahlentyp:** Die Operanden werden vom JSON-Parser als JavaScript-`number` (IEEE-754 double) gelesen und anschließend in eine `Decimal`-Instanz (`decimal.js`, Konfiguration `CalcDecimal`) überführt, die `System.Decimal` nachbildet: 29 signifikante Stellen, maximal 28 Nachkommastellen, Rundung *half away from zero* (`ROUND_HALF_UP`), Wertebereich ±79228162514264337593543950335 (≈ ±7,9 × 10²⁸, `DECIMAL_MAX_ABS`). Die Berechnung erfolgt exakt dezimal ohne binäre Gleitkomma-Rundungsfehler. Das Ergebnis wird **nicht** über `JSON.stringify` serialisiert (das würde auf double-Genauigkeit runden), sondern als handgebauter JSON-String mit der vollen `Decimal`-Genauigkeit ausgegeben.

Operanden, die nicht endlich sind oder außerhalb des `Decimal`-Wertebereichs liegen (z. B. `1e308`), werden von der Eingabevalidierung mit 400 abgelehnt. Da JSON-Zahlen als double ankommen, ist `decimal.MaxValue` (2⁹⁶ − 1) über die API **nicht exakt** darstellbar – das nächstgelegene double ist 2⁹⁶ und liegt bereits außerhalb des Bereichs.

Der `CalculatorService` (`src/services/calculator.service.ts`) ist **variadisch** (`a, b, ...rest`, links-assoziativ ausgewertet, Überlaufprüfung nach jedem Schritt, Null-Divisor-Prüfung an jeder Position). Die HTTP-Schnittstelle reicht das `numbers`-Array vollständig an den Service durch (`calculate(a, b, ...rest)`); damit sind die variadischen Fälle auf allen Testebenen (Unit, API, UI) prüfbar. Fälle mit `MaxValue`/`MinValue` als Operand bleiben Unit-Ebene (siehe Kap. 4.2).

Zusätzlich stellt die API einen Health-Endpoint `GET /health` bereit (`200`, `{ "status": "ok" }`), der von der UI (Status-Anzeige), den Test-Repos (`globalSetup`) und der CI als Erreichbarkeits-Probe genutzt wird.

### 2.2 Calculator UI

Die Calculator UI (`calculator_ui_ts`) ist eine Single-Page-Anwendung (React 19, TypeScript strict, Vite 8, React Router, TanStack Query, zod) mit genau einer fachlichen Seite (Route `/`) und einer Catch-all-Route (`*`, „Seite nicht gefunden“). Sie sendet **zwei oder mehr Operanden** als `{ "numbers": [...] }` an `POST /api/calculate/{operation}` und zeigt das Ergebnis **exakt** so an, wie die API es liefert.

| Element | Verhalten |
|---|---|
| Kopfzeile | Überschrift `Calculator` (h1), Seitentitel `Calculator`; API-Status-Anzeige (`role="status"`, `data-status`): `API wird geprüft…` → `API erreichbar` / `API nicht erreichbar` (Health-Poll, Standard 30 s) |
| Eingabefelder `Zahl 1` … `Zahl n` (Gruppe `Zahlen`) | Dynamische Liste von Textfeldern (`inputMode="decimal"`, bewusst nicht `type="number"`); initial genau zwei Felder (`MIN_OPERANDS = 2`); Komma wird als Dezimaltrennzeichen akzeptiert; Autofokus auf `Zahl 1` |
| Button `Zahl hinzufügen` | Fügt ein weiteres Feld am Ende hinzu (fortlaufende Nummerierung) und setzt den Fokus darauf |
| Buttons `Zahl n entfernen` | Nur sichtbar, solange mehr als zwei Felder vorhanden sind (einer je Feld); entfernt das jeweilige Feld, die übrigen Werte bleiben erhalten (stabile Feld-IDs, keine Verschiebung); das Minimum von zwei Feldern kann nicht unterschritten werden |
| Operation | Radiogruppe `Operation` mit `Addieren` (+), `Subtrahieren` (−), `Multiplizieren` (×), `Dividieren` (÷); Vorauswahl `Addieren`; gilt für alle Operanden (links-assoziativ) |
| Button `Berechnen` | Löst die Berechnung aus; während der Anfrage: Text `Berechne…`, Button, alle Felder, `Zahl hinzufügen`/`entfernen` und Radiogruppe deaktiviert, Formular `aria-busy="true"` |
| Clientseitige Validierung | Vor dem API-Aufruf **je Feld**: leer/Leerzeichen → `Bitte eine Zahl eingeben`; kein Dezimal-/Exponentialliteral (Text, Hex, `Infinity`, `1.2.3`) → `Ungültige Zahl`; nicht endlich (z. B. `1e999`) → `Zahl ist zu groß`. Fehler als `role="alert"` unter dem Feld, `aria-invalid="true"`, verschwinden bei Bearbeitung des Feldes. Bei Validierungsfehlern wird **kein** Request gesendet. |
| Ergebnis-Panel (`region` „Ergebnis“, `aria-live`) | Idle: `Gib zwei Zahlen ein und wähle eine Operation.`; Pending: `Berechnung läuft…`; Erfolg: Ausdruck `n1 <Symbol> n2 <Symbol> … =` und exakter Ergebniswert (`data-testid="result-value"`); Fehler: `role="alert"` mit Fehlertext |
| Fehlertexte | API-Fehlervertrag `{ "error" }` wird unverändert angezeigt (z. B. `Division by zero is not allowed`); Transportfehler und Gateway-Antworten 502/503/504 ohne API-Body → `Die API ist nicht erreichbar`; 2xx mit ungültigem Body → `Unerwartete Antwort der API` |
| Verlauf | Erscheint nach der ersten erfolgreichen Berechnung (Überschrift `Verlauf`, Button `Leeren`); Einträge `n1 <Symbol> n2 <Symbol> … =<Ergebnis>`, neueste zuerst, maximal `VITE_HISTORY_LIMIT` (Standard 10); fehlgeschlagene Berechnungen werden nicht aufgenommen |
| Unbekannte Route | Überschrift `Seite nicht gefunden`, Link `Zurück zum Rechner` nach `/` |

**Zahlentyp in der UI:** Jeder Operand wird per `Number()` geparst (nur Dezimal-/Exponentialliterale, Komma → Punkt) und das Array als JSON-Zahlen gesendet; `-0` wird dabei als `0` serialisiert. Das Ergebnis wird aus dem **rohen Response-Text** extrahiert (`parse-calculation-response.ts`, zod-Schema mit `numbers: z.array(z.number()).min(2)`) und als String geführt, da `JSON.parse` die 28-stellige `Decimal`-Ausgabe auf double-Genauigkeit runden würde. Die UI ist damit ein zweiter Konsument des API-Vertrags; Wertebereich, Division durch null, Überlauf und Mindestanzahl bleiben Aufgabe der API („Quelle der Wahrheit“).

**Anbindung:** Im Dev-Server und in `vite preview` werden `/api` und `/health` per Proxy an die API weitergeleitet (`API_PROXY_TARGET`, Standard `http://localhost:3000`), sodass die UI Same-Origin-Requests nutzt und die API keine CORS-Header benötigt.

## 3. Teststrategie

### 3.1 Testebenen und Werkzeuge

Die Testpyramide besteht aus fünf Ebenen, von schnell/feingranular nach langsam/realitätsnah:

- **Unit-Tests (White-Box)** – API-Repo, `tests/calculator.service.test.ts` und `tests/calculator.validation.test.ts` (Vitest):
  - Rechenlogik des `CalculatorService`: alle vier Operationen inkl. variadischer Operanden, Präzision, Rundung, Überlauf, Division durch null, Fehlerklassen-Hierarchie (`CalculationError` → `DivisionByZeroError` / `OverflowError`).
  - Eingabevalidierung `isCalculationRequest`: Typ-, Struktur- und Wertebereichsprüfung des Request-Bodys (`numbers`-Array, Mindestanzahl, jedes Element), inkl. Werten, die über JSON gar nicht transportierbar sind (`NaN`, `Infinity`, `undefined`, Boolean).
- **In-Process-API-Tests (Grey-Box)** – API-Repo, `tests/calculator.routes.test.ts` (Vitest + **Supertest**): Die Express-App (`src/app.ts`) wird direkt eingebunden – kein laufender Server, kein Port, keine Basis-URL. Schnelles Feedback für Routing, Middleware und Fehlerbehandlung innerhalb des API-Repos (PR-Gate).
- **Black-Box-API-Tests (E2E)** – API-Test-Repo `calculator_api_test_ts`, `tests/calculator.spec.ts` (**Playwright Test**, `request`-Fixture / `APIRequestContext`, kein Browser nötig): Tests gegen eine **extern betriebene** API-Instanz über echtes HTTP. Die Basis-URL ist über die Umgebungsvariable `API_BASE_URL` konfigurierbar (Standard: `http://localhost:3000`). Ein `globalSetup` prüft vor dem Lauf `GET /health`; ist die API nicht erreichbar, bricht der Lauf mit einer klaren Fehlermeldung ab (kein „grün ohne Tests“). Ausführung parallel (`fullyParallel`), ohne Retries.
- **UI-Unit-/Komponenten-/Integrationstests (White-/Grey-Box)** – UI-Repo `calculator_ui_ts`, `tests/**/*.test.ts(x)` (Vitest, jsdom, **Testing Library**, **MSW**): reine Funktionen (`parseOperand`, `parseCalculationResponse`, `createEnv`), der generische `api-client` (Fehlerübersetzung in `ApiError`/`NetworkError`/`InvalidResponseError`), Request-Funktionen sowie die Komponente `Calculator` mit vollständiger Benutzerinteraktion (inkl. Hinzufügen/Entfernen von Operandenfeldern und variadischer Berechnung). Die API wird durch MSW-Handler emuliert, die den `numbers`-Vertrag und die `Decimal`-Semantik nachbilden (`decimal.js`, 29 signifikante Stellen, links-assoziative Reduktion); unbehandelte Requests schlagen fehl. Kein laufender Server, kein Browser (PR-Gate des UI-Repos).
- **Black-Box-UI-Tests (E2E)** – UI-Test-Repo `calculator_ui_tests_ts`, `tests/0*_*.spec.ts` (**Playwright Test**, Chromium, Firefox/WebKit konfigurierbar): Tests im echten Browser gegen eine **extern betriebene** UI (`UI_BASE_URL`, Standard `http://localhost:5173`), die ihrerseits mit der laufenden API (`API_BASE_URL`) spricht. Architektur nach dem Vorbild des Frameworks *E2E-Tests-PA-Leadmanagement*:
  - **Page Object Model** mit getrennten Selector-Klassen (`pages/calculator/CalculatorPage.ts`, Komponenten `calculatorForm`, `resultPanel`, `history`, `apiStatus` jeweils als `Get*`/`Set*`/`Is*`-Klassen; `pages/notFound/NotFoundPage.ts`), erzeugt über eine `PageObjectFactory`.
  - **Modulare Test-Schritte** (`tests/steps/**`, Basisklasse `BaseTestStep`, gekapselt in `test.step()`), die Assertions sammeln und über einen `AssertionReporter` als JSON-Anhänge in den Report schreiben (inkl. Summary-Report).
  - **Datengetrieben**: je Spec eine JSON-Datei pro Umgebung (`data/<gruppe>TestData/<gruppe>_Dev.json` / `_Staging.json`, Auswahl über `TEST_ENVIRONMENT`), geladen über `TestDataManager`/`TestCaseRunner` mit Template-Variablen (`{{BASE_URL}}`, `{{dateNow}}`, `{{currentDateDE}}`). Jeder Datensatz wird zu einem eigenen Playwright-Test; Testfall-ID und Prioritäts-Tags stammen aus den Daten. Operanden sind als String-Array (`"operands": ["10", "4", "3"]`) hinterlegt; der Schritt `EnterOperandsTestStep` fügt über `Zahl hinzufügen` so viele Felder hinzu, wie der Datensatz benötigt.
  - **API-Orakel**: Für Happy-Path- und Präzisionsfälle ruft der Schritt `ApiOracleVerificationTestStep` dieselbe Berechnung über `api/service/calculatorService/CalculatorService.ts` (Playwright `APIRequestContext`, Body `{ numbers }`) auf und vergleicht das rohe `result`-Literal der API mit dem in der UI gerenderten Text.
  - **Netzwerk-Simulation** über `page.route()` (`utils/networkManager/ApiRouteManager.ts`): Abbruch von Requests (Offline-API), erzwungene Statuscodes (Gateway-Fehler ohne API-Body) und verzögerte Antworten (Pending-Zustand); zusätzlich Aufzeichnung ausgehender `/api/calculate/`-Requests für den Nachweis „kein API-Aufruf bei Client-Validierung“.
  - Ein `globalSetup` prüft `GET /health` (API) **und** `GET /` (UI) und bricht bei Nichterreichbarkeit ab. Ausführung parallel mit 2 Workern; Retries `0` lokal, `1` in CI (Trace `on-first-retry`, Screenshot/Video nur bei Fehlern).

Für Präzisionsfälle wird auf allen drei Black-/Grey-Box-Ebenen (Supertest `res.text`, Playwright `response.text()`, UI-Textinhalt von `result-value`) der exakte String verglichen, da `JSON.parse` das 28-stellige Ergebnis auf double-Genauigkeit runden würde.

- **Technologie:** TypeScript 7 (UI-Repo: TypeScript 6), **Vitest 5**, **Supertest 7**, **Testing Library**, **MSW 2**, **Playwright 1.63**, Linting mit **oxlint** (API-, UI- und UI-Test-Repo), Typprüfung mit `tsc --noEmit` (alle Repos).
- **Ausführung:** API-Repo `npm test` (`vitest run`), Watch-Modus `npm run test:watch`; UI-Repo `npm test` (`vitest run`); API-Test-Repo `npm test` (`playwright test`) bei laufender API; UI-Test-Repo `npm test` (`playwright test`) bei laufender API **und** UI.

### 3.2 Testarten

| Testart | Abdeckung | Ebene |
|---|---|---|
| Unit-Tests (Service) | Rechenlogik des `CalculatorService` inkl. variadischer Operanden, Rundung, Überlauf und Ausnahmefälle | Unit |
| Unit-Tests (Validierung) | `isCalculationRequest`: Body-Struktur, Operandentypen, Wertebereich | Unit |
| Funktionale Tests (Happy Path) | Korrekte Ergebnisse aller vier Operationen über HTTP bzw. über die Oberfläche | Supertest + Playwright (API) + Playwright (UI) |
| Negativtests | Division durch null, Überlauf, ungültige/unvollständige Eingaben; Anzeige der API-Fehlertexte in der UI | Supertest + Playwright (API) + Playwright (UI) |
| Vertragstests | Response-Struktur, Statuscodes, Content-Type, Header | Supertest + Playwright (API) |
| Robustheitstests | Ungültiges JSON, falscher Content-Type, Body-Limit, falsche HTTP-Methode, unbekannte Routen | Supertest + Playwright (API) |
| UI-Unit-/Komponententests | `parseOperand`, `parseCalculationResponse`, `createEnv`, `api-client`-Fehlerübersetzung, `Calculator`-Komponente mit MSW-emulierter API | Vitest + Testing Library + MSW (UI-Repo) |
| Clientseitige Validierungstests | Feldfehler (`Bitte eine Zahl eingeben`, `Ungültige Zahl`, `Zahl ist zu groß`), `aria-invalid`, kein API-Aufruf, Fehler verschwindet bei Eingabe | Playwright (UI) |
| UI-Verhaltenstests | Initialzustand, API-Status-Anzeige, Netzwerk-/Gateway-Fehler, Pending-Zustand (deaktiviertes Formular), Verlauf (Reihenfolge, Limit, Leeren), 404-Route | Playwright (UI) |
| Konsistenztests (API-Orakel) | UI-Anzeige entspricht exakt dem `result`-Literal der API | Playwright (UI) |

### 3.3 Testentwurfsverfahren

Die Testfälle in Kapitel 4 wurden mit folgenden Black-Box-Testentwurfsverfahren (gemäß ISTQB) abgeleitet:

| Verfahren | Anwendung |
|---|---|
| Äquivalenzklassenbildung | Gültige Eingaben (`numbers`-Array mit ≥ 2 endlichen Zahlen im Wertebereich; positive/negative/dezimale Werte; 2 vs. mehr als 2 Operanden) vs. ungültige Eingaben (`numbers` fehlt oder ist kein Array, weniger als 2 Elemente, Element mit falschem Typ/`null`, Array statt Objekt, leerer Body, ungültiges JSON, Werte außerhalb des Bereichs, veraltetes `{ a, b }`-Format). UI: gültige Eingabetexte (Dezimal-/Exponentialliteral, Komma oder Punkt) vs. ungültige Klassen (leer/Leerzeichen, Text, Hexadezimal, `Infinity`, mehrere Trennzeichen, nicht endlich) – je Klasse ein Feldfehlertext, je Feld unabhängig |
| Grenzwertanalyse | Divisor 0 und −0 (an erster und späterer Position); Mindestanzahl Operanden (1 → 400, 2 → OK, leeres Array → 400); Zahlbereichsgrenzen von `Decimal` (`MaxValue` ± 1, `MinValue` − 1, Werte außerhalb des Bereichs wie `1e308`); 28. Nachkommastelle (Rundung); Body-Limit 10 kB. UI: Minimum von zwei Eingabefeldern (Entfernen-Buttons verschwinden), Verlaufslimit 10 (11 Berechnungen → 10 Einträge), Grenze endlich/nicht endlich (`1e308` wird gesendet, `1e999` clientseitig abgelehnt) |
| Zustandsinduzierte Tests (State Transition) | UI-Zustände des Ergebnis-Panels idle → pending → success/error, Formular aktiv ↔ deaktiviert, Operandenliste 2 → n → 2 Felder, Verlauf leer → gefüllt → geleert, Feldfehler gesetzt → bei Eingabe gelöscht, API-Status checking → online/offline |
| Zustandsunabhängige Vertragsprüfung | Response-Struktur (`operation`, `numbers`, `result`), Spiegelung der Operanden, Statuscodes, HTTP-Methoden, Routen, Header |
| Fehlererwartungsmethode (Error Guessing) | Dezimalpräzision (0.1 + 0.2 muss exakt 0.3 ergeben, auch über mehrere Schritte), periodische Ergebnisse (1/3, 2/3), Überlauf in einem späteren Rechenschritt, Zusatzfelder im Body, `JSON.stringify`-Rundung des Ergebnisses, Links-Assoziativität bei Subtraktion/Division; UI: Rundung des Ergebnisses durch `JSON.parse`, Komma als Dezimaltrennzeichen, Werteverschiebung beim Entfernen eines mittleren Feldes, Gateway-Antworten ohne API-Body, fehlgeschlagene Berechnungen im Verlauf |
| Use-Case-basierte Tests | Vollständiger Benutzerablauf in der UI: Seite öffnen → ggf. Felder hinzufügen → Operanden eingeben → Operation wählen → berechnen → Ergebnis, Ausdruck und Verlauf prüfen |

### 3.4 Risikobasierte Priorisierung

Jeder Testfallgruppe ist eine Priorität zugeordnet, die die Ausführungs- und Behebungsreihenfolge bestimmt:

| Priorität | Testfallgruppen | Begründung |
|---|---|---|
| Hoch | 4.1 Happy Path, 4.3 Division durch null, 4.4 Eingabevalidierung, 4.6 Clientseitige Validierung (UI), 4.7 TC-UI-OPS-01 (Operandenfelder hinzufügen/entfernen) | Kernfunktionalität und Fehlerbehandlung; Fehler hier betreffen alle Nutzer direkt |
| Mittel | 4.2 Dezimal-Randfälle, 4.5 API-Vertrag, 4.7 UI-Verhalten (übrige Fälle) | Randbedingungen, Vertragsstabilität und Komfortfunktionen (Status, Verlauf, Navigation); geringere Eintrittswahrscheinlichkeit |

Die Prioritäten sind im Testcode hinterlegt:

- **API-Test-Repo (Playwright):** als Tags an den `describe`-Blöcken (`@prio-hoch` / `@prio-mittel`), filterbar über `--grep` bzw. die Scripts `npm run test:prio-hoch` / `npm run test:prio-mittel`.
- **UI-Test-Repo (Playwright):** als Tags **je Testfall** im Feld `tags` der JSON-Testdaten (`"tags": ["@prio-hoch"]`), die an die `tag`-Option von `test()` übergeben werden; gleiche Scripts wie im API-Test-Repo.
- **API-Repo (Vitest):** über die Kapitelnummer der Testfallgruppe im `describe`-Namen (z. B. `4.1 Happy Path – …`), filterbar über den Namensfilter.

```powershell
# API-Test-Repo und UI-Test-Repo
npx playwright test --grep @prio-hoch
# API-Repo
npx vitest run -t "4.1|4.3|4.4"
```

### 3.5 Nicht im Scope

- Last-/Performancetests
- Security-Tests (AuthN/AuthZ ist nicht implementiert)
- Visuelle Regressionstests (Screenshot-Vergleiche), Cross-Browser-Matrix (nur Chromium aktiv; Firefox/WebKit in `playwright.config.ts` vorbereitet) und automatisierte Accessibility-Audits (z. B. axe) – barrierefreie Attribute werden nur funktional über Rollen-/Label-Locators genutzt
- Dark Mode / responsive Layout (`prefers-color-scheme`, Viewports)
- Tests des Server-Bootstraps (`src/server.ts`, Port-Auflösung) und des UI-Bootstraps (`main.tsx`, Build-Konfiguration) – wird über den manuellen Start (`npm run dev` / `npm start` / `vite preview`) abgedeckt
- Health-Polling-Intervall der UI (30 s) – nur der initiale Status wird geprüft

## 4. Testfälle

Die Spalte **Ebene** gibt an, auf welcher Testebene ein Testfall umgesetzt ist: **API** = sowohl In-Process (Supertest, API-Repo) als auch Black-Box (Playwright, API-Test-Repo); **UI** = Black-Box im Browser über die Oberfläche (Playwright, UI-Test-Repo); **Unit** = direkter Aufruf des Services bzw. der Validierung (API-Repo). Variadische Fälle (mehr als zwei Operanden) sind auf allen Ebenen umgesetzt; nur Fälle mit `MaxValue`/`MinValue` als Operand bleiben Unit-Ebene, da diese Werte als JSON-Zahl nicht exakt darstellbar sind. Fälle, die nur über die Struktur des HTTP-Requests auslösbar sind (Body-Struktur, Content-Type, HTTP-Methode, Header), sind über die UI nicht erreichbar und bleiben API-Ebene. UI-spezifische Fälle tragen das Präfix `TC-UI-`.

Auf UI-Ebene folgt jeder Fall der Gruppen 4.1–4.4 demselben Ablauf: Rechner-Seite öffnen → bei mehr als zwei Operanden Felder über `Zahl hinzufügen` ergänzen → Operanden eingeben → Operation wählen → `Berechnen` → Ergebnis-Panel prüfen. Bei Erfolg werden zusätzlich der Ausdruck (`n1 <Symbol> n2 <Symbol> … =`), der Verlaufseintrag (`… =<Ergebnis>`) und die Übereinstimmung mit dem rohen API-Ergebnis (Orakel) geprüft; bei API-Fehlern, dass der Fehlertext als Alert erscheint und weder Ergebniswert noch Verlaufseintrag entstehen.

### 4.1 Happy Path – Grundrechenarten (erwartet: 200 OK)

| ID | Operation | Eingabe (`numbers`) | Erwartetes Ergebnis | Ebene |
|---|---|---|---|---|
| TC-ADD-01 | add | 1, 2 | 3 | API + UI + Unit |
| TC-ADD-02 | add | 1, 2, 3, 4 | 10 (variadisch) | API + UI + Unit |
| TC-ADD-03 | add | −5, 2.5 | −2.5 (negative & dezimale Zahlen) | API + UI + Unit |
| TC-SUB-01 | subtract | 10, 4 | 6 | API + UI + Unit |
| TC-SUB-02 | subtract | 10, 4, 3 | 3 (links-assoziativ) | API + UI + Unit |
| TC-SUB-03 | subtract | −1, −1 | 0 | API + UI + Unit |
| TC-MUL-01 | multiply | 3, 4 | 12 | API + UI + Unit |
| TC-MUL-02 | multiply | 2, 3, 4 | 24 (variadisch) | API + UI + Unit |
| TC-MUL-03 | multiply | 5, 0 | 0 | API + UI + Unit |
| TC-MUL-04 | multiply | −2, 2.5 | −5 | API + UI + Unit |
| TC-DIV-01 | divide | 10, 4 | 2.5 | API + UI + Unit |
| TC-DIV-02 | divide | 100, 5, 2 | 10 (verkettete Division, links-assoziativ) | API + UI + Unit |
| TC-DIV-03 | divide | −9, 3 | −3 | API + UI + Unit |
| TC-DIV-04 | divide | 0, 5 | 0 (Dividend null ist erlaubt) | API + UI + Unit |

Die API-Tests prüfen zusätzlich, dass das Eingabe-Array `numbers` unverändert (Reihenfolge und Anzahl) in der Response gespiegelt wird (siehe auch TC-CON-08). Die UI-Tests prüfen zusätzlich den Ausdruck mit Operationssymbolen (`1 + 2 + 3 + 4 =`, `10 − 4 − 3 =`, `3 × 4 =`, `100 ÷ 5 ÷ 2 =`) und den Verlaufseintrag.

### 4.2 Dezimal-Randfälle (Präzision, Rundung und Zahlenbereich)

| ID | Operation | Eingabe | Erwartung | Ebene |
|---|---|---|---|---|
| TC-DEC-01 | add | 0.1, 0.2 | 200, Ergebnis **exakt** 0.3 (kein Toleranzvergleich; bei `double` wäre 0.30000000000000004 herausgekommen) | API + UI + Unit |
| TC-DEC-02 | subtract | 1, 0.9 | 200, Ergebnis exakt 0.1 | API + UI + Unit |
| TC-DEC-03 | multiply | 1.1, 1.1 | 200, Ergebnis exakt 1.21 | API + UI + Unit |
| TC-DEC-04 | divide | 1, 3 | 200, Ergebnis 0.3333333333333333333333333333 (28 Nachkommastellen = maximale Genauigkeit, exakter Vergleich) | API + UI + Unit |
| TC-DEC-05 | add | Unit: `MaxValue`, 1 · API/UI: 7e28, 1e28 | 400 Bad Request – arithmetischer Überlauf | API + UI + Unit |
| TC-DEC-06 | subtract | Unit: `MinValue`, 1 · API/UI: −7e28, 1e28 | 400 Bad Request – negativer Überlauf | API + UI + Unit |
| TC-DEC-07 | multiply | 1e15, 1e15 | 400 Bad Request – Überlauf bei Multiplikation (Produkt 10³⁰ > `MaxValue`) | API + UI + Unit |
| TC-DEC-08 | divide | Unit: `MaxValue`, 0.5 · API/UI: 7e28, 0.5 | 400 Bad Request – Überlauf bei Division | API + UI + Unit |
| TC-DEC-09 | divide | 2, 3 | 200, Ergebnis 0.6666666666666666666666666667 (Rundung *half away from zero* an der 28. Nachkommastelle) | API + UI + Unit |
| TC-DEC-10 | add / subtract | `MaxValue`, 0 bzw. `MinValue`, 0 | Ergebnis exakt an der Bereichsgrenze wird akzeptiert (kein Überlauf) | Unit |
| TC-DEC-11 | add / multiply | Unit: `MaxValue`, 0, 1 · API/UI: 1e14, 1e14, 10 | Überlauf in einem **späteren** Rechenschritt wird erkannt (`OverflowError` → 400); Zwischenergebnis 10²⁸ liegt noch im Bereich, erst × 10 überschreitet ihn | API + UI + Unit |
| TC-UI-DEC-01 | add | `1,5`, `2` (Komma als Dezimaltrennzeichen) | UI parst `1,5` als 1.5; Ergebnis exakt 3.5, Ausdruck `1.5 + 2 =` | UI |
| TC-UI-DEC-02 | subtract | `0,3`, `0,1` | Ergebnis exakt 0.2, Ausdruck `0.3 − 0.1 =` | UI |
| TC-UI-DEC-03 | add | 0.1, 0.2, 0.3 (drei Felder) | Ergebnis exakt 0.6 über mehrere Rechenschritte, Ausdruck `0.1 + 0.2 + 0.3 =` | UI |

> **Hinweis:** `MaxValue`/`MinValue` (±79228162514264337593543950335) sind als JSON-Zahl nicht exakt darstellbar (siehe Kap. 2). Die API- und UI-Varianten von TC-DEC-05/06/08/11 verwenden deshalb Operanden, die selbst innerhalb des Bereichs liegen, deren Ergebnis ihn aber überschreitet, sodass der Überlauf in der Berechnung (nicht in der Validierung) entsteht. Überläufe führen zu einer `OverflowError`, die der `errorHandler` in 400 Bad Request mit `{ "error": "Arithmetic overflow: result exceeds the decimal range" }` übersetzt; die UI zeigt diesen Text unverändert als Alert. Ein `Infinity`/`NaN`-Zustand wie bei `double` wird durch die `isFinite`-Prüfung in `isInDecimalRange` ausgeschlossen. In der UI werden die Exponentialschreibweisen (`7e28`, `1e15`, `1e14`) direkt in die Textfelder eingegeben; `parseOperand` akzeptiert sie als gültige Zahlen.

### 4.3 Division durch null (erwartet: 400 Bad Request)

| ID | Eingabe (`numbers`) | Erwartung | Ebene |
|---|---|---|---|
| TC-DIV0-01 | 10, 0 | 400, `{ "error": "Division by zero is not allowed" }`; UI: Alert mit diesem Text | API + UI + Unit |
| TC-DIV0-02 | 10, −0 | 400 (negative Null wird ebenfalls als null erkannt); UI: Eingabe `-0` wird als `0` serialisiert | API + UI + Unit |
| TC-DIV0-03 | 10, 2, 0 | 400 – null an späterer Divisor-Position (variadisch); der Fehler tritt nach einem gültigen Zwischenschritt (10 ÷ 2 = 5) auf | API + UI + Unit |

### 4.4 Eingabevalidierung (erwartet: 400 Bad Request, alle 4 Endpunkte)

Sofern nicht anders angegeben, lautet die Fehlerantwort `{ "error": "Body must contain an array numbers with at least two finite numbers within the decimal range" }`.

| ID | Eingabe | Erwartung | Ebene |
|---|---|---|---|
| TC-VAL-01 | `{ "numbers": [42] }` | 400 – nur ein Operand (Mindestanzahl 2 unterschritten) | API + Unit |
| TC-VAL-02 | `[1, 2]` | 400 – JSON-Array statt Objekt | API + Unit |
| TC-VAL-03 | `{ }` | 400 – Feld `numbers` fehlt | API + Unit |
| TC-VAL-04 | leerer Body (`Content-Type: application/json`, `Content-Length: 0`) | 400 | API + Unit (`undefined`-Body) |
| TC-VAL-05 | `{ "numbers": [1, "abc"] }` | 400 – ungültiger Elementtyp | API + Unit |
| TC-VAL-06 | syntaktisch ungültiges JSON | 400, `{ "error": "Invalid JSON body" }` (Body-Parser-Fehler) | API |
| TC-VAL-07 | `{ "numbers": [1, null] }` | 400 – explizit null als Element | API + Unit |
| TC-VAL-08 | gültiger Body mit `Content-Type: text/plain` | 400 – der Body wird nicht als JSON geparst und scheitert deshalb an der Validierung (kein 415) | API |
| TC-VAL-09 | Body > 10 kB | 413 Payload Too Large, `{ "error": "Request rejected" }` | API |
| TC-VAL-10 | `{ "numbers": [1e308, 1] }` | 400 – Zahl außerhalb des `Decimal`-Wertebereichs; UI: `1e308` ist clientseitig endlich und wird gesendet, der API-Fehlertext erscheint als Alert | API + UI + Unit |
| TC-VAL-11 | `{ "numbers": [79228162514264337593543950336, 1] }` | 400 – `MaxValue` + 1 (= 2⁹⁶) liegt außerhalb des Bereichs; UI: Eingabe als Ziffernfolge, Serialisierung als `7.922816251426434e+28` | API + UI + Unit |
| TC-VAL-12 | `{ "numbers": 5 }` | 400 – `numbers` ist kein Array | API + Unit |
| TC-VAL-13 | `{ "a": 1, "b": 2 }` | 400 – veraltetes zweistelliges Format wird nicht mehr akzeptiert | API + Unit |
| TC-VAL-14 | `{ "numbers": [] }` | 400 – leeres Array | API + Unit |

Zusätzlich wird bei allen Validierungsfällen die Struktur der Fehlerantwort geprüft: genau ein Feld `error` mit dem erwarteten Text. Auf Unit-Ebene (`isCalculationRequest`) werden ergänzend Werte geprüft, die über JSON nicht transportierbar sind oder nur auf Typebene auftreten: `NaN`, `Infinity`, Boolean, numerische Strings (`"1"`), `null`/String als Body, Werte unterhalb von `MinValue` (−1e29) sowie ein ungültiges Element an späterer Position (`[1, 2, "3"]`). TC-VAL-01 bis TC-VAL-09 und TC-VAL-12 bis TC-VAL-14 betreffen die Struktur des HTTP-Requests und sind über die UI nicht auslösbar (die UI sendet stets `{ "numbers": [number, number, ...] }` mit mindestens zwei Elementen); die UI-seitigen Eingabefehler sind in Gruppe 4.6 beschrieben.

> **Hinweis zu TC-VAL-04:** Ein JSON-Stringliteral `""` als Body (2 Bytes) ist **kein** leerer Body, sondern syntaktisch ungültiges JSON im strikten Modus des Body-Parsers (→ `Invalid JSON body`). Der Playwright-Test sendet daher bewusst **kein** `data`-Feld, da `data: ""` von Playwright als `""` serialisiert würde.

### 4.5 API-Vertrag / Robustheit

| ID | Prüfung | Erwartung | Ebene |
|---|---|---|---|
| TC-CON-01 | Response-Felder | Genau `operation`, `numbers`, `result` | API |
| TC-CON-02 | Header | `Content-Type: application/json` – sowohl bei 200 als auch bei Fehlerantworten | API |
| TC-CON-03 | GET auf POST-Endpunkt | 404 Not Found, `{ "error": "Not found" }` – Express routet methodenspezifisch; es gibt kein 405 | API |
| TC-CON-04 | Unbekannte Operation (z. B. `/modulo`) | 404 Not Found, `{ "error": "Not found" }` | API |
| TC-CON-05 | Unbekannte Zusatzfelder im Body (z. B. `{ "numbers": [1, 2], "extra": true }`) | 200 – Zusatzfelder werden toleriert (Robustheitsprinzip), Response enthält sie nicht | API + Unit |
| TC-CON-06 | `GET /health` | 200, `{ "status": "ok" }`; UI: Status-Anzeige `API erreichbar` (`data-status="online"`, siehe TC-UI-STAT-01) | API + UI |
| TC-CON-07 | Header `X-Powered-By` | nicht vorhanden (`app.disable("x-powered-by")`) | API |
| TC-CON-08 | Spiegelung der Operanden (`numbers: [3, -1.5, 2, 0.25]`) | `numbers` in der Response ist identisch mit der Eingabe (Reihenfolge, Anzahl, Werte) | API |

### 4.6 Clientseitige Validierung der UI (erwartet: Feldfehler, kein API-Aufruf)

Alle Fälle werden über die Oberfläche ausgeführt (bei Bedarf Felder hinzufügen, Operanden eingeben, Operation wählen, `Berechnen`). Erwartung in jedem Fall: Der Fehlertext erscheint als `role="alert"` unter dem betroffenen Feld, das Feld trägt `aria-invalid="true"`, alle anderen Felder zeigen keinen Fehler und kein `aria-invalid`, das Ergebnis-Panel bleibt im Idle-Zustand (`Gib zwei Zahlen ein und wähle eine Operation.`) und es wird **kein** Request an `/api/calculate/*` gesendet (Nachweis über aufgezeichnete Browser-Requests). Priorität: hoch.

| ID | Eingabe (Felder in Reihenfolge) | Erwartung | Ebene |
|---|---|---|---|
| TC-UI-VAL-01 | ` ` (leer), `1` | Zahl 1: `Bitte eine Zahl eingeben` | UI |
| TC-UI-VAL-02 | `1`, ` ` (leer) | Zahl 2: `Bitte eine Zahl eingeben` | UI |
| TC-UI-VAL-03 | `abc`, `1` | Zahl 1: `Ungültige Zahl` | UI |
| TC-UI-VAL-04 | `abc`, `␠` (Leerzeichen) | Zahl 1: `Ungültige Zahl`, Zahl 2: `Bitte eine Zahl eingeben` (beide Fehler gleichzeitig) | UI |
| TC-UI-VAL-05 | `1e999`, `1` | Zahl 1: `Zahl ist zu groß` (Literal ist syntaktisch gültig, aber nicht endlich) | UI |
| TC-UI-VAL-06 | `0x10`, `1` | Zahl 1: `Ungültige Zahl` (Hexadezimal wird abgelehnt, obwohl `Number()` es akzeptieren würde) | UI |
| TC-UI-VAL-07 | `1`, `Infinity` | Zahl 2: `Ungültige Zahl` | UI |
| TC-UI-VAL-08 | `1.2.3`, `1` | Zahl 1: `Ungültige Zahl` (mehrere Dezimaltrennzeichen) | UI |
| TC-UI-VAL-09 | `abc`, `1`; danach Eingabe `1` in Zahl 1 | Fehler `Ungültige Zahl` erscheint und verschwindet mit der ersten Bearbeitung des Feldes (`aria-invalid` entfernt) | UI |
| TC-UI-VAL-10 | `1`, `2`, `x` (drittes Feld hinzugefügt) | Nur Zahl 3: `Ungültige Zahl`; Zahl 1 und 2 ohne Fehler – hinzugefügte Felder werden gleich validiert | UI |
| TC-UI-VAL-11 | `1`, `2`, ` `, ` ` (zwei hinzugefügte, leere Felder) | Zahl 3 und Zahl 4: `Bitte eine Zahl eingeben`; Zahl 1 und 2 ohne Fehler | UI |

Die zugrunde liegende Funktion `parseOperand` (Regex für Dezimal-/Exponentialliteral, Komma → Punkt, `Number.isFinite`) ist zusätzlich im UI-Repo per Unit-Test abgesichert.

### 4.7 UI-Verhalten (Status, Netzwerk, Pending, Verlauf, Navigation, Operandenfelder)

Szenario-basierte Fälle des UI-Test-Repos (`05_UiBehavior.spec.ts`). Netzwerkbedingungen werden über `page.route()` im Browser simuliert; die API selbst läuft unverändert. Priorität: mittel (außer TC-UI-OPS-01 und TC-UI-VAL-09: hoch).

| ID | Szenario | Erwartung | Ebene |
|---|---|---|---|
| TC-UI-PAGE-01 | Initialer Seitenzustand | Titel und h1 `Calculator`, Idle-Hinweis im Ergebnis-Panel, genau zwei leere Felder `Zahl 1`/`Zahl 2`, keine Entfernen-Buttons, Button `Zahl hinzufügen` sichtbar, `Addieren` vorausgewählt, Fokus auf `Zahl 1`, Button `Berechnen`, kein Verlauf | UI |
| TC-UI-OPS-01 | Zweimal `Zahl hinzufügen`, Werte `10, 4, 3, 1`, `Zahl 2 entfernen`, danach auf Minimum reduzieren | Nach Hinzufügen 4 Felder, Fokus auf dem neuen Feld, je Feld ein Entfernen-Button; nach Entfernen verbleiben `10, 3, 1` (keine Verschiebung der Werte); bei zwei Feldern sind keine Entfernen-Buttons mehr vorhanden | UI |
| TC-UI-STAT-01 | API erreichbar | Status-Anzeige `API erreichbar`, `data-status="online"` (UI-Sicht von TC-CON-06) | UI |
| TC-UI-STAT-02 | `GET /health` wird abgebrochen (Offline-Simulation) | Status-Anzeige `API nicht erreichbar`, `data-status="offline"` | UI |
| TC-UI-NET-01 | `POST /api/calculate/*` wird abgebrochen (Verbindungsfehler) | Alert `Die API ist nicht erreichbar`, kein Ergebnis, kein Verlaufseintrag | UI |
| TC-UI-NET-02 | `POST /api/calculate/*` antwortet 503 ohne API-Body | Alert `Die API ist nicht erreichbar` (Gateway-Status ohne Fehlervertrag gilt als „nicht erreichbar“) | UI |
| TC-UI-PEND-01 | Antwort um 3 s verzögert | Während der Anfrage: Button `Berechne…` und deaktiviert, alle Felder, `Zahl hinzufügen` und Radiobuttons deaktiviert, Formular `aria-busy`, Hinweis `Berechnung läuft…`; danach Button `Berechnen` aktiv und Ergebnis `3` sichtbar | UI |
| TC-UI-HIST-01 | Drei Berechnungen (1+2, 10+20+30, 1÷3), dann `Leeren` | Verlauf zeigt genau drei Einträge, neueste zuerst (`1 ÷ 3 =0.3333333333333333333333333333`, `10 + 20 + 30 =60`, `1 + 2 =3`); nach `Leeren` ist der Verlaufsbereich nicht mehr vorhanden | UI |
| TC-UI-HIST-02 | Elf Berechnungen (1+1 … 11+1) | Verlauf enthält genau 10 Einträge (`VITE_HISTORY_LIMIT`), der älteste (`1 + 1 =2`) ist verdrängt | UI |
| TC-UI-NAV-01 | Aufruf einer unbekannten Route (`/gibt-es-nicht`) | Überschrift `Seite nicht gefunden`, Link `Zurück zum Rechner`; nach Klick URL `/`, Rechner-Überschrift und Formular sichtbar | UI |

Ergänzend sichern die Komponententests des UI-Repos (`tests/features/calculator/components/Calculator.test.tsx`) dieselben Verhaltensweisen mit MSW-emulierter API ab (Startzustand mit zwei Feldern, exakte Ergebnisanzeige, variadische Berechnung nach Hinzufügen von Feldern, Entfernen eines Feldes ohne Werteverschiebung und nie unter zwei, Komma-Trennzeichen, Client-Validierung aller Felder ohne API-Aufruf, Fehler verschwindet bei Eingabe, API-/Netzwerkfehlertext, Pending-Zustand, Verlauf neueste zuerst und Leeren).

## 5. Testumgebung

| Aspekt | Lokal | CI (GitHub Actions) |
|---|---|---|
| Betriebssystem | Windows (Entwicklung) | ubuntu-24.04 |
| Node.js | ≥ 24 (`engines` in `package.json` aller Repos) | 24 (`actions/setup-node@v6`, npm-Cache) |
| Abhängigkeiten | `npm install` je Repo | `npm ci` je Repo |
| API-Repo: Testlauf | `npm test` (`vitest run`), `npm run test:watch` – kein laufender Server nötig | `npm run lint`, `npm run typecheck`, `npm test` |
| UI-Repo: Testlauf | `npm test` (`vitest run`, jsdom + MSW) – kein laufender Server, kein Browser nötig | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| API-Test-Repo: API-Start | extern, z. B. `npm run dev` im API-Repo (tsx watch, Port über `PORT`, Standard 3000) | `npm run build` + `npm start` im Hintergrund, Warten auf `GET /health` (max. 30 s) |
| API-Test-Repo: Testlauf | `npm test` (`playwright test`) gegen laufende API | `npm run typecheck`, `npm test` |
| UI-Test-Repo: API- und UI-Start | extern: `npm run dev` im API-Repo **und** `npm run dev` im UI-Repo (Vite-Dev-Server, Port 5173, Proxy `/api` + `/health` → API) | API wie oben; UI: `npm run build` + `vite preview --host 127.0.0.1 --port 5173 --strictPort` im Hintergrund (`API_PROXY_TARGET` = API-URL), Warten auf `GET /` und `GET /health` über den UI-Proxy (max. 30 s) |
| UI-Test-Repo: Testlauf | `npm test` (`playwright test`) gegen laufende UI + API; `.env` mit `TEST_ENVIRONMENT`, `UI_BASE_URL`, `API_BASE_URL` | `npm run lint`, `npm run typecheck`, `npm run install:browsers`, `npm test` |
| Basis-URLs | API `http://localhost:3000` (`API_BASE_URL`), UI `http://localhost:5173` (`UI_BASE_URL`) | identisch, über Workflow-`env` gesetzt |
| Testdaten-Umgebung (UI-Test-Repo) | `TEST_ENVIRONMENT=DEV` → `*_Dev.json` (Standard); `STAGING` → `*_Staging.json` | `TEST_ENVIRONMENT=DEV` |
| Browser | API-Tests: nicht erforderlich; UI-Tests: Chromium (`npm run install:browsers`) | UI-Tests: `playwright install --with-deps chromium` |

## 6. CI/CD-Integration (GitHub Actions)

Jedes Repository besitzt eine eigene Pipeline. Die Black-Box-API-Tests werden sowohl von der API-Pipeline als auch von der Pipeline des API-Test-Repos ausgeführt, damit sowohl API- als auch Testcode-Änderungen über ein PR-Gate abgesichert sind. Die Black-Box-UI-Tests werden von der Pipeline des UI-Test-Repos ausgeführt, die API und UI aus deren `main`-Branches (oder wählbaren Refs) selbst baut und startet; UI-Änderungen werden damit über den nächsten Lauf des UI-Test-Repos (Push, PR oder `workflow_dispatch` mit `ui_ref`) abgesichert.

**API-Repository (`calculator_api_ts`)** – Workflow `.github/workflows/ci.yml`:

- **Trigger:** Push und Pull Request auf `main`, zusätzlich manuell (`workflow_dispatch`, dabei ist der Git-Ref des API-Test-Repos über `tests_ref` wählbar).
- **Job `test` (Lint, Typecheck & Test):**
  1. Checkout (`actions/checkout@v6`), Node 24 einrichten (`actions/setup-node@v6`, npm-Cache)
  2. `npm ci`
  3. `npm run lint` (oxlint, Kategorien `correctness` = error, `suspicious` = warn)
  4. `npm run typecheck` (`tsc --noEmit`)
  5. `npm test` (`vitest run`) – Unit- und In-Process-Tests, erzeugt Konsolen-, HTML- und JUnit-Report
  6. Upload des Verzeichnisses `test-report/` als Workflow-Artefakt `test-report` (`if: always()`)
  7. Nicht bei Pull Requests: Upload von `test-report/` als Pages-Artefakt (`actions/upload-pages-artifact@v5`)
- **Job `api-tests` (Playwright API tests, `needs: test`)** – die Unit-/In-Process-Tests sind das schnelle Quality Gate vor den Black-Box-Tests:
  1. Checkout des API-Repos und des API-Test-Repos (`Sascha-Pommernell/calculator_api_test_ts`, Pfad `api-tests`, Ref `tests_ref` bzw. `main`)
  2. `npm ci` + `npm run build` der API, Start via `npm start` im Hintergrund (`PORT=3000`), Warten auf `GET /health`
  3. `npm ci` + `npm test` im API-Test-Repo (`API_BASE_URL=http://localhost:3000`)
  4. Upload von `playwright-report/` und `test-results/` als Artefakt `playwright-report` (`if: always()`); bei Fehlschlag zusätzlich das API-Log
- **Job `deploy-report`** (nur Push/`workflow_dispatch`, `needs: test`, `if: always()`): Veröffentlichung des Vitest-HTML-Reports auf **GitHub Pages** (`actions/deploy-pages@v5`, Environment `github-pages`). Der Report wird auch bei fehlgeschlagenen Tests veröffentlicht.
- **Fehlerverhalten:** Lint-, Typecheck- oder Testfehler brechen den jeweiligen Job ab (PR-Gate über den `pull_request`-Trigger). Es gibt keinen automatischen Retry; Flakiness wird durch zustandslose, deterministische Tests und die Erreichbarkeits-Probe (`/health`) vor dem Black-Box-Lauf vermieden. Wird die API nicht gesund, schlägt der Job `api-tests` hart fehl (kein „grün ohne Tests“).
- **Berechtigungen:** Workflow-weit `contents: read`; der Deploy-Job zusätzlich `pages: write` und `id-token: write`.
- **Voraussetzung:** GitHub Pages mit Quelle „GitHub Actions“.

**API-Test-Repository (`calculator_api_test_ts`)** – Workflow `.github/workflows/api-tests.yml`:

- **Trigger:** Push und Pull Request auf `main`, zusätzlich manuell (dabei ist der Git-Ref des API-Repos über `api_ref` wählbar).
- **Ablauf:** identisch zum Job `api-tests` oben, mit vertauschten Rollen: API-Repo (`Sascha-Pommernell/calculator_api_ts`) wird in den Pfad `api` ausgecheckt, gebaut und gestartet; anschließend `npm ci`, `npm run typecheck` und `npm test` im API-Test-Repo; Upload von `playwright-report/` und `test-results/` als Artefakt (bei Fehlschlag zusätzlich das API-Log). Kein Pages-Deployment.

**UI-Repository (`calculator_ui_ts`)** – Workflow `.github/workflows/ci.yml`:

- **Trigger:** Push und Pull Request auf `main`, zusätzlich manuell.
- **Job `verify`:** Checkout, Node 24, `npm ci`, `npm run lint` (oxlint inkl. Architekturregeln/Modulgrenzen), `npm run typecheck` (`tsc -b --noEmit`, inkl. Tests), `npm test` (Vitest, jsdom, MSW), `npm run build`; Upload von `dist/` als Artefakt. Kein laufender Server und kein Browser nötig.

**UI-Test-Repository (`calculator_ui_tests_ts`)** – Workflow `.github/workflows/ui-tests.yml`:

- **Trigger:** Push und Pull Request auf `main`, zusätzlich manuell (dabei sind die Git-Refs von API- und UI-Repo über `api_ref` und `ui_ref` wählbar).
- **Job `ui-tests`:**
  1. Checkout des UI-Test-Repos sowie des API-Repos (Pfad `api`) und des UI-Repos (Pfad `ui`), Node 24 mit npm-Cache über alle drei Lockfiles
  2. API: `npm ci` + `npm run build`, Start via `npm start` im Hintergrund (`PORT=3000`), Warten auf `GET /health`
  3. UI: `npm ci` + `npm run build`, Start via `vite preview --host 127.0.0.1 --port 5173 --strictPort` im Hintergrund (`API_PROXY_TARGET` = API-URL; `vite preview` übernimmt `server.proxy`), Warten auf `GET /` **und** `GET /health` über den UI-Proxy
  4. UI-Test-Repo: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run install:browsers` (Chromium inkl. System-Abhängigkeiten), `npm test` (`UI_BASE_URL`, `API_BASE_URL`, `TEST_ENVIRONMENT=DEV` über Workflow-`env`)
  5. Upload von `playwright-report/` und `test-results/` als Artefakt `playwright-report` (`if: always()`); bei Fehlschlag zusätzlich `api.log` und `ui.log` als Artefakt `server-logs`
- **Fehlerverhalten:** Wird API oder UI nicht erreichbar, schlägt der Job vor dem Testlauf hart fehl; der `globalSetup` der Tests prüft beide Probes erneut. In CI ist ein Retry (`retries: 1`) mit Trace-Aufzeichnung konfiguriert, um UI-Timing-Flakiness zu diagnostizieren statt zu maskieren – wiederholt flaky Tests werden als Defect behandelt.

## 7. Berichterstattung

**API-Repo** (Reporter in `vitest.config.ts`):

- **Konsole:** Standard-Reporter von Vitest.
- **HTML-Report:** `test-report/index.html` (Vitest-HTML-Reporter).
- **JUnit-XML:** `test-report/junit.xml` – maschinenlesbar für externe Auswertung.
- **CI:** Testergebnisse im Actions-Log, Verzeichnis `test-report/` als Workflow-Artefakt (Standard-Aufbewahrung des Repositories) und – außer bei Pull Requests – als veröffentlichter HTML-Report auf GitHub Pages:
  `https://sascha-pommernell.github.io/calculator_api_ts/` (jeweils der letzte Lauf; keine Historie).

**API-Test-Repo** (Reporter in `playwright.config.ts`):

- **Konsole:** `list`-Reporter.
- **HTML-Report:** `playwright-report/index.html`, lokal über `npm run report` (`playwright show-report`).
- **JUnit-XML:** `test-results/junit.xml`.
- **CI:** Ergebnisse im Actions-Log sowie `playwright-report/` und `test-results/` als Workflow-Artefakt `playwright-report` (in beiden Pipelines).

**UI-Repo** (Vitest-Standardkonfiguration in `vite.config.ts`):

- **Konsole:** Standard-Reporter von Vitest; Ergebnisse im Actions-Log. Kein HTML-/JUnit-Report und kein Pages-Deployment.

**UI-Test-Repo** (Reporter in `playwright.config.ts`):

- **Konsole:** `list`-Reporter; zusätzlich Fortschrittsausgaben der Test-Schritte (`→ …`).
- **HTML-Report:** `playwright-report/index.html`, lokal über `npm run test:report` (`playwright show-report`); öffnet sich lokal automatisch bei Fehlern (`open: "on-failure"`), in CI nie.
- **JSON-Report:** `test-results/test-results.json`.
- **JUnit-XML:** `test-results/junit.xml`.
- **Assertion-Anhänge:** Jede über den `AssertionReporter` ausgeführte Prüfung wird als JSON-Anhang (`assertion-*`, `text-check-*`, `visibility-check-*`, `url-check-*` …) mit Soll-/Ist-Wert, Beschreibung und Kontext an den Test angehängt; Verifikationsschritte erzeugen zusätzlich einen `test-summary-report` (Anzahl erfolgreicher/fehlgeschlagener Assertions). Bei fehlgeschlagener Sichtbarkeitsprüfung wird ein Screenshot angehängt.
- **Fehlerdiagnose:** Screenshot `only-on-failure`, Video `retain-on-failure`, Trace `on-first-retry` (`npx playwright show-trace test-results/<test>/trace.zip`).
- **CI:** `playwright-report/` und `test-results/` als Workflow-Artefakt `playwright-report`; bei Fehlschlag zusätzlich `server-logs` (API- und UI-Log).

Für Pull Requests stehen alle Reports ausschließlich als Workflow-Artefakt bereit.

## 8. Testorganisation

### 8.1 Rollen und Verantwortlichkeiten

| Rolle | Verantwortlich | Aufgaben |
|---|---|---|
| Testmanager / Testanalyst / Testautomatisierer / Entwickler | Sascha Pommernell (Einzelentwickler) | Testkonzept, Testfallentwurf, Automatisierung, Pflege, Auswertung, Fehlerbehebung |

### 8.2 Eingangskriterien (Entry Criteria)

- Node.js ≥ 24 und npm sind installiert; `npm ci` bzw. `npm install` läuft in allen Repos fehlerfrei.
- Das API-Repo ist typkorrekt (`npm run typecheck`) und lintfrei (`npm run lint`); das UI-Repo ist typkorrekt, lintfrei und baubar (`npm run build`); die Test-Repos sind typkorrekt (`npm run typecheck`, UI-Test-Repo zusätzlich `npm run lint`).
- Für die Black-Box-API-Tests: Eine laufende Instanz der Calculator API ist unter der konfigurierten `API_BASE_URL` erreichbar (Prüfung via `GET /health` im `globalSetup`).
- Für die Black-Box-UI-Tests: zusätzlich eine laufende Instanz der Calculator UI unter `UI_BASE_URL`, deren Proxy auf dieselbe API zeigt (Prüfung via `GET /` und `GET /health` im `globalSetup`); Chromium ist installiert (`npm run install:browsers`); die Testdaten-Dateien der gewählten Umgebung (`TEST_ENVIRONMENT`) sind vorhanden und nicht leer (eine leere Datei führt zu 0 erkannten Tests der Gruppe).

### 8.3 Endekriterien (Exit Criteria / Abnahme)

- Alle Testfälle aus Abschnitt 4 sind auf der angegebenen Ebene automatisiert umgesetzt und über ihre ID im Testnamen auffindbar.
- Alle Tests laufen lokal und in GitHub Actions (alle vier Pipelines) erfolgreich („grün“); bekannte, als Defect erfasste Abweichungen (siehe Kap. 10) sind dokumentiert.
- Ein PR kann nur gemerged werden, wenn die Pipeline des jeweiligen Repos erfolgreich ist.

### 8.4 Abbruch- und Wiederaufnahmekriterien (Suspension Criteria)

- **Abbruch:** Die Testdurchführung wird ausgesetzt, wenn die Testumgebung nicht herstellbar ist (`npm ci` schlägt fehl, inkompatible Node-Version, Browser-Download nicht möglich), die API unter `API_BASE_URL` bzw. die UI unter `UI_BASE_URL` nicht erreichbar ist (`globalSetup` bricht den Playwright-Lauf ab) oder mehr als 50 % der Tests aufgrund eines Umgebungsproblems fehlschlagen.
- **Wiederaufnahme:** Nach Behebung des blockierenden Problems und erfolgreichem Smoke-Check (ein Happy-Path-Test pro Endpunkt bzw. Operation, z. B. `npx playwright test --grep "TC-(ADD|SUB|MUL|DIV)-01"` in beiden Test-Repos bzw. `npx vitest run -t "4.1"` im API-Repo) wird die vollständige Testsuite erneut ausgeführt.

## 9. Rückverfolgbarkeit (Traceability)

- Jeder automatisierte Test trägt die Testfall-ID aus Kapitel 4 im Testnamen:
  - **Vitest:** direkt (`it("TC-DEC-01: …")`) oder als erster Parameter einer `it.each`-Tabelle, der über `%s` in den Testnamen eingesetzt wird (z. B. `TC-ADD-01: add(1, 2) = 3`).
  - **Playwright (API-Test-Repo):** als Präfix des Testtitels (`test(\`${id}: …\`)`), ergänzt um Prioritäts-Tags am `describe`-Block.
  - **Playwright (UI-Test-Repo):** über das Feld `testCase` des JSON-Datensatzes (`"testCase": "TC-DEC-04 Präzision 1 / 3 = …"`), das zum Testtitel wird; Prioritäts-Tags stammen aus dem Feld `tags` desselben Datensatzes. Testdaten-Datei, Testfall und Report sind damit über die ID verknüpft.
- `describe`-Blöcke tragen in allen Repos die Kapitelnummer der Testfallgruppe (`4.1 Happy Path – …`, `4.5 UI-Verhalten – …`), sodass Gruppen über `vitest run -t` bzw. `playwright test --grep` gefiltert werden können.
- Die UI-Komponententests im UI-Repo tragen keine IDs; ihre Zuordnung zu den Gruppen 4.6/4.7 ist im jeweiligen Abschnitt beschrieben.
- Dadurch ist die Zuordnung Testkonzept ↔ Testdaten ↔ Testcode ↔ Testreport (Konsole/HTML/JSON/JUnit) lückenlos möglich.
- Bei Änderungen am Testkonzept werden betroffene Testfall-IDs im Commit/PR referenziert.

## 10. Fehler- und Abweichungsmanagement (Defect Management)

- Gefundene Abweichungen werden als **GitHub Issues** im verursachenden Repository erfasst: API-Fehler im API-Repo, UI-Fehler im UI-Repo, Abweichungen im Testcode selbst im jeweiligen Test-Repo. Ist unklar, ob API oder UI ursächlich ist, entscheidet der Abgleich mit dem API-Orakel (UI zeigt etwas anderes als die API liefert → UI-Repo; API liefert einen falschen Wert → API-Repo).
- Jedes Issue enthält: betroffene Testfall-ID(s), Ist- und Soll-Verhalten, Reproduktionsschritte (Request-Beispiel bzw. UI-Eingaben) und Link zum fehlgeschlagenen Workflow-Lauf; bei UI-Fehlern zusätzlich Screenshot/Trace aus dem Playwright-Artefakt.
- Bekannte offene Defects: derzeit keine.
- Historie: Das Testkonzept und das API-Test-Repo wurden ursprünglich für die .NET-Variante der Calculator API (`calculator-api`, NUnit/Playwright, Body `{ "numbers": [...] }`, Gleitkomma-Fälle TC-FLT-01 bis -06) erstellt und für die TypeScript-Implementierung überarbeitet. Dabei wurden folgende Abweichungen des Vertrags übernommen und als Soll festgeschrieben: Routenpräfix `/api/calculate`, Fehlerformat `{ "error" }` statt ProblemDetails, 404 statt 405 bei falscher HTTP-Methode (TC-CON-03), 400 statt 415 bei falschem Content-Type (TC-VAL-08), Body-Limit 10 kB/413 (TC-VAL-09) anstelle der Operanden-Obergrenze 1000 sowie die `Decimal`-Fälle TC-DEC-01 bis -11 (exakte Vergleiche, Überlauf an den `Decimal`-Grenzen) anstelle der `double`-Fälle TC-FLT-01 bis -06. Die TypeScript-API exponierte zunächst nur einen zweistelligen Body `{ "a", "b" }` (variadische Fälle nur auf Unit-Ebene); nach Einführung der React-UI wurde dieser Vertrag als Defect erkannt (der Service ist variadisch, die UI konnte aber nur zwei Zahlen erfassen) und auf `{ "numbers": [n1, n2, ...] }` mit mindestens zwei Operanden umgestellt – damit sind TC-ADD-02/SUB-02/MUL-02/DIV-02, TC-DIV0-03 und TC-DEC-11 auf API- und UI-Ebene prüfbar; das alte Format wird abgelehnt (TC-VAL-13), und TC-VAL-12/14 sowie TC-CON-08 kamen hinzu. Mit der React-UI (`calculator_ui_ts`) und dem UI-Test-Repo (`calculator_ui_tests_ts`) wurde das Konzept um die UI-Ebene erweitert: Gruppen 4.6/4.7 (`TC-UI-*`), UI-Varianten der Gruppen 4.1–4.4 und TC-CON-06 sowie die Architektur der UI-Tests (Page Object Model, modulare Test-Schritte, datengetriebene JSON-Testfälle) nach dem Vorbild des Frameworks *E2E-Tests-PA-Leadmanagement*.

## 11. Wartung und Erweiterung

- Neue Endpunkte oder Operationen erfordern entsprechende neue Testfälle (Happy Path + Negativtests) in **allen betroffenen** Repos vor dem Merge: im API-Repo werden neue Operationen über `OPERATIONS` in `src/types/calculator.types.ts` registriert und damit automatisch von den `describe.each`-Validierungstests erfasst; im API-Test-Repo ist die Liste `OPERATIONS` in `tests/calculator.spec.ts` zu ergänzen; im UI-Repo `OPERATIONS`/`OPERATION_META` in `src/features/calculator/types/index.ts` (Label und Symbol) sowie die MSW-Handler; im UI-Test-Repo `OPERATIONS`/`OPERATION_LABELS` in `types.ts` und neue Datensätze in den JSON-Testdaten (Dev **und** Staging).
- Bei Änderungen am Response-Format sind die Vertragstests (4.5) und die Präzisionstests (4.2, Rohvergleich des Bodys) im API- und API-Test-Repo sowie `parse-calculation-response.ts` und der API-Orakel-Schritt (`CalculatorService.ts`, `RESULT_LITERAL`) im UI- bzw. UI-Test-Repo anzupassen.
- Bei Änderungen an UI-Texten (Labels, Fehlermeldungen, Hinweise, Button-Beschriftungen) sind die Selector-Klassen (`pages/**/*Selectors.ts`) und die erwarteten Texte in den JSON-Testdaten des UI-Test-Repos nachzuziehen; bei Änderungen an `VITE_HISTORY_LIMIT` der Datensatz TC-UI-HIST-02.
- Neue UI-Testfälle werden als zusätzlicher Datensatz (`testCase`, `tags`, `testData`) in der passenden `data/*TestData/*_Dev.json` **und** `*_Staging.json` angelegt; nur für neue Abläufe sind neue Test-Schritte (`tests/steps/**`, Registrierung in `index.ts`) oder Page-Object-Komponenten nötig. Neue Seiten werden in der `PageObjectFactory` und im Typ `Pages` registriert.
- Die Mindestanzahl von Operanden ist zentral definiert (`MIN_OPERANDS` in `src/types/calculator.types.ts` der API, `src/features/calculator/types/index.ts` der UI und `types.ts` des UI-Test-Repos); eine Änderung erfordert die Anpassung der Grenzwertfälle TC-VAL-01/14, TC-UI-OPS-01 und TC-UI-PAGE-01. Eine explizite Obergrenze für Operanden ist nicht implementiert; wird eine eingeführt, sind Grenzwertfälle auf API- und UI-Ebene (Button `Zahl hinzufügen` deaktiviert) zu ergänzen.
- Cross-Repo-Änderungen (z. B. am Fehlertext) sind so zu sequenzieren, dass die Pipelines aller Repos grün bleiben: zuerst die API-Änderung mit `workflow_dispatch` gegen Feature-Branches der Test-Repos prüfen (`tests_ref` im API-Repo bzw. `api_ref`/`ui_ref` in den Test-Repos), dann die `main`-Branches in der Reihenfolge API → UI → Test-Repos aktualisieren.
