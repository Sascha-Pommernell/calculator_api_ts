# Testkonzept – Calculator API (TypeScript)

## 1. Zielsetzung

Dieses Dokument beschreibt das Konzept für die automatisierte Testung der **Calculator API** (TypeScript, Node.js ≥ 24, Express 5). Ziel ist die Absicherung der fachlichen Korrektheit, der Eingabevalidierung und des API-Vertrags durch automatisierte **Black-Box-API-Tests mit Playwright** (`@playwright/test`, `APIRequestContext`) gegen die laufende Anwendung, ergänzt um **Unit- und In-Process-Tests mit Vitest/Supertest** im API-Repository, ausgeführt in CI-Pipelines über **GitHub Actions**.

Die Tests verteilen sich auf zwei Repositories:

| Repository | Inhalt | Werkzeuge |
|---|---|---|
| `calculator_api_ts` (API-Repo) | Anwendung, Unit-Tests (Service, Validierung), In-Process-API-Tests | Vitest, Supertest |
| `calculator_api_test_ts` (Test-Repo) | Black-Box-API-Tests gegen eine laufende API-Instanz | Playwright Test |

## 2. Testgegenstand

Die Calculator API stellt vier REST-Endpunkte bereit:

| Endpunkt | Methode | Operation |
|---|---|---|
| `/api/calculate/add` | POST | Addition |
| `/api/calculate/subtract` | POST | Subtraktion |
| `/api/calculate/multiply` | POST | Multiplikation |
| `/api/calculate/divide` | POST | Division |

**Request-Body:** `{ "a": zahl, "b": zahl }` – genau zwei Operanden, beide als JSON-Zahl.

**Response (200):** `{ "operation": string, "a": number, "b": number, "result": number }`

**Fehlerantwort:** `{ "error": string }` mit folgenden Statuscodes:

| Status | Ursache | `error`-Text |
|---|---|---|
| 400 | Ungültiger Body (fehlende/falsche Operanden, Zahl außerhalb des Wertebereichs) | `Body must contain finite numbers a and b within the decimal range` |
| 400 | Syntaktisch ungültiges JSON | `Invalid JSON body` |
| 400 | Division durch null | `Division by zero is not allowed` |
| 400 | Arithmetischer Überlauf | `Arithmetic overflow: result exceeds the decimal range` |
| 404 | Unbekannte Route oder nicht unterstützte HTTP-Methode | `Not found` |
| 413 | Body größer als 10 kB (`express.json({ limit: "10kb" })`) | `Request rejected` |
| 500 | Unerwarteter Fehler | `Internal server error` |

**Zahlentyp:** Die Operanden werden vom JSON-Parser als JavaScript-`number` (IEEE-754 double) gelesen und anschließend in eine `Decimal`-Instanz (`decimal.js`, Konfiguration `CalcDecimal`) überführt, die `System.Decimal` nachbildet: 29 signifikante Stellen, maximal 28 Nachkommastellen, Rundung *half away from zero* (`ROUND_HALF_UP`), Wertebereich ±79228162514264337593543950335 (≈ ±7,9 × 10²⁸, `DECIMAL_MAX_ABS`). Die Berechnung erfolgt exakt dezimal ohne binäre Gleitkomma-Rundungsfehler. Das Ergebnis wird **nicht** über `JSON.stringify` serialisiert (das würde auf double-Genauigkeit runden), sondern als handgebauter JSON-String mit der vollen `Decimal`-Genauigkeit ausgegeben.

Operanden, die nicht endlich sind oder außerhalb des `Decimal`-Wertebereichs liegen (z. B. `1e308`), werden von der Eingabevalidierung mit 400 abgelehnt. Da JSON-Zahlen als double ankommen, ist `decimal.MaxValue` (2⁹⁶ − 1) über die API **nicht exakt** darstellbar – das nächstgelegene double ist 2⁹⁶ und liegt bereits außerhalb des Bereichs.

Der `CalculatorService` (`src/services/calculator.service.ts`) unterstützt intern **variadische Operanden** (`a, b, ...rest`, links-assoziativ ausgewertet, Überlaufprüfung nach jedem Schritt). Die HTTP-Schnittstelle exponiert davon nur die zweistellige Form (`a`, `b`); die variadische Form wird ausschließlich auf Unit-Test-Ebene abgesichert.

Zusätzlich stellt die API einen Health-Endpoint `GET /health` bereit (`200`, `{ "status": "ok" }`), der vom Test-Repo und der CI als Erreichbarkeits-Probe genutzt wird.

## 3. Teststrategie

### 3.1 Testebenen und Werkzeuge

Die Testpyramide besteht aus drei Ebenen, von schnell/feingranular nach langsam/realitätsnah:

- **Unit-Tests (White-Box)** – API-Repo, `tests/calculator.service.test.ts` und `tests/calculator.validation.test.ts` (Vitest):
  - Rechenlogik des `CalculatorService`: alle vier Operationen inkl. variadischer Operanden, Präzision, Rundung, Überlauf, Division durch null, Fehlerklassen-Hierarchie (`CalculationError` → `DivisionByZeroError` / `OverflowError`).
  - Eingabevalidierung `isCalculationRequest`: Typ-, Struktur- und Wertebereichsprüfung des Request-Bodys, inkl. Werten, die über JSON gar nicht transportierbar sind (`NaN`, `Infinity`, `undefined`, Boolean).
- **In-Process-API-Tests (Grey-Box)** – API-Repo, `tests/calculator.routes.test.ts` (Vitest + **Supertest**): Die Express-App (`src/app.ts`) wird direkt eingebunden – kein laufender Server, kein Port, keine Basis-URL. Schnelles Feedback für Routing, Middleware und Fehlerbehandlung innerhalb des API-Repos (PR-Gate).
- **Black-Box-API-Tests (E2E)** – Test-Repo `calculator_api_test_ts`, `tests/calculator.spec.ts` (**Playwright Test**, `request`-Fixture / `APIRequestContext`, kein Browser nötig): Tests gegen eine **extern betriebene** API-Instanz über echtes HTTP. Die Basis-URL ist über die Umgebungsvariable `API_BASE_URL` konfigurierbar (Standard: `http://localhost:3000`). Ein `globalSetup` prüft vor dem Lauf `GET /health`; ist die API nicht erreichbar, bricht der Lauf mit einer klaren Fehlermeldung ab (kein „grün ohne Tests“). Ausführung parallel (`fullyParallel`), ohne Retries.

Für Präzisionsfälle wird auf beiden API-Ebenen der rohe Response-Body (`res.text` bzw. `response.text()`) verglichen, da `JSON.parse` das 28-stellige Ergebnis auf double-Genauigkeit runden würde.

- **Technologie:** TypeScript 7, **Vitest 5**, **Supertest 7**, **Playwright 1.63**, Linting mit **oxlint** (API-Repo), Typprüfung mit `tsc --noEmit` (beide Repos).
- **Ausführung:** API-Repo `npm test` (`vitest run`), Watch-Modus `npm run test:watch`; Test-Repo `npm test` (`playwright test`) bei laufender API.

### 3.2 Testarten

| Testart | Abdeckung | Ebene |
|---|---|---|
| Unit-Tests (Service) | Rechenlogik des `CalculatorService` inkl. variadischer Operanden, Rundung, Überlauf und Ausnahmefälle | Unit |
| Unit-Tests (Validierung) | `isCalculationRequest`: Body-Struktur, Operandentypen, Wertebereich | Unit |
| Funktionale Tests (Happy Path) | Korrekte Ergebnisse aller vier Operationen über HTTP | Supertest + Playwright |
| Negativtests | Division durch null, Überlauf, ungültige/unvollständige Eingaben | Supertest + Playwright |
| Vertragstests | Response-Struktur, Statuscodes, Content-Type, Header | Supertest + Playwright |
| Robustheitstests | Ungültiges JSON, falscher Content-Type, Body-Limit, falsche HTTP-Methode, unbekannte Routen | Supertest + Playwright |

### 3.3 Testentwurfsverfahren

Die Testfälle in Kapitel 4 wurden mit folgenden Black-Box-Testentwurfsverfahren (gemäß ISTQB) abgeleitet:

| Verfahren | Anwendung |
|---|---|
| Äquivalenzklassenbildung | Gültige Eingaben (zwei endliche Zahlen `a`, `b` im Wertebereich; positive/negative/dezimale Werte) vs. ungültige Eingaben (fehlender Operand, falscher Typ, `null`, Array statt Objekt, leerer Body, ungültiges JSON, Werte außerhalb des Bereichs) |
| Grenzwertanalyse | Divisor 0 und −0; Zahlbereichsgrenzen von `Decimal` (`MaxValue` ± 1, `MinValue` − 1, Werte außerhalb des Bereichs wie `1e308`); 28. Nachkommastelle (Rundung); Body-Limit 10 kB |
| Zustandsunabhängige Vertragsprüfung | Response-Struktur, Statuscodes, HTTP-Methoden, Routen, Header |
| Fehlererwartungsmethode (Error Guessing) | Dezimalpräzision (0.1 + 0.2 muss exakt 0.3 ergeben), periodische Ergebnisse (1/3, 2/3), Überlauf in einem späteren Rechenschritt, Zusatzfelder im Body, `JSON.stringify`-Rundung des Ergebnisses |

### 3.4 Risikobasierte Priorisierung

Jeder Testfallgruppe ist eine Priorität zugeordnet, die die Ausführungs- und Behebungsreihenfolge bestimmt:

| Priorität | Testfallgruppen | Begründung |
|---|---|---|
| Hoch | 4.1 Happy Path, 4.3 Division durch null, 4.4 Eingabevalidierung | Kernfunktionalität und Fehlerbehandlung; Fehler hier betreffen alle Nutzer direkt |
| Mittel | 4.2 Dezimal-Randfälle, 4.5 API-Vertrag | Randbedingungen und Vertragsstabilität; geringere Eintrittswahrscheinlichkeit |

Die Prioritäten sind im Testcode hinterlegt:

- **Test-Repo (Playwright):** als Tags an den `describe`-Blöcken (`@prio-hoch` / `@prio-mittel`), filterbar über `--grep` bzw. die Scripts `npm run test:prio-hoch` / `npm run test:prio-mittel`.
- **API-Repo (Vitest):** über die Kapitelnummer der Testfallgruppe im `describe`-Namen (z. B. `4.1 Happy Path – …`), filterbar über den Namensfilter.

```powershell
# Test-Repo
npx playwright test --grep @prio-hoch
# API-Repo
npx vitest run -t "4.1|4.3|4.4"
```

### 3.5 Nicht im Scope

- Last-/Performancetests
- Security-Tests (AuthN/AuthZ ist nicht implementiert)
- UI-Tests (keine UI vorhanden)
- Tests des Server-Bootstraps (`src/server.ts`, Port-Auflösung) – wird über den manuellen Start (`npm run dev` / `npm start`) abgedeckt

## 4. Testfälle

Die Spalte **Ebene** gibt an, auf welcher Testebene ein Testfall umgesetzt ist: **API** = sowohl In-Process (Supertest, API-Repo) als auch Black-Box (Playwright, Test-Repo); **Unit** = direkter Aufruf des Services bzw. der Validierung (API-Repo). Variadische Fälle sind nur auf Unit-Ebene möglich, da die HTTP-Schnittstelle genau zwei Operanden entgegennimmt.

### 4.1 Happy Path – Grundrechenarten (erwartet: 200 OK)

| ID | Operation | Eingabe | Erwartetes Ergebnis | Ebene |
|---|---|---|---|---|
| TC-ADD-01 | add | 1, 2 | 3 | API + Unit |
| TC-ADD-02 | add | 1, 2, 3, 4 | 10 (variadisch) | Unit |
| TC-ADD-03 | add | −5, 2.5 | −2.5 (negative & dezimale Zahlen) | API + Unit |
| TC-SUB-01 | subtract | 10, 4 | 6 | API + Unit |
| TC-SUB-02 | subtract | 10, 4, 3 | 3 (links-assoziativ) | Unit |
| TC-SUB-03 | subtract | −1, −1 | 0 | API + Unit |
| TC-MUL-01 | multiply | 3, 4 | 12 | API + Unit |
| TC-MUL-02 | multiply | 2, 3, 4 | 24 (variadisch) | Unit |
| TC-MUL-03 | multiply | 5, 0 | 0 | API + Unit |
| TC-MUL-04 | multiply | −2, 2.5 | −5 | API + Unit |
| TC-DIV-01 | divide | 10, 4 | 2.5 | API + Unit |
| TC-DIV-02 | divide | 100, 5, 2 | 10 (verkettete Division, links-assoziativ) | Unit |
| TC-DIV-03 | divide | −9, 3 | −3 | API + Unit |
| TC-DIV-04 | divide | 0, 5 | 0 (Dividend null ist erlaubt) | API + Unit |

Die API-Tests prüfen zusätzlich, dass die Eingabewerte `a` und `b` unverändert in der Response gespiegelt werden.

### 4.2 Dezimal-Randfälle (Präzision, Rundung und Zahlenbereich)

| ID | Operation | Eingabe | Erwartung | Ebene |
|---|---|---|---|---|
| TC-DEC-01 | add | 0.1, 0.2 | 200, Ergebnis **exakt** 0.3 (kein Toleranzvergleich; bei `double` wäre 0.30000000000000004 herausgekommen) | API + Unit |
| TC-DEC-02 | subtract | 1, 0.9 | 200, Ergebnis exakt 0.1 | API + Unit |
| TC-DEC-03 | multiply | 1.1, 1.1 | 200, Ergebnis exakt 1.21 | API + Unit |
| TC-DEC-04 | divide | 1, 3 | 200, Ergebnis 0.3333333333333333333333333333 (28 Nachkommastellen = maximale Genauigkeit, exakter Vergleich) | API + Unit |
| TC-DEC-05 | add | Unit: `MaxValue`, 1 · API: 7e28, 1e28 | 400 Bad Request – arithmetischer Überlauf | API + Unit |
| TC-DEC-06 | subtract | Unit: `MinValue`, 1 · API: −7e28, 1e28 | 400 Bad Request – negativer Überlauf | API + Unit |
| TC-DEC-07 | multiply | 1e15, 1e15 | 400 Bad Request – Überlauf bei Multiplikation (Produkt 10³⁰ > `MaxValue`) | API + Unit |
| TC-DEC-08 | divide | Unit: `MaxValue`, 0.5 · API: 7e28, 0.5 | 400 Bad Request – Überlauf bei Division | API + Unit |
| TC-DEC-09 | divide | 2, 3 | 200, Ergebnis 0.6666666666666666666666666667 (Rundung *half away from zero* an der 28. Nachkommastelle) | API + Unit |
| TC-DEC-10 | add / subtract | `MaxValue`, 0 bzw. `MinValue`, 0 | Ergebnis exakt an der Bereichsgrenze wird akzeptiert (kein Überlauf) | Unit |
| TC-DEC-11 | add / multiply | `MaxValue`, 0, 1 bzw. 1e14, 1e14, 10 | Überlauf in einem **späteren** Rechenschritt wird erkannt (`OverflowError`) | Unit |

> **Hinweis:** `MaxValue`/`MinValue` (±79228162514264337593543950335) sind als JSON-Zahl nicht exakt darstellbar (siehe Kap. 2). Die API-Varianten von TC-DEC-05/06/08 verwenden deshalb Operanden, die selbst innerhalb des Bereichs liegen, deren Ergebnis ihn aber überschreitet, sodass der Überlauf in der Berechnung (nicht in der Validierung) entsteht. Überläufe führen zu einer `OverflowError`, die der `errorHandler` in 400 Bad Request mit `{ "error": "Arithmetic overflow: result exceeds the decimal range" }` übersetzt. Ein `Infinity`/`NaN`-Zustand wie bei `double` wird durch die `isFinite`-Prüfung in `isInDecimalRange` ausgeschlossen.

### 4.3 Division durch null (erwartet: 400 Bad Request)

| ID | Eingabe | Erwartung | Ebene |
|---|---|---|---|
| TC-DIV0-01 | 10, 0 | 400, `{ "error": "Division by zero is not allowed" }` | API + Unit |
| TC-DIV0-02 | 10, −0 | 400 (negative Null wird ebenfalls als null erkannt) | API + Unit |
| TC-DIV0-03 | 10, 2, 0 | `DivisionByZeroError` – null an späterer Divisor-Position (variadisch) | Unit |

### 4.4 Eingabevalidierung (erwartet: 400 Bad Request, alle 4 Endpunkte)

Sofern nicht anders angegeben, lautet die Fehlerantwort `{ "error": "Body must contain finite numbers a and b within the decimal range" }`.

| ID | Eingabe | Erwartung | Ebene |
|---|---|---|---|
| TC-VAL-01 | `{ "a": 42 }` | 400 – nur ein Operand | API + Unit |
| TC-VAL-02 | `[1, 2]` | 400 – JSON-Array statt Objekt | API + Unit |
| TC-VAL-03 | `{ }` | 400 – Felder `a` und `b` fehlen | API + Unit |
| TC-VAL-04 | leerer Body (`Content-Type: application/json`, `Content-Length: 0`) | 400 | API + Unit (`undefined`-Body) |
| TC-VAL-05 | `{ "a": 1, "b": "abc" }` | 400 – ungültiger Typ | API + Unit |
| TC-VAL-06 | syntaktisch ungültiges JSON | 400, `{ "error": "Invalid JSON body" }` (Body-Parser-Fehler) | API |
| TC-VAL-07 | `{ "a": 1, "b": null }` | 400 – explizit null | API + Unit |
| TC-VAL-08 | gültiger Body mit `Content-Type: text/plain` | 400 – der Body wird nicht als JSON geparst und scheitert deshalb an der Validierung (kein 415) | API |
| TC-VAL-09 | Body > 10 kB | 413 Payload Too Large, `{ "error": "Request rejected" }` | API |
| TC-VAL-10 | `{ "a": 1e308, "b": 1 }` | 400 – Zahl außerhalb des `Decimal`-Wertebereichs | API + Unit |
| TC-VAL-11 | `{ "a": 79228162514264337593543950336, "b": 1 }` | 400 – `MaxValue` + 1 (= 2⁹⁶) liegt außerhalb des Bereichs | API + Unit |

Zusätzlich wird bei allen Validierungsfällen die Struktur der Fehlerantwort geprüft: genau ein Feld `error` mit dem erwarteten Text. Auf Unit-Ebene (`isCalculationRequest`) werden ergänzend Werte geprüft, die über JSON nicht transportierbar sind oder nur auf Typebene auftreten: `NaN`, `Infinity`, Boolean, numerische Strings (`"1"`), `null`/String als Body sowie Werte unterhalb von `MinValue` (−1e29).

> **Hinweis zu TC-VAL-04:** Ein JSON-Stringliteral `""` als Body (2 Bytes) ist **kein** leerer Body, sondern syntaktisch ungültiges JSON im strikten Modus des Body-Parsers (→ `Invalid JSON body`). Der Playwright-Test sendet daher bewusst **kein** `data`-Feld, da `data: ""` von Playwright als `""` serialisiert würde.

### 4.5 API-Vertrag / Robustheit

| ID | Prüfung | Erwartung | Ebene |
|---|---|---|---|
| TC-CON-01 | Response-Felder | Genau `operation`, `a`, `b`, `result` | API |
| TC-CON-02 | Header | `Content-Type: application/json` – sowohl bei 200 als auch bei Fehlerantworten | API |
| TC-CON-03 | GET auf POST-Endpunkt | 404 Not Found, `{ "error": "Not found" }` – Express routet methodenspezifisch; es gibt kein 405 | API |
| TC-CON-04 | Unbekannte Operation (z. B. `/modulo`) | 404 Not Found, `{ "error": "Not found" }` | API |
| TC-CON-05 | Unbekannte Zusatzfelder im Body (z. B. `{ "a": 1, "b": 2, "extra": true }`) | 200 – Zusatzfelder werden toleriert (Robustheitsprinzip), Response enthält sie nicht | API + Unit |
| TC-CON-06 | `GET /health` | 200, `{ "status": "ok" }` | API |
| TC-CON-07 | Header `X-Powered-By` | nicht vorhanden (`app.disable("x-powered-by")`) | API |

## 5. Testumgebung

| Aspekt | Lokal | CI (GitHub Actions) |
|---|---|---|
| Betriebssystem | Windows (Entwicklung) | ubuntu-24.04 |
| Node.js | ≥ 24 (`engines` in `package.json` beider Repos) | 24 (`actions/setup-node@v6`, npm-Cache) |
| Abhängigkeiten | `npm install` je Repo | `npm ci` je Repo |
| API-Repo: Testlauf | `npm test` (`vitest run`), `npm run test:watch` – kein laufender Server nötig | `npm run lint`, `npm run typecheck`, `npm test` |
| Test-Repo: API-Start | extern, z. B. `npm run dev` im API-Repo (tsx watch, Port über `PORT`, Standard 3000) | `npm run build` + `npm start` im Hintergrund, Warten auf `GET /health` (max. 30 s) |
| Test-Repo: Testlauf | `npm test` (`playwright test`) gegen laufende API | `npm run typecheck`, `npm test` |
| Basis-URL (Test-Repo) | `http://localhost:3000` (Standard) | `http://localhost:3000` via `API_BASE_URL` |
| Browser | nicht erforderlich (reine API-Tests, kein `playwright install`) | nicht erforderlich |

## 6. CI/CD-Integration (GitHub Actions)

Beide Repositories besitzen eine eigene Pipeline; beide führen die Black-Box-Tests aus, damit sowohl API- als auch Testcode-Änderungen über ein PR-Gate abgesichert sind.

**API-Repository (`calculator_api_ts`)** – Workflow `.github/workflows/ci.yml`:

- **Trigger:** Push und Pull Request auf `main`, zusätzlich manuell (`workflow_dispatch`, dabei ist der Git-Ref des Test-Repos über `tests_ref` wählbar).
- **Job `test` (Lint, Typecheck & Test):**
  1. Checkout (`actions/checkout@v6`), Node 24 einrichten (`actions/setup-node@v6`, npm-Cache)
  2. `npm ci`
  3. `npm run lint` (oxlint, Kategorien `correctness` = error, `suspicious` = warn)
  4. `npm run typecheck` (`tsc --noEmit`)
  5. `npm test` (`vitest run`) – Unit- und In-Process-Tests, erzeugt Konsolen-, HTML- und JUnit-Report
  6. Upload des Verzeichnisses `test-report/` als Workflow-Artefakt `test-report` (`if: always()`)
  7. Nicht bei Pull Requests: Upload von `test-report/` als Pages-Artefakt (`actions/upload-pages-artifact@v5`)
- **Job `api-tests` (Playwright API tests, `needs: test`)** – die Unit-/In-Process-Tests sind das schnelle Quality Gate vor den Black-Box-Tests:
  1. Checkout des API-Repos und des Test-Repos (`Sascha-Pommernell/calculator_api_test_ts`, Pfad `api-tests`, Ref `tests_ref` bzw. `main`)
  2. `npm ci` + `npm run build` der API, Start via `npm start` im Hintergrund (`PORT=3000`), Warten auf `GET /health`
  3. `npm ci` + `npm test` im Test-Repo (`API_BASE_URL=http://localhost:3000`)
  4. Upload von `playwright-report/` und `test-results/` als Artefakt `playwright-report` (`if: always()`); bei Fehlschlag zusätzlich das API-Log
- **Job `deploy-report`** (nur Push/`workflow_dispatch`, `needs: test`, `if: always()`): Veröffentlichung des Vitest-HTML-Reports auf **GitHub Pages** (`actions/deploy-pages@v5`, Environment `github-pages`). Der Report wird auch bei fehlgeschlagenen Tests veröffentlicht.
- **Fehlerverhalten:** Lint-, Typecheck- oder Testfehler brechen den jeweiligen Job ab (PR-Gate über den `pull_request`-Trigger). Es gibt keinen automatischen Retry; Flakiness wird durch zustandslose, deterministische Tests und die Erreichbarkeits-Probe (`/health`) vor dem Black-Box-Lauf vermieden. Wird die API nicht gesund, schlägt der Job `api-tests` hart fehl (kein „grün ohne Tests“).
- **Berechtigungen:** Workflow-weit `contents: read`; der Deploy-Job zusätzlich `pages: write` und `id-token: write`.
- **Voraussetzung:** GitHub Pages mit Quelle „GitHub Actions“.

**Test-Repository (`calculator_api_test_ts`)** – Workflow `.github/workflows/api-tests.yml`:

- **Trigger:** Push und Pull Request auf `main`, zusätzlich manuell (dabei ist der Git-Ref des API-Repos über `api_ref` wählbar).
- **Ablauf:** identisch zum Job `api-tests` oben, mit vertauschten Rollen: API-Repo (`Sascha-Pommernell/calculator_api_ts`) wird in den Pfad `api` ausgecheckt, gebaut und gestartet; anschließend `npm ci`, `npm run typecheck` und `npm test` im Test-Repo; Upload von `playwright-report/` und `test-results/` als Artefakt (bei Fehlschlag zusätzlich das API-Log). Kein Pages-Deployment.

## 7. Berichterstattung

**API-Repo** (Reporter in `vitest.config.ts`):

- **Konsole:** Standard-Reporter von Vitest.
- **HTML-Report:** `test-report/index.html` (Vitest-HTML-Reporter).
- **JUnit-XML:** `test-report/junit.xml` – maschinenlesbar für externe Auswertung.
- **CI:** Testergebnisse im Actions-Log, Verzeichnis `test-report/` als Workflow-Artefakt (Standard-Aufbewahrung des Repositories) und – außer bei Pull Requests – als veröffentlichter HTML-Report auf GitHub Pages:
  `https://sascha-pommernell.github.io/calculator_api_ts/` (jeweils der letzte Lauf; keine Historie).

**Test-Repo** (Reporter in `playwright.config.ts`):

- **Konsole:** `list`-Reporter.
- **HTML-Report:** `playwright-report/index.html`, lokal über `npm run report` (`playwright show-report`).
- **JUnit-XML:** `test-results/junit.xml`.
- **CI:** Ergebnisse im Actions-Log sowie `playwright-report/` und `test-results/` als Workflow-Artefakt `playwright-report` (in beiden Pipelines).

Für Pull Requests stehen alle Reports ausschließlich als Workflow-Artefakt bereit.

## 8. Testorganisation

### 8.1 Rollen und Verantwortlichkeiten

| Rolle | Verantwortlich | Aufgaben |
|---|---|---|
| Testmanager / Testanalyst / Testautomatisierer / Entwickler | Sascha Pommernell (Einzelentwickler) | Testkonzept, Testfallentwurf, Automatisierung, Pflege, Auswertung, Fehlerbehebung |

### 8.2 Eingangskriterien (Entry Criteria)

- Node.js ≥ 24 und npm sind installiert; `npm ci` bzw. `npm install` läuft in beiden Repos fehlerfrei.
- Das API-Repo ist typkorrekt (`npm run typecheck`) und lintfrei (`npm run lint`); das Test-Repo ist typkorrekt (`npm run typecheck`).
- Für die Black-Box-Tests: Eine laufende Instanz der Calculator API ist unter der konfigurierten `API_BASE_URL` erreichbar (Prüfung via `GET /health` im `globalSetup`).

### 8.3 Endekriterien (Exit Criteria / Abnahme)

- Alle Testfälle aus Abschnitt 4 sind auf der angegebenen Ebene automatisiert umgesetzt und über ihre ID im Testnamen auffindbar.
- Alle Tests laufen lokal und in GitHub Actions (beide Pipelines) erfolgreich („grün“); bekannte, als Defect erfasste Abweichungen (siehe Kap. 10) sind dokumentiert.
- Ein PR kann nur gemerged werden, wenn die Pipeline des jeweiligen Repos erfolgreich ist.

### 8.4 Abbruch- und Wiederaufnahmekriterien (Suspension Criteria)

- **Abbruch:** Die Testdurchführung wird ausgesetzt, wenn die Testumgebung nicht herstellbar ist (`npm ci` schlägt fehl, inkompatible Node-Version), die API unter `API_BASE_URL` nicht erreichbar ist (`globalSetup` bricht den Playwright-Lauf ab) oder mehr als 50 % der Tests aufgrund eines Umgebungsproblems fehlschlagen.
- **Wiederaufnahme:** Nach Behebung des blockierenden Problems und erfolgreichem Smoke-Check (ein Happy-Path-Test pro Endpunkt, z. B. `npx playwright test --grep "TC-(ADD|SUB|MUL|DIV)-01"` bzw. `npx vitest run -t "4.1"`) wird die vollständige Testsuite erneut ausgeführt.

## 9. Rückverfolgbarkeit (Traceability)

- Jeder automatisierte Test trägt die Testfall-ID aus Kapitel 4 im Testnamen:
  - **Vitest:** direkt (`it("TC-DEC-01: …")`) oder als erster Parameter einer `it.each`-Tabelle, der über `%s` in den Testnamen eingesetzt wird (z. B. `TC-ADD-01: add(1, 2) = 3`).
  - **Playwright:** als Präfix des Testtitels (`test(\`${id}: …\`)`), ergänzt um Prioritäts-Tags am `describe`-Block.
- `describe`-Blöcke tragen in beiden Repos die Kapitelnummer der Testfallgruppe (`4.1 Happy Path – …`), sodass Gruppen über `vitest run -t` bzw. `playwright test --grep` gefiltert werden können.
- Dadurch ist die Zuordnung Testkonzept ↔ Testcode ↔ Testreport (Konsole/HTML/JUnit) lückenlos möglich.
- Bei Änderungen am Testkonzept werden betroffene Testfall-IDs im Commit/PR referenziert.

## 10. Fehler- und Abweichungsmanagement (Defect Management)

- Gefundene Abweichungen werden als **GitHub Issues** im API-Repository erfasst (Abweichungen im Testcode selbst im Test-Repository).
- Jedes Issue enthält: betroffene Testfall-ID(s), Ist- und Soll-Verhalten, Reproduktionsschritte (Request-Beispiel) und Link zum fehlgeschlagenen Workflow-Lauf.
- Bekannte offene Defects: derzeit keine.
- Historie: Das Testkonzept und das Test-Repo wurden ursprünglich für die .NET-Variante der Calculator API (`calculator-api`, NUnit/Playwright, Body `{ "numbers": [...] }`, Gleitkomma-Fälle TC-FLT-01 bis -06) erstellt und für die TypeScript-Implementierung überarbeitet. Dabei wurden folgende Abweichungen des Vertrags übernommen und als Soll festgeschrieben: Routenpräfix `/api/calculate`, zweistelliger Body `{ "a", "b" }` statt `numbers`-Array (variadische Fälle TC-ADD-02/SUB-02/MUL-02/DIV-02 und TC-DIV0-03 nur auf Unit-Ebene), Fehlerformat `{ "error" }` statt ProblemDetails, 404 statt 405 bei falscher HTTP-Methode (TC-CON-03), 400 statt 415 bei falschem Content-Type (TC-VAL-08), Body-Limit 10 kB/413 (TC-VAL-09) anstelle der Operanden-Obergrenze 1000 sowie die `Decimal`-Fälle TC-DEC-01 bis -11 (exakte Vergleiche, Überlauf an den `Decimal`-Grenzen) anstelle der `double`-Fälle TC-FLT-01 bis -06.

## 11. Wartung und Erweiterung

- Neue Endpunkte oder Operationen erfordern entsprechende neue Testfälle (Happy Path + Negativtests) in **beiden** Repos vor dem Merge; im API-Repo werden neue Operationen über `OPERATIONS` in `src/types/calculator.types.ts` registriert und damit automatisch von den `describe.each`-Validierungstests erfasst, im Test-Repo ist die Liste `OPERATIONS` in `tests/calculator.spec.ts` zu ergänzen.
- Bei Änderungen am Response-Format sind die Vertragstests (4.5) und die Präzisionstests (4.2, Rohvergleich des Bodys) in beiden Repos anzupassen.
- Wird die variadische Form des Services über die HTTP-Schnittstelle exponiert, sind TC-ADD-02/SUB-02/MUL-02/DIV-02 und TC-DIV0-03 zusätzlich als API-Tests (Supertest und Playwright) umzusetzen.
- Cross-Repo-Änderungen (z. B. am Fehlertext) sind so zu sequenzieren, dass die Pipelines beider Repos grün bleiben: zuerst API-Änderung mit `workflow_dispatch` gegen einen Feature-Branch des Test-Repos (`tests_ref`) prüfen, dann beide `main`-Branches aktualisieren.
