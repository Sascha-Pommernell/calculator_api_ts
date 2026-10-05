import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { OPERATIONS } from "../src/types/calculator.types.js";
import { VALIDATION_ERROR } from "../src/validation/calculator.validation.js";

const BASE = "/api/calculate";
const OVERFLOW_ERROR = "Arithmetic overflow: result exceeds the decimal range";

describe("POST /api/calculate/:operation", () => {
    describe("4.1 Happy Path – Grundrechenarten (200 OK)", () => {
        it.each([
            ["TC-ADD-01", "add", 1, 2, 3],
            ["TC-ADD-03", "add", -5, 2.5, -2.5],
            ["TC-SUB-01", "subtract", 10, 4, 6],
            ["TC-SUB-03", "subtract", -1, -1, 0],
            ["TC-MUL-01", "multiply", 3, 4, 12],
            ["TC-MUL-03", "multiply", 5, 0, 0],
            ["TC-MUL-04", "multiply", -2, 2.5, -5],
            ["TC-DIV-01", "divide", 10, 4, 2.5],
            ["TC-DIV-03", "divide", -9, 3, -3],
            ["TC-DIV-04", "divide", 0, 5, 0],
        ])("%s: %s(%d, %d) = %d", async (_id, operation, a, b, result) => {
            const res = await request(app).post(`${BASE}/${operation}`).send({ a, b });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ operation, a, b, result });
        });
    });

    describe("4.2 Dezimal-Randfälle – Präzision (200 OK, exakter Vergleich)", () => {
        it.each([
            ["TC-DEC-01", "add", 0.1, 0.2, "0.3"],
            ["TC-DEC-02", "subtract", 1, 0.9, "0.1"],
            ["TC-DEC-03", "multiply", 1.1, 1.1, "1.21"],
            ["TC-DEC-04", "divide", 1, 3, "0.3333333333333333333333333333"],
            ["TC-DEC-09", "divide", 2, 3, "0.6666666666666666666666666667"],
        ])("%s: %s(%d, %d) = exactly %s", async (_id, operation, a, b, expected) => {
            const res = await request(app).post(`${BASE}/${operation}`).send({ a, b });
            expect(res.status).toBe(200);
            // Raw body: JSON.parse would round the 28-digit result to double precision.
            expect(res.text).toBe(`{"operation":"${operation}","a":${a},"b":${b},"result":${expected}}`);
        });
    });

    describe("4.2 Dezimal-Randfälle – Überlauf (400 Bad Request)", () => {
        // Operands lie inside the decimal range so the overflow happens in the calculation itself.
        it.each([
            ["TC-DEC-05", "add", 7e28, 1e28],
            ["TC-DEC-06", "subtract", -7e28, 1e28],
            ["TC-DEC-07", "multiply", 1e15, 1e15],
            ["TC-DEC-08", "divide", 7e28, 0.5],
        ])("%s: %s(%d, %d) overflows", async (_id, operation, a, b) => {
            const res = await request(app).post(`${BASE}/${operation}`).send({ a, b });
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: OVERFLOW_ERROR });
        });
    });

    describe("4.3 Division durch null (400 Bad Request)", () => {
        it.each([
            ["TC-DIV0-01", 10, 0],
            ["TC-DIV0-02", 10, -0],
        ])("%s: divide(%d, %d)", async (_id, a, b) => {
            const res = await request(app).post(`${BASE}/divide`).send({ a, b });
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: "Division by zero is not allowed" });
        });
    });

    describe.each(OPERATIONS)("4.4 Eingabevalidierung – %s (400 Bad Request)", (operation) => {
        const url = `${BASE}/${operation}`;

        it.each([
            ["TC-VAL-01: only one operand", { a: 42 }],
            ["TC-VAL-02: array instead of object", [1, 2]],
            ["TC-VAL-03: empty object", {}],
            ["TC-VAL-05: string operand", { a: 1, b: "abc" }],
            ["TC-VAL-07: null operand", { a: 1, b: null }],
            ["TC-VAL-10: 1e308 exceeds decimal range", { a: 1e308, b: 1 }],
            ["TC-VAL-11: decimal.MaxValue + 1 as literal", { a: 79228162514264337593543950336, b: 1 }],
        ])("%s", async (_label, body) => {
            const res = await request(app).post(url).send(body);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: VALIDATION_ERROR });
        });

        it("TC-VAL-04: empty body", async () => {
            const res = await request(app).post(url).set("Content-Type", "application/json").send("");
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: VALIDATION_ERROR });
        });

        it("TC-VAL-06: malformed JSON", async () => {
            const res = await request(app).post(url).set("Content-Type", "application/json").send("{ not json");
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: "Invalid JSON body" });
        });

        it("TC-VAL-08: valid body with Content-Type text/plain is rejected", async () => {
            const res = await request(app).post(url).set("Content-Type", "text/plain").send('{"a":1,"b":2}');
            // Non-JSON bodies are not parsed, so the request fails validation (400, not 415).
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: VALIDATION_ERROR });
        });

        it("TC-VAL-09: rejects payloads above the 10kb body limit", async () => {
            const res = await request(app).post(url).send({ a: 1, b: 2, padding: "x".repeat(11_000) });
            expect(res.status).toBe(413);
            expect(res.body).toEqual({ error: "Request rejected" });
        });
    });

    describe("4.5 API-Vertrag / Robustheit", () => {
        it("TC-CON-01: response contains exactly operation, a, b, result", async () => {
            const res = await request(app).post(`${BASE}/add`).send({ a: 1, b: 2 });
            expect(res.status).toBe(200);
            expect(Object.keys(res.body).toSorted()).toEqual(["a", "b", "operation", "result"]);
        });

        it("TC-CON-02: responds with Content-Type application/json", async () => {
            const ok = await request(app).post(`${BASE}/add`).send({ a: 1, b: 2 });
            expect(ok.headers["content-type"]).toMatch(/^application\/json/);

            const error = await request(app).post(`${BASE}/divide`).send({ a: 1, b: 0 });
            expect(error.headers["content-type"]).toMatch(/^application\/json/);
        });

        it("TC-CON-03: GET on a POST endpoint returns 404", async () => {
            const res = await request(app).get(`${BASE}/add`);
            // Express routes per method; there is no 405 handling.
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: "Not found" });
        });

        it("TC-CON-04: unknown operation returns 404", async () => {
            const res = await request(app).post(`${BASE}/modulo`).send({ a: 1, b: 2 });
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: "Not found" });
        });

        it("TC-CON-05: unknown extra fields are tolerated", async () => {
            const res = await request(app).post(`${BASE}/add`).send({ a: 1, b: 2, extra: true });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ operation: "add", a: 1, b: 2, result: 3 });
        });

        it("TC-CON-06: GET /health returns ok", async () => {
            const res = await request(app).get("/health");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ok" });
        });

        it("TC-CON-07: does not expose the x-powered-by header", async () => {
            const res = await request(app).get("/health");
            expect(res.headers["x-powered-by"]).toBeUndefined();
        });
    });
});
