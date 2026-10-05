# calculator_api_ts

REST-API eines Taschenrechners (TypeScript, Node.js ≥ 24, Express 5). Die API nimmt **zwei oder mehr Operanden**
entgegen, rechnet **exakt dezimal** (`decimal.js`, Nachbildung von `System.Decimal`: 29 signifikante Stellen,
28 Nachkommastellen, Rundung *half away from zero*) und liefert das Ergebnis ohne Gleitkomma-Rundungsfehler –
`0.1 + 0.2` ergibt exakt `0.3`, `1 ÷ 3` ergibt `0.3333333333333333333333333333`.

Die API ist das Backend der React-Oberfläche [calculator_ui_ts](https://github.com/Sascha-Pommernell/calculator_ui_ts)
und wird durch drei Testebenen abgesichert (siehe [Tests](#tests) und das
[Testkonzept](./docs/Testkonzept.md)).

## Stack

| Bereich       | Technologie                                   |
| ------------- | --------------------------------------------- |
| Laufzeit      | Node.js ≥ 24, ESM                             |
| Framework     | Express 5                                     |
| Sprache       | TypeScript 7 (strict, `NodeNext`)             |
| Arithmetik    | decimal.js (`CalcDecimal`-Klon)               |
| Tests         | Vitest 5, Supertest 7                         |
| Lint          | oxlint                                        |
| CI            | GitHub Actions, Testreport auf GitHub Pages   |

## Schnellstart

```bash
npm install
npm run dev          # tsx watch, Port 3000 (PORT überschreibbar)

curl -X POST http://localhost:3000/api/calculate/add \
     -H "Content-Type: application/json" \
     -d '{"numbers":[1,2,3,4]}'
# {"operation":"add","numbers":[1,2,3,4],"result":10}
```

## Skripte

| Skript               | Zweck                                              |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Dev-Server mit Neustart bei Änderungen (`tsx watch`) |
| `npm run build`      | Kompiliert nach `dist/` (`tsc`)                    |
| `npm start`          | Startet den Build (`node dist/server.js`)          |
| `npm run typecheck`  | `tsc --noEmit`                                     |
| `npm run lint`       | oxlint (`correctness` = error, `suspicious` = warn) |
| `npm test`           | Unit- und In-Process-API-Tests (`vitest run`)      |
| `npm run test:watch` | Tests im Watch-Modus                               |

Umgebungsvariable: `PORT` (Standard `3000`; ungültige Werte brechen den Start ab).

## API

### Endpunkte

| Endpunkt                   | Methode | Operation                         |
| -------------------------- | ------- | --------------------------------- |
| `/api/calculate/add`       | POST    | Addition                          |
| `/api/calculate/subtract`  | POST    | Subtraktion (links-assoziativ)    |
| `/api/calculate/multiply`  | POST    | Multiplikation                    |
| `/api/calculate/divide`    | POST    | Division (links-assoziativ)       |
| `/health`                  | GET     | Erreichbarkeits-Probe `{ "status": "ok" }` |

### Request

```json
{ "numbers": [10, 4, 3] }
```

- `numbers`: Array mit **mindestens zwei** JSON-Zahlen (`MIN_OPERANDS = 2`), keine explizite Obergrenze
  (Body-Limit 10 kB).
- Alle Elemente müssen endlich sein und im `Decimal`-Wertebereich ±79228162514264337593543950335 (≈ ±7,9 × 10²⁸) liegen.
- Die Operanden werden links-assoziativ verknüpft: `subtract [10, 4, 3]` = `(10 − 4) − 3` = `3`,
  `divide [100, 5, 2]` = `10`.
- Unbekannte Zusatzfelder werden toleriert.

### Response (200)

```json
{ "operation": "subtract", "numbers": [10, 4, 3], "result": 3 }
```

`result` wird **nicht** über `JSON.stringify` serialisiert (das würde auf double-Genauigkeit runden), sondern als
handgebauter JSON-String mit der vollen `Decimal`-Genauigkeit ausgegeben. Clients, die alle 28 Nachkommastellen
benötigen, müssen das Literal aus dem rohen Response-Text lesen (so macht es die UI).

### Fehler

Alle Fehler haben die Form `{ "error": string }`:

| Status | Ursache                                                                                     | `error`                                                                             |
| ------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 400    | `numbers` fehlt, kein Array, < 2 Elemente, Element keine endliche Zahl oder außerhalb des Bereichs | `Body must contain an array numbers with at least two finite numbers within the decimal range` |
| 400    | Syntaktisch ungültiges JSON                                                                 | `Invalid JSON body`                                                                 |
| 400    | Division durch null (an beliebiger Divisor-Position)                                        | `Division by zero is not allowed`                                                   |
| 400    | Arithmetischer Überlauf (in einem beliebigen Rechenschritt)                                 | `Arithmetic overflow: result exceeds the decimal range`                             |
| 404    | Unbekannte Route oder HTTP-Methode                                                          | `Not found`                                                                         |
| 413    | Body > 10 kB                                                                                | `Request rejected`                                                                  |
| 500    | Unerwarteter Fehler                                                                         | `Internal server error`                                                             |

Der Header `X-Powered-By` wird nicht gesendet. CORS-Header sind nicht gesetzt – die UI erreicht die API in
Entwicklung und `vite preview` über einen Proxy (Same Origin).

## Projektstruktur

```
src/
├── app.ts                          # Express-App: JSON-Parser (10 kB), /health, Router, Fehler-Middleware
├── server.ts                       # Bootstrap: PORT-Auflösung, app.listen
├── routes/calculator.routes.ts     # POST /api/calculate/:operation, handgebaute JSON-Antwort
├── services/
│   ├── calculator.service.ts       # add/subtract/multiply/divide (variadisch), Fehlerklassen
│   └── decimal.ts                  # CalcDecimal (29 Stellen, ROUND_HALF_UP), Wertebereich
├── validation/calculator.validation.ts  # isCalculationRequest (numbers-Array, Mindestanzahl, Bereich)
├── middleware/error.middleware.ts  # 404-Handler, Fehler → { error }
└── types/calculator.types.ts       # OPERATIONS, MIN_OPERANDS, Request-/Response-Typen

tests/
├── calculator.service.test.ts      # Unit: Rechenlogik, Präzision, Überlauf, Division durch null
├── calculator.validation.test.ts   # Unit: Body-Validierung
└── calculator.routes.test.ts       # In-Process-API-Tests mit Supertest (ohne laufenden Server)

docs/
└── Testkonzept.md                  # Testkonzept für API, UI und beide Test-Repos
```

## Tests

Die Qualitätssicherung folgt dem **[Testkonzept](./docs/Testkonzept.md)** in `docs/`. Es beschreibt
Testgegenstand, Teststrategie, alle Testfälle mit IDs (`TC-ADD-01`, `TC-DEC-04`, `TC-VAL-13`, …), Testumgebung,
CI-Integration, Berichterstattung und Rückverfolgbarkeit für die gesamte Calculator-Landschaft (API, UI und die
beiden Test-Repositories).

| Ebene                         | Repository                | Werkzeuge                      | Was wird geprüft                                                         |
| ----------------------------- | ------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| Unit-Tests                    | dieses Repo (`tests/`)    | Vitest                         | `CalculatorService` (inkl. variadischer Operanden, Rundung, Überlauf), `isCalculationRequest` |
| In-Process-API-Tests          | dieses Repo (`tests/`)    | Vitest + Supertest             | Routing, Middleware, Fehlerbehandlung – ohne laufenden Server            |
| Black-Box-API-Tests           | [calculator_api_test_ts](https://github.com/Sascha-Pommernell/calculator_api_test_ts) | Playwright (`APIRequestContext`) | Vertrag über echtes HTTP gegen eine laufende API                       |
| Black-Box-UI-Tests            | [calculator_ui_tests_ts](https://github.com/Sascha-Pommernell/calculator_ui_tests_ts) | Playwright (Chromium)          | Ablauf über die Oberfläche inkl. Abgleich mit der API als Orakel         |

Jeder Test trägt die Testfall-ID aus Kapitel 4 des Testkonzepts im Namen; die `describe`-Blöcke tragen die
Kapitelnummer der Testfallgruppe, sodass sich Gruppen gezielt ausführen lassen:

```bash
npm test                                   # alle Tests (150)
npx vitest run -t "4.1"                    # nur Happy Path
npx vitest run -t "TC-DEC-04"              # einzelner Testfall
npx vitest run tests/calculator.routes.test.ts
```

Reports (`vitest.config.ts`): Konsole, HTML unter `test-report/index.html`, JUnit unter `test-report/junit.xml`.

## CI/CD

`.github/workflows/ci.yml` (Push/PR auf `main`, manuell mit wählbarem Ref des API-Test-Repos `tests_ref`):

1. **`test`** – `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`; Upload von `test-report/` als Artefakt und
   (außer bei PRs) als Pages-Artefakt
2. **`api-tests`** (`needs: test`) – baut und startet die API, checkt `calculator_api_test_ts` aus und führt dessen
   Playwright-Tests gegen `http://localhost:3000` aus; Upload von `playwright-report/` (API-Log bei Fehlschlag)
3. **`deploy-report`** – veröffentlicht den Vitest-HTML-Report auf GitHub Pages:
   <https://sascha-pommernell.github.io/calculator_api_ts/>

Details zu Ablauf, Fehlerverhalten und den Pipelines der anderen Repositories: [Testkonzept, Kapitel 6](./docs/Testkonzept.md#6-cicd-integration-github-actions).

## Verwandte Repositories

| Repository | Inhalt |
| --- | --- |
| [calculator_ui_ts](https://github.com/Sascha-Pommernell/calculator_ui_ts) | React-UI (Vite), die diese API konsumiert |
| [calculator_api_test_ts](https://github.com/Sascha-Pommernell/calculator_api_test_ts) | Black-Box-API-Tests (Playwright) |
| [calculator_ui_tests_ts](https://github.com/Sascha-Pommernell/calculator_ui_tests_ts) | UI-E2E-Tests (Playwright, Page Object Model) |

## Weiterführende Dokumentation

- **[docs/Testkonzept.md](./docs/Testkonzept.md)** – Testkonzept (Zielsetzung, Testgegenstand API & UI, Strategie,
  Testfälle, Umgebung, CI, Reporting, Traceability, Defect Management, Wartung)
